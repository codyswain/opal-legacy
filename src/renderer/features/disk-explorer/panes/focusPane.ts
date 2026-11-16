import { useTabsStore } from '../store/tabsStore';

/**
 * Puts the keyboard in the active pane, after the frame that draws it: its
 * page's text when it has an editor, else the page card itself.
 */
export function focusActivePane(): void {
  window.requestAnimationFrame(() => {
    const id = useTabsStore.getState().activePaneId;
    const column = document.querySelector<HTMLElement>(`[data-pane-column="${CSS.escape(id)}"]`);
    if (!column || column.contains(document.activeElement)) return;
    const target =
      column.querySelector<HTMLElement>('.cm-content[contenteditable="true"]') ??
      column.querySelector<HTMLElement>('[data-testid="workspace-surface"]');
    target?.focus();
  });
}

/** Split right, or the other pane with two, with the keyboard there. */
export function splitRight(): void {
  useTabsStore.getState().splitRight();
  focusActivePane();
}

export function focusOtherPane(): void {
  useTabsStore.getState().focusOtherPane();
  focusActivePane();
}

/** Moves the active pane's open tab to the other pane, making one at the right when there is one pane. */
export function moveTabToOtherPane(): void {
  const { activeId, moveToPane } = useTabsStore.getState();
  if (!activeId) return;
  moveToPane(activeId);
  focusActivePane();
}
