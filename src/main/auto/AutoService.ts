import type * as fsPromises from 'fs/promises';
import path from 'path';
import {
  toArchived,
  toDigest,
  toDigestDays,
  toListEvent,
  toQueue,
  toSnapshot,
  toStatus,
  toThread,
  toThreadEvent,
  toThreads,
  toUsage,
  validCursor,
  validThreadId,
} from '@/common/autoModel';
import type {
  AutoConfig,
  AutoFailure,
  AutoResult,
  AutoRoute,
  AutoStreamMessage,
  AutoStreamTarget,
} from '@/types/auto';
import {
  allowSendRequest,
  buildRequest,
  offerKeyRequest,
  sendKeyRequest,
  parseAutoAddress,
  parseAutoConfig,
  serializeAutoConfig,
  streamUrl,
  type BuiltRequest,
} from './autoRequests';
import { SseReader } from './sseReader';

/** The file operations the service uses; Node's `fs/promises` in the app. */
export type AutoFs = Pick<typeof fsPromises, 'readFile' | 'writeFile' | 'rename' | 'mkdir' | 'rm'>;

export interface AutoFetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  /** A redirect could lead to another host, so none is followed. */
  redirect: 'error';
  /** No cookie or saved sign-in goes along. */
  credentials: 'omit';
  cache: 'no-store';
}

export type AutoFetch = (url: string, init: AutoFetchInit) => Promise<Response>;

export interface AutoServiceDependencies {
  userData: string;
  fs: AutoFs;
  /** Electron's `net.fetch` in the app. */
  fetch: AutoFetch;
  onStream?: (message: AutoStreamMessage) => void;
  /** A request with no answer after this long has failed. */
  requestTimeoutMs?: number;
  /** The first wait before a broken stream is opened again; it doubles while the service stays away. */
  reconnectMs?: number;
  /** A stream that sends nothing for this long, not even a heartbeat, is opened again. */
  quietMs?: number;
  /** The largest answer to a request. */
  responseLimit?: number;
}

const CONFIG_FILE = 'auto.json';
const REQUEST_TIMEOUT_MS = 20_000;
const RECONNECT_MS = 3_000;
const RECONNECT_MAX_MS = 30_000;
/** The service sends a heartbeat every 15 s; three missed ones mean the stream is dead. */
const QUIET_MS = 50_000;
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const MESSAGE_LIMIT = 500;

const UNREACHABLE = "Can't reach Auto.";

interface Follow {
  token: number;
  target: AutoStreamTarget;
  cursor: string | null;
  closed: boolean;
  controller: AbortController | null;
  /** Ends the wait before the next try. */
  wake: (() => void) | null;
}

type StreamEnd = { how: 'down' } | { how: 'reset' } | { how: 'gone'; message: string };

class TooLargeError extends Error {}

const fail = (kind: AutoFailure['kind'], message: string, extra: Partial<AutoFailure> = {}): AutoResult<never> => ({
  success: false,
  error: { kind, message, ...extra },
});

const ok = <T>(data: T): AutoResult<T> => ({ success: true, data }) as AutoResult<T>;

/** The body as text, read no further than `limit` bytes. */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (text.length > limit) throw new TooLargeError();
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => undefined);
      throw new TooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** The service's own sentence for an error, cut to a line. */
function errorSentence(data: unknown, status: number): { message: string; code?: string } {
  const error = data && typeof data === 'object' ? (data as { error?: { code?: unknown; message?: unknown } }).error : null;
  const message = error && typeof error.message === 'string' && error.message.trim() ? error.message.slice(0, MESSAGE_LIMIT) : `Auto answered with error ${status}.`;
  return { message, ...(error && typeof error.code === 'string' ? { code: error.code.slice(0, 60) } : {}) };
}

/** What a request's answer holds, read into Opal's shapes; null when it does not fit. */
function shape(kind: AutoRoute['kind'], data: unknown): unknown {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!body) return null;
  switch (kind) {
    case 'status':
    case 'check-status':
      return toStatus(body);
    case 'threads':
      return Array.isArray(body.threads)
        ? { threads: toThreads(body.threads).filter((thread) => !thread.archived), cursor: validCursor(body.cursor) ? body.cursor : null }
        : null;
    case 'archived':
      return toArchived(body);
    case 'thread':
      return toSnapshot(body);
    case 'message':
      return { queued: body.queued === true };
    case 'stop':
      return { returned: toQueue(body.returned) };
    case 'answer':
      return { ok: body.ok === true };
    case 'move':
      return Array.isArray(body.ids) ? { ids: body.ids.filter(validThreadId) } : null;
    case 'digest':
    case 'digest-archive':
    case 'digest-resolve':
    case 'digest-note':
      return toDigest(body);
    case 'digests':
      return toDigestDays(body);
    case 'usage':
      return toUsage(body);
    default: {
      const thread = toThread(body.thread);
      return thread ? { thread } : null;
    }
  }
}

