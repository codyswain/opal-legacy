import { create } from 'zustand';
import type { AutoAPI, AutoStatus, AutoStreamMessage, AutoThread } from '@/types/auto';
import { applyOrder, moved, upsertThread } from '../model/listModel';
import { LIST_PLACE, forgetPlace } from '../model/places';
import { unconfirmed } from '../model/unconfirmed';
import { useSaidStore } from './saidStore';

/*
 * What the page knows about Auto as a whole: its address, whether it
 * answers, its status and the list of threads. The main process makes every
 * request; this asks it and keeps the answers.
 */

export interface AutoStore {
  /** Whether the address has been read from the main process yet. */
  configured: boolean;
  /** The service's address, or null when none is set. */
  address: string | null;
  /** The address form shows although an address is set. */
  editing: boolean;
  loading: boolean;
  /** The list has been read at least once. */
  loaded: boolean;
  /** Whether the service's last word was an answer. */
  reachable: boolean;
  /** Why the list could not be read. */
  problem: string | null;
  status: AutoStatus | null;
  /** Every thread not archived, in the service's order. */
  threads: AutoThread[];
  /** An Auto tab is open: the digest is read too, and a service out of reach is asked again sooner. */
  tabOpen: boolean;
  listToken: number | null;
  /** When the list was last read, in ms. */
  refreshedAt: number;
  snoozedOpen: boolean;
  /** The line over the threads put away until someone replies is open. */
  waitingOpen: boolean;
  /** The threads he archived. They are read when their line is first opened, a first few and then all. */
  archive: Archive;
  /**
   * The row that takes the keyboard focus once the list has drawn it: a
   * thread's id, or a pane's name for New thread and Digest.
   */
  focusRow: string | null;
  /**
   * The thread whose snooze is being given a day and a time of his own, or,
   * with `reply`, put away until someone replies; and where the action came from.
   */
  picking: { thread: AutoThread; from: 'row' | 'pane'; reply?: boolean } | null;
  /** Answers picked on a row and held a few seconds before they are posted, by thread. The row shows the pick. */
  held: Record<string, string>;

  /** Reads the address, and the list when there is one. */
  start: () => Promise<void>;
  /** Saves a typed address. Answers the sentence to show when it is refused. */
  saveAddress: (typed: string) => Promise<string | null>;
  editAddress: (editing: boolean) => void;
  /** Reads the status and the list again, and follows the list's stream from there. */
  refresh: () => Promise<boolean>;
  setTabOpen: (open: boolean) => void;
  requestFocus: (row: string | null) => void;
  pickSnooze: (picking: AutoStore['picking']) => void;
  /** A message of the list stream. */
  handle: (message: AutoStreamMessage) => void;
  upsert: (thread: AutoThread) => void;
  toggleSnoozed: () => void;
  toggleWaiting: () => void;
  /** Opens or closes the Archived line. Opening it reads the archive. */
  toggleArchive: () => void;
  /** Reads the archive: its newest few, or all of it. */
  loadArchive: (all?: boolean) => Promise<void>;
  /** A thread was archived or brought back here: the archive, once read, follows without asking again. */
  archiveChanged: (thread: AutoThread) => void;
  checkStatus: () => Promise<void>;

  move: (id: string, before: string | null) => Promise<void>;
  /** Marks a thread for the Mac, or takes the mark off. The service ends the mark by itself. */
  desk: (thread: AutoThread, on: boolean) => Promise<void>;
}

export interface Archive {
  open: boolean;
  /** Read at least once. Until then nothing is known of it, not even how many there are. */
  loaded: boolean;
  loading: boolean;
  /** Every archived thread was asked for, not only the newest few. */
  all: boolean;
  /** Newest archived first. */
  threads: AutoThread[];
  /** How many there are at the service, which may be more than are held here. */
  total: number;
  /** Why it could not be read. */
  problem: string | null;
}

/** How many archived threads are read before he asks for all of them. */
export const ARCHIVE_FIRST = 10;

const NO_ARCHIVE: Archive = { open: false, loaded: false, loading: false, all: false, threads: [], total: 0, problem: null };

export const autoApi = (): AutoAPI | undefined => (typeof window !== 'undefined' ? window.autoAPI : undefined);

const UNREACHABLE = "Can't reach Auto.";

let refreshing: Promise<boolean> | null = null;

/**
 * What he has just done to a thread (archived it, snoozed it, taken either
 * back) and the service has yet to confirm. It is laid over every copy of
 * the thread that arrives meanwhile.
 */
export const unconfirmedThreads = unconfirmed<AutoThread>();
const laid = (thread: AutoThread): AutoThread => unconfirmedThreads.lay(thread.id, thread);

