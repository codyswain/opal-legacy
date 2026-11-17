/** No page card is ever narrower than this. */
export const MIN_PANE_WIDTH = 360;
/** What a pane's column holds beside its card: the inset at the window's side and half the band between the cards. */
export const PANE_COLUMN_EXTRA = 12;
/** The narrowest column a pane is given. */
export const MIN_PANE_COLUMN = MIN_PANE_WIDTH + PANE_COLUMN_EXTRA;

/** Whether the room beside the open sidebars holds two panes side by side. */
export function fitsTwoPanes(width: number): boolean {
  return width >= 2 * MIN_PANE_COLUMN;
}

/** The left pane's column, in px, for a share of the room: never so wide or narrow that a card drops under the minimum. */
export function leftPaneWidth(split: number, width: number): number {
  const wanted = Math.round((Number.isFinite(split) ? split : 0.5) * width);
  return Math.min(width - MIN_PANE_COLUMN, Math.max(MIN_PANE_COLUMN, wanted));
}

/** The share of the room a left column of this width takes. */
export function splitFor(leftWidth: number, width: number): number {
  if (width <= 0) return 0.5;
  return Math.min(width - MIN_PANE_COLUMN, Math.max(MIN_PANE_COLUMN, leftWidth)) / width;
}
