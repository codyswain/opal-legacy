import * as React from 'react';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { filesLocationKey, focusFile } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { canonical, tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import type { MarkdownLinks } from './markdown/Markdown';
import { autoApi } from './store/autoStore';
import { useSaidStore } from './store/saidStore';

/**
 * How links in replies are followed. A vault path is looked up by the main
 * process inside the opened folders, and the file opens in a tab of its
 * own, or in the tab that already shows it, so the thread stays where it is.
 */
export function useVaultLinks(): MarkdownLinks {
  const { navigateFiles } = useShell();
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const tops = React.useMemo(
    () => new Set(roots.flatMap((root) => listings[root] ?? []).map((entry) => entry.name)),
    [roots, listings]
  );
  const openVault = React.useCallback(
    (path: string) => {
      void autoApi()?.resolvePage(path).then((result) => {
        if (!result.success) {
          useSaidStore.getState().refuse(result.error.message);
          return;
        }
        recordOpened(result.data.path);
        const intent = focusFile(result.data.path);
        const key = filesLocationKey(canonical(intent.location));
        const tabs = useTabsStore.getState();
        const shown = tabs.tabs.find((tab) => filesLocationKey(tabLocation(tab)) === key);
        if (shown) tabs.activate(shown.id);
        else navigateFiles(intent, { newTab: true });
      });
    },
    [navigateFiles]
  );
  return React.useMemo(() => ({ context: { roots, tops }, openVault }), [roots, tops, openVault]);
}

