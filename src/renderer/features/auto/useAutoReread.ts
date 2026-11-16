import { useEffect } from 'react';
import { useAutoStore } from './store/autoStore';

/** Back in front, the list and the digest are read again when the last read is at least this old. */
export const REREAD_STALE_MS = 5 * 60_000;
/** How often the clock is checked; also the least time between two re-reads asked for here. */
export const REREAD_CHECK_MS = 60_000;
/** A clock check that comes later than this after the one before means the Mac slept or the app was suspended. */
export const REREAD_JUMP_MS = 3 * 60_000;

/** The local calendar day of a time, as a string to compare. */
const dayOf = (at: number): string => new Date(at).toDateString();

/**
 * Reads the list again, and with it the digest, when the app may have
 * missed a change no event announced: the window comes back to the front
 * after a while, the day turns, or the Mac wakes from sleep. Nothing is
 * read without an address, nor while the service is out of reach, which
 * the retry timer in useAutoSync looks after.
 */
export function useAutoReread(): void {
  const address = useAutoStore((state) => state.address);

  useEffect(() => {
    if (!address) return;
    let lastCheck = Date.now();
    let lastAsked = 0;

    const reread = () => {
      const now = Date.now();
      const store = useAutoStore.getState();
      if (!store.address || !store.reachable || now - lastAsked < REREAD_CHECK_MS) return;
      lastAsked = now;
      void store.refresh();
    };
    /** The day has turned since the last read. */
    const newDay = (now: number) => {
      const { refreshedAt } = useAutoStore.getState();
      return refreshedAt > 0 && dayOf(refreshedAt) !== dayOf(now);
    };

    const front = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - useAutoStore.getState().refreshedAt >= REREAD_STALE_MS || newDay(now)) reread();
    };
    const check = () => {
      const now = Date.now();
      const jumped = now - lastCheck > REREAD_JUMP_MS;
      lastCheck = now;
      if (jumped || newDay(now)) reread();
    };

    const timer = setInterval(check, REREAD_CHECK_MS);
    document.addEventListener('visibilitychange', front);
    window.addEventListener('focus', front);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', front);
      window.removeEventListener('focus', front);
    };
  }, [address]);
}
