import type {
  AutoAsk,
  AutoDigest,
  AutoDigestDays,
  AutoDigestEntry,
  AutoDigestKind,
  AutoDigestSection,
  AutoItem,
  AutoListEvent,
  AutoLive,
  AutoQuestion,
  AutoQuestionPart,
  AutoQueued,
  AutoSent,
  AutoSnapshot,
  AutoStatus,
  AutoStep,
  AutoThread,
  AutoThreadEvent,
  AutoThreadStatus,
} from '@/types/auto';

/*
 * Everything the service sends is read here before Opal keeps it. The service
 * runs on another machine, so its answers are untrusted: every field is
 * checked for its type, long text is cut, long lists are cut, and anything
 * that does not fit is left out. Nothing here throws on a strange answer.
 */

/** The longest message, answer or deny message the service takes. */
export const TEXT_LIMIT = 100_000;
/** The longest reply or history item Opal keeps; the rest is cut. */
const ITEM_TEXT_LIMIT = 400_000;
const LINE_LIMIT = 2_000;
const TITLE_LIMIT = 300;
const THREADS_LIMIT = 2_000;
const ITEMS_LIMIT = 5_000;
const STEPS_LIMIT = 500;
const OPTIONS_LIMIT = 24;
const QUEUE_LIMIT = 100;
const NEXT_LIMIT = 6;

/** A thread id as it may go into a path: letters, digits, `-` and `_`. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A stream cursor: `<boot>.<n>`. */
const CURSOR = /^[A-Za-z0-9._-]{1,80}$/;
/** A client's id for one message. */
const CID = /^[A-Za-z0-9]{1,40}$/;
const MODEL = /^[a-z0-9-]{0,32}$/;
/** A digest's day. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A digest entry's id: the service makes it from lower-case letters, digits and hyphens. */
const ENTRY_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** The longest note on a digest entry the service takes. */
export const NOTE_LIMIT = 4_000;
/** The most entries one resolve may name. */
export const RESOLVE_LIMIT = 200;

export const validThreadId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
export const validCursor = (value: unknown): value is string => typeof value === 'string' && CURSOR.test(value);
export const validCid = (value: unknown): value is string => typeof value === 'string' && CID.test(value);
export const validModel = (value: unknown): value is string => typeof value === 'string' && MODEL.test(value);
export const validDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value);
export const validEntryId = (value: unknown): value is string => typeof value === 'string' && ENTRY_ID.test(value);

type Fields = Record<string, unknown>;

const fields = (value: unknown): Fields | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null;

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '');

const optional = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value !== '' ? value.slice(0, limit) : null;

const time = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000) : 0;

const list = (value: unknown, limit: number): unknown[] => (Array.isArray(value) ? value.slice(0, limit) : []);

const STATUSES: readonly AutoThreadStatus[] = ['idle', 'queued', 'working', 'waiting', 'stopped', 'failed'];

function toAsk(value: unknown): AutoAsk | null {
  const ask = fields(value);
  if (!ask || !validThreadId(ask.id)) return null;
  const options = list(ask.options, OPTIONS_LIMIT).filter((label): label is string => typeof label === 'string' && label !== '');
  const question = optional(ask.question, TEXT_LIMIT);
  return {
    id: ask.id,
    kind: ask.kind === 'permission' ? 'permission' : 'ask',
    text: text(ask.text, LINE_LIMIT),
    // Buttons need the question they answer; without it the thread is opened instead.
    options: question ? options.map((label) => label.slice(0, LINE_LIMIT)) : [],
    question: question && options.length > 0 ? question : null,
  };
}

/** A list entry, or null for anything without a usable id. */
export function toThread(value: unknown): AutoThread | null {
  const thread = fields(value);
  if (!thread || !validThreadId(thread.id)) return null;
  const digest = fields(thread.digest);
  const desk = fields(thread.desk);
  const status = STATUSES.find((name) => name === thread.status) ?? 'idle';
  return {
    id: thread.id,
    title: text(thread.title, TITLE_LIMIT),
    status,
    last: text(thread.last, LINE_LIMIT),
    activity: text(thread.activity, LINE_LIMIT),
    ask: toAsk(thread.ask),
    unread: thread.unread === true,
    model: validModel(thread.model) ? thread.model : '',
    created: time(thread.created) ?? 0,
    updated: time(thread.updated) ?? 0,
    error: optional(thread.error, LINE_LIMIT),
    queued: count(thread.queued),
    archived: thread.archived === true,
    snoozed: time(thread.snoozed),
    woke: time(thread.woke),
    digest:
      digest && typeof digest.date === 'string' && typeof digest.id === 'string'
        ? { date: digest.date.slice(0, 40), id: digest.id.slice(0, 200) }
        : null,
    waits: thread.waits === true,
    desk: desk ? { at: time(desk.at) ?? 0, by: text(desk.by, 40) } : null,
  };
}

