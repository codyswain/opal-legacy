import type {
  AutoItem,
  AutoLive,
  AutoQuestion,
  AutoQueued,
  AutoSent,
  AutoSnapshot,
  AutoStep,
  AutoThread,
  AutoThreadEvent,
} from '@/types/auto';

/*
 * One open thread: the finished history, the running turn, and what hangs
 * off them. A snapshot sets it, each event of the thread's stream changes
 * it, and nothing here touches the network or the page.
 */

export interface ThreadView {
  thread: AutoThread;
  /** The finished history. */
  history: AutoItem[];
  /** The running turn, or null. */
  live: { items: AutoItem[]; activity: string; state: AutoLive['state'] } | null;
  question: AutoQuestion | null;
  /** Messages the service holds behind the running turn. */
  queue: AutoQueued[];
  /** Follow-ups, as the service gave them. */
  next: string[];
  /** A message that failed before it reached the agent. */
  unsent: string | null;
  /** A waiting entry's words. */
  seed: string | null;
  /** A send waits on the phone. */
  sendWaiting: boolean;
  sent: AutoSent[];
  /** How the turn that ended while this was open ended. */
  ending: { outcome: 'done' | 'stopped' | 'failed'; error: string | null } | null;
  cursor: string | null;
}

export function fromSnapshot(snapshot: AutoSnapshot): ThreadView {
  return {
    thread: snapshot.thread,
    history: snapshot.items,
    live: snapshot.live ? { items: snapshot.live.items, activity: snapshot.live.activity, state: snapshot.live.state } : null,
    question: snapshot.live?.question ?? null,
    queue: snapshot.queue,
    next: snapshot.next,
    unsent: snapshot.unsent,
    seed: snapshot.thread.waits ? snapshot.seed : null,
    sendWaiting: snapshot.sendWaiting,
    sent: snapshot.sent,
    ending: null,
    cursor: snapshot.cursor,
  };
}

/** An item as it rests in the history: no reply is still being written. */
const settled = (item: AutoItem): AutoItem => (item.role === 'assistant' && item.open ? { ...item, open: false } : item);

/**
 * The view after one event of the thread's stream, as the service's README
 * says to treat each kind. `reset` changes nothing here: the caller fetches
 * the snapshot again.
 */
export function applyEvent(view: ThreadView, event: AutoThreadEvent): ThreadView {
  const live = view.live;
  switch (event.kind) {
    case 'turn':
      return {
        ...view,
        history: live ? [...view.history, ...live.items.map(settled)] : view.history,
        live: { items: event.items, activity: event.activity, state: event.state },
        next: [],
        ending: null,
        unsent: null,
        // A started entry no longer waits, and a new turn closes any send that waited.
        seed: null,
        sendWaiting: false,
      };
    case 'add':
      return live ? { ...view, live: { ...live, items: [...live.items, event.item] } } : view;
    case 'append': {
      const last = live?.items[live.items.length - 1];
      if (!live || !last || last.role !== 'assistant') return view;
      return { ...view, live: { ...live, items: [...live.items.slice(0, -1), { ...last, text: last.text + event.text }] } };
    }
    case 'set':
      if (!live || event.index >= live.items.length) return view;
      return { ...view, live: { ...live, items: live.items.map((item, at) => (at === event.index ? event.item : item)) } };
    case 'drop':
      if (!live || event.index >= live.items.length) return view;
      return { ...view, live: { ...live, items: live.items.filter((_item, at) => at !== event.index) } };
    case 'activity':
      return live ? { ...view, live: { ...live, activity: event.text } } : view;
    case 'question':
      return { ...view, question: event.question };
    case 'queue':
      return { ...view, queue: event.queue };
    case 'end': {
      const history = live ? [...view.history, ...live.items.map(settled)] : view.history;
      const last = history[history.length - 1];
      return {
        ...view,
        history: event.outcome === 'stopped' && last?.role !== 'note' ? [...history, { role: 'note', text: 'Stopped' }] : history,
        live: null,
        question: null,
        next: event.next,
        ending: { outcome: event.outcome, error: event.error },
      };
    }
    case 'thread':
      return event.thread.id === view.thread.id ? { ...view, thread: event.thread } : view;
    case 'send':
      return { ...view, sendWaiting: event.waiting, sent: event.sent ? [...view.sent, event.sent].slice(-5) : view.sent };
    case 'reset':
      return view;
  }
}

/** Whether a turn runs or waits, so Stop shows and a new message would queue. */
export const turnRuns = (view: ThreadView | null): boolean => view?.live != null;

/** The sentence for a failed turn: the service's own. */
export function failure(view: ThreadView): string | null {
  if (view.live) return null;
  if (view.ending) return view.ending.outcome === 'failed' ? view.ending.error || 'The turn did not finish.' : null;
  return view.thread.status === 'failed' ? view.thread.error || 'The turn did not finish.' : null;
}

/**
 * Whether the follow-ups show: only while the thread is at rest, with a
 * reply last and nothing running, asked, waiting to go or failed.
 */
export function showsNext(view: ThreadView, waitingToGo: number): boolean {
  if (view.next.length === 0 || view.live || view.question || view.seed) return false;
  if (view.queue.length > 0 || waitingToGo > 0 || view.unsent) return false;
  if (view.ending ? view.ending.outcome !== 'done' : view.thread.status !== 'idle') return false;
  return view.history[view.history.length - 1]?.role === 'assistant';
}

/** Messages sent from here that the thread has not shown yet. */
export interface PendingMessage {
  cid: string;
  text: string;
}

