/**
 * Auto: a service on another machine that runs agent threads. Opal is one of
 * its screens. These are the service's shapes as Opal keeps them, and the
 * bridge between the page and the main process, which makes every request.
 */

export type AutoThreadStatus = 'idle' | 'queued' | 'working' | 'waiting' | 'stopped' | 'failed';

/** What a waiting thread asks, as its list entry carries it. */
export interface AutoAsk {
  id: string;
  kind: 'ask' | 'permission';
  /** The question's first sentence, or the permission's title. */
  text: string;
  /** Labels for one single-choice question with nothing under it; empty otherwise. */
  options: string[];
  /** The question text the answer is keyed by, when `options` is filled. */
  question: string | null;
}

/** A thread's list entry. */
export interface AutoThread {
  id: string;
  title: string;
  status: AutoThreadStatus;
  /** The first line of the last reply, "Stopped", or empty. */
  last: string;
  /** The live line while a turn runs. */
  activity: string;
  ask: AutoAsk | null;
  unread: boolean;
  model: string;
  /** Unix seconds. */
  created: number;
  updated: number;
  /** The sentence to show when `status` is `failed`. */
  error: string | null;
  queued: number;
  archived: boolean;
  /** When it comes back, in Unix seconds, or null. */
  snoozed: number | null;
  /** When it came back from snooze, until it is next opened. */
  woke: number | null;
  /** The digest entry it was started from. */
  digest: { date: string; id: string } | null;
  /** An entry nobody has started: it holds its words and has run no turn. */
  waits: boolean;
}

export interface AutoStep {
  /** The kind: read, change, run, search, fetch, websearch, agent, plan, quiet, skill:<name>, mcp:<phrase>, tool:<name>. */
  g: string;
  text: string;
  /** Set when the step names a file in the vault. */
  path: string | null;
}

export type AutoItem =
  | { role: 'user'; text: string; cid: string | null }
  | { role: 'assistant'; text: string; open: boolean }
  | { role: 'steps'; steps: AutoStep[] }
  | { role: 'asked'; text: string; answer: string }
  | { role: 'note'; text: string };

export interface AutoQuestionOption {
  label: string;
  description: string;
}

export interface AutoQuestionPart {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AutoQuestionOption[];
}

export type AutoQuestion =
  | { id: string; kind: 'ask'; questions: AutoQuestionPart[] }
  | { id: string; kind: 'permission'; tool: string; title: string; detail: string; reason: string };

export interface AutoQueued {
  cid: string;
  text: string;
}

export interface AutoLive {
  items: AutoItem[];
  activity: string;
  state: 'queued' | 'working' | 'waiting';
  question: AutoQuestion | null;
}

/** A message that went out from a thread, as one line. */
export interface AutoSent {
  at: number;
  to: string[];
  subject: string;
}

export interface AutoSnapshot {
  thread: AutoThread;
  items: AutoItem[];
  live: AutoLive | null;
  queue: AutoQueued[];
  /** A message that failed before it reached the agent, to put back in the box. */
  unsent: string | null;
  /** Follow-ups, as the service gives them. */
  next: string[];
  cursor: string | null;
  /** A waiting entry's words. */
  seed: string | null;
  /** Whether a send waits to be confirmed on the phone. Opal never confirms one. */
  sendWaiting: boolean;
  sent: AutoSent[];
}

export interface AutoStatus {
  auth: {
    loggedIn: boolean | null;
    token: string;
    error: string | null;
  };
  /** The one command that signs the service in, shown as text. */
  signin: string;
  running: number;
  waiting: number;
  limit: number;
  /** Model keys and their labels. */
  models: Record<string, string>;
}

/** An answer to an open question, as the service takes it. */
export type AutoAnswer =
  | { id: string; answers: Record<string, string | string[]>; allow?: undefined; message?: undefined }
  | { id: string; allow: boolean; message?: string; answers?: undefined };

/** One request the page may ask for. The main process turns each into a fixed path. */
export type AutoRoute =
  | { kind: 'status' }
  | { kind: 'check-status' }
  | { kind: 'threads' }
  | { kind: 'thread'; id: string }
  | { kind: 'create'; text: string; model: string; cid: string }
  | { kind: 'message'; id: string; text: string; cid: string }
  | { kind: 'stop'; id: string }
  | { kind: 'answer'; id: string; answer: AutoAnswer }
  | { kind: 'model'; id: string; model: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'archive'; id: string; archived: boolean; done?: boolean }
  | { kind: 'move'; id: string; before: string | null }
  | { kind: 'snooze'; id: string; until: number | null }
  | { kind: 'start'; id: string };

