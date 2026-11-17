import { browseAuto, isAutoLocation, type FilesNavigationIntent } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { allTabs, paneOfTab, tabLocation, useTabsStore, type OpenOptions } from '@/renderer/features/disk-explorer/store/tabsStore';
import { AWAY, DIGEST_QUEUE } from './model/pane';
import { useThreadStore } from './store/threadStore';

type NavigateFiles = (intent: FilesNavigationIntent, options?: Pick<OpenOptions, 'newTab' | 'side'>) => void;

/**
 * There is one Auto tab: this goes to the one already open, in either pane,
 * or opens one beside the page. With `side` it goes to the other pane.
 */
export function openAutoTab(navigateFiles: NavigateFiles, options: Pick<OpenOptions, 'side'> = {}): void {
  if (options.side) {
    navigateFiles(browseAuto(), { side: true });
    return;
  }
  const tabs = useTabsStore.getState();
  const open = allTabs(tabs).find((tab) => isAutoLocation(tabLocation(tab)));
  if (open) tabs.activate(open.id);
  else navigateFiles(browseAuto(), { newTab: true });
}

/**
 * Shows a thread, the digest's queue or a new thread in the Auto tab, from
 * the sidebar or the palette. The page he was on stays in its own tab. The
 * pane with the Auto tab becomes the active one, and a thread or a new one
 * opens with the caret in its box, as with one pane.
 */
export function showInAuto(navigateFiles: NavigateFiles, pane: string, options: Pick<OpenOptions, 'side'> = {}): void {
  openAutoTab(navigateFiles, options);
  const tabs = useTabsStore.getState();
  const auto = allTabs(tabs).find((tab) => isAutoLocation(tabLocation(tab)));
  const autoPane = auto ? paneOfTab(tabs, auto.id) : null;
  if (autoPane) tabs.focusPane(autoPane.id);
  useThreadStore.getState().open(pane);
  if (autoPane && pane !== DIGEST_QUEUE && pane !== AWAY) focusBoxWhenUp(autoPane.id);
}

/**
 * Puts the caret in the box of the Auto tab's pane once it is drawn, unless
 * the keyboard is already in that pane (the title's field while renaming)
 * or another pane has been made active since.
 */
function focusBoxWhenUp(paneId: string, frames = 60): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    if (useTabsStore.getState().activePaneId !== paneId || useThreadStore.getState().renaming) return;
    const column = document.querySelector<HTMLElement>(`[data-pane-column="${CSS.escape(paneId)}"]`);
    const box = column?.querySelector<HTMLTextAreaElement>('[data-testid="auto-box"]');
    if (box) {
      if (!column?.contains(document.activeElement) || document.activeElement === column.querySelector('[data-testid="workspace-surface"]')) box.focus({ preventScroll: true });
      return;
    }
    if (frames > 0) focusBoxWhenUp(paneId, frames - 1);
  });
}
