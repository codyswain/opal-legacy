import { create } from 'zustand';
import type { AutoStreamMessage, AutoUsage } from '@/types/auto';
import { autoApi, useAutoStore } from './autoStore';

/*
 * How much of the plan the service's agent has used, for the ring by the
 * message box. It follows the list as the digest does: read again whenever
 * the list is, and when the service says on the list stream that the numbers
 * changed. A read that fails leaves nothing behind: it never marks the
 * service out of reach, sets a problem or shows an error, and the ring simply
 * does not show. A service without the route answers 404 and is treated the
 * same way.
 */

export interface UsageStore {
  /** Null with no address, out of reach, an answer that does not fit, or a refusal. */
  usage: AutoUsage | null;
  /** Reads the numbers again. One read at a time; asked during one, it reads once more after it. */
  read: () => Promise<void>;
  /** A message of the list stream. */
  handle: (message: AutoStreamMessage) => void;
}

let reading: Promise<void> | null = null;
let again = false;

export const useUsageStore = create<UsageStore>((set, get) => {
  const once = async () => {
    const api = autoApi();
    const { address, reachable } = useAutoStore.getState();
    if (!api || !address || !reachable) {
      set({ usage: null });
      return;
    }
    const result = await api.request({ kind: 'usage' }).catch((): null => null);
    // An answer for an address that has since changed, or a service that has since gone, is not kept.
    const now = useAutoStore.getState();
    if (now.address !== address || !now.reachable) {
      set({ usage: null });
      return;
    }
    set({ usage: result?.success ? result.data : null });
  };

  return {
    usage: null,

    read: () => {
      if (reading) {
        again = true;
        return reading;
      }
      reading = (async () => {
        do {
          again = false;
          await once();
        } while (again);
      })().finally(() => {
        reading = null;
      });
      return reading;
    },

    handle: (message) => {
      if (message.token !== useAutoStore.getState().listToken) return;
      if (message.type === 'event' && message.stream === 'list' && message.event.kind === 'usage') void get().read();
    },
  };
});

// Follows the list: read whenever the list has just been read and the service
// answered, and when the service comes back in reach; forgotten with the
// address and while the service is out of reach.
useAutoStore.subscribe((state, before) => {
  if (state.address !== before.address || !state.address || !state.reachable) {
    if (useUsageStore.getState().usage !== null) useUsageStore.setState({ usage: null });
  }
  const read = state.refreshedAt !== before.refreshedAt || (state.reachable && !before.reachable);
  if (read && state.address && state.reachable) void useUsageStore.getState().read();
});
