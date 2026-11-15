import { create } from 'zustand';
import { toast } from 'sonner';
import type { AutoDigest, AutoStreamMessage } from '@/types/auto';
import { stepDay, wordsKey, type QueueFilter } from '../model/digestModel';
import { cidFor, type Failed } from '../model/outbox';
import { autoApi, useAutoStore } from './autoStore';
import { useThreadStore } from './threadStore';

/*
 * The digest as a queue. The latest day is kept for the list's count; a day
 * he steps back to is kept beside it. Every write answers with the day as it
 * is now, which replaces the copy here, and the service says on the list
 * stream when a day changed somewhere else.
 */

export interface DigestStore {
  /** The latest digest: the list's "N left" counts from it. */
  latest: AutoDigest | null;
  /** `none` when the service has no digest at all. */
  status: 'unknown' | 'loaded' | 'none' | 'failed';
  /** The days that have a digest, newest first. */
  days: string[];
  /** A day he stepped to that is not the latest. */
  past: AutoDigest | null;
  filter: QueueFilter;
  /** The entry open in place, by id. */
  opened: string | null;
  /** Typed and not sent, by day and entry. */
  words: Record<string, string>;
  /** The entry whose words did not go, by the same key. */
  notSent: string | null;
  failed: Failed | null;

  /** Reads the latest digest and the days again, and the day he stepped to. */
  refresh: () => Promise<void>;
  /** Steps to the earlier or the later day. An earlier day opens whole, since it is for looking back. */
  step: (older: boolean) => Promise<void>;
  setFilter: (filter: QueueFilter) => void;
  open: (id: string | null) => void;
  /** Resolves entries of the shown day, or reopens them. Resolving offers Undo for a few seconds. */
  resolve: (ids: string[], resolved: boolean) => Promise<void>;
  /** Saves his note on an entry; empty text removes it. */
  setNote: (id: string, text: string) => Promise<boolean>;
  /** Makes an entry a thread that waits on top of the list. He stays in the queue. */
  makeThread: (id: string) => Promise<void>;
  setWords: (id: string, text: string) => void;
  /** Starts a thread with the entry and his words, and opens it. His words stay in the box if the post fails. */
  say: (id: string, text: string) => Promise<boolean>;
  /** A message of the list stream. */
  handle: (message: AutoStreamMessage) => void;
}

/** The day the queue shows: the one he stepped to, else the latest. */
export const selectDay = (state: Pick<DigestStore, 'latest' | 'past'>): AutoDigest | null => state.past ?? state.latest;

const UNREACHABLE = "Can't reach Auto.";

