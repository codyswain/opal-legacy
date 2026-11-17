import { browseAuto, browseDigest, filesLocationKey, isAutoLocation, type FilesNavigationIntent } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { allTabs, selectCurrentLocation, tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import type { OpenHow } from '@/renderer/features/disk-explorer/navigation/openHow';
import { AWAY, DIGEST_QUEUE } from './model/pane';
import { useThreadStore } from './store/threadStore';

type NavigateFiles = (intent: FilesNavigationIntent, options?: OpenHow) => void;
type ShowOptions = OpenHow & { focus?: boolean; fromAway?: boolean };

/** Threads share a tab. The digest has a separate tab which can stay open beside it. */
function openPlace(navigate: NavigateFiles, intent: FilesNavigationIntent, how: OpenHow): void {
  if (how.side) {
    navigate(intent, { side: true });
    return;
  }
  const tabs = useTabsStore.getState();
  const key = filesLocationKey(intent.location);
  const open = allTabs(tabs).find((tab) => filesLocationKey(tabLocation(tab)) === key);
  if (open) tabs.activate(open.id);
  else navigate(intent, { newTab: true });
}

export function openAutoTab(navigateFiles: NavigateFiles, options: OpenHow = {}): void {
  openPlace(navigateFiles, browseAuto(), options);
}

export function showInAuto(navigateFiles: NavigateFiles, pane: string, options: ShowOptions = {}): void {
  if (pane === DIGEST_QUEUE) {
    openPlace(navigateFiles, browseDigest(), options);
    return;
  }
  openAutoTab(navigateFiles, options);
  useThreadStore.getState().open(pane, options);
  if (options.focus !== false && pane !== AWAY) focusBoxWhenUp(useTabsStore.getState().activePaneId);
}

/** Actions within the workspace, including a completed digest reply, can bring the appropriate tab forward. */
export function showAutoPane(pane: string, options: ShowOptions = {}): void {
  showInAuto((intent, how) => useTabsStore.getState().open(intent.location, how), pane, options);
}

/**
 * Puts the caret in the box of the Auto tab's pane once it is drawn, unless
 * the keyboard is already in that pane (the title's field while renaming)
 * or another pane has been made active since.
 */
function focusBoxWhenUp(paneId: string, frames = 60): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    const tabs = useTabsStore.getState();
    if (tabs.activePaneId !== paneId || !isAutoLocation(selectCurrentLocation(tabs)) || useThreadStore.getState().renaming) return;
    const column = document.querySelector<HTMLElement>(`[data-pane-column="${CSS.escape(paneId)}"]`);
    const box = column?.querySelector<HTMLTextAreaElement>('[data-testid="auto-box"]');
    if (box) {
      if (!column?.contains(document.activeElement) || document.activeElement === column.querySelector('[data-testid="workspace-surface"]')) box.focus({ preventScroll: true });
      return;
    }
    if (frames > 0) focusBoxWhenUp(paneId, frames - 1);
  });
}
