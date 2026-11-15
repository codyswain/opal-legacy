import { browseAuto, isAutoLocation, type FilesNavigationIntent } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { tabLocation, useTabsStore, type OpenOptions } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useThreadStore } from './store/threadStore';

type NavigateFiles = (intent: FilesNavigationIntent, options?: Pick<OpenOptions, 'newTab'>) => void;

/** There is one Auto tab: this goes to the one already open, or opens one beside the page. */
export function openAutoTab(navigateFiles: NavigateFiles): void {
  const tabs = useTabsStore.getState();
  const open = tabs.tabs.find((tab) => isAutoLocation(tabLocation(tab)));
  if (open) tabs.activate(open.id);
  else navigateFiles(browseAuto(), { newTab: true });
}

/**
 * Shows a thread, the digest's queue or a new thread in the Auto tab, from
 * the sidebar or the palette. The page he was on stays in its own tab.
 */
export function showInAuto(navigateFiles: NavigateFiles, pane: string): void {
  openAutoTab(navigateFiles);
  useThreadStore.getState().open(pane);
}
