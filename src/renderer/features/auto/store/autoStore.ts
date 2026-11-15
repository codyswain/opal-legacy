import { create } from 'zustand';
import { toast } from 'sonner';
import type { AutoAPI, AutoStatus, AutoStreamMessage, AutoThread } from '@/types/auto';
import { applyOrder, fromDigest, moved, upsertThread } from '../model/listModel';

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
  /** An Auto tab is open, so the list stream is followed. */
  following: boolean;
  listToken: number | null;
  /** When the list was last read, in ms. */
  refreshedAt: number;
  snoozedOpen: boolean;

  /** Reads the address, and the list when there is one. */
  start: () => Promise<void>;
  /** Saves a typed address. Answers the sentence to show when it is refused. */
  saveAddress: (typed: string) => Promise<string | null>;
  editAddress: (editing: boolean) => void;
  /** Reads the status and the list again, and follows the list from there while a tab is open. */
  refresh: () => Promise<boolean>;
  setFollowing: (following: boolean) => void;
  /** A message of the list stream. */
  handle: (message: AutoStreamMessage) => void;
  upsert: (thread: AutoThread) => void;
  toggleSnoozed: () => void;
  checkStatus: () => Promise<void>;

  snooze: (id: string, until: number | null) => Promise<void>;
  /** Archives a thread; `done` also marks the digest entry it came from as done. */
  archive: (thread: AutoThread, done?: boolean) => Promise<void>;
  move: (id: string, before: string | null) => Promise<void>;
  /** An option of a waiting row, clicked. */
  answer: (thread: AutoThread, label: string) => Promise<void>;
}

export const autoApi = (): AutoAPI | undefined => (typeof window !== 'undefined' ? window.autoAPI : undefined);

const UNREACHABLE = "Can't reach Auto.";

let refreshing: Promise<boolean> | null = null;

export const useAutoStore = create<AutoStore>((set, get) => {
  /** A write whose failure is said in one line. */
  const said = (message: string) => toast.error(message);

  const follow = async (cursor: string | null) => {
    const api = autoApi();
    if (!api || !get().following) return;
    const result = await api.follow({ stream: 'list', cursor }).catch((): null => null);
    if (result?.success && get().following) set({ listToken: result.data.token });
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
      threads: list.data.threads,
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
    following: false,
    listToken: null,
    refreshedAt: 0,
    snoozedOpen: false,

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
      set({ address: result.data.url, editing: false, loaded: false, reachable: false, problem: null, threads: [], status: null, listToken: null });
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

    setFollowing: (following) => {
      if (get().following === following) return;
      set({ following });
      if (following) {
        if (get().address) void get().refresh();
        return;
      }
      set({ listToken: null });
      void autoApi()?.unfollow('list').catch(() => undefined);
    },

    handle: (message) => {
      if (message.token !== get().listToken) return;
      if (message.type === 'open') {
        set({ reachable: true, problem: null });
      } else if (message.type === 'down') {
        set({ reachable: false, problem: UNREACHABLE });
      } else if (message.type === 'event' && message.stream === 'list') {
        const event = message.event;
        if (event.kind === 'thread') set({ threads: upsertThread(get().threads, event.thread) });
        else if (event.kind === 'order') set({ threads: applyOrder(get().threads, event.ids) });
        else if (event.kind === 'status') set({ status: event.status });
        // The service can no longer say what was missed: read everything again.
        else if (event.kind === 'reset') void get().refresh();
      }
    },

    upsert: (thread) => set({ threads: upsertThread(get().threads, thread) }),

    toggleSnoozed: () => set({ snoozedOpen: !get().snoozedOpen }),

    checkStatus: async () => {
      const result = await autoApi()?.request({ kind: 'check-status' }).catch((): null => null);
      if (result?.success) set({ status: result.data });
      else if (result) said(result.error.message);
    },

    snooze: async (id, until) => {
      const result = await autoApi()?.request({ kind: 'snooze', id, until }).catch((): null => null);
      if (result?.success) get().upsert(result.data.thread);
      else if (result) said(result.error.message);
    },

    archive: async (thread, done = false) => {
      const api = autoApi();
      const result = await api?.request({ kind: 'archive', id: thread.id, archived: true, ...(done && fromDigest(thread) ? { done: true } : {}) }).catch((): null => null);
      if (!result) return;
      if (!result.success) {
        said(result.error.message);
        return;
      }
      get().upsert(result.data.thread);
      toast(done ? 'Done' : 'Archived', {
        action: {
          label: 'Undo',
          onClick: () => {
            void api?.request({ kind: 'archive', id: thread.id, archived: false }).then((undone) => {
              if (undone.success) get().upsert(undone.data.thread);
              else said(undone.error.message);
            });
          },
        },
      });
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

    answer: async (thread, label) => {
      const ask = thread.ask;
      if (!ask?.question) return;
      const result = await autoApi()?.request({ kind: 'answer', id: thread.id, answer: { id: ask.id, answers: { [ask.question]: label } } }).catch((): null => null);
      if (result && !result.success) said(result.error.message);
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
