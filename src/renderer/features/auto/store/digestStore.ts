import { create } from 'zustand';
import type { AutoDigest, AutoDigestEntry, AutoStreamMessage } from '@/types/auto';
import { afterLeaving, allEntries, entryName, queueOrder, queueSections, stepDay, withState, wordsKey, type QueueFilter } from '../model/digestModel';
import { cidFor, type Failed } from '../model/outbox';
import { unconfirmed } from '../model/unconfirmed';
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

type EntryState = AutoDigestEntry['state'];

/**
 * What he has just done to an entry (resolved it, made it a thread, taken
 * either back) and the service has yet to confirm, by day and id. It is
 * laid over every copy of the day that arrives meanwhile.
 */
const unconfirmedEntries = unconfirmed<AutoDigestEntry>();
const entryKey = (date: string, id: string): string => `${date}/${id}`;
/** A day as the service gave it, with what he has done since laid over it and what is left counted again. */
const laid = (digest: AutoDigest): AutoDigest => {
  const ids = allEntries(digest).filter((entry) => unconfirmedEntries.has(entryKey(digest.date, entry.id))).map((entry) => entry.id);
  return ids.length === 0 ? digest : withState(digest, ids, (entry) => unconfirmedEntries.lay(entryKey(digest.date, entry.id), entry).state);
};
/** Where an entry is when it is not resolved. */
const unresolved = (entry: AutoDigestEntry): EntryState => (entry.thread ? 'thread' : 'open');

export const useDigestStore = create<DigestStore>((set, get) => {
  /** The service's answer for a day replaces the copy of that day, with what he has done since kept. */
  const took = (answer: AutoDigest) => {
    const digest = laid(answer);
    const { latest, past } = get();
    if (past && past.date === digest.date) set({ past: digest });
    else if (!latest || latest.date === digest.date) set({ latest: digest, status: 'loaded' });
  };
  /** The copy of a day that is held now. */
  const held = (date: string): AutoDigest | null => (get().past?.date === date ? get().past : get().latest?.date === date ? get().latest : null);
  /** Keeps a state for some entries until their posts have landed, and shows it at once. Answers how to end it. */
  const keep = (date: string, ids: readonly string[], state: (entry: AutoDigestEntry) => EntryState): (() => void) => {
    const tokens = ids.map((id) => unconfirmedEntries.keep(entryKey(date, id), (entry) => ({ ...entry, state: state(entry) })));
    const now = held(date);
    if (now) took(now);
    return () => ids.forEach((id, at) => unconfirmedEntries.end(entryKey(date, id), tokens[at]));
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
        set({ latest: laid(latest.data), status: 'loaded', ...(past && past.date === latest.data.date ? { past: null } : {}) });
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
      if (result?.success) set({ past: laid(result.data), filter: 'all', opened: null });
      else said().refuse(result?.error.message ?? UNREACHABLE);
    },

    setFilter: (filter) => set({ filter, opened: null }),

    open: (id) => set({ opened: id }),

    openNote: (id) => set({ opened: id, noteWanted: id }),

    requestFocus: (entry) => set({ focusEntry: entry }),

    resolve: async (ids, resolved, section) => {
      const day = selectDay(get());
      const api = autoApi();
      if (!day || !api || ids.length === 0) return;
      const date = day.date;
      const name = ids.length === 1 ? named(day, ids[0]) : section ?? '';
      const shown = () => selectDay(get())?.date === date;
      /** The day as it is held, with these entries changed: for a change the service will not be asked for again. */
      const put = (state: (entry: AutoDigestEntry) => EntryState) => {
        const now = held(date);
        if (now) took(withState(now, ids, state));
      };
      // The rows change at once, and stay changed whatever is read of the day until the post has landed.
      let end = keep(date, ids, (entry) => (resolved ? 'resolved' : unresolved(entry)));
      if (resolved) moveOn(day, ids);
      const post = api.request({ kind: 'digest-resolve', date, ids, resolved }).catch((): null => null);
      let undone = false;
      let offer = 0;
      if (resolved) {
        // On offer from the moment the rows leave.
        offer = said().offer({
          name,
          text: ids.length === 1 ? 'resolved' : `${ids.length} resolved`,
          subject: `${date}/${ids.join()}`,
          undo: () => {
            undone = true;
            end = keep(date, ids, unresolved);
            if (shown()) set({ focusEntry: ids[0] });
            // The resolve goes first, then its undoing.
            void post.then((result) => {
              if (!result?.success) {
                end();
                return;
              }
              return api.request({ kind: 'digest-resolve', date, ids, resolved: false }).catch((): null => null).then((back) => {
                end();
                if (back?.success) took(back.data);
                else {
                  put(() => 'resolved');
                  said().refuse(back?.error.message ?? UNREACHABLE, name);
                }
              });
            });
          },
        });
      }
      const result = await post;
      // Undone meanwhile: the undo ends what it kept, once its own post has landed.
      if (undone) return;
      end();
      if (result?.success) {
        took(result.data);
        return;
      }
      said().drop(offer);
      put((entry) => (resolved ? unresolved(entry) : 'resolved'));
      said().refuse(result?.error.message ?? UNREACHABLE, name);
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
      const api = autoApi();
      if (!day || !api) return;
      const date = day.date;
      const name = named(day, id);
      // The entry leaves "Left" at once, and stays away whatever is read of the day until the post has landed.
      let end = keep(date, [id], () => 'thread');
      moveOn(day, [id]);
      const post = api.request({ kind: 'digest-thread', date, id, words: null, cid: null }).catch((): null => null);
      let undone = false;
      const offer = said().offer({
        name,
        text: 'made a thread',
        subject: `${date}/${id}`,
        open: () => {
          void post.then((result) => {
            if (result?.success) useThreadStore.getState().open(result.data.thread.id);
          });
        },
        // A thread nobody has started, archived, leaves its entry open again.
        undo: () => {
          undone = true;
          end = keep(date, [id], () => 'open');
          if (selectDay(get())?.date === date) set({ focusEntry: id });
          void post.then((result) => {
            if (!result?.success) {
              end();
              return;
            }
            return api.request({ kind: 'archive', id: result.data.thread.id, archived: true }).catch((): null => null).then(async (back) => {
              end();
              if (back?.success) useAutoStore.getState().upsert(back.data.thread);
              else said().refuse(back?.error.message ?? UNREACHABLE, name);
              await reload(date);
            });
          });
        },
      });
      const result = await post;
      // Undone meanwhile: the undo ends what it kept, once its own post has landed.
      if (undone) return;
      end();
      if (!result?.success) {
        said().drop(offer);
        const now = held(date);
        if (now) took(withState(now, [id], () => 'open'));
        said().refuse(result?.error.message ?? UNREACHABLE, name);
        return;
      }
      useAutoStore.getState().upsert(result.data.thread);
      await reload(date);
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
    unconfirmedEntries.clear();
    useDigestStore.setState({ latest: null, status: 'unknown', days: [], past: null, filter: 'left', opened: null, words: {}, notSent: null, failed: null, focusEntry: null });
  }
  // Read while a tab is open: when the list is read, and when the tab opens on a list read before.
  const read = state.refreshedAt !== before.refreshedAt || (state.tabOpen && !before.tabOpen);
  if (read && state.reachable && state.tabOpen) void useDigestStore.getState().refresh();
});
