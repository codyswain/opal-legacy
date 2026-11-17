import * as React from 'react';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { focusFile } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import type { MarkdownLinks, VaultOpen, VaultOpenOptions } from './markdown/Markdown';
import { autoApi, useAutoStore } from './store/autoStore';
import { updateFolders } from './store/pageLinks';
import { useSaidStore } from './store/saidStore';

/** What a page that is not here says, at the link or, from elsewhere, at the foot of the sidebar. */
export const NOT_HERE_YET = 'This file is not on this Mac yet.';

/**
 * How links in replies are followed. A vault path is looked up by the main
 * process inside the opened folders, and the file opens the way a click in
 * the sidebar opens it: in the active pane, where the Auto tab sends it to
 * the tab that already shows it or a new one beside it, so the thread stays
 * where it is; a page the other pane shows is brought forward there instead
 * of opened twice.
 * A page that is not found may be on the remote already, written by the
 * service on its own machine: the opened folders are brought up to date
 * once, and the page is looked up again.
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
    async (path: string, newTab: boolean, options: VaultOpenOptions = {}): Promise<VaultOpen> => {
      const api = autoApi();
      if (!api) return 'refused';
      const look = () => api.resolvePage(path).catch((): null => null);
      let result = await look();
      const address = useAutoStore.getState().address;
      if (result && !result.success && result.error.kind === 'missing' && address) {
        options.onWorking?.();
        await updateFolders(address);
        result = await look();
      }
      if (!result) {
        useSaidStore.getState().refuse('Opal could not open that file.');
        return 'refused';
      }
      if (!result.success) {
        if (result.error.kind !== 'missing') useSaidStore.getState().refuse(result.error.message);
        // A link says so where he is looking; anything else says it at the foot of the sidebar.
        else if (!options.atLink) useSaidStore.getState().refuse(NOT_HERE_YET);
        return result.error.kind === 'missing' ? 'missing' : 'refused';
      }
      recordOpened(result.data.path);
      navigateFiles(focusFile(result.data.path), { newTab });
      return 'opened';
    },
    [navigateFiles]
  );
  return React.useMemo(() => ({ context: { roots, tops }, openVault }), [roots, tops, openVault]);
}
