import type { AutoThread, AutoWait } from '@/types/auto';
import { clockTime, dayGap, shortDate, shortWeekday } from './clock';

/*
 * The words for what is put away: a thread snoozed to a time, a thread put
 * away until someone replies, and the archive. They are the phone's words,
 * so a thread reads the same on both. Every time is said as seen from `now`.
 */

/** A wait that has not ended: Auto is still naming the conversation, or the service is watching it. */
export const isOpenWait = (wait: AutoWait | null): wait is AutoWait => wait !== null && (wait.state === 'finding' || wait.state === 'watching');

/** Put away until someone replies. Its `snoozed` is when the wait gives up. */
export const isWaitingOnReply = (thread: AutoThread): boolean => thread.snoozed !== null && isOpenWait(thread.wait);

/** "Tomorrow 9:00 am" inside a sentence: "tomorrow 9:00 am". A weekday or a month keeps its capital. */
export function lower(words: string): string {
  for (const word of ['Tomorrow', 'Yesterday']) {
    if (words.startsWith(word)) return word.toLowerCase() + words.slice(word.length);
  }
  return words;
}

const capitalized = (words: string): string => (words ? words.charAt(0).toUpperCase() + words.slice(1) : '');

/** When something returns: "5:40 pm" today, "Tomorrow 9:00 am", "Mon 9:00 am" within the week, else "Nov 23 9:00 am". */
export function returns(seconds: number, now: number): string {
  const clock = clockTime(seconds);
  const days = dayGap(seconds, now);
  if (days <= 0) return clock;
  if (days === 1) return `Tomorrow ${clock}`;
  if (days < 7) return `${shortWeekday(seconds)} ${clock}`;
  return `${shortDate(seconds, now)} ${clock}`;
}

/** When something happened: the clock today ("now" within the minute), "Yesterday", the weekday within the week, else "Nov 3". */
export function stamp(seconds: number, now: number): string {
  const days = -dayGap(seconds, now);
  if (days <= 0) return now - seconds * 1000 < 60_000 ? 'now' : clockTime(seconds);
  if (days === 1) return 'Yesterday';
  if (days < 7) return shortWeekday(seconds);
  return shortDate(seconds, now);
}

/** How long a thread has been working: "now", "12 min", "1 h", "1 h 5 min". */
export function elapsed(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now / 1000 - since) / 60);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Who a waiting thread waits on and until when, on one line: "Waiting on Sam until Tue 5:00 pm". */
export function waitLine(thread: AutoThread, now: number): string {
  const wait = thread.wait;
  if (!wait) return '';
  if (wait.state === 'finding') return 'Finding the conversation';
  const who = `Waiting on ${wait.on || 'a reply'}`;
  const at = wait.expires ?? thread.snoozed;
  return at === null ? who : `${who} until ${lower(returns(at, now))}`;
}

/** "Gives up Tue 5:00 pm". */
export function givesUp(thread: AutoThread, now: number): string {
  const at = thread.wait?.expires ?? thread.snoozed;
  return at === null ? '' : `Gives up ${lower(returns(at, now))}`;
}

/** "Returns tomorrow 9:00 am", for a thread snoozed to a time. */
export function returnsLine(thread: AutoThread, now: number): string {
  if (thread.snoozed === null) return '';
  const back = returns(thread.snoozed, now);
  return `Returns ${dayGap(thread.snoozed, now) <= 0 ? `at ${back}` : lower(back)}`;
}

/** "Snoozed at 4:10 pm", "Snoozed yesterday": when he put it away. '' when the service does not say. */
export function sinceLine(thread: AutoThread, now: number): string {
  const at = thread.snoozedAt ?? thread.wait?.since ?? null;
  if (at === null) return '';
  const when = stamp(at, now);
  return `Snoozed ${when === 'now' ? 'just now' : -dayGap(at, now) <= 0 ? `at ${when}` : lower(when)}`;
}