/**
 * Opal's way to the Auto service. It makes every request to the one address
 * in `<userData>/auto.json`, on fixed paths, with a time limit and a size
 * limit, and follows the service's two streams, opening a broken one again
 * after a wait. A folder opened in Opal can never set the address. It holds
 * no sign-in: the service decides who may talk to it.
 */
export class AutoService {
  /** Undefined until the file has been read. */
  private address: string | null | undefined;
  private follows: Record<'list' | 'thread', Follow | null> = { list: null, thread: null };
  private tokens = 0;

  constructor(private deps: AutoServiceDependencies) {}

  private get file(): string {
    return path.join(this.deps.userData, CONFIG_FILE);
  }

  /** The address on disk now. */
  async config(): Promise<AutoConfig> {
    const stored = await this.deps.fs.readFile(this.file, 'utf8').catch((): null => null);
    this.address = parseAutoConfig(stored);
    return { url: this.address };
  }

  private async base(): Promise<string | null> {
    if (this.address === undefined) await this.config();
    return this.address ?? null;
  }

  /** Keeps a new address for this Mac, or forgets it for an empty one. Throws AutoAddressError for one Opal refuses. */
  async setAddress(typed: string): Promise<AutoConfig> {
    const { fs, userData } = this.deps;
    if (typed.trim() === '') {
      await fs.rm(this.file, { force: true });
      this.address = null;
    } else {
      const url = parseAutoAddress(typed);
      await fs.mkdir(userData, { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temp, serializeAutoConfig(url), { mode: 0o600 });
      await fs.rename(temp, this.file);
      this.address = url;
    }
    // Streams of the old address end; the page follows again.
    this.stopAll();
    return { url: this.address };
  }

  async request(route: AutoRoute): Promise<AutoResult<unknown>> {
    const base = await this.base();
    if (!base) return fail('no-address', 'No address is set for Auto.');
    const answer = await this.send(buildRequest(base, route), base);
    if (!answer.success) return answer;
    const data = shape(route.kind, answer.data);
    if (data) return ok(data);
    // The usage is read beside the list and never marks the service out of reach: an answer that does not fit says so.
    return route.kind === 'usage' ? fail('invalid', "Auto's usage answer did not fit.") : fail('unreachable', UNREACHABLE);
  }

  /** Answers a send to allow with this Mac's signature. The thread and question ids are checked by the caller. */
  async allowSend(thread: string, question: string, signature: string): Promise<AutoResult> {
    const base = await this.base();
    if (!base) return fail('no-address', 'No address is set for Auto.');
    const answer = await this.send(allowSendRequest(base, thread, question, signature), base);
    return answer.success ? ok(undefined) : { success: false, error: answer.error };
  }

  /** The codes of the keys the service trusts: `paired` as one code, a list, or codes by device name. */
  async trustedKeys(): Promise<AutoResult<string[]>> {
    const base = await this.base();
    if (!base) return fail('no-address', 'No address is set for Auto.');
    const answer = await this.send(sendKeyRequest(base), base);
    if (!answer.success) return { success: false, error: answer.error };
    const paired = answer.data && typeof answer.data === 'object' ? (answer.data as { paired?: unknown }).paired : null;
    const values = typeof paired === 'string' ? [paired] : Array.isArray(paired) ? paired : paired && typeof paired === 'object' ? Object.values(paired) : [];
    return ok(values.filter((value): value is string => typeof value === 'string'));
  }

  /** Offers this Mac's public key, and answers the code the service worked out for it. */
  async offerKey(key: string, device: string): Promise<AutoResult<{ code: string }>> {
    const base = await this.base();
    if (!base) return fail('no-address', 'No address is set for Auto.');
    const answer = await this.send(offerKeyRequest(base, key, device), base);
    if (!answer.success) return { success: false, error: answer.error };
    const code = answer.data && typeof answer.data === 'object' ? (answer.data as { code?: unknown }).code : null;
    return typeof code === 'string' && /^[0-9a-f]{12}$/.test(code) ? ok({ code }) : fail('unreachable', UNREACHABLE);
  }

  private async send(built: BuiltRequest, base: string): Promise<AutoResult<unknown>> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const response = await this.deps.fetch(built.url, {
        method: built.method,
        headers: built.headers,
        ...(built.body !== undefined ? { body: built.body } : {}),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      // Something other than the service answered, such as a proxy's own page.
      if (!sameOrigin(response.url, base) || !(response.headers.get('content-type') ?? '').includes('application/json')) {
        void response.body?.cancel().catch(() => undefined);
        return fail('unreachable', UNREACHABLE);
      }
      const data: unknown = JSON.parse(await readCapped(response, this.deps.responseLimit ?? RESPONSE_LIMIT));
      if (!response.ok) return fail('refused', errorSentence(data, response.status).message, { status: response.status, ...codeOf(data, response.status) });
      return ok(data);
    } catch (error) {
      if (error instanceof TooLargeError) return fail('unreachable', "Auto's answer was too large to read.");
      return fail('unreachable', timedOut ? 'Auto did not answer in time.' : UNREACHABLE);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Follows a stream, in place of the one of its kind followed before. */
  async follow(target: AutoStreamTarget): Promise<AutoResult<{ token: number }>> {
    this.unfollow(target.stream);
    const base = await this.base();
    if (!base) return fail('no-address', 'No address is set for Auto.');
    this.tokens += 1;
    const follow: Follow = { token: this.tokens, target, cursor: target.cursor, closed: false, controller: null, wake: null };
    this.follows[target.stream] = follow;
    void this.run(base, follow);
    return ok({ token: follow.token });
  }

  unfollow(stream: 'list' | 'thread'): void {
    const follow = this.follows[stream];
    if (!follow) return;
    this.follows[stream] = null;
    follow.closed = true;
    follow.controller?.abort();
    follow.wake?.();
  }

  /** Ends both streams, as when Opal quits. */
  stopAll(): void {
    this.unfollow('list');
    this.unfollow('thread');
  }

  private emit(follow: Follow, message: AutoStreamMessage): void {
    if (!follow.closed) this.deps.onStream?.(message);
  }

  private async run(base: string, follow: Follow): Promise<void> {
    const first = this.deps.reconnectMs ?? RECONNECT_MS;
    let wait = first;
    let asked: number | null = null;
    let down = false;
    while (!follow.closed) {
      const end = await this.read(base, follow, {
        opened: () => {
          down = false;
          wait = asked ?? first;
          this.emit(follow, { token: follow.token, type: 'open' });
        },
        retry: (ms) => {
          asked = Math.min(Math.max(ms, 500), RECONNECT_MAX_MS);
          wait = asked;
        },
      });
      if (follow.closed) return;
      if (end.how === 'gone') {
        this.emit(follow, { token: follow.token, type: 'closed', message: end.message });
        this.end(follow);
        return;
      }
      if (end.how === 'reset') {
        // The page fetches again and follows from the new cursor.
        this.end(follow);
        return;
      }
      if (!down) this.emit(follow, { token: follow.token, type: 'down' });
      down = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait);
        follow.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      follow.wake = null;
      wait = Math.min(wait * 2, RECONNECT_MAX_MS);
    }
  }

  private end(follow: Follow): void {
    follow.closed = true;
    if (this.follows[follow.target.stream] === follow) this.follows[follow.target.stream] = null;
  }

  /** One connection of a stream, from its cursor until it breaks. */
  private async read(base: string, follow: Follow, on: { opened: () => void; retry: (ms: number) => void }): Promise<StreamEnd> {
    const controller = new AbortController();
    follow.controller = controller;
    const quietMs = this.deps.quietMs ?? QUIET_MS;
    let quiet = setTimeout(() => controller.abort(), quietMs);
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => controller.abort(), quietMs);
    };
    try {
      const response = await this.deps.fetch(streamUrl(base, { ...follow.target, cursor: follow.cursor }), {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...(follow.cursor ? { 'Last-Event-ID': follow.cursor } : {}) },
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      const type = response.headers.get('content-type') ?? '';
      if (!sameOrigin(response.url, base)) return { how: 'down' };
      if (response.status === 404 && type.includes('application/json')) {
        const data: unknown = JSON.parse(await readCapped(response, 64 * 1024));
        return { how: 'gone', message: errorSentence(data, 404).message };
      }
      if (!response.ok || !type.includes('text/event-stream') || !response.body) {
        void response.body?.cancel().catch(() => undefined);
        return { how: 'down' };
      }
      on.opened();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sse = new SseReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || follow.closed) return { how: 'down' };
        heard();
        const piece = sse.push(decoder.decode(value, { stream: true }));
        if (piece.retry !== null) on.retry(piece.retry);
        for (const event of piece.events) {
          if (validCursor(event.id)) follow.cursor = event.id;
          let data: unknown;
          try {
            data = JSON.parse(event.data);
          } catch {
            continue;
          }
          if (follow.target.stream === 'list') {
            const shaped = toListEvent(event.event, data);
            if (shaped) this.emit(follow, { token: follow.token, type: 'event', stream: 'list', event: shaped, cursor: follow.cursor });
          } else {
            const shaped = toThreadEvent(event.event, data);
            if (shaped) this.emit(follow, { token: follow.token, type: 'event', stream: 'thread', event: shaped, cursor: follow.cursor });
          }
          if (event.event === 'reset') {
            controller.abort();
            return { how: 'reset' };
          }
        }
      }
    } catch {
      return { how: 'down' };
    } finally {
      clearTimeout(quiet);
      if (follow.controller === controller) follow.controller = null;
      // Nothing is left reading a connection that broke.
      controller.abort();
    }
  }
}

function codeOf(data: unknown, status: number): { code?: string } {
  const { code } = errorSentence(data, status);
  return code ? { code } : {};
}

/** Whether an answer came from the address asked. A fake or test answer with no URL passes. */
function sameOrigin(answered: string, base: string): boolean {
  if (!answered) return true;
  try {
    return new URL(answered).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
