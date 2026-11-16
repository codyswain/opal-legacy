/* Where Threads' rows are cut, and bringing an opened part of them into view. */

export { fadeOf, type Fade } from '@/renderer/shared/utils/scrollFade';

/**
 * Scrolls the least that shows a section just opened: as much of it as
 * fits, its line first, kept `clear` px below the top so the top edge's
 * fade does not cover it.
 */
export function revealIn(scroller: HTMLElement, section: HTMLElement, clear = 0): void {
  const view = scroller.getBoundingClientRect();
  const box = section.getBoundingClientRect();
  const past = box.bottom - view.bottom;
  if (past <= 0) return;
  scroller.scrollTop += Math.min(past, Math.max(0, box.top - view.top - clear));
}
