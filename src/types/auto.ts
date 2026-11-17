/**
 * Auto: a service on another machine that runs agent threads. Opal is one of
 * its screens. These are the service's shapes as Opal keeps them, and the
 * bridge between the page and the main process, which makes every request.
 */

export type AutoThreadStatus = 'idle' | 'queued' | 'working' | 'waiting' | 'stopped' | 'failed';

/** What a waiting thread asks, as its list entry carries it. */
export interface AutoAsk {
  id: string;
  /** A question, a permission request, or a send he is asked to allow up front. */
  kind: 'ask' | 'permission' | 'grant';
  /** The question's first sentence, or the permission's or the grant's title. */
  text: string;
  /** Labels for one single-choice question with nothing under it; empty otherwise. */
  options: string[];
  /** The question text the answer is keyed by, when `options` is filled. */
  question: string | null;
}

export type AutoWaitState = 'finding' | 'watching' | 'met' | 'expired';

/**
 * What a thread put away until someone replies waits on. `finding`: Auto is
 * still naming the conversation. `watching`: the service checks it. `met`:
 * the reply came. `expired`: the time ran out. A finished wait stays on the
 * thread until his next message there.
 */
export interface AutoWait {
  /** Who or what he waits for, in his own words; '' when he asked in the thread itself. */
  say: string;
  state: AutoWaitState;
  /** Who he waits on; '' while `finding`. */
  on: string;
  /** For what. */
  what: string;
  /** Where the conversation is, in the service's own word (`Slack`, `Gmail`, `WhatsApp`, `Messages`, or one named later); '' when it names none. */
  where: string;
  /** The conversation. Opened only when it starts with `http`: a chat's id or a text's number (`whatsapp:…`, `imessage:…`) never is. */
  link: string;
  /** Which reply ends the wait. */
  check: string;
  /** Unix seconds. */
  since: number | null;
  /** When the wait gives up. */
  expires: number | null;
  /** Their newest message, one line, when it did not answer what he waits for; else ''. */
  heard: string;
  /** One line of the reply, once it has come; else ''. */
  reply: string;
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
  /** When he archived it, in Unix seconds, or null when it is not archived. */
  archivedAt: number | null;
  /** When it comes back, in Unix seconds, or null. For a thread that waits on a reply, when the wait gives up. */
  snoozed: number | null;
  /** When he put it away, or null when it is not snoozed. */
  snoozedAt: number | null;
  /** When it came back from snooze, until it is next opened. */
  woke: number | null;
  /** What it waits on, when it was put away until someone replies; else null. */
  wait: AutoWait | null;
  /** The digest entry it was started from. */
  digest: { date: string; id: string } | null;
  /** An entry nobody has started: it holds its words and has run no turn. */
  waits: boolean;
  /** Set while he has marked the thread as one he wants on the Mac; the service ends the mark. */
  desk: { at: number; by: string } | null;
  /**
   * What is now his to do in this thread, in a few words, as Auto named it
   * in a reply; '' for nothing. Words on the row, never a button.
   */
  yours: string;
}

export type AutoDigestKind = 'item' | 'meeting' | 'person' | 'draft' | 'text';

/** What became of a digest entry: still open, resolved, or made a thread. */
export type AutoDigestState = 'open' | 'resolved' | 'thread';

/** One entry of a day's digest. */
export interface AutoDigestEntry {
  id: string;
  kind: AutoDigestKind;
  title: string;
  /** The entry's words, as Markdown. */
  md: string;
  /** Its section's title. */
  section: string;
  state: AutoDigestState;
  /** The thread the entry became, or null. */
  thread: string | null;
  /** His own words on the entry, or empty. */
  note: string;
  /** A to-do's priority word, or empty. */
  priority: string;
  /** A reply drafted for the entry, as words to paste: who it is for, and the words. */
  draft: { title: string; paste: string } | null;
  /**
   * A thread he already has that this open entry matches, as the service
   * found it: the entry can be added there instead of becoming a new thread.
   * Null for no match, and for an entry that is not open.
   */
  continues: AutoContinues | null;
}

/** The thread an open digest entry matches: its id, its title, and whether it is snoozed. */
export interface AutoContinues {
  id: string;
  title: string;
  snoozed: boolean;
}

export interface AutoDigestSection {
  title: string;
  entries: AutoDigestEntry[];
}

/** A day's digest, as a queue he works through. */
export interface AutoDigest {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The digest's file, a path from the vault's top. */
  path: string;
  /** How many entries are still open. */
  left: number;
  /** He put this day's digest away: it is off the list until the next one, and reads as before. */
  archived: boolean;
  sections: AutoDigestSection[];
}

