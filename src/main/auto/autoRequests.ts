import { TEXT_LIMIT, validCid, validCursor, validModel, validThreadId } from '@/common/autoModel';
import type { AutoAnswer, AutoRoute, AutoStreamTarget } from '@/types/auto';

/*
 * The rules for talking to the Auto service: which address Opal accepts,
 * which requests the page may ask for, and how each becomes a fixed path
 * under that address. Nothing the page sends is ever used as a URL or as
 * part of one except a checked thread id and a checked cursor.
 */

/** The name Opal gives itself on every write, as the service asks of a client that is not its own page. */
export const CLIENT_NAME = 'opal';

export class AutoAddressError extends Error {}

const LOOPBACK_V4 = /^127(?:\.\d{1,3}){3}$/;

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || LOOPBACK_V4.test(hostname);
}

/**
 * The address as Opal keeps it: https, or http for this Mac only, with no
 * sign-in, query or fragment, and no slash at its end. Throws a sentence
 * that can be shown under the field.
 */
export function parseAutoAddress(typed: string): string {
  const written = typed.trim();
  if (!written) throw new AutoAddressError('Enter the address of your Auto service.');
  if (written.length > 2_000) throw new AutoAddressError('That address is too long.');
  let url: URL;
  try {
    url = new URL(written);
  } catch {
    throw new AutoAddressError('That is not an address. It looks like https://host.example/agent.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new AutoAddressError('The address must start with https://. Only an address on this Mac may use http://.');
  }
  if (url.username || url.password) throw new AutoAddressError('The address cannot hold a name or password.');
  if (url.search || url.hash) throw new AutoAddressError('The address cannot hold a ? or a #.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The address in `<userData>/auto.json`, or null when the file is missing, broken or holds an address Opal refuses. */
export function parseAutoConfig(json: string | null): string | null {
  if (!json) return null;
  try {
    const stored = JSON.parse(json) as { version?: unknown; url?: unknown } | null;
    if (!stored || typeof stored !== 'object' || stored.version !== 1 || typeof stored.url !== 'string') return null;
    return parseAutoAddress(stored.url);
  } catch {
    return null;
  }
}

export const serializeAutoConfig = (url: string): string => `${JSON.stringify({ version: 1, url }, null, 2)}\n`;

export interface BuiltRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

const get = (base: string, path: string): BuiltRequest => ({
  url: `${base}${path}`,
  method: 'GET',
  headers: { Accept: 'application/json' },
});

/**
 * A write: a POST with a JSON object body and the client's name. It carries
 * no Origin, which is what marks it as a native client's.
 */
const post = (base: string, path: string, body: Record<string, unknown>): BuiltRequest => ({
  url: `${base}${path}`,
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Auto-Client': CLIENT_NAME },
  body: JSON.stringify(body),
});

/**
 * The request for a route. Each body is built from named fields, so nothing
 * else the page sent can ride along: in particular no body ever marks a
 * message as a send request.
 */
export function buildRequest(base: string, route: AutoRoute): BuiltRequest {
  switch (route.kind) {
    case 'status':
      return get(base, '/api/status');
    case 'check-status':
      return post(base, '/api/status/check', {});
    case 'threads':
      return get(base, '/api/threads');
    case 'thread':
      return get(base, `/api/threads/${route.id}`);
    case 'create':
      return post(base, '/api/threads', { text: route.text, model: route.model, cid: route.cid });
    case 'message':
      return post(base, `/api/threads/${route.id}/messages`, { text: route.text, cid: route.cid });
    case 'stop':
      return post(base, `/api/threads/${route.id}/stop`, {});
    case 'answer':
      return post(base, `/api/threads/${route.id}/answer`, answerBody(route.answer));
    case 'model':
      return post(base, `/api/threads/${route.id}/model`, { model: route.model });
    case 'rename':
      return post(base, `/api/threads/${route.id}/rename`, { title: route.title });
    case 'archive':
      return post(base, `/api/threads/${route.id}/archive`, {
        archived: route.archived,
        ...(route.archived && route.done ? { done: true } : {}),
      });
    case 'move':
      return post(base, `/api/threads/${route.id}/move`, { before: route.before });
    case 'snooze':
      return post(base, `/api/threads/${route.id}/snooze`, { until: route.until });
    case 'start':
      return post(base, `/api/threads/${route.id}/start`, {});
  }
}

function answerBody(answer: AutoAnswer): Record<string, unknown> {
  if (answer.answers) return { id: answer.id, answers: answer.answers };
  return { id: answer.id, allow: answer.allow, ...(answer.allow === false && answer.message ? { message: answer.message } : {}) };
}

/** A stream's address, from the cursor the snapshot or the last event gave. */
export function streamUrl(base: string, target: AutoStreamTarget): string {
  const path = target.stream === 'list' ? '/api/events' : `/api/threads/${target.id}/events`;
  return `${base}${path}${target.cursor ? `?last=${encodeURIComponent(target.cursor)}` : ''}`;
}

type Fields = Record<string, unknown>;

const words = (value: unknown, limit = TEXT_LIMIT): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= limit && !value.includes('\0');

function validAnswer(value: unknown): AutoAnswer | null {
  if (!value || typeof value !== 'object') return null;
  const answer = value as Fields;
  if (!validThreadId(answer.id)) return null;
  if (typeof answer.allow === 'boolean') {
    if (answer.message !== undefined && !(typeof answer.message === 'string' && answer.message.length <= TEXT_LIMIT)) return null;
    return { id: answer.id, allow: answer.allow, ...(typeof answer.message === 'string' && answer.message ? { message: answer.message } : {}) };
  }
  if (!answer.answers || typeof answer.answers !== 'object' || Array.isArray(answer.answers)) return null;
  const answers: Record<string, string | string[]> = {};
  const entries = Object.entries(answer.answers as Fields);
  if (entries.length === 0 || entries.length > 24) return null;
  for (const [question, picked] of entries) {
    if (!words(question)) return null;
    if (Array.isArray(picked)) {
      if (picked.length === 0 || picked.length > 24 || !picked.every((label) => words(label))) return null;
      answers[question] = picked as string[];
    } else if (words(picked)) {
      answers[question] = picked;
    } else {
      return null;
    }
  }
  return { id: answer.id, answers };
}

/**
 * A route as the page must send it, rebuilt field by field, or null. A
 * thread id that is not letters, digits, `-` and `_` never reaches a path.
 */
export function validRoute(value: unknown): AutoRoute | null {
  if (!value || typeof value !== 'object') return null;
  const route = value as Fields;
  switch (route.kind) {
    case 'status':
    case 'check-status':
    case 'threads':
      return { kind: route.kind };
    case 'create':
      return words(route.text) && validModel(route.model) && validCid(route.cid)
        ? { kind: 'create', text: route.text, model: route.model, cid: route.cid }
        : null;
    default:
  }
  if (!validThreadId(route.id)) return null;
  const id = route.id;
  switch (route.kind) {
    case 'thread':
    case 'stop':
    case 'start':
      return { kind: route.kind, id };
    case 'message':
      return words(route.text) && validCid(route.cid) ? { kind: 'message', id, text: route.text, cid: route.cid } : null;
    case 'answer': {
      const answer = validAnswer(route.answer);
      return answer ? { kind: 'answer', id, answer } : null;
    }
    case 'model':
      return validModel(route.model) ? { kind: 'model', id, model: route.model } : null;
    case 'rename':
      return words(route.title, 300) ? { kind: 'rename', id, title: route.title.trim() } : null;
    case 'archive':
      return typeof route.archived === 'boolean'
        ? { kind: 'archive', id, archived: route.archived, ...(route.done === true ? { done: true } : {}) }
        : null;
    case 'move':
      return route.before === null || (validThreadId(route.before) && route.before !== id)
        ? { kind: 'move', id, before: route.before as string | null }
        : null;
    case 'snooze':
      return route.until === null || (typeof route.until === 'number' && Number.isFinite(route.until) && route.until > 0)
        ? { kind: 'snooze', id, until: route.until as number | null }
        : null;
    default:
      return null;
  }
}

/** A stream to follow as the page must name it, or null. */
export function validStreamTarget(value: unknown): AutoStreamTarget | null {
  if (!value || typeof value !== 'object') return null;
  const target = value as Fields;
  if (target.cursor !== null && !validCursor(target.cursor)) return null;
  const cursor = target.cursor as string | null;
  if (target.stream === 'list') return { stream: 'list', cursor };
  return target.stream === 'thread' && validThreadId(target.id) ? { stream: 'thread', id: target.id, cursor } : null;
}