/** What each request answers with. */
export interface AutoRouteData {
  status: AutoStatus;
  'check-status': AutoStatus;
  threads: { threads: AutoThread[]; cursor: string | null };
  thread: AutoSnapshot;
  create: { thread: AutoThread };
  message: { queued: boolean };
  stop: { returned: AutoQueued[] };
  answer: { ok: boolean };
  model: { thread: AutoThread };
  rename: { thread: AutoThread };
  archive: { thread: AutoThread };
  move: { ids: string[] };
  snooze: { thread: AutoThread };
  start: { thread: AutoThread };
}

/**
 * Why a request did not work. `unreachable`: no answer from the service (no
 * network, a timeout, or something else answered in its place). `refused`:
 * the service answered with an error, whose sentence can be shown as it is.
 */
export interface AutoFailure {
  kind: 'no-address' | 'unreachable' | 'refused' | 'invalid';
  message: string;
  /** The service's error code and HTTP status, for `refused`. */
  code?: string;
  status?: number;
}

/** Narrows on `success`, as UpdateResult does. */
export type AutoResult<T = undefined> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: AutoFailure; data?: undefined };

export interface AutoConfig {
  /** The service's address, or null when none is set. */
  url: string | null;
}

/** A stream to follow: the list's, or one thread's. */
export type AutoStreamTarget =
  | { stream: 'list'; cursor: string | null }
  | { stream: 'thread'; id: string; cursor: string | null };

/** One event of the list stream, after the main process has checked its shape. */
export type AutoListEvent =
  | { kind: 'thread'; thread: AutoThread }
  | { kind: 'order'; ids: string[] }
  | { kind: 'status'; status: AutoStatus }
  | { kind: 'reset' };

/** One event of a thread's stream. */
export type AutoThreadEvent =
  | { kind: 'turn'; items: AutoItem[]; state: AutoLive['state']; activity: string }
  | { kind: 'add'; item: AutoItem }
  | { kind: 'append'; text: string }
  | { kind: 'set'; index: number; item: AutoItem }
  | { kind: 'drop'; index: number }
  | { kind: 'activity'; text: string }
  | { kind: 'question'; question: AutoQuestion | null }
  | { kind: 'queue'; queue: AutoQueued[] }
  | { kind: 'end'; outcome: 'done' | 'stopped' | 'failed'; error: string | null; next: string[] }
  | { kind: 'thread'; thread: AutoThread }
  | { kind: 'send'; waiting: boolean; sent: AutoSent | null }
  | { kind: 'reset' };

/** What the main process tells the page about a stream it follows. */
export type AutoStreamMessage = {
  /** The number `follow` answered with; messages from an earlier follow are dropped. */
  token: number;
} & (
  | { type: 'open' }
  /** The stream broke; the main process tries again by itself. */
  | { type: 'down' }
  /** The stream is over and will not be tried again, as for a thread that is gone. */
  | { type: 'closed'; message: string }
  | { type: 'event'; stream: 'list'; event: AutoListEvent; cursor: string | null }
  | { type: 'event'; stream: 'thread'; event: AutoThreadEvent; cursor: string | null }
);

export interface AutoAPI {
  config: () => Promise<AutoResult<AutoConfig>>;
  /** Saves the address for this Mac. An empty string forgets it. */
  setAddress: (url: string) => Promise<AutoResult<AutoConfig>>;
  request: <K extends AutoRoute['kind']>(route: Extract<AutoRoute, { kind: K }>) => Promise<AutoResult<AutoRouteData[K]>>;
  /** Follows a stream from a cursor, in place of any stream of that kind followed before. */
  follow: (target: AutoStreamTarget) => Promise<AutoResult<{ token: number }>>;
  unfollow: (stream: 'list' | 'thread') => Promise<AutoResult>;
  /** The file in an opened folder that a path from the vault's top names. */
  resolvePage: (path: string) => Promise<AutoResult<{ path: string }>>;
  onStream: (callback: (message: AutoStreamMessage) => void) => () => void;
}

declare global {
  interface Window {
    autoAPI: AutoAPI;
  }
}