/**
 * Where a thread sits in his order while an undo is putting it back there:
 * above the thread named, or at the end for null. The service puts a thread
 * that returns from snooze on top and says so in its order; until the move
 * that undoes that has landed, the row stays where he had it.
 */
export const heldPlaces = new Map<string, string | null>();
const placed = (threads: AutoThread[]): AutoThread[] => {
  let next = threads;
  for (const [id, before] of heldPlaces) {
    if (next.some((thread) => thread.id === id) && (before === null || next.some((thread) => thread.id === before))) next = moved(next, id, before);
  }
  return next;
};

/** The row last asked to take the focus, and when. */
let wanted: { row: string; at: number } | null = null;

/**
 * The row an action asked to focus within the last second, or null. A menu
 * or a dialog that closes after the action hands the keyboard to it, where
 * its own way of returning focus would point at a row that has left.
 */
export const wantedRow = (): string | null => (wanted && Date.now() - wanted.at < 1_000 ? wanted.row : null);

export const useAutoStore = create<AutoStore>((set, get) => {
  /** A write whose failure is said in one line, at the foot of the list. */
  const said = (message: string) => useSaidStore.getState().refuse(message);

  // The list's stream is followed whenever an address is set, with a tab
  // open or not: it holds back no ping, and it keeps the sidebar's count true.
  const follow = async (cursor: string | null) => {
    const api = autoApi();
    const address = get().address;
    if (!api || !address) return;
    const result = await api.follow({ stream: 'list', cursor }).catch((): null => null);
    if (result?.success && get().address === address) set({ listToken: result.data.token });
  };

  const read = async (): Promise<boolean> => {
    const api = autoApi();
    if (!api || !get().address) return false;
    set({ loading: true });
    const [status, list] = await Promise.all([
      api.request({ kind: 'status' }).catch((): null => null),
      api.request({ kind: 'threads' }).catch((): null => null),
    ]);
    if (!list?.success) {
      set({ loading: false, reachable: false, problem: list?.error.message ?? UNREACHABLE, refreshedAt: Date.now() });
      return false;
    }
    set({
      loading: false,
      loaded: true,
      reachable: true,
      problem: null,
      // A thread he brought back a moment ago, which the service still has as archived, is not in its list yet.
      threads: [
        ...get().threads.filter((thread) => unconfirmedThreads.has(thread.id) && !laid(thread).archived && !list.data.threads.some((listed) => listed.id === thread.id)),
        ...list.data.threads.map(laid).filter((thread) => !thread.archived),
      ],
      status: status?.success ? status.data : get().status,
      refreshedAt: Date.now(),
    });
    await follow(list.data.cursor);
    return true;
  };

  return {
    configured: false,
    address: null,
    editing: false,
    loading: false,
    loaded: false,
    reachable: false,
    problem: null,
    status: null,
    threads: [],
    tabOpen: false,
    listToken: null,
    refreshedAt: 0,
    snoozedOpen: false,
    waitingOpen: false,
    archive: NO_ARCHIVE,
    focusRow: null,
    picking: null,
    held: {},

    start: async () => {
      const api = autoApi();
      if (!api) return;
      const config = await api.config().catch((): null => null);
      set({ configured: true, address: config?.success ? config.data.url : null });
      if (get().address) await get().refresh();
    },

    saveAddress: async (typed) => {
      const api = autoApi();
      if (!api) return 'Opal could not save the address.';
      const result = await api.setAddress(typed).catch((): null => null);
      if (!result?.success) return result?.error.message ?? 'Opal could not save the address.';
      // Another address is another service: nothing of the old one stays.
      unconfirmedThreads.clear();
      heldPlaces.clear();
      set({ archive: NO_ARCHIVE });
      set({ address: result.data.url, editing: false, loaded: false, reachable: false, problem: null, threads: [], status: null, listToken: null });
      if (!result.data.url) void api.unfollow('list').catch(() => undefined);
      if (result.data.url) await get().refresh();
      return null;
    },

    editAddress: (editing) => set({ editing }),

    refresh: () => {
      refreshing ??= read().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    setTabOpen: (open) => {
      if (get().tabOpen === open) return;
      set({ tabOpen: open });
      // A tab opened fresh starts its list at the top; one only switched away from keeps its place.
      if (!open) forgetPlace(LIST_PLACE);
      // A tab opened on a service that did not answer asks again at once.
      if (open && get().address && !get().reachable) void get().refresh();
    },

    requestFocus: (row) => {
      if (row) wanted = { row, at: Date.now() };
      set({ focusRow: row });
    },

    pickSnooze: (picking) => set({ picking }),

    handle: (message) => {
      if (message.token !== get().listToken) return;
      if (message.type === 'open') {
        set({ reachable: true, problem: null });
      } else if (message.type === 'down') {
        set({ reachable: false, problem: UNREACHABLE });
      } else if (message.type === 'event' && message.stream === 'list') {
        const event = message.event;
        if (event.kind === 'thread') {
          set({ threads: upsertThread(get().threads, laid(event.thread)) });
          get().archiveChanged(laid(event.thread));
        }
        else if (event.kind === 'order') set({ threads: placed(applyOrder(get().threads, event.ids)) });
        else if (event.kind === 'status') set({ status: event.status });
        // The service can no longer say what was missed: read everything again.
        else if (event.kind === 'reset') void get().refresh();
      }
    },

    upsert: (thread) => {
      set({ threads: upsertThread(get().threads, laid(thread)) });
      get().archiveChanged(laid(thread));
    },

    toggleSnoozed: () => set({ snoozedOpen: !get().snoozedOpen }),

    toggleWaiting: () => set({ waitingOpen: !get().waitingOpen }),

    toggleArchive: () => {
      const archive = get().archive;
      set({ archive: { ...archive, open: !archive.open } });
      // Read on every opening: threads archived on another device are not on the list's stream.
      if (!archive.open) void get().loadArchive(archive.all);
    },

    loadArchive: async (all = false) => {
      const api = autoApi();
      const address = get().address;
      if (!api || !address || get().archive.loading) return;
      set({ archive: { ...get().archive, loading: true, problem: null } });
      const result = await api.request({ kind: 'archived', limit: all ? null : ARCHIVE_FIRST }).catch((): null => null);
      if (get().address !== address) return;
      if (!result?.success) {
        set({ archive: { ...get().archive, loading: false, problem: result?.error.message ?? UNREACHABLE } });
        return;
      }
      // What he did a moment ago and the service has yet to confirm still holds.
      const threads = result.data.threads.map(laid).filter((thread) => thread.archived);
      set({ archive: { ...get().archive, loading: false, loaded: true, all, threads, total: Math.max(result.data.total, threads.length), problem: null } });
    },

    archiveChanged: (thread) => {
      const archive = get().archive;
      if (!archive.loaded) return;
      const held = archive.threads.some((candidate) => candidate.id === thread.id);
      // A digest entry nobody started is put away by the service and is not part of the archive.
      if (thread.archived && !thread.waits) {
        const rest = archive.threads.filter((candidate) => candidate.id !== thread.id);
        // Newest archived first: one archived just now goes on top.
        const threads = [...rest, thread].sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
        set({ archive: { ...archive, threads, total: archive.total + (held ? 0 : 1) } });
      } else if (held) {
        set({ archive: { ...archive, threads: archive.threads.filter((candidate) => candidate.id !== thread.id), total: Math.max(0, archive.total - 1) } });
      }
    },

    checkStatus: async () => {
      const result = await autoApi()?.request({ kind: 'check-status' }).catch((): null => null);
      if (result?.success) set({ status: result.data });
      else if (result) said(result.error.message);
    },

    move: async (id, before) => {
      const earlier = get().threads;
      set({ threads: moved(earlier, id, before) });
      const result = await autoApi()?.request({ kind: 'move', id, before }).catch((): null => null);
      if (result?.success) {
        set({ threads: applyOrder(get().threads, result.data.ids) });
      } else {
        set({ threads: earlier });
        if (result) said(result.error.message);
      }
    },

    desk: async (thread, on) => {
      const result = await autoApi()?.request({ kind: 'desk', id: thread.id, on }).catch((): null => null);
      // The mark changes only by the service's answer, or by its event on the list stream.
      if (result?.success) get().upsert(result.data.thread);
      else if (result) said(result.error.message);
    },
  };
});

/** The model keys and labels the service offers, with its default when it has said nothing yet. */
export function modelChoices(status: AutoStatus | null): Array<[string, string]> {
  const models = Object.entries(status?.models ?? {});
  return models.length > 0 ? models : [['', 'Default']];
}

/** What a sign-in problem says, or null while the service is signed in. */
export function signInProblem(status: AutoStatus | null): string | null {
  if (!status) return null;
  if (status.auth.token === 'loose') return "Auto's sign-in file can be read by other users, so Auto ignores it.";
  if (status.auth.token === 'bad') return "Auto's sign-in file holds no token.";
  return status.auth.loggedIn === false ? 'Auto is signed out.' : null;
}
