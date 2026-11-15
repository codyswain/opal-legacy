import { browseAuto, isAutoLocation, type FilesNavigationIntent } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { tabLocation, useTabsStore, type OpenOptions } from '@/renderer/features/disk-explorer/store/tabsStore';

/** There is one Auto tab: this goes to the one already open, or opens one beside the page. */
export function openAutoTab(navigateFiles: (intent: FilesNavigationIntent, options?: Pick<OpenOptions, 'newTab'>) => void): void {
  const tabs = useTabsStore.getState();
  const open = tabs.tabs.find((tab) => isAutoLocation(tabLocation(tab)));
  if (open) tabs.activate(open.id);
  else navigateFiles(browseAuto(), { newTab: true });
}
