import { create } from 'zustand';
import type { AutoDigest, AutoStreamMessage } from '@/types/auto';
import { afterLeaving, allEntries, entryName, queueOrder, queueSections, stepDay, withState, wordsKey, type QueueFilter } from '../model/digestModel';
import { cidFor, type Failed } from '../model/outbox';
import { autoApi, useAutoStore } from './autoStore';
import { useSaidStore } from './saidStore';
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
  /** The entry that takes the keyboard focus once the queue has drawn it; `:top` is the queue's first control. */
  focusEntry: string | null;
  /** The entry whose note takes the caret once it is open. */
  noteWanted: string | null;

  /** Reads the latest digest and the days again, and the day he stepped to. */
  refresh: () => Promise<void>;
  /** Steps to the earlier or the later day. An earlier day opens whole, since it is for looking back. */
  step: (older: boolean) => Promise<void>;
  setFilter: (filter: QueueFilter) => void;
  open: (id: string | null) => void;
  /** Opens an entry with the caret in its note. */
  openNote: (id: string) => void;
  requestFocus: (entry: string | null) => void;
  /**
   * Resolves entries of the shown day, or reopens them. They leave "Left"
   * at once and come back with the service's sentence if it refuses.
   * Resolving offers Undo for a few seconds; `section` names several.
   */
  resolve: (ids: string[], resolved: boolean, section?: string) => Promise<void>;
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
/** The queue's first control, for when no entry is left to hold the focus. */
export const QUEUE_TOP = ':top';
/** The entry that is the queue's Tab stop: where the keyboard goes when the queue opens. */
export const QUEUE_FIRST = ':first';

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

  /** An entry that left "Left" is no longer open in place, and the keyboard moves on to the next one. */
  const moveOn = (day: AutoDigest, ids: readonly string[]) => {
    const { opened, filter } = get();
    if (filter !== 'left') return;
    if (opened && ids.includes(opened)) set({ opened: null });
    set({ focusEntry: afterLeaving(queueOrder(queueSections(day, filter)), ids) ?? QUEUE_TOP });
  };
  const said = () => useSaidStore.getState();
  const named = (day: AutoDigest, id: string): string => {
    const entry = allEntries(day).find((candidate) => candidate.id === id);
    return entry ? entryName(entry) : '';
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
    focusEntry: null,
    noteWanted: null,

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
      else said().refuse(result?.error.message ?? UNREACHABLE);
    },

    setFilter: (filter) => set({ filter, opened: null }),

    open: (id) => set({ opened: id }),

    openNote: (id) => set({ opened: id, noteWanted: id }),

    requestFocus: (entry) => set({ focusEntry: entry }),

    resolve: async (ids, resolved, section) => {
      const day = selectDay(get());
      if (!day || ids.length === 0) return;
      const date = day.date;
      const name = ids.length === 1 ? named(day, ids[0]) : section ?? '';
      // The rows change at once; the service's answer then takes the place of this guess.
      took(withState(day, ids, (entry) => (resolved ? 'resolved' : entry.thread ? 'thread' : 'open')));
      if (resolved) moveOn(day, ids);
      const result = await autoApi()?.request({ kind: 'digest-resolve', date, ids, resolved }).catch((): null => null);
      if (!result?.success) {
        took(day);
        said().refuse(result?.error.message ?? UNREACHABLE, name);
        return;
      }
      took(result.data);
      if (!resolved) return;
      said().say({
        text: ids.length === 1 ? 'Resolved' : `Resolved ${ids.length} in`,
        name,
        undo: () => {
          void autoApi()?.request({ kind: 'digest-resolve', date, ids, resolved: false }).catch((): null => null).then((undone) => {
            if (undone?.success) {
              took(undone.data);
              if (selectDay(get())?.date === date) set({ focusEntry: ids[0] });
            } else said().refuse(undone?.error.message ?? UNREACHABLE, name);
          });
        },
      });
    },

    setNote: async (id, text) => {
      const day = selectDay(get());
      if (!day) return false;
      const result = await autoApi()?.request({ kind: 'digest-note', date: day.date, id, text: text.trim() }).catch((): null => null);
      if (!result?.success) {
        said().refuse(result?.error.message ?? UNREACHABLE, named(day, id));
        return false;
      }
      took(result.data);
      return true;
    },

    makeThread: async (id) => {
      const day = selectDay(get());
      if (!day) return;
      const date = day.date;
      const name = named(day, id);
      // The entry leaves "Left" at once.
      took(withState(day, [id], () => 'thread'));
      moveOn(day, [id]);
      const api = autoApi();
      const result = await api?.request({ kind: 'digest-thread', date, id, words: null, cid: null }).catch((): null => null);
      if (!result?.success) {
        took(day);
        said().refuse(result?.error.message ?? UNREACHABLE, name);
        return;
      }
      const thread = result.data.thread;
      useAutoStore.getState().upsert(thread);
      await reload(date);
      said().say({
        text: 'Made a thread',
        name,
        open: () => useThreadStore.getState().open(thread.id),
        // A thread nobody has started, archived, leaves its entry open again.
        undo: () => {
          void api?.request({ kind: 'archive', id: thread.id, archived: true }).catch((): null => null).then(async (undone) => {
            if (!undone?.success) {
              said().refuse(undone?.error.message ?? UNREACHABLE, name);
              return;
            }
            useAutoStore.getState().upsert(undone.data.thread);
            await reload(date);
            if (selectDay(get())?.date === date) set({ focusEntry: id });
          });
        },
      });
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
      // With no tab open nobody looks at the digest: it is read when one opens.
      if (message.token !== useAutoStore.getState().listToken || !useAutoStore.getState().tabOpen) return;
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
    useDigestStore.setState({ latest: null, status: 'unknown', days: [], past: null, filter: 'left', opened: null, words: {}, notSent: null, failed: null, focusEntry: null });
  }
  // Read while a tab is open: when the list is read, and when the tab opens on a list read before.
  const read = state.refreshedAt !== before.refreshedAt || (state.tabOpen && !before.tabOpen);
  if (read && state.reachable && state.tabOpen) void useDigestStore.getState().refresh();
});
