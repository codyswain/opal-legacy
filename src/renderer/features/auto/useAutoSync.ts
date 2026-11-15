import { useEffect } from 'react';
import { isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { autoApi, useAutoStore } from './store/autoStore';
import { dispatchStream } from './store/streams';
import { useThreadStore } from './store/threadStore';

/** While the service is out of reach and a tab is open, the list is asked for again this often. */
const RETRY_MS = 5_000;
/** With no tab open, focusing the window reads the list again at most this often, for the sidebar's count. */
const FOCUS_REFRESH_MS = 60_000;

/**
 * Keeps what the page knows about Auto current. Mounted once, by
 * AppCommands. The list is read at launch when an address is set, so the
 * sidebar can count the threads that wait. Its stream is followed only
 * while an Auto tab is open; without one, the list is read again when the
 * window gets focus. A thread's stream is the tab's own business
 * (AutoView), followed only while the tab is in view.
 */
export function useAutoSync(): void {
  const hasTab = useTabsStore((state) => state.tabs.some((tab) => isAutoLocation(tabLocation(tab))));
  const address = useAutoStore((state) => state.address);
  const reachable = useAutoStore((state) => state.reachable);

  useEffect(() => {
    const api = autoApi();
    if (!api) return;
    const off = api.onStream(dispatchStream);
    void useAutoStore.getState().start();
    return off;
  }, []);

  useEffect(() => {
    useAutoStore.getState().setFollowing(hasTab);
  }, [hasTab]);

  // Back in reach: what a closed app or a dropped connection left unsent goes out, or returns to its box.
  useEffect(() => {
    if (reachable) useThreadStore.getState().flush();
  }, [reachable]);

  useEffect(() => {
    if (!hasTab || !address || reachable) return;
    const timer = setInterval(() => void useAutoStore.getState().refresh(), RETRY_MS);
    return () => clearInterval(timer);
  }, [hasTab, address, reachable]);

  useEffect(() => {
    if (hasTab || !address) return;
    const onFocus = () => {
      const { refreshedAt, refresh } = useAutoStore.getState();
      if (Date.now() - refreshedAt >= FOCUS_REFRESH_MS) void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [hasTab, address]);
}
