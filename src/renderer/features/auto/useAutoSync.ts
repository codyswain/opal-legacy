import { useEffect } from 'react';
import { isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { autoApi, useAutoStore } from './store/autoStore';
import { dispatchStream } from './store/streams';
import { useThreadStore } from './store/threadStore';
import { useAutoCommands } from './useAutoCommands';
import { useAutoKeys } from './useAutoKeys';
import { useAutoReread } from './useAutoReread';

/** While the service is out of reach, the list is asked for again this often with a tab open, and this often without. */
const RETRY_MS = 5_000;
const RETRY_AWAY_MS = 30_000;

/**
 * Keeps what the page knows about Auto current. Mounted once, by
 * AppCommands. The list is read at launch when an address is set and its
 * stream is followed from then on, with a tab open or not, so the sidebar
 * can count what needs him: the list's stream holds back no ping. A
 * thread's stream is the tab's own business (AutoView), followed only
 * while the tab is in view, because an open one does hold them back.
 * useAutoReread reads the list again when the app may have missed a change.
 */
export function useAutoSync(): void {
  const hasTab = useTabsStore((state) => state.tabs.some((tab) => isAutoLocation(tabLocation(tab))));
  const address = useAutoStore((state) => state.address);
  const reachable = useAutoStore((state) => state.reachable);
  useAutoCommands();
  useAutoKeys();
  useAutoReread();

  useEffect(() => {
    const api = autoApi();
    if (!api) return;
    const off = api.onStream(dispatchStream);
    void useAutoStore.getState().start();
    return off;
  }, []);

  useEffect(() => {
    useAutoStore.getState().setTabOpen(hasTab);
  }, [hasTab]);

  // Back in reach: what a closed app or a dropped connection left unsent goes out, or returns to its box.
  useEffect(() => {
    if (reachable) useThreadStore.getState().flush();
  }, [reachable]);

  useEffect(() => {
    if (!address || reachable) return;
    const timer = setInterval(() => void useAutoStore.getState().refresh(), hasTab ? RETRY_MS : RETRY_AWAY_MS);
    return () => clearInterval(timer);
  }, [hasTab, address, reachable]);
}
