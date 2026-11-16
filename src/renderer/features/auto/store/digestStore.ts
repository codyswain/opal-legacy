import { create } from 'zustand';
import { byKey, giveBack } from '../components/focus';
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
  /** The days whose digest he archived, newest first. */
  archivedDays: string[];
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
  /** The entry whose box takes the caret once it is open: he asked to make a thread of it. */
  boxWanted: string | null;

  /** Reads the latest digest and the days again, and the day he stepped to. */
  refresh: () => Promise<void>;
  /** Steps to the earlier or the later day. An earlier day opens whole, since it is for looking back. */
  step: (older: boolean) => Promise<void>;
  /** Shows one day, as a row of the archive asks for it. The latest day shows as it always does. */
  show: (date: string) => Promise<void>;
  /**
   * Puts a day's digest away, or brings it back. Archived, it is off the
   * list until the next one and reads as before. Either way offers Undo.
   */
  archive: (date: string, archived: boolean) => Promise<void>;
  /** What became of an entry, read from the held day or from the service; null when it cannot be told. */
  entryState: (date: string, id: string) => Promise<AutoDigestEntry['state'] | null>;
  /** Takes a day the service answered a write with, when the write was made outside this store. */
  take: (digest: AutoDigest) => void;
  setFilter: (filter: QueueFilter) => void;
  open: (id: string | null) => void;
  /** Opens an entry with the caret in its note. */
  openNote: (id: string) => void;
  /**
   * Opens an entry with the caret in its box, for the words a thread of it
   * starts with. Nothing is made until he sends them, or asks for a thread
   * without words.
   */
  openBox: (id: string) => void;
  requestFocus: (entry: string | null) => void;
  /**
   * Resolves entries of the shown day, or reopens them. They leave "Left"
   * at once and come back with the service's sentence if it refuses.
   * Resolving offers Undo for a few seconds; `section` names several.
   */
  resolve: (ids: string[], resolved: boolean, section?: string) => Promise<void>;
  /** Saves his note on an entry; empty text removes it. */
  setNote: (id: string, text: string) => Promise<boolean>;
  /** Makes an entry a thread without words: it waits on top of the list, not started. He stays in the queue. */
  makeThread: (id: string) => Promise<void>;
  /**
   * Adds an open entry to the thread it matches, with his words if any, in
   * one post per click. It leaves "Left" at once, as a thread made of it
   * does, and says "Added to <title>" with a way on to the thread and no
   * Undo: there is no way back from it. A match that has gone is read again
   * and said once; a post that does not arrive leaves the entry open, his
   * words back in its box under "Not sent". Answers whether it was added.
   */
  continueThread: (id: string, words?: string) => Promise<boolean>;
  setWords: (id: string, text: string) => void;
  /** Starts a thread with the entry and his words, and opens it. His words stay in the box if the post fails. */
  say: (id: string, text: string) => Promise<boolean>;
  /** A message of the list stream. */
  handle: (message: AutoStreamMessage) => void;
}

/** The day the queue shows: the one he stepped to, else the latest. */
export const selectDay = (state: Pick<DigestStore, 'latest' | 'past'>): AutoDigest | null => state.past ?? state.latest;