export const useDigestStore = create<DigestStore>((set, get) => {
  /** The service's answer for a day replaces the copy of that day. */
  const took = (digest: AutoDigest) => {
    const { latest, past } = get();
    if (past && past.date === digest.date) set({ past: digest });
    else if (!latest || latest.date === digest.date) set({ latest: digest, status: 'loaded' });
  };

  const reload = async (date: string) => {
    const result = await autoApi()?.request({ kind: 'digest', date }).catch((): null => null);
    if (result?.success) took(result.data);
  };

  /** An entry that left "Left" is no longer open in place. */
  const closeIfGone = (ids: readonly string[]) => {
    const { opened, filter } = get();
    if (opened && filter === 'left' && ids.includes(opened)) set({ opened: null });
  };

  return {
    latest: null,
    status: 'unknown',
    days: [],
    past: null,
    filter: 'left',
    opened: null,
    words: {},
    notSent: null,
    failed: null,

    refresh: async () => {
      const api = autoApi();
      if (!api) return;
      const [latest, days] = await Promise.all([
        api.request({ kind: 'digest', date: null }).catch((): null => null),
        api.request({ kind: 'digests' }).catch((): null => null),
      ]);
      if (latest?.success) {
        const past = get().past;
        // The day he stepped to has become the latest's own day.
        set({ latest: latest.data, status: 'loaded', ...(past && past.date === latest.data.date ? { past: null } : {}) });
      } else if (latest?.error.kind === 'refused' && latest.error.status === 404) {
        set({ latest: null, status: 'none' });
      } else if (!get().latest) {
        set({ status: 'failed' });
      }
      if (days?.success) set({ days: days.data.days });
      const past = get().past;
      if (past) await reload(past.date);
    },

    step: async (older) => {
      const day = selectDay(get());
      const api = autoApi();
      if (!day || !api) return;
      const target = stepDay(day.date, get().days, older);
      if (!target) return;
      if (target === get().latest?.date) {
        set({ past: null, filter: 'left', opened: null });
        return;
      }
      const result = await api.request({ kind: 'digest', date: target }).catch((): null => null);
      if (result?.success) set({ past: result.data, filter: 'all', opened: null });
      else toast.error(result?.error.message ?? UNREACHABLE);
    },

    setFilter: (filter) => set({ filter, opened: null }),

    open: (id) => set({ opened: id }),

    resolve: async (ids, resolved) => {
      const day = selectDay(get());
      if (!day || ids.length === 0) return;
      const date = day.date;
      const result = await autoApi()?.request({ kind: 'digest-resolve', date, ids, resolved }).catch((): null => null);
      if (!result?.success) {
        toast.error(result?.error.message ?? UNREACHABLE);
        return;
      }
      took(result.data);
      if (!resolved) return;
      closeIfGone(ids);
      toast(ids.length === 1 ? 'Resolved' : `${ids.length} resolved`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void autoApi()?.request({ kind: 'digest-resolve', date, ids, resolved: false }).then((undone) => {
              if (undone.success) took(undone.data);
              else toast.error(undone.error.message);
            });
          },
        },
      });
    },

    setNote: async (id, text) => {
      const day = selectDay(get());
      if (!day) return false;
      const result = await autoApi()?.request({ kind: 'digest-note', date: day.date, id, text: text.trim() }).catch((): null => null);
      if (!result?.success) {
        toast.error(result?.error.message ?? UNREACHABLE);
        return false;
      }
      took(result.data);
      return true;
    },

    makeThread: async (id) => {
      const day = selectDay(get());
      if (!day) return;
      const result = await autoApi()?.request({ kind: 'digest-thread', date: day.date, id, words: null, cid: null }).catch((): null => null);
      if (!result?.success) {
        toast.error(result?.error.message ?? UNREACHABLE);
        return;
      }
      useAutoStore.getState().upsert(result.data.thread);
      closeIfGone([id]);
      await reload(day.date);
    },

    setWords: (id, text) => {
      const day = selectDay(get());
      if (!day) return;
      const key = wordsKey(day.date, id);
      const words = { ...get().words };
      if (text) words[key] = text;
      else delete words[key];
      set({ words, ...(get().notSent === key ? { notSent: null } : {}) });
    },

    say: async (id, text) => {
      const day = selectDay(get());
      const said = text.trim();
      if (!day || !said) return false;
      const key = wordsKey(day.date, id);
      // The same words sent again go under the same id, so a copy that did arrive is not made twice.
      const cid = cidFor(get().failed, key, said);
      const result = useAutoStore.getState().reachable
        ? await autoApi()?.request({ kind: 'digest-thread', date: day.date, id, words: said, cid }).catch((): null => null)
        : null;
      if (!result?.success) {
        set({ notSent: key, failed: { thread: key, text: said, cid } });
        return false;
      }
      const words = { ...get().words };
      delete words[key];
      set({ words, notSent: null, failed: null, opened: null });
      useAutoStore.getState().upsert(result.data.thread);
      useThreadStore.getState().open(result.data.thread.id);
      void reload(day.date);
      return true;
    },

    handle: (message) => {
      if (message.token !== useAutoStore.getState().listToken) return;
      if (message.type !== 'event' || message.stream !== 'list' || message.event.kind !== 'digest') return;
      const { date } = message.event;
      const { latest, past } = get();
      if (past?.date === date) void reload(date);
      // The latest day changed, or a newer day has arrived.
      if (!latest || date >= latest.date) void get().refresh();
    },
  };
});

// The digest follows the list: read again whenever the list is (the tab
// opening, a reset, a reconnect), and forgotten with the address it came from.
useAutoStore.subscribe((state, before) => {
  if (state.address !== before.address) {
    useDigestStore.setState({ latest: null, status: 'unknown', days: [], past: null, filter: 'left', opened: null, words: {}, notSent: null, failed: null });
  }
  if (state.refreshedAt !== before.refreshedAt && state.reachable && state.following) void useDigestStore.getState().refresh();
});
