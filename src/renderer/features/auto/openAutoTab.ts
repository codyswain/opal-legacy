import { browseAuto, isAutoLocation, type FilesNavigationIntent } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { allTabs, tabLocation, useTabsStore, type OpenOptions } from '@/renderer/features/disk-explorer/store/tabsStore';
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
 * the sidebar or the palette. The page he was on stays in its own tab.
 */
export function showInAuto(navigateFiles: NavigateFiles, pane: string, options: Pick<OpenOptions, 'side'> = {}): void {
  openAutoTab(navigateFiles, options);
  useThreadStore.getState().open(pane);
}
