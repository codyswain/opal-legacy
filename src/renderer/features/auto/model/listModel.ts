import type { AutoThread } from '@/types/auto';
import { elapsed, isWaitingOnReply, waitBack } from './awayModel';
import { clockTime, startOfDay } from './clock';

/*
 * The list: the threads he marked for the Mac first, then the ones that wait
 * on him, then what is new to him (a reply he has not read, a thread back
 * from snooze), then the rest in the order he keeps. What is put away (the
 * threads waiting on a reply, the snoozed ones, and the archive) is on the
 * Put away page, behind one row at the foot. Put away wins over every group.
 */

export interface ListGroup {
  key: string;
  /** A heading above the group, or null for none. */
  heading: string | null;
  threads: AutoThread[];
  /** Whether its rows can be dragged to reorder. */
  movable: boolean;
}

interface GroupRule {
  key: string;
  heading: string | null;
  movable: boolean;
  /** Newest first, in place of the order the service keeps. */
  newestFirst?: boolean;
  takes: (thread: AutoThread) => boolean;
}

/** At work, or queued to be. */
export const isWorking = (thread: AutoThread): boolean => thread.status === 'working' || thread.status === 'queued';
const isWaiting = (thread: AutoThread): boolean => thread.status === 'waiting';

/** The dot before a title: a reply he has not read, or a thread back from snooze. */
export const isMarked = (thread: AutoThread): boolean => thread.unread || thread.woke !== null;

/** New to him and not being worked on: it sits under the questions until he opens it. */
export const isFresh = (thread: AutoThread): boolean => isMarked(thread) && !isWorking(thread) && !isWaiting(thread);

/** At rest, with a next move that Auto said is his: a draft to read and send, a call to make. */
export const isYours = (thread: AutoThread): boolean =>
  thread.yours !== '' && !isWorking(thread) && !isWaiting(thread) && !thread.waits && thread.status !== 'failed';

/**
 * The list's groups, top to bottom. A thread goes into the first group that
 * takes it, and keeps the service's order inside it. This is the one place
 * the grouping is set: a new group, with or without a heading, is one more
 * line here.
 */
const GROUPS: readonly GroupRule[] = [
  // Marked for the Mac on any device. A marked thread that waits on him stays here, with its question.
  { key: 'desk', heading: 'For the Mac', movable: false, takes: (thread) => thread.desk !== null },
  { key: 'needs', heading: null, movable: false, newestFirst: true, takes: isWaiting },
  // Lifted under the questions until he opens them; then back to their place in his order.
  { key: 'fresh', heading: null, movable: false, newestFirst: true, takes: isFresh },
  { key: 'rest', heading: null, movable: true, takes: () => true },
];

export interface ListView {
  /** The groups that hold a thread. */
  groups: ListGroup[];
  /** Put away until someone replies, behind their own line: the one that gives up soonest first. */
  waiting: AutoThread[];
  /** Snoozed to a time, behind the Snoozed line: the first to come back first. */
  snoozed: AutoThread[];
  /** How many threads wait on him. */
  needs: number;
}

/**
 * The open thread keeps the group it was in when he opened it, so reading it
 * does not move its row from under the pointer. A mark for the Mac moves it
 * still: that is his doing.
 */
export interface Hold {
  id: string;
  group: string;
}

/** The key of the group a thread shows in, or null when it is put away. */
export function groupOf(threads: readonly AutoThread[], id: string): string | null {
  const thread = threads.find((candidate) => candidate.id === id);
  if (!thread || thread.archived || thread.snoozed !== null) return null;
  return GROUPS.find((rule) => rule.takes(thread))?.key ?? null;
}

export function listView(threads: readonly AutoThread[], hold: Hold | null = null): ListView {
  const shown = threads.filter((thread) => !thread.archived && thread.snoozed === null);
  const away = threads
    .filter((thread) => !thread.archived && thread.snoozed !== null)
    .sort((left, right) => (left.snoozed ?? 0) - (right.snoozed ?? 0));
  const groups = GROUPS.map((rule): ListGroup => ({ key: rule.key, heading: rule.heading, movable: rule.movable, threads: [] }));
  for (const thread of shown) {
    let at = GROUPS.findIndex((rule) => rule.takes(thread));
    if (hold && thread.id === hold.id && at !== -1 && GROUPS[at].key !== 'desk' && hold.group !== 'desk') {
      const held = GROUPS.findIndex((rule) => rule.key === hold.group);
      if (held !== -1) at = held;
    }
    if (at !== -1) groups[at].threads.push(thread);
  }
  GROUPS.forEach((rule, at) => {
    if (rule.newestFirst) groups[at].threads.sort((left, right) => right.updated - left.updated);
  });
  return {
    groups: groups.filter((group) => group.threads.length > 0),
    waiting: away.filter(isWaitingOnReply),
    snoozed: away.filter((thread) => !isWaitingOnReply(thread)),
    // Whichever group they show in.
    needs: shown.filter((thread) => thread.status === 'waiting').length,
  };
}