export function toThreads(value: unknown): AutoThread[] {
  const seen = new Set<string>();
  return list(value, THREADS_LIMIT).flatMap((entry) => {
    const thread = toThread(entry);
    if (!thread || seen.has(thread.id)) return [];
    seen.add(thread.id);
    return [thread];
  });
}

function toStep(value: unknown): AutoStep | null {
  const step = fields(value);
  if (!step || typeof step.g !== 'string') return null;
  return { g: step.g.slice(0, 200), text: text(step.text, LINE_LIMIT), path: optional(step.path, 1_024) };
}

/** One item of a thread, or null for a role Opal does not know. */
export function toItem(value: unknown): AutoItem | null {
  const item = fields(value);
  if (!item) return null;
  switch (item.role) {
    case 'user':
      return { role: 'user', text: text(item.text, ITEM_TEXT_LIMIT), cid: validCid(item.cid) ? item.cid : null };
    case 'assistant':
      return { role: 'assistant', text: text(item.text, ITEM_TEXT_LIMIT), open: item.open === true };
    case 'steps':
      return {
        role: 'steps',
        steps: list(item.steps, STEPS_LIMIT).flatMap((entry) => {
          const step = toStep(entry);
          return step ? [step] : [];
        }),
      };
    case 'asked':
      return { role: 'asked', text: text(item.text, TEXT_LIMIT), answer: text(item.answer, TEXT_LIMIT) };
    case 'note':
      return { role: 'note', text: text(item.text, LINE_LIMIT) };
    default:
      return null;
  }
}

const toItems = (value: unknown): AutoItem[] =>
  list(value, ITEMS_LIMIT).flatMap((entry) => {
    const item = toItem(entry);
    return item ? [item] : [];
  });

function toPart(value: unknown): AutoQuestionPart | null {
  const part = fields(value);
  if (!part || typeof part.question !== 'string' || part.question === '') return null;
  return {
    question: part.question.slice(0, TEXT_LIMIT),
    header: text(part.header, LINE_LIMIT),
    multiSelect: part.multiSelect === true,
    options: list(part.options, OPTIONS_LIMIT).flatMap((entry) => {
      const option = fields(entry);
      return option && typeof option.label === 'string' && option.label !== ''
        ? [{ label: option.label.slice(0, LINE_LIMIT), description: text(option.description, LINE_LIMIT) }]
        : [];
    }),
  };
}

/** An open question or permission request, or null. */
export function toQuestion(value: unknown): AutoQuestion | null {
  const question = fields(value);
  if (!question || !validThreadId(question.id)) return null;
  if (question.kind === 'permission') {
    return {
      id: question.id,
      kind: 'permission',
      tool: text(question.tool, LINE_LIMIT),
      title: text(question.title, LINE_LIMIT),
      detail: text(question.detail, TEXT_LIMIT),
      reason: text(question.reason, LINE_LIMIT),
    };
  }
  if (question.kind !== 'ask') return null;
  const questions = list(question.questions, OPTIONS_LIMIT).flatMap((entry) => {
    const part = toPart(entry);
    return part ? [part] : [];
  });
  return questions.length > 0 ? { id: question.id, kind: 'ask', questions } : null;
}

export function toQueue(value: unknown): AutoQueued[] {
  return list(value, QUEUE_LIMIT).flatMap((entry) => {
    const queued = fields(entry);
    return queued && typeof queued.text === 'string'
      ? [{ cid: validCid(queued.cid) ? queued.cid : '', text: queued.text.slice(0, TEXT_LIMIT) }]
      : [];
  });
}

