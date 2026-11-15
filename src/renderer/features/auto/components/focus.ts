import { useAutoStore, wantedRow } from '../store/autoStore';

/*
 * Where the keyboard goes. The list is one Tab stop: its rows are reached
 * with the arrow keys, and each carries its id so an action can hand the
 * focus on to the next one.
 */

/** A row of the list by its id: a thread's, or a pane's name for New thread and Digest. */
export const rowElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="auto-list"] [data-row-id="${id.replace(/["\\]/g, '')}"]`);

/**
 * For a menu or a dialog that closes: the keyboard goes to the row an
 * action asked for a moment ago, else back to the row it was opened from.
 * Their own way of returning focus would point at a button inside a row
 * that may have left.
 */
export function focusRowAfterClose(event: Event, from: string | null): void {
  event.preventDefault();
  const row = wantedRow() ?? from;
  const element = row ? rowElement(row) : null;
  if (element) element.focus();
  else if (row) useAutoStore.getState().requestFocus(row);
}

/** Whether a key press belongs to a field, where letters are text. */
export function inField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable === true);
}

/** Up, Down, Home, End, and `j` and `k`: the place in a run of rows a key moves to, or null for any other key. */
export function rovingTarget(key: string, at: number, count: number): number | null {
  const to = key === 'ArrowDown' || key === 'j' ? at + 1 : key === 'ArrowUp' || key === 'k' ? at - 1 : key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
  return to === null || to < 0 || to >= count || to === at ? null : to;
}
