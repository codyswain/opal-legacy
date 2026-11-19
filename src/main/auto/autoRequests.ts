import { modeChoice, replyChoice } from '@/common/autoReplyModel';
import {
  NOTE_LIMIT,
  RESOLVE_LIMIT,
  TEXT_LIMIT,
  WAIT_SAY_LIMIT,
  validCid,
  validCursor,
  validDate,
  validEntryId,
  validThreadId,
} from '@/common/autoModel';
import type { AutoAnswer, AutoRoute, AutoStreamTarget } from '@/types/auto';

/*
 * The rules for talking to the Auto service: which address Opal accepts,
 * which requests the page may ask for, and how each becomes a fixed path
 * under that address. Nothing the page sends is ever used as a URL or as
 * part of one except a checked thread id and a checked cursor.
 */

/** The name Opal gives itself on every write, as the service asks of a client that is not its own page. */
export const CLIENT_NAME = 'opal';

/** The most archived threads one read may ask for by number; all of them is asked for with no number. */
export const ARCHIVED_LIMIT = 500;

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

/** The yes to a send he allowed on this Mac, with the signature made here after Touch ID. */
export const allowSendRequest = (base: string, thread: string, question: string, signature: string): BuiltRequest =>
  post(base, `/api/threads/${thread}/answer`, { id: question, allow: true, signature });

/** The code of the key the service trusts for this Mac (`paired`), if any. */
export const sendKeyRequest = (base: string): BuiltRequest => get(base, '/api/phone-key?device=macbook-pro');

/** Offers this Mac's public key; it is trusted only once pair-phone.sh is run on the Mini with its code. */
export const offerKeyRequest = (base: string, key: string, device: string): BuiltRequest => post(base, '/api/phone-key', { key, device });

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
    case 'archived':
      // What he archived. The limit is a whole number checked before it reaches the path.
      return get(base, route.limit === null ? '/api/threads?archived=1' : `/api/threads?archived=1&limit=${route.limit}`);
    case 'thread':
      return get(base, `/api/threads/${route.id}`);
    case 'create':
      // A mode travels only when one is set, so an older service sees the body it knows.
      return post(base, '/api/threads', { text: route.text, ...replyChoice(route), ...(route.mode ? { mode: route.mode, agentsModel: route.agentsModel ?? '' } : {}), cid: route.cid });
    case 'message':
      return post(base, `/api/threads/${route.id}/messages`, { text: route.text, cid: route.cid });
    case 'stop':
      return post(base, `/api/threads/${route.id}/stop`, {});
    case 'answer':
      return post(base, `/api/threads/${route.id}/answer`, answerBody(route.answer));
    case 'model':
      return post(base, `/api/threads/${route.id}/model`, { ...replyChoice(route) });
    case 'mode':
      return post(base, `/api/threads/${route.id}/mode`, { mode: route.mode, agentsModel: route.agentsModel });
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
      // With a wait and no time, the service's own give-up time applies, so `until` is left out; alone, null brings the thread back.
      return post(base, `/api/threads/${route.id}/snooze`, {
        ...(route.wait && route.until === null ? {} : { until: route.until }),
        ...(route.wait ? { wait: { say: route.wait.say } } : {}),
      });
    case 'start':
      return post(base, `/api/threads/${route.id}/start`, {});
    case 'desk':
      return post(base, `/api/threads/${route.id}/desk`, { on: route.on });
    case 'digest':
      return get(base, route.date ? `/api/digest?date=${route.date}` : '/api/digest');
    case 'digests':
      return get(base, '/api/digests');
    case 'usage':
      // Read only, and nothing from the page goes into the path.
      return get(base, '/api/usage');
    case 'digest-archive':
      return post(base, '/api/digest/archive', { date: route.date, archived: route.archived });
    case 'digest-resolve':
      return post(base, '/api/digest/resolve', {
        date: route.date,
        ...(route.ids.length === 1 ? { id: route.ids[0] } : { ids: route.ids }),
        resolved: route.resolved,
      });
    case 'digest-note':
      return post(base, '/api/digest/note', { date: route.date, id: route.id, text: route.text });
    case 'digest-thread':
      // With his words the thread starts with them; without, it waits on top of the list.
      return post(base, '/api/digest/thread', {
        date: route.date,
        id: route.id,
        ...replyChoice(route),
        ...(route.words !== null ? { words: route.words, ...(route.cid ? { cid: route.cid } : {}) } : { start: false }),
      });
    case 'digest-continue':
      // Into the thread the entry matches, as one message with his note and his words. Nothing in it is a send.
      return post(base, '/api/digest/continue', {
        date: route.date,
        id: route.id,
        ...replyChoice(route),
        thread: route.thread,
        ...(route.words !== null ? { words: route.words } : {}),
        ...(route.cid !== null ? { cid: route.cid } : {}),
      });
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
    case 'create': {
      const choice = replyChoice(route);
      const mode = route.mode === undefined && route.agentsModel === undefined ? {} : modeChoice(route);
      return words(route.text) && choice && mode && validCid(route.cid)
        ? { kind: 'create', text: route.text, ...choice, ...mode, cid: route.cid }
        : null;
    }
    case 'archived':
      return route.limit === null || (Number.isInteger(route.limit) && (route.limit as number) > 0 && (route.limit as number) <= ARCHIVED_LIMIT)
        ? { kind: 'archived', limit: route.limit as number | null }
        : null;
    case 'digests':
      return { kind: 'digests' };
    case 'usage':
      return { kind: 'usage' };
    case 'digest':
      return route.date === null || validDate(route.date) ? { kind: 'digest', date: route.date as string | null } : null;
    case 'digest-archive':
      return validDate(route.date) && typeof route.archived === 'boolean' ? { kind: 'digest-archive', date: route.date, archived: route.archived } : null;
    case 'digest-resolve':
    case 'digest-note':
    case 'digest-thread':
    case 'digest-continue':
      return validDigestRoute(route);
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
    case 'model': {
      const choice = replyChoice(route);
      return choice ? { kind: 'model', id, ...choice } : null;
    }
    case 'mode': {
      const choice = modeChoice(route);
      return choice ? { kind: 'mode', id, ...choice } : null;
    }
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
    case 'snooze': {
      if (!(route.until === null || (typeof route.until === 'number' && Number.isFinite(route.until) && route.until > 0))) return null;
      const until = route.until as number | null;
      if (route.wait === undefined) return { kind: 'snooze', id, until };
      // Put away until someone replies: who or what he waits for, in his own words, and nothing else of what the page sent.
      const wait = route.wait && typeof route.wait === 'object' ? (route.wait as Fields) : null;
      return wait && words(wait.say, WAIT_SAY_LIMIT) ? { kind: 'snooze', id, until, wait: { say: wait.say.trim() } } : null;
    }
    case 'desk':
      return typeof route.on === 'boolean' ? { kind: 'desk', id, on: route.on } : null;
    default:
      return null;
  }
}