const UNREACHABLE = "Can't reach Auto.";
/** What is said once when the thread an entry was shown to match no longer matches it. */
export const NO_MATCH = 'That thread no longer matches.';
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
/** A day he has just archived or brought back, until the service has confirmed it. */
const unconfirmedDays = unconfirmed<{ archived: boolean }>();
/** A day as the service gave it, with what he has done since laid over it and what is left counted again. */
const laid = (answer: AutoDigest): AutoDigest => {
  const archived = unconfirmedDays.lay(answer.date, { archived: answer.archived }).archived;
  const digest = archived === answer.archived ? answer : { ...answer, archived };
  const ids = allEntries(digest).filter((entry) => unconfirmedEntries.has(entryKey(digest.date, entry.id))).map((entry) => entry.id);
  return ids.length === 0 ? digest : withState(digest, ids, (entry) => unconfirmedEntries.lay(entryKey(digest.date, entry.id), entry).state);
};
/** The archived days as the service listed them, with the days he has just archived or brought back laid over. */
const laidDays = (days: readonly string[], archived: readonly string[]): string[] =>
  days.filter((day) => unconfirmedDays.lay(day, { archived: archived.includes(day) }).archived);
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

  /** Reads the days that have a digest, and which of them he archived. */
  const days = async () => {
    const result = await autoApi()?.request({ kind: 'digests' }).catch((): null => null);
    if (!result?.success) return;
    served = result.data.archived;
    set({ days: result.data.days, archivedDays: laidDays(result.data.days, served) });
  };

  /** An entry that left "Left" is no longer open in place, and the keyboard moves on to the next one. */
  const moveOn = (day: AutoDigest, ids: readonly string[]) => {
    const { opened, filter } = get();
    if (filter !== 'left') return;
    if (opened && ids.includes(opened)) set({ opened: null });
    // By a key, the keyboard moves on to the next entry; after the pointer it goes back to where it was.
    if (byKey()) set({ focusEntry: afterLeaving(queueOrder(queueSections(day, filter)), ids) ?? QUEUE_TOP });
    else giveBack();
  };
  const said = () => useSaidStore.getState();
  /** The entries being added to a thread now, by day and entry: a second click while one is out sends nothing. */
  const continuing = new Set<string>();
  /** The archived days as the service last listed them. */
  let served: string[] = [];
  const named = (day: AutoDigest, id: string): string => {
    const entry = allEntries(day).find((candidate) => candidate.id === id);
    return entry ? entryName(entry) : '';
  };

  return {
    latest: null,
    status: 'unknown',
    days: [],
    archivedDays: [],
    past: null,
    filter: 'left',
    opened: null,
    words: {},
    notSent: null,
    failed: null,
    focusEntry: null,
    noteWanted: null,
    boxWanted: null,

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
      if (days?.success) {
        served = days.data.archived;
        set({ days: days.data.days, archivedDays: laidDays(days.data.days, served) });
      }
      const past = get().past;
      if (past) await reload(past.date);
    },

    show: async (date) => {
      const api = autoApi();
      if (!api) return;
      if (date === get().latest?.date) {
        set({ past: null, opened: null });
        return;
      }
      if (get().past?.date === date) return;
      const result = await api.request({ kind: 'digest', date }).catch((): null => null);
      if (result?.success) set({ past: laid(result.data), filter: 'all', opened: null });
      else said().refuse(result?.error.message ?? UNREACHABLE);
    },

    archive: async (date, archived) => {
      const api = autoApi();
      if (!api) return;
      /** Shows the day as archived or not, in its own copy and in the list of archived days, whatever is read meanwhile. */
      const mark = (on: boolean): (() => void) => {
        const token = unconfirmedDays.keep(date, () => ({ archived: on }));
        const now = held(date);
        if (now) took(now);
        set({ archivedDays: laidDays(get().days, served) });
        return () => unconfirmedDays.end(date, token);
      };
      let end = mark(archived);
      const post = api.request({ kind: 'digest-archive', date, archived }).catch((): null => null);
      let undone = false;
      let offer = 0;
      /** The service's answer, or the day put back as it was when the post did not go. */
      const settle = (result: Awaited<typeof post>, was: boolean) => {
        end();
        if (result?.success) {
          served = result.data.archived ? [...new Set([...served, date])] : served.filter((day) => day !== date);
          took(result.data);
        } else {
          const now = held(date);
          if (now) took({ ...now, archived: was });
          said().refuse(result?.error.message ?? UNREACHABLE, 'Digest');
        }
        set({ archivedDays: laidDays(get().days, served) });
      };
      if (archived) {
        // On offer from the moment the Digest row leaves.
        offer = said().offer({
          name: 'Digest',
          text: 'Digest archived. It is off the list.',
          whole: true,
          subject: `${date}/digest`,
          undo: () => {
            undone = true;
            end = mark(false);
            // The archive goes first, then its undoing.
            void post.then((result) => {
              if (!result?.success) {
                end();
                set({ archivedDays: laidDays(get().days, served) });
                return;
              }
              served = [...new Set([...served, date])];
              return api.request({ kind: 'digest-archive', date, archived: false }).catch((): null => null).then((back) => settle(back, true));
            });
          },
        });
      } else {
        // Brought back, an older line about archiving it no longer holds. It can be put away again.
        said().dropSubject(`${date}/digest`);
        offer = said().offer({
          name: 'Digest',
          text: 'Back in the list.',
          whole: true,
          subject: `${date}/digest`,
          undo: () => {
            undone = true;
            end = mark(true);
            void post.then((result) => {
              if (!result?.success) {
                end();
                set({ archivedDays: laidDays(get().days, served) });
                return;
              }
              served = served.filter((day) => day !== date);
              return api.request({ kind: 'digest-archive', date, archived: true }).catch((): null => null).then((again) => settle(again, false));
            });
          },
        });
      }
      const result = await post;
      // Undone meanwhile: the undo ends what it kept, once its own post has landed.
      if (undone) return;
      if (!result?.success) said().drop(offer);
      settle(result, !archived);
    },

    entryState: async (date, id) => {
      const find = (day: AutoDigest | null) => allEntries(day ?? { date, path: '', left: 0, archived: false, sections: [] }).find((entry) => entry.id === id)?.state ?? null;
      const now = held(date);
      if (now) return find(now);
      const result = await autoApi()?.request({ kind: 'digest', date }).catch((): null => null);
      return result?.success ? find(result.data) : null;
    },

    take: (digest) => took(digest),

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

    openBox: (id) => set({ opened: id, boxWanted: id }),

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
            if (shown() && byKey()) set({ focusEntry: ids[0] });
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
          if (selectDay(get())?.date === date && byKey()) set({ focusEntry: id });
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

    continueThread: async (id, text = '') => {
      const day = selectDay(get());
      const api = autoApi();
      if (!day || !api) return false;
      const found = allEntries(day).find((entry) => entry.id === id);
      const match = found?.state === 'open' ? found.continues : null;
      const date = day.date;
      const key = wordsKey(date, id);
      if (!match || continuing.has(key)) return false;
      continuing.add(key);
      const words = text.trim();
      const name = named(day, id);
      // The same words sent again go under the same id, so a click that did arrive adds nothing the second time.
      const cid = cidFor(get().failed, key, words);
      // The entry leaves "Left" at once, as a thread made of it does, until the post has landed.
      const end = keep(date, [id], () => 'thread');
      moveOn(day, [id]);
      const result = useAutoStore.getState().reachable
        ? await api.request({ kind: 'digest-continue', date, id, thread: match.id, words: words || null, cid }).catch((): null => null)
        : null;
      continuing.delete(key);
      end();
      if (result?.success) {
        const left = { ...get().words };
        delete left[key];
        set({ words: left, ...(get().notSent === key ? { notSent: null, failed: null } : {}) });
        const thread = result.data.thread;
        useAutoStore.getState().upsert(thread);
        said().offer({
          name: thread.title || match.title,
          text: `Added to ${thread.title || match.title}`,
          whole: true,
          subject: `${date}/${id}`,
          open: () => useThreadStore.getState().open(thread.id),
        });
        await reload(date);
        return true;
      }
      const now = held(date);
      if (now) took(withState(now, [id], () => 'open'));
      if (result?.error.kind === 'refused' && result.error.code === 'no_match') {
        // The match has gone: the day is read again, and the line under the entry goes with it.
        await reload(date);
        said().refuse(NO_MATCH, name);
        return false;
      }
      if (result?.error.kind === 'refused') {
        said().refuse(result.error.message, name);
        return false;
      }
      // It did not arrive: the entry is open again with his words in its box, to send again.
      const back = { ...get().words };
      if (words) back[key] = words;
      set({ words: back, notSent: key, failed: { thread: key, text: words, cid }, opened: id });
      return false;
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
      // The sidebar's Digest row says how many entries are left, so the digest is followed with or without a tab.
      if (message.token !== useAutoStore.getState().listToken) return;
      if (message.type !== 'event' || message.stream !== 'list' || message.event.kind !== 'digest') return;
      const { date } = message.event;
      const { latest, past } = get();
      if (past?.date === date) void reload(date);
      // The latest day changed, or a newer day has arrived: read it again. For any other day only the days and
      // which of them are archived can have changed for the list.
      if (!latest || date >= latest.date) void get().refresh();
      else void days();
    },
  };
});

// The digest follows the list: read again whenever the list is (launch,
// the tab opening, a reset, a reconnect), and forgotten with the address it came from.
useAutoStore.subscribe((state, before) => {
  if (state.address !== before.address) {
    unconfirmedEntries.clear();
    unconfirmedDays.clear();
    useDigestStore.setState({ latest: null, status: 'unknown', days: [], archivedDays: [], past: null, filter: 'left', opened: null, words: {}, notSent: null, failed: null, focusEntry: null, noteWanted: null, boxWanted: null });
  }
  // Read whenever the list is, tab or no tab: the sidebar's Digest row counts what is left. And when the tab opens.
  const read = state.refreshedAt !== before.refreshedAt || (state.tabOpen && !before.tabOpen);
  if (read && state.reachable) void useDigestStore.getState().refresh();
});
