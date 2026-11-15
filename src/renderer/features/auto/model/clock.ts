/*
 * Times as the list says them. Everything here takes its "now" as an
 * argument, so a test can stand at any moment.
 */

export const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** How many days after today a time falls: 0 today, 1 tomorrow, -1 yesterday. */
export const dayGap = (seconds: number, now: number): number =>
  Math.round((startOfDay(new Date(seconds * 1000)) - startOfDay(new Date(now))) / 86_400_000);

/** "3:10 pm". */
export function clockTime(seconds: number): string {
  return new Date(seconds * 1000)
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?([AP]M)$/i, (_match, half: string) => ` ${half.toLowerCase()}`);
}

/** "Tue". */
export const shortWeekday = (seconds: number): string => new Date(seconds * 1000).toLocaleDateString('en-US', { weekday: 'short' });

/** "Nov 23", with the year when it is not this one. */
export function shortDate(seconds: number, now: number): string {
  const date = new Date(seconds * 1000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  });
}
