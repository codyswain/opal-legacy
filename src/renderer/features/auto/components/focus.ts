import type * as React from 'react';
import { useAutoStore, wantedRow } from '../store/autoStore';

/*
 * Where the keyboard goes. The list is one Tab stop: its rows are reached
 * with the arrow keys, and each carries its id so an action can hand the
 * focus on to the next one.
 */

/*
 * Whether the last thing he did came from a key or from the pointer, and
 * where the keyboard was just before it, outside any menu or dialog. An
 * action taken with the pointer leaves the keyboard where it was: moved onto
 * the next row, the letters he types next would act on threads.
 */
let input: 'key' | 'pointer' = 'key';
let before: Element | null = null;
const inPopup = (target: EventTarget | null): boolean => target instanceof Element && target.closest('[role="menu"], [role="dialog"]') !== null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      input = 'pointer';
      // Before the press moves the focus: this runs first, in the capture phase.
      if (!inPopup(event.target)) before = document.activeElement;
    },
    true
  );
  document.addEventListener(
    'keydown',
    (event) => {
      input = 'key';
      if (!inPopup(event.target)) before = document.activeElement;
    },
    true
  );
}

/** The action being taken came from a key, not from the pointer. */
export const byKey = (): boolean => input === 'key';

/** After a pointer action: the keyboard goes back to where it was, if that is still there. A page's text keeps its caret. */
export function giveBack(): void {
  const element = before as HTMLElement | null;
  if (element && element.isConnected && element !== document.body && typeof element.focus === 'function' && document.activeElement !== element) element.focus({ preventScroll: true });
}

/** For the buttons on a row: a press does not take the keyboard from where it is. */
export const keepFocus = (event: React.MouseEvent): void => event.preventDefault();

/** A row of the sidebar's Threads by its id: a thread's, or a pane's name for New thread and Digest. */
export const rowElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-auto-list] [data-row-id="${id.replace(/["\\]/g, '')}"]`);

/** Puts the keyboard on a row of the sidebar now, or on its New thread button, if the sidebar shows it. */
export function focusRowNow(id: string): void {
  (rowElement(id) ?? rowElement(':new'))?.focus();
}

/**
 * For a menu or a dialog that closes: the keyboard goes to the row an
 * action asked for a moment ago, else back to the row it was opened from.
 * Their own way of returning focus would point at a button inside a row
 * that may have left.
 */
export function focusRowAfterClose(event: Event, from: string | null): void {
  event.preventDefault();
  if (!byKey()) {
    giveBack();
    return;
  }
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

/** A request for the page's Tab stop row, and for the page itself when no row is left. */
export const PAGE_FIRST = ':first';
export const PAGE_TOP = ':top';

/** A row of the Put away page by its id. */
export const pageRowElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="auto-away-page"] [data-row-id="${id.replace(/["\\]/g, '')}"]`);

/** The page's rows, top to bottom, as last drawn: where the keyboard goes when the row it was on leaves. */
let pageOrder: string[] = [];
export const setPageOrder = (order: string[]): void => {
  pageOrder = order;
};
/** The row that takes a leaving row's place on the page: the one below, else the one above. */
export function pageNext(id: string, still: (row: string) => boolean = (row) => pageRowElement(row) !== null): string | null {
  const at = pageOrder.indexOf(id);
  if (at === -1) return null;
  for (let step = at + 1; step < pageOrder.length; step += 1) if (pageOrder[step] !== id && still(pageOrder[step])) return pageOrder[step];
  for (let step = at - 1; step >= 0; step -= 1) if (still(pageOrder[step])) return pageOrder[step];
  return null;
}

/** For a menu or a dialog of a page row that closes: by a key, the keyboard goes to the row or the one in its place; by the pointer, back where it was. */
export function focusPageAfterClose(event: Event, from: string): void {
  event.preventDefault();
  if (!byKey()) {
    giveBack();
    return;
  }
  (pageRowElement(from) ?? (pageNext(from) ? pageRowElement(pageNext(from) ?? '') : null))?.focus();
}