/**
 * The quiet line under a put-away thread. Waiting: what it waits for and
 * where ("A reply about the site visit. In Gmail."), or when it gives up
 * while Auto still looks. Snoozed: when he snoozed it.
 */
export function awayDetail(thread: AutoThread, now: number): string {
  const parts: string[] = [];
  const wait = thread.wait;
  if (wait && isWaitingOnReply(thread)) {
    if (wait.state === 'finding') parts.push(givesUp(thread, now));
    else {
      parts.push(capitalized(wait.what));
      if (wait.where) parts.push(`In ${wait.where}`);
    }
  } else {
    parts.push(sinceLine(thread, now));
  }
  const line = parts.filter(Boolean).map((part) => (part.endsWith('.') ? part.slice(0, -1) : part)).join('. ');
  return line ? `${line}.` : '';
}

/** The service's line may open with a name ("Robin: Will look tonight."): the name, and what was said. */
function spoken(line: string): { who: string; said: string } {
  const colon = line.indexOf(': ');
  return colon !== -1 && colon <= 40 ? { who: line.slice(0, colon), said: line.slice(colon + 2) } : { who: '', said: line };
}

/** Their newest message when it did not answer what he waits for: "Last heard: Will check on Monday". */
export function heardLine(wait: AutoWait): string {
  return wait.heard ? `Last heard: ${spoken(wait.heard).said}` : '';
}

/** Back in the list after a wait: who replied and what they said, or that nobody did. Null for a wait that has not ended. */
export function waitBack(wait: AutoWait): string | null {
  if (wait.state === 'met') {
    const { who, said } = spoken(wait.reply);
    const name = who || wait.on;
    const lead = name ? `${name} replied` : 'A reply came';
    return said ? `${lead}: ${said}` : `${lead}.`;
  }
  if (wait.state === 'expired') return wait.on ? `No reply from ${wait.on}.` : 'No reply came.';
  return null;
}

/** "Archived Nov 12.", or '' when the service does not say when. */
export function archivedWord(thread: AutoThread, now: number): string {
  const at = thread.archivedAt;
  if (at === null) return '';
  const when = stamp(at, now);
  return `Archived ${when === 'now' ? 'just now' : -dayGap(at, now) <= 0 ? `at ${when}` : lower(when)}.`;
}

/** The conversation a wait watches, when it is a web address this app may open; else null. */
export function waitUrl(wait: AutoWait | null): string | null {
  if (!wait || !/^https?:\/\//i.test(wait.link)) return null;
  try {
    const url = new URL(wait.link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The hour a wait gives up at. */
const GIVE_UP_HOUR = 17;

/** 5:00 pm, this many working days on, in Unix seconds. Saturday and Sunday are not counted. */
export function workingDays(days: number, now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  let left = Math.max(1, days);
  while (left > 0) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0 && day.getDay() !== 6) left -= 1;
  }
  day.setHours(GIVE_UP_HOUR, 0, 0, 0);
  return day.getTime() / 1000;
}

export interface GiveUpChoice {
  label: string;
  /** Unix seconds. */
  until: number;
  /** The time it means: "Tue 5:00 pm". */
  hint: string;
}

/** When a wait gives up unless he says otherwise: two working days on at 5:00 pm. */
export const defaultGiveUp = (now: number): number => workingDays(2, now);

/** The times a wait can give up at: the next working day, two working days (the default), a week. */
export function giveUpChoices(now: number): GiveUpChoice[] {
  const week = new Date(now);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() + 7);
  week.setHours(GIVE_UP_HOUR, 0, 0, 0);
  return [
    { label: 'Next working day', until: workingDays(1, now) },
    { label: 'Two working days', until: defaultGiveUp(now) },
    { label: 'A week', until: week.getTime() / 1000 },
  ].map((choice) => ({ ...choice, hint: returns(choice.until, now) }));
}