/** Pending messages the thread now shows itself: in the history, the running turn or the queue. */
export function unconfirmed(pending: readonly PendingMessage[], view: ThreadView): PendingMessage[] {
  const seen = new Set<string>();
  for (const item of [...view.history, ...(view.live?.items ?? [])]) if (item.role === 'user' && item.cid) seen.add(item.cid);
  for (const queued of view.queue) if (queued.cid) seen.add(queued.cid);
  return pending.filter((message) => !seen.has(message.cid));
}

/** What is still to go, shown above the box while a turn runs: the service's queue, then what it has not confirmed. */
export function waitingToGo(view: ThreadView | null, pending: readonly PendingMessage[]): PendingMessage[] {
  const queue = view?.queue ?? [];
  const shown = new Set(queue.map((queued) => queued.cid).filter(Boolean));
  return [...queue.map((queued, at) => ({ cid: queued.cid || `queued-${at}`, text: queued.text })), ...pending.filter((message) => !shown.has(message.cid))];
}

/** A step as one line: its lead word, its text, and the vault file it names. */
export interface StepLine {
  lead: string;
  text: string;
  path: string | null;
}

const STEP_LEAD: Record<string, string> = {
  read: 'Read ',
  change: 'Changed ',
  search: 'Searched for ',
  websearch: 'Searched the web for ',
  agent: 'Helper: ',
};

/** The steps to show, one line each. Plumbing steps (`quiet`) are left out. */
export function stepLines(steps: readonly AutoStep[]): StepLine[] {
  return steps
    .filter((step) => step.g !== 'quiet')
    .map((step) => ({
      lead: STEP_LEAD[step.g] ?? (step.g.startsWith('skill:') ? 'Skill: ' : ''),
      text: step.path ?? step.text,
      path: step.path,
    }));
}

const count = (many: number, one: string, more: string): string => (many === 1 ? one : `${many} ${more}`);

/**
 * A group of steps as one line, which opens to all of them: "Read 3 files,
 * searched the web, 2 more steps". One step alone is its own line.
 */
export function stepsSummary(steps: readonly AutoStep[]): string {
  const shown = steps.filter((step) => step.g !== 'quiet');
  if (shown.length === 0) return '';
  if (shown.length === 1) {
    const [line] = stepLines(shown);
    return `${line.lead}${line.text}`;
  }
  const kinds = new Map<string, number>();
  for (const step of shown) {
    const kind = step.g.startsWith('skill:') ? 'skill' : step.g in STEP_LEAD ? step.g : 'other';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const parts = [...kinds].map(([kind, many]) => {
    if (kind === 'read') return `read ${count(many, '1 file', 'files')}`;
    if (kind === 'change') return `changed ${count(many, '1 file', 'files')}`;
    if (kind === 'search') return many === 1 ? 'searched' : `searched ${many} times`;
    if (kind === 'websearch') return many === 1 ? 'searched the web' : `searched the web ${many} times`;
    if (kind === 'agent') return count(many, 'a helper', 'helpers');
    if (kind === 'skill') return count(many, 'a skill', 'skills');
    return kinds.size === 1 ? `${many} steps` : count(many, '1 more step', 'more steps');
  });
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/**
 * Where a thread with a reply he has not read opens: his last message that
 * has a reply under it, counted in the finished history, so a long reply is
 * read from its start. Null while a turn runs or a question waits, and when
 * there is no such message: the thread then opens at its end.
 */
export function turnStart(view: ThreadView): number | null {
  if (view.live || view.question) return null;
  for (let at = view.history.length - 1; at >= 0; at -= 1) {
    if (view.history[at].role !== 'user') continue;
    return view.history.slice(at + 1).some((item) => item.role === 'assistant' && item.text !== '') ? at : null;
  }
  return null;
}

/** One line for a message that went out: who to, the subject. */
export function sentLine(sent: AutoSent): string {
  return `Sent to ${sent.to.join(', ') || 'no one'}: ${sent.subject || 'no subject'}`;
}

/** What a digest entry's words hold, when a message is one. */
export interface EntryCard {
  /** "Friday November 13, item 2". */
  source: string;
  title: string;
  /** A to-do's priority ("High"), or '' for none. */
  priority: string;
  /** The entry, as Markdown. */
  body: string;
  /** The file it came from, a path from the vault's top. */
  from: string | null;
  /** His own words, sent with the entry. */
  says: string;
}

/**
 * The service starts a thread from a digest entry with a message whose
 * first line is "Digest, <day>, <what>: <title>" and whose last is "From
 * <file>". When he sends his first words with it, they follow a line
 * "<name> says:". Any other message is not an entry.
 */
export function parseEntry(text: string): EntryCard | null {
  const lines = text.split('\n');
  const head = /^Digest, (.+?): (.+)$/.exec(lines[0] ?? '');
  if (!head) return null;
  let body = lines.slice(1);
  let says = '';
  const split = body.findIndex((line) => /^[^\s:]{1,40} says:$/.test(line));
  if (split !== -1) {
    says = body.slice(split + 1).join('\n').trim();
    body = body.slice(0, split);
  }
  let from: string | null = null;
  for (let at = body.length - 1; at >= 0; at -= 1) {
    if (!body[at].trim()) continue;
    const source = /^From (\S.*)$/.exec(body[at]);
    if (source) {
      from = source[1].trim();
      body = body.slice(0, at);
    }
    break;
  }
  // A to-do with a priority says so on a line of its own under the title.
  let priority = '';
  const first = body.findIndex((line) => line.trim() !== '');
  const marked = first === -1 ? null : /^Priority: (\S.{0,39})$/.exec(body[first].trim());
  if (marked) {
    priority = marked[1].trim();
    body = body.slice(first + 1);
  }
  return { source: head[1], title: head[2].trim(), priority, body: body.join('\n').trim(), from, says };
}