/** Follow-ups, exactly as given: only non-strings and anything past the first few are left out. */
export function toNext(value: unknown): string[] {
  return list(value, NEXT_LIMIT)
    .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
    .map((line) => line.slice(0, LINE_LIMIT));
}

const liveState = (value: unknown): AutoLive['state'] =>
  value === 'queued' || value === 'waiting' ? value : 'working';

function toLive(value: unknown): AutoLive | null {
  const live = fields(value);
  if (!live) return null;
  return {
    items: toItems(live.items),
    activity: text(live.activity, LINE_LIMIT),
    state: liveState(live.state),
    question: toQuestion(live.question),
  };
}

function toSent(value: unknown): AutoSent | null {
  const sent = fields(value);
  if (!sent) return null;
  return {
    at: time(sent.at) ?? 0,
    to: list(sent.to, 50).filter((address): address is string => typeof address === 'string').map((address) => address.slice(0, 320)),
    subject: text(sent.subject, LINE_LIMIT),
  };
}

/** A thread's snapshot, or null when it names no thread. */
export function toSnapshot(value: unknown): AutoSnapshot | null {
  const snapshot = fields(value);
  const thread = snapshot ? toThread(snapshot.thread) : null;
  if (!snapshot || !thread) return null;
  return {
    thread,
    items: toItems(snapshot.items),
    live: toLive(snapshot.live),
    queue: toQueue(snapshot.queue),
    unsent: optional(snapshot.unsent, TEXT_LIMIT),
    next: toNext(snapshot.next),
    cursor: validCursor(snapshot.cursor) ? snapshot.cursor : null,
    seed: optional(snapshot.seed, ITEM_TEXT_LIMIT),
    // Only that one waits is kept. Its contents are for the phone, which confirms it.
    sendWaiting: fields(snapshot.send) !== null,
    sent: list(snapshot.sent, 5).flatMap((entry) => {
      const sent = toSent(entry);
      return sent ? [sent] : [];
    }),
  };
}

export function toStatus(value: unknown): AutoStatus | null {
  const status = fields(value);
  const auth = status ? fields(status.auth) : null;
  if (!status || !auth) return null;
  const models: Record<string, string> = {};
  for (const [key, label] of Object.entries(fields(status.models) ?? {}).slice(0, OPTIONS_LIMIT)) {
    if (validModel(key) && typeof label === 'string' && label !== '') models[key] = label.slice(0, 80);
  }
  return {
    auth: {
      loggedIn: typeof auth.loggedIn === 'boolean' ? auth.loggedIn : null,
      token: text(auth.token, 40),
      error: optional(auth.error, LINE_LIMIT),
    },
    signin: text(status.signin, LINE_LIMIT),
    running: count(status.running),
    waiting: count(status.waiting),
    limit: count(status.limit),
    models,
  };
}

const DIGEST_KINDS: readonly AutoDigestKind[] = ['item', 'meeting', 'person', 'draft', 'text'];
const SECTIONS_LIMIT = 100;
const ENTRIES_LIMIT = 500;

/** One digest entry, or null for one without a usable id. A kind Opal does not know reads as text. */
function toEntry(value: unknown, section: string): AutoDigestEntry | null {
  const entry = fields(value);
  if (!entry || !validEntryId(entry.id)) return null;
  const kind = DIGEST_KINDS.find((name) => name === entry.kind) ?? 'text';
  const title = text(entry.title, TITLE_LIMIT);
  const thread = validThreadId(entry.thread) ? entry.thread : null;
  // A to-do carries its drafted reply; a drafted reply of its own carries its words.
  const drafted = fields(entry.draft);
  const paste = drafted ? text(drafted.paste, TEXT_LIMIT) : kind === 'draft' ? text(entry.paste, TEXT_LIMIT) : '';
  return {
    id: entry.id,
    kind,
    title,
    md: text(entry.md, TEXT_LIMIT),
    section,
    // An entry said to be a thread without one that can be named is still open.
    state: entry.state === 'resolved' ? 'resolved' : entry.state === 'thread' && thread ? 'thread' : 'open',
    thread,
    note: text(entry.note, NOTE_LIMIT),
    priority: kind === 'item' ? text(entry.priority, 40) : '',
    draft: paste ? { title: drafted ? text(drafted.title, TITLE_LIMIT) : title, paste } : null,
  };
}