/**
 * A write to a day's digest: its day and every entry id are checked before
 * anything is sent. Opal resolves, notes, makes threads and adds an entry to
 * the thread it matches; it never ticks a box by number and never asks the
 * service to fill the inbox.
 */
function validDigestRoute(route: Fields): AutoRoute | null {
  if (!validDate(route.date)) return null;
  const date = route.date;
  if (route.kind === 'digest-resolve') {
    const ids = route.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > RESOLVE_LIMIT || !ids.every(validEntryId)) return null;
    if (new Set(ids).size !== ids.length || typeof route.resolved !== 'boolean') return null;
    return { kind: 'digest-resolve', date, ids: [...(ids as string[])], resolved: route.resolved };
  }
  if (!validEntryId(route.id)) return null;
  const id = route.id;
  if (route.kind === 'digest-note') {
    return typeof route.text === 'string' && route.text.length <= NOTE_LIMIT && !route.text.includes('\0')
      ? { kind: 'digest-note', date, id, text: route.text.trim() }
      : null;
  }
  const choice = route.model === undefined && route.effort === undefined && route.speed === undefined ? {} : replyChoice(route);
  if (!choice) return null;
  if (route.kind === 'digest-continue') {
    // The thread it goes into is the one the entry was shown to match; words and the client's id are each optional.
    if (!validThreadId(route.thread)) return null;
    if (!(route.words === null || words(route.words)) || !(route.cid === null || validCid(route.cid))) return null;
    return { kind: 'digest-continue', date, id, ...choice, thread: route.thread, words: route.words as string | null, cid: route.cid as string | null };
  }
  if (route.words === null) return route.cid === null ? { kind: 'digest-thread', date, id, ...choice, words: null, cid: null } : null;
  return words(route.words) && validCid(route.cid) ? { kind: 'digest-thread', date, id, ...choice, words: route.words, cid: route.cid } : null;
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
