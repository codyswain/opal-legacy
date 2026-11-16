import type { AutoLimit, AutoUsage } from '@/types/auto';
import { lower, returns } from './awayModel';

/*
 * The words for how much of the plan is used: the ring by the message box
 * and its popover. A limit whose window has started again is left out: the
 * service drops it within a minute and says so, and until then its number
 * belongs to a window that is over. Every time is said as seen from `now`,
 * in ms.
 */

/** The app's middle dot between two parts of one line. */
export const DOT = ' · ';

/** The percent used: 100 only at the limit, so a rounded 99.5 stays 99. */
export const usagePercent = (used: number): number => (used >= 1 ? 100 : Math.min(99, Math.round(used * 100)));

/** "Weekly, all models" as a row says it: "Weekly · all models". */
export const usageLabel = (label: string): string => label.split(', ').join(DOT);

/** The limit's window has started again: its number belongs to a window that is over. */
export const isReset = (limit: AutoLimit, now: number): boolean => limit.resetsAt !== null && limit.resetsAt * 1000 <= now;

/** The limits shown: those whose windows have not started again, in the order sent. */
export const shownLimits = (usage: AutoUsage, now: number): AutoLimit[] => usage.limits.filter((limit) => !isReset(limit, now));

/** The fullest limit shown, the first of equals; null when none is. */
export function fullest(usage: AutoUsage, now: number): AutoLimit | null {
  return shownLimits(usage, now).reduce<AutoLimit | null>((most, limit) => (most === null || limit.used > most.used ? limit : most), null);
}

/** How full the ring is, 0 to 1: the fullest limit shown, 0 when none is. */
export const ringFill = (usage: AutoUsage, now: number): number => fullest(usage, now)?.used ?? 0;

/** What the ring says to a screen reader: "Plan usage, Weekly · all models 73% used". */
export function ringLabel(usage: AutoUsage, now: number): string {
  const limit = fullest(usage, now);
  return limit ? `Plan usage, ${usageLabel(limit.label)} ${usagePercent(limit.used)}% used` : 'Plan usage';
}

/** The popover's header: "Plan usage limits · Pro". */
export const usageHeader = (usage: AutoUsage): string => (usage.plan ? `Plan usage limits${DOT}${usage.plan}` : 'Plan usage limits');

export interface UsageRow {
  key: string;
  /** "Weekly · all models". */
  label: string;
  /** "Resets Wed 10:00 pm"; '' when the service gives no time. */
  when: string;
  /** "45%". */
  percent: string;
  /** How far the bar is filled, 0 to 1. */
  fill: number;
}

/** One row per limit shown, in the order the service sends them. */
export function usageRows(usage: AutoUsage, now: number): UsageRow[] {
  return shownLimits(usage, now).map((limit) => ({
    key: limit.key,
    label: usageLabel(limit.label),
    when: limit.resetsAt === null ? '' : `Resets ${lower(returns(limit.resetsAt, now))}`,
    percent: `${usagePercent(limit.used)}%`,
    fill: limit.used,
  }));
}