/** A day's digest, or null when it names no day. Entries and sections that do not fit are left out. */
export function toDigest(value: unknown): AutoDigest | null {
  const digest = fields(value);
  if (!digest || !validDate(digest.date)) return null;
  const seen = new Set<string>();
  const sections = list(digest.sections, SECTIONS_LIMIT).flatMap((each): AutoDigestSection[] => {
    const section = fields(each);
    if (!section) return [];
    const title = text(section.title, TITLE_LIMIT);
    const entries = list(section.entries, ENTRIES_LIMIT).flatMap((candidate) => {
      const entry = toEntry(candidate, title);
      if (!entry || seen.has(entry.id)) return [];
      seen.add(entry.id);
      return [entry];
    });
    return entries.length > 0 ? [{ title, entries }] : [];
  });
  const open = sections.reduce((sum, section) => sum + section.entries.filter((entry) => entry.state === 'open').length, 0);
  return {
    date: digest.date,
    path: text(digest.path, 1_024),
    // The service's own count; what Opal can see for itself when it gives none.
    left: typeof digest.left === 'number' && Number.isFinite(digest.left) && digest.left >= 0 ? Math.floor(digest.left) : open,
    sections,
  };
}

/** The days that have a digest, newest first. */
export function toDigestDays(value: unknown): AutoDigestDays | null {
  const body = fields(value);
  if (!body || !Array.isArray(body.days)) return null;
  const days = [...new Set(body.days.slice(0, 400).filter(validDate))].sort().reverse();
  return { days, latest: validDate(body.latest) ? body.latest : days[0] ?? null };
}

/** A list stream event, or null for a kind Opal does not know or a body that does not fit it. */
export function toListEvent(kind: string, data: unknown): AutoListEvent | null {
  switch (kind) {
    case 'thread': {
      const thread = toThread(data);
      return thread ? { kind, thread } : null;
    }
    case 'order': {
      const body = fields(data);
      return body && Array.isArray(body.ids) ? { kind, ids: body.ids.slice(0, THREADS_LIMIT).filter(validThreadId) } : null;
    }
    case 'status': {
      const status = toStatus(data);
      return status ? { kind, status } : null;
    }
    case 'digest': {
      const body = fields(data);
      return body && validDate(body.date) ? { kind, date: body.date } : null;
    }
    case 'reset':
      return { kind };
    default:
      return null;
  }
}

const index = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < ITEMS_LIMIT ? value : null;

/** A thread stream event, or null for a kind Opal does not know or a body that does not fit it. */
export function toThreadEvent(kind: string, data: unknown): AutoThreadEvent | null {
  const body = fields(data);
  switch (kind) {
    case 'turn':
      return body ? { kind, items: toItems(body.items), state: liveState(body.state), activity: text(body.activity, LINE_LIMIT) } : null;
    case 'add': {
      const item = body ? toItem(body.item) : null;
      return item ? { kind, item } : null;
    }
    case 'append':
      return body && typeof body.text === 'string' ? { kind, text: body.text.slice(0, ITEM_TEXT_LIMIT) } : null;
    case 'set': {
      const at = body ? index(body.index) : null;
      const item = body ? toItem(body.item) : null;
      return at !== null && item ? { kind, index: at, item } : null;
    }
    case 'drop': {
      const at = body ? index(body.index) : null;
      return at !== null ? { kind, index: at } : null;
    }
    case 'activity':
      return body ? { kind, text: text(body.text, LINE_LIMIT) } : null;
    case 'question':
      return body ? { kind, question: toQuestion(body.question) } : null;
    case 'queue':
      return body ? { kind, queue: toQueue(body.queue) } : null;
    case 'end': {
      if (!body) return null;
      const outcome = body.outcome === 'stopped' || body.outcome === 'failed' ? body.outcome : 'done';
      return { kind, outcome, error: optional(body.error, LINE_LIMIT), next: toNext(body.next) };
    }
    case 'thread': {
      const thread = toThread(data);
      return thread ? { kind, thread } : null;
    }
    case 'send':
      return body ? { kind, waiting: fields(body.send) !== null, sent: toSent(body.sent) } : null;
    case 'reset':
      return { kind };
    default:
      return null;
  }
}
