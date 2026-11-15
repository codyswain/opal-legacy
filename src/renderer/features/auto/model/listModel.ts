import type { AutoThread } from '@/types/auto';

/*
 * The list: the threads he marked for the Mac first, then the ones that wait
 * on him, then the rest, each in the service's order, and snoozed ones
 * behind one line at the bottom. Snoozed wins over every group.
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
  takes: (thread: AutoThread) => boolean;
}

/**
 * The list's groups, top to bottom. A thread goes into the first group that
 * takes it, and keeps the service's order inside it. This is the one place
 * the grouping is set: a new group, with or without a heading, is one more
 * line here.
 */
const GROUPS: readonly GroupRule[] = [
  // Marked for the Mac on any device. A marked thread that waits on him stays here, with its question.
  { key: 'desk', heading: 'For the Mac', movable: false, takes: (thread) => thread.desk !== null },
  { key: 'needs', heading: null, movable: false, takes: (thread) => thread.status === 'waiting' },
  { key: 'rest', heading: null, movable: true, takes: () => true },
];

export interface ListView {
  /** The groups that hold a thread. */
  groups: ListGroup[];
  /** Hidden behind the Snoozed line, the first to come back first. */
  snoozed: AutoThread[];
  /** How many threads wait on him. */
  needs: number;
}

export function listView(threads: readonly AutoThread[]): ListView {
  const shown = threads.filter((thread) => !thread.archived && thread.snoozed === null);
  const snoozed = threads
    .filter((thread) => !thread.archived && thread.snoozed !== null)
    .sort((left, right) => (left.snoozed ?? 0) - (right.snoozed ?? 0));
  const groups = GROUPS.map((rule): ListGroup => ({ key: rule.key, heading: rule.heading, movable: rule.movable, threads: [] }));
  for (const thread of shown) {
    const at = GROUPS.findIndex((rule) => rule.takes(thread));
    if (at !== -1) groups[at].threads.push(thread);
  }
  return {
    groups: groups.filter((group) => group.threads.length > 0),
    snoozed,
    // Whichever group they show in.
    needs: shown.filter((thread) => thread.status === 'waiting').length,
  };
}

/** How many threads wait on him. */
export const needsCount = (threads: readonly AutoThread[]): number => listView(threads).needs;

/**
 * The sidebar's count: the threads that wait on him and the ones with a
 * reply he has not read. Snoozed and archived threads are left out.
 */
export function attentionCount(threads: readonly AutoThread[]): number {
  return threads.filter((thread) => !thread.archived && thread.snoozed === null && (thread.status === 'waiting' || thread.unread)).length;
}

/** The threads' ids in the order the list shows them: each group in turn, then the snoozed ones when their line is open. */
export function shownOrder(threads: readonly AutoThread[], snoozedOpen: boolean): string[] {
  const view = listView(threads);
  return [...view.groups.flatMap((group) => group.threads), ...(snoozedOpen ? view.snoozed : [])].map((thread) => thread.id);
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
  kind: 'ask' | 'live' | 'failed' | 'plain';
  text: string;
}

export function rowLine(thread: AutoThread): RowLine {
  if (thread.status === 'waiting' && thread.ask) return { kind: 'ask', text: thread.ask.text };
  if (thread.status === 'working' || thread.status === 'queued') return { kind: 'live', text: thread.activity || 'Working' };
  if (thread.status === 'failed') return { kind: 'failed', text: `Failed: ${thread.error || 'the turn did not finish'}` };
  return { kind: 'plain', text: thread.status === 'stopped' ? 'Stopped' : thread.last };
}

/** The labels a waiting row offers as buttons: only for a plain question, never for a permission. */
export function rowOptions(thread: AutoThread): string[] {
  const ask = thread.ask;
  if (thread.status !== 'waiting' || !ask || ask.kind !== 'ask' || !ask.question) return [];
  return ask.options;
}

/** A thread that came from a digest entry: Done archives it and marks its entry done in the digest. */
export const fromDigest = (thread: AutoThread): boolean => thread.digest !== null;

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "3:10 pm". */
export function clockTime(seconds: number): string {
  return new Date(seconds * 1000)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([AP]M)$/i, (_match, half: string) => ` ${half.toLowerCase()}`);
}

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
 * thread at work, and an entry nobody has started, show none.
 */
export function rowTime(thread: AutoThread, now: number): string {
  if (thread.woke) return `Back ${clockTime(thread.woke)}`;
  if (thread.status === 'working' || thread.status === 'queued' || thread.waits || !thread.updated) return '';
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
  const count = view.snoozed.length;
  const back = returnTime(next.snoozed ?? 0, now);
  return {
    title: 'Nothing left.',
    detail: count === 1 ? `1 snoozed. It returns ${back}.` : `${count} snoozed. The next one returns ${back}.`,
  };
}

export interface SnoozeChoice {
  label: string;
  /** Unix seconds. */
  until: number;
  /** The time it means, at the row's end. */
  hint: string;
}

const MORNING_HOUR = 8;

/** A day's morning, `days` after now. */
function morning(now: number, days: number): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(MORNING_HOUR, 0, 0, 0);
  return date;
}

/**
 * Later today (three hours on, while that is still today), Tomorrow and
 * Next week (Monday), both at 8 in the morning.
 */
export function snoozeChoices(now: number): SnoozeChoice[] {
  const choices: SnoozeChoice[] = [];
  const later = new Date(now + 3 * 3_600_000);
  later.setMinutes(Math.ceil(later.getMinutes() / 30) * 30, 0, 0);
  if (later.getDate() === new Date(now).getDate()) {
    choices.push({ label: 'Later today', until: later.getTime() / 1000, hint: clockTime(later.getTime() / 1000) });
  }
  const tomorrow = morning(now, 1);
  choices.push({ label: 'Tomorrow', until: tomorrow.getTime() / 1000, hint: `${tomorrow.toLocaleDateString('en-US', { weekday: 'short' })} ${clockTime(tomorrow.getTime() / 1000)}` });
  const weekday = new Date(now).getDay();
  // Monday of next week; from a Sunday that is tomorrow, so it is the Monday after.
  const toMonday = ((8 - weekday) % 7 || 7) + (weekday === 0 ? 7 : 0);
  const monday = morning(now, toMonday);
  choices.push({ label: 'Next week', until: monday.getTime() / 1000, hint: `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clockTime(monday.getTime() / 1000)}` });
  return choices;
}

/** The first and last day a date picked for a snooze may be, as `YYYY-MM-DD`. */
export function snoozeDateRange(now: number): { min: string; max: string } {
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { min: iso(morning(now, 1)), max: iso(morning(now, 365)) };
}

/** The time a picked day starts with, as a time field holds it. */
export const SNOOZE_TIME = `${String(MORNING_HOUR).padStart(2, '0')}:00`;

/**
 * A picked `YYYY-MM-DD` at a picked `HH:MM` (8 in the morning when none is
 * given), in Unix seconds, or null when it is not a time on a day inside
 * the range.
 */
export function snoozeDate(picked: string, now: number, time: string = SNOOZE_TIME): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(picked);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]), 0, 0);
  const { min, max } = snoozeDateRange(now);
  if (Number.isNaN(date.getTime()) || picked < min || picked > max) return null;
  return date.getTime() / 1000;
}