/** The days that have a digest, newest first, and which of them he archived. */
export interface AutoDigestDays {
  days: string[];
  latest: string | null;
  archived: string[];
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
  | { id: string; kind: 'permission'; tool: string; title: string; detail: string; reason: string }
  | AutoGrant;

/**
 * A send Auto asks him to allow up front: one message to named people by one
 * channel. Only his phone can say yes, with a signature Opal cannot make.
 * Opal shows it and can only say no.
 */
export interface AutoGrant {
  id: string;
  kind: 'grant';
  /** The service's question, which names the channel and the people: "Send this Slack message to Robin?". */
  title: string;
  /** What it is about and how it would go, in the service's words, on lines of their own. */
  detail: string;
  /** The exact words that would go, when the grant carries them. */
  text: string | null;
}

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

/** One of the plan's limits, as the service last saw it. */
export interface AutoLimit {
  key: string;
  /** The service's own name for it: "Weekly, all models". */
  label: string;
  /** How much of it is used, 0 to 1; a number past 1 is kept at 1. */
  used: number;
  /** When its window starts again, in Unix seconds. */
  resetsAt: number | null;
  /** The service's word for it: `allowed`, `rejected` (reached), or another. */
  status: string;
}

/** How much of the plan the service's agent has used. Opal never reads the account's email. */
export interface AutoUsage {
  /** The plan's name, or '' when the service names none. */
  plan: string;
  /** In the order the service sends them. */
  limits: AutoLimit[];
  asOf: number | null;
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
  /** The threads he archived, newest archived first; the first `limit` of them, or all with null. */
  | { kind: 'archived'; limit: number | null }
  | { kind: 'thread'; id: string }
  | { kind: 'create'; text: string; model: string; cid: string }
  | { kind: 'message'; id: string; text: string; cid: string }
  | { kind: 'stop'; id: string }
  | { kind: 'answer'; id: string; answer: AutoAnswer }
  | { kind: 'model'; id: string; model: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'archive'; id: string; archived: boolean; done?: boolean }
  | { kind: 'move'; id: string; before: string | null }
  /**
   * Snoozes until a time, or brings the thread back with null. With `wait`
   * it is put away until someone replies, and `until` is when the wait gives
   * up (the service's own default with null).
   */
  | { kind: 'snooze'; id: string; until: number | null; wait?: { say: string } }
  | { kind: 'start'; id: string }
  /** Marks a thread for the Mac, or takes the mark off. */
  | { kind: 'desk'; id: string; on: boolean }
  /** A day's digest; the latest with no date. */
  | { kind: 'digest'; date: string | null }
  | { kind: 'digests' }
  /** Puts a day's digest away, or brings it back. */
  | { kind: 'digest-archive'; date: string; archived: boolean }
  /** Resolves entries of one day, or reopens them. */
  | { kind: 'digest-resolve'; date: string; ids: string[]; resolved: boolean }
  /** His note on an entry; empty text removes it. */
  | { kind: 'digest-note'; date: string; id: string; text: string }
  /**
   * Makes an entry a thread. With `words` it starts with the entry and his
   * words; without, it waits on top of the list until he says something.
   */
  | { kind: 'digest-thread'; date: string; id: string; words: string | null; cid: string | null; model?: string }
  /** Adds an open entry to the thread it matches, with his words if any. Only his click sends it. */
  | { kind: 'digest-continue'; date: string; id: string; thread: string; words: string | null; cid: string | null; model?: string }
  /** How much of the plan the service's agent has used. Read only. */
  | { kind: 'usage' };

/** What each request answers with. */
export interface AutoRouteData {
  status: AutoStatus;
  'check-status': AutoStatus;
  threads: { threads: AutoThread[]; cursor: string | null };
  /** `total` counts every archived thread, before the limit. */
  archived: { threads: AutoThread[]; total: number };
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
  desk: { thread: AutoThread };
  digest: AutoDigest;
  digests: AutoDigestDays;
  'digest-archive': AutoDigest;
  'digest-resolve': AutoDigest;
  'digest-note': AutoDigest;
  'digest-thread': { thread: AutoThread };
  'digest-continue': { thread: AutoThread };
  usage: AutoUsage;
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
  /** That day's digest changed. */
  | { kind: 'digest'; date: string }
  /** The plan's usage numbers changed. */
  | { kind: 'usage' }
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