/** How many threads wait on him. */
export const needsCount = (threads: readonly AutoThread[]): number => listView(threads).needs;

/**
 * The sidebar's count: the threads that wait on him, the ones whose next
 * move Auto said is his, the ones with a reply he has not read and the ones
 * back from snooze, so it agrees with the line over the list and with the
 * count the service keeps for other devices. Snoozed and archived threads
 * are left out.
 */
export function attentionCount(threads: readonly AutoThread[]): number {
  return threads.filter((thread) => !thread.archived && thread.snoozed === null && (isWaiting(thread) || isMarked(thread) || isYours(thread))).length;
}

const counted = (many: number, one: string, more: string): string => (many === 1 ? one : `${many} ${more}`);

/**
 * One line over the list, so a glance is enough: "1 needs you, 2 new, 1
 * working". What needs him is a question that waits or a move that is his;
 * new is a reply he has not read or a thread back from snooze. Empty when
 * every count is zero.
 */
export function listSummary(threads: readonly AutoThread[]): string {
  const shown = threads.filter((thread) => !thread.archived && thread.snoozed === null);
  const rest = shown.filter((thread) => !isWaiting(thread));
  const fresh = rest.filter(isFresh);
  const order = rest.filter((thread) => !isFresh(thread));
  const needing = shown.length - rest.length + rest.filter(isYours).length;
  const idle = order.filter((thread) => thread.waits).length;
  const working = rest.filter(isWorking).length;
  return [
    needing > 0 ? counted(needing, '1 needs you', 'need you') : '',
    fresh.length > 0 ? `${fresh.length} new` : '',
    idle > 0 ? `${idle} not started` : '',
    working > 0 ? `${working} working` : '',
  ].filter(Boolean).join(', ');
}

/** The threads' ids in the order the list shows them: each group in turn. What is put away is on its own page. */
export function shownOrder(threads: readonly AutoThread[], hold: Hold | null = null): string[] {
  return listView(threads, hold).groups.flatMap((group) => group.threads).map((thread) => thread.id);
}

/** What takes a row's place when it leaves: the one below it, else the one above, else nothing. */
export function nextAfter(order: readonly string[], id: string): string | null {
  const at = order.indexOf(id);
  if (at === -1) return null;
  return order[at + 1] ?? order[at - 1] ?? null;
}

/**
 * A row moved one place up or down with the keyboard, as a drag would move
 * it: the thread it now sits above, or null for the end. Null when it is
 * already at that end, or cannot be moved.
 */
export function moveBy(threads: readonly AutoThread[], id: string, delta: -1 | 1): { id: string; before: string | null } | null {
  const group = listView(threads).groups.find((each) => each.movable && each.threads.some((thread) => thread.id === id));
  if (!group) return null;
  const at = group.threads.findIndex((thread) => thread.id === id);
  if (delta === -1 ? at === 0 : at === group.threads.length - 1) return null;
  return moveTarget(group.threads, id, delta === -1 ? at - 1 : at + 2);
}

/** A new or changed entry: replaced where it is, added on top, or taken out once archived. */
export function upsertThread(threads: readonly AutoThread[], thread: AutoThread): AutoThread[] {
  const at = threads.findIndex((candidate) => candidate.id === thread.id);
  if (thread.archived) return at === -1 ? [...threads] : threads.filter((candidate) => candidate.id !== thread.id);
  if (at === -1) return [thread, ...threads];
  return threads.map((candidate, index) => (index === at ? thread : candidate));
}

/**
 * A thread put back where it was in an earlier list: above the first thread
 * that followed it then and is still here, else at the end. A list that
 * already holds it is left as it is.
 */
export function putBack(threads: readonly AutoThread[], earlier: readonly AutoThread[], thread: AutoThread): AutoThread[] {
  if (threads.some((candidate) => candidate.id === thread.id)) return [...threads];
  const after = earlier.slice(earlier.findIndex((candidate) => candidate.id === thread.id) + 1).map((candidate) => candidate.id);
  const at = threads.findIndex((candidate) => after.includes(candidate.id));
  return at === -1 ? [...threads, thread] : [...threads.slice(0, at), thread, ...threads.slice(at)];
}

/** The service's order. A thread it does not name stays on top, where it was. */
export function applyOrder(threads: readonly AutoThread[], ids: readonly string[]): AutoThread[] {
  const place = new Map(ids.map((id, index) => [id, index]));
  const unknown = threads.filter((thread) => !place.has(thread.id));
  const known = threads
    .filter((thread) => place.has(thread.id))
    .sort((left, right) => (place.get(left.id) ?? 0) - (place.get(right.id) ?? 0));
  return [...unknown, ...known];
}

