import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import { NEW_THREAD } from './pane';

export { NEW_THREAD };

/*
 * The box's outbox. A message is kept here from Enter until the service has
 * it, so closing Opal while one is on its way does not lose it: the next
 * launch sends it again under the same id, and the service drops a repeat.
 * A message whose post fails comes out, and its words go back into the box.
 * Drafts, the words typed and not yet sent, are kept per thread beside it.
 */

export interface OutboxEntry {
  /** The client's id for this message; the service drops a second copy with the same one. */
  cid: string;
  /** The thread it goes to, or null for a message that starts a new one. */
  thread: string | null;
  text: string;
  /** The model picked for a new thread. */
  model: string;
  /** When Enter was pressed, in ms. */
  at: number;
}

export interface BoxState {
  outbox: OutboxEntry[];
  /** Typed and not sent, by thread id; NEW_THREAD is the new thread's box. */
  drafts: Record<string, string>;
}

const PREF_KEY = 'auto.box';
const OUTBOX_LIMIT = 50;
const DRAFTS_LIMIT = 200;
/** An entry older than this is not sent again by itself; its words go back to the box. */
export const RESEND_WINDOW_MS = 10 * 60 * 1000;

const isEntry = (value: unknown): value is OutboxEntry => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.cid === 'string' && /^[A-Za-z0-9]{1,40}$/.test(entry.cid) &&
    (entry.thread === null || typeof entry.thread === 'string') &&
    typeof entry.text === 'string' && entry.text !== '' &&
    typeof entry.model === 'string' &&
    typeof entry.at === 'number'
  );
};

/** What storage holds, with anything that does not fit left out. */
export function readBox(): BoxState {
  const stored = readPref<unknown>(PREF_KEY, null) as { outbox?: unknown; drafts?: unknown } | null;
  const outbox = Array.isArray(stored?.outbox) ? stored.outbox.filter(isEntry).slice(-OUTBOX_LIMIT) : [];
  const drafts: Record<string, string> = {};
  if (stored?.drafts && typeof stored.drafts === 'object') {
    for (const [thread, text] of Object.entries(stored.drafts as Record<string, unknown>).slice(-DRAFTS_LIMIT)) {
      if (typeof text === 'string' && text !== '') drafts[thread] = text;
    }
  }
  return { outbox, drafts };
}

export function writeBox(state: BoxState): void {
  writePref<BoxState>(PREF_KEY, { outbox: state.outbox.slice(-OUTBOX_LIMIT), drafts: state.drafts });
}

/** Ten random hex characters, as the service's own page makes. */
export function newCid(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function put(state: BoxState, entry: OutboxEntry): BoxState {
  return { ...state, outbox: [...state.outbox.filter((candidate) => candidate.cid !== entry.cid), entry] };
}

export function drop(state: BoxState, cid: string): BoxState {
  return { ...state, outbox: state.outbox.filter((entry) => entry.cid !== cid) };
}

export function setDraft(state: BoxState, thread: string, text: string): BoxState {
  const drafts = { ...state.drafts };
  if (text) drafts[thread] = text;
  else delete drafts[thread];
  return { ...state, drafts };
}

/**
 * A message that did not go: it leaves the outbox and its words go back
 * into its thread's box, above anything typed since.
 */
export function giveBack(state: BoxState, entry: OutboxEntry): BoxState {
  const key = entry.thread ?? NEW_THREAD;
  const typed = state.drafts[key] ?? '';
  return setDraft(drop(state, entry.cid), key, typed.trim() ? `${entry.text}\n\n${typed}` : entry.text);
}

/**
 * What to do with entries left from before: one pressed within the last ten
 * minutes is sent again under its own id; an older one is given back to its
 * box, so nothing goes out long after he meant it to.
 */
export function leftOver(state: BoxState, now: number): { resend: OutboxEntry[]; state: BoxState; returned: OutboxEntry[] } {
  const resend = state.outbox.filter((entry) => now - entry.at <= RESEND_WINDOW_MS && now >= entry.at);
  const returned = state.outbox.filter((entry) => !resend.includes(entry));
  return { resend, returned, state: returned.reduce(giveBack, state) };
}

/** A message that failed, kept so the same words sent again go under the same id. */
export interface Failed {
  thread: string | null;
  text: string;
  cid: string;
}

/** The id for a message: the failed one's when these are the same words to the same thread, else a new one. */
export function cidFor(failed: Failed | null, thread: string | null, text: string): string {
  return failed && failed.thread === thread && failed.text === text ? failed.cid : newCid();
}
