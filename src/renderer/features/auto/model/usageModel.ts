import type { AutoLimit, AutoUsage } from '@/types/auto';
import { lower, returns, stamp } from './awayModel';
import { clockTime, dayGap, shortDate, shortWeekday } from './clock';

/*
 * The words for how much of the plan is used: the ring by the message box
 * and its popover. The numbers move only when a thread runs, so each can be
 * hours old, and a window can have started again since it was seen. Every
 * time is said as seen from `now`, in ms.
 */

/** The app's middle dot between two parts of one line. */
export const DOT = ' · ';

/** A number this much older than now is said with when it was seen. */
export const STALE_MS = 60 * 60_000;

/** The percent used: 100 only at the limit, so a rounded 99.5 stays 99. */
export const usagePercent = (used: number): number => (used >= 1 ? 100 : Math.min(99, Math.round(used * 100)));

/** "Weekly, all models" as a row says it: "Weekly · all models". */
export const usageLabel = (label: string): string => label.split(', ').join(DOT);

/** The limit's window has started again since its number was seen: the number belongs to a window that is over. */
export const isReset = (limit: AutoLimit, now: number): boolean => limit.resetsAt !== null && limit.resetsAt * 1000 <= now;

/** The limits whose windows are still the ones their numbers were seen in, in the order sent. */
const current = (usage: AutoUsage, now: number): AutoLimit[] => usage.limits.filter((limit) => !isReset(limit, now));

/** The fullest limit that has not reset, the first of equals; null when every one has. */
export function fullest(usage: AutoUsage, now: number): AutoLimit | null {
  return current(usage, now).reduce<AutoLimit | null>((most, limit) => (most === null || limit.used > most.used ? limit : most), null);
}

/** How full the ring is, 0 to 1: the fullest limit that has not reset, 0 when none is left. */
export const ringFill = (usage: AutoUsage, now: number): number => fullest(usage, now)?.used ?? 0;

/** What the ring says to a screen reader: "Plan usage, Weekly · all models 73% used". */
export function ringLabel(usage: AutoUsage, now: number): string {
  const limit = fullest(usage, now);
  return limit ? `Plan usage, ${usageLabel(limit.label)} ${usagePercent(limit.used)}% used` : 'Plan usage, limits reset';
}

/** The popover's header: "Plan usage limits · Pro". */
export const usageHeader = (usage: AutoUsage): string => (usage.plan ? `Plan usage limits${DOT}${usage.plan}` : 'Plan usage limits');

/** When something already happened, with its time: "10:00 pm" today, "yesterday 10:00 pm", "Wed 10:00 pm", else "Nov 3 10:00 pm". */
function happened(seconds: number, now: number): string {
  const clock = clockTime(seconds);
  const days = -dayGap(seconds, now);
  if (days <= 0) return clock;
  if (days === 1) return `yesterday ${clock}`;
  if (days < 7) return `${shortWeekday(seconds)} ${clock}`;
  return `${shortDate(seconds, now)} ${clock}`;
}

export interface UsageRow {
  key: string;
  /** "Weekly · all models". */
  label: string;
  /** "Resets Wed 10:00 pm", or for a window that is over "Reset Wed 10:00 pm, not seen since"; '' when the service gives no time. */
  when: string;
  /** "45%", or null for a window that is over. */
  percent: string | null;
  /** How far the bar is filled, 0 to 1. Empty for a window that is over. */
  fill: number;
  /** "as of 9:12 am" when the number was seen more than an hour ago, else null. */
  asOf: string | null;
}

/** One row per limit, in the order the service sends them. */
export function usageRows(usage: AutoUsage, now: number): UsageRow[] {
  return usage.limits.map((limit) => {
    const label = usageLabel(limit.label);
    if (limit.resetsAt !== null && isReset(limit, now)) {
      return { key: limit.key, label, when: `Reset ${happened(limit.resetsAt, now)}, not seen since`, percent: null, fill: 0, asOf: null };
    }
    const stale = limit.seenAt !== null && now - limit.seenAt * 1000 > STALE_MS;
    return {
      key: limit.key,
      label,
      when: limit.resetsAt === null ? '' : `Resets ${lower(returns(limit.resetsAt, now))}`,
      percent: `${usagePercent(limit.used)}%`,
      fill: limit.used,
      asOf: stale && limit.seenAt !== null ? `as of ${lower(stamp(limit.seenAt, now))}` : null,
    };
  });
}