/**
 * Where a dragged row lands: `to` is the gap it was dropped in, counted in
 * the group as it shows (0 is above the first row). The answer names the
 * thread it now sits above, or null for the end; null when nothing moves.
 */
export function moveTarget(group: readonly AutoThread[], id: string, to: number): { id: string; before: string | null } | null {
  const from = group.findIndex((thread) => thread.id === id);
  if (from === -1 || to === from || to === from + 1) return null;
  const before = group[to];
  return { id, before: before ? before.id : null };
}

/** The list as it is right after a move, before the service's own order arrives. */
export function moved(threads: readonly AutoThread[], id: string, before: string | null): AutoThread[] {
  const thread = threads.find((candidate) => candidate.id === id);
  if (!thread) return [...threads];
  const rest = threads.filter((candidate) => candidate.id !== id);
  const at = before === null ? -1 : rest.findIndex((candidate) => candidate.id === before);
  return at === -1 ? [...rest, thread] : [...rest.slice(0, at), thread, ...rest.slice(at)];
}

/** What the line under a row's title says, and how it reads. */
export interface RowLine {
  /**
   * `idle`: nobody has started it. `yours`: the next move is his. Both are
   * said in the text's own colour, with the last line quiet under them.
   * `back`: it has come back from a wait, and says who replied and what
   * they said, or that nobody did.
   */
  kind: 'ask' | 'live' | 'failed' | 'idle' | 'yours' | 'back' | 'plain';
  text: string;
  /** The quiet line under "Not started" and "Your move": the entry's first words, or the reply's first line. */
  under: string;
}

export function rowLine(thread: AutoThread): RowLine {
  const rest = thread.status === 'stopped' ? 'Stopped' : thread.last;
  // Back from a wait, until he opens it: the reply's line, or that nobody replied.
  const back = thread.wait && thread.woke !== null && !isWaiting(thread) && !isWorking(thread) ? waitBack(thread.wait) : null;
  if (back) return { kind: 'back', text: back, under: '' };
  if (thread.waits) return { kind: 'idle', text: 'Not started', under: rest };
  if (isYours(thread)) return { kind: 'yours', text: `Your move: ${thread.yours}`, under: rest };
  if (isWaiting(thread) && thread.ask) return { kind: 'ask', text: thread.ask.text, under: '' };
  if (isWorking(thread)) return { kind: 'live', text: thread.activity || 'Working', under: '' };
  if (thread.status === 'failed') return { kind: 'failed', text: `Failed: ${thread.error || 'the turn did not finish'}`, under: '' };
  return { kind: 'plain', text: rest, under: '' };
}

/**
 * The line a row in the sidebar shows under its title, only when there is
 * something he must see: the question, "Your move: ...", "Not started", why
 * it failed, or who replied to a wait. The first words of an idle thread's
 * last reply, and the live line of one at work, are left out: its time says
 * how long it has been working.
 */
export function needsLine(thread: AutoThread): RowLine | null {
  const line = rowLine(thread);
  if (!line.text || line.kind === 'plain' || line.kind === 'live') return null;
  return { ...line, under: '' };
}

/** The labels a waiting row offers as buttons: only for a plain question, never for a permission. */
export function rowOptions(thread: AutoThread): string[] {
  const ask = thread.ask;
  if (thread.status !== 'waiting' || !ask || ask.kind !== 'ask' || !ask.question) return [];
  return ask.options;
}

/** A thread that came from a digest entry: Done archives it and marks its entry done in the digest. */
export const fromDigest = (thread: AutoThread): boolean => thread.digest !== null;

export { clockTime };

/** The day a time falls on, seen from now: Today, Yesterday, Tomorrow, the weekday inside a week, else the date. */
export function dayLabel(seconds: number, now: number): string {
  const date = new Date(seconds * 1000);
  const today = new Date(now);
  const days = Math.round((startOfDay(date) - startOfDay(today)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  if (days > -7 && days < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/**
 * A row's time: the clock today, then Yesterday, the weekday, or the date.
 * A thread back from snooze says "Back" and when, until it is opened. A
 * thread at work says how long it has been working ("now", "12 min", "1 h
 * 5 min"). An entry nobody has started shows none.
 */
export function rowTime(thread: AutoThread, now: number): string {
  if (thread.waits || !thread.updated) return '';
  if (isWorking(thread)) return elapsed(thread.updated, now);
  if (thread.woke) return `Back ${clockTime(thread.woke)}`;
  const day = dayLabel(thread.updated, now);
  if (day !== 'Today') return day;
  return now - thread.updated * 1000 < 60_000 ? 'now' : clockTime(thread.updated);
}

/** When something comes back: "today at 3:10 pm", "tomorrow at 8:00 am", "Monday at 8:00 am", "Nov 21 at 8:00 am". */
export function returnTime(seconds: number, now: number): string {
  const day = dayLabel(seconds, now);
  const named = day === 'Today' || day === 'Tomorrow' || day === 'Yesterday' ? day.toLowerCase() : day;
  return `${named} at ${clockTime(seconds)}`;
}

/** A snoozed row's time slot: "Tomorrow 8:00 am", "Friday 8:00 am", "Nov 21 8:00 am". */
export function snoozedUntil(seconds: number, now: number): string {
  return `${dayLabel(seconds, now)} ${clockTime(seconds)}`;
}

/** What the list says when no thread is left to show. */
export interface EmptyList {
  title: string;
  /** How many are snoozed and when the next one returns, or null when none is. */
  detail: string | null;
}

export function emptyList(view: ListView, now: number): EmptyList | null {
  if (view.groups.length > 0) return null;
  const [next] = view.snoozed;
  if (!next) return { title: 'Nothing left.', detail: null };
  // How many are snoozed is on the Snoozed line under this, so it is said once.
  const back = returnTime(next.snoozed ?? 0, now);
  return {
    title: 'Nothing left.',
    detail: view.snoozed.length === 1 ? `The snoozed one returns ${back}.` : `The next snoozed one returns ${back}.`,
  };
}

export interface SnoozeChoice {
  label: string;
  /** Unix seconds. */
  until: number;
  /** The time it means, at the row's end. */
  hint: string;
}

/** The hour a snooze to a later day brings a thread back, as on the phone. */
const MORNING_HOUR = 9;
/** The hour "Tonight" means. */
const EVENING_HOUR = 19;

/** A time of day, `days` after now. */
function dayAt(now: number, days: number, hour: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** The time beside a choice, and in the line that says a thread was snoozed: the clock today, else "Sat 9:00 am", else "Nov 21 9:00 am". */
export function shortUntil(seconds: number, now: number): string {
  const date = new Date(seconds * 1000);
  const clock = clockTime(seconds);
  const days = Math.round((startOfDay(date) - startOfDay(new Date(now))) / 86_400_000);
  if (days === 0) return clock;
  if (days > 0 && days < 7) return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`;
}

/**
 * The phone's choices and times. Later today is three hours on, while that
 * is still today. Tonight is 7 pm, offered before 6. Tomorrow is 9 in the
 * morning. This weekend is Saturday at 9, offered from Monday to Friday and
 * on a Saturday before 9. Next week is the first Monday after today at 9.
 * Two that mean the same time show once, and they are in the order of
 * their times.
 */
export function snoozeChoices(now: number): SnoozeChoice[] {
  const choices: SnoozeChoice[] = [];
  const add = (label: string, date: Date | null) => {
    if (!date || date.getTime() <= now || choices.some((choice) => choice.until === date.getTime() / 1000)) return;
    choices.push({ label, until: date.getTime() / 1000, hint: shortUntil(date.getTime() / 1000, now) });
  };
  const today = new Date(now);
  const later = new Date(now + 3 * 3_600_000);
  if (later.getDate() === today.getDate()) add('Later today', later);
  if (today.getHours() < 18) add('Tonight', dayAt(now, 0, EVENING_HOUR));
  add('Tomorrow', dayAt(now, 1, MORNING_HOUR));
  const weekday = today.getDay();
  // Sunday is 0. Once the weekend has begun there is no "this weekend" left to pick.
  add('This weekend', weekday === 0 ? null : dayAt(now, 6 - weekday, MORNING_HOUR));
  add('Next week', dayAt(now, ((8 - weekday) % 7) || 7, MORNING_HOUR));
  return choices.sort((left, right) => left.until - right.until);
}

const isoDay = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * The days a snooze of his own may fall on, as `YYYY-MM-DD`: from today to
 * a year on. `start` is the day the picker opens at, tomorrow.
 */
export function snoozeDateRange(now: number): { min: string; max: string; start: string } {
  return { min: isoDay(new Date(now)), max: isoDay(dayAt(now, 365, MORNING_HOUR)), start: isoDay(dayAt(now, 1, MORNING_HOUR)) };
}

/** The time a picked day starts with, as a time field holds it. */
export const SNOOZE_TIME = `${String(MORNING_HOUR).padStart(2, '0')}:00`;

/**
 * A picked `YYYY-MM-DD` at a picked `HH:MM` (9 in the morning when none is
 * given), in Unix seconds. Any time from now on will do, today included.
 * Null when it is not a time, is not later than now, or is past the range.
 */
export function snoozeDate(picked: string, now: number, time: string = SNOOZE_TIME): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(picked);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]), 0, 0);
  const { min, max } = snoozeDateRange(now);
  if (Number.isNaN(date.getTime()) || picked < min || picked > max || date.getTime() <= now) return null;
  return date.getTime() / 1000;
}
