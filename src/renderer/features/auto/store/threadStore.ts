import { create } from 'zustand';
import type { AutoAnswer, AutoStreamMessage } from '@/types/auto';
import {
  NEW_THREAD,
  cidFor,
  drop,
  giveBack,
  leftOver,
  put,
  readBox,
  setDraft,
  writeBox,
  type BoxState,
  type Failed,
  type OutboxEntry,
} from '../model/outbox';
import type { Picks } from '../model/questionModel';
import { applyEvent, fromSnapshot, unconfirmed, type PendingMessage, type ThreadView } from '../model/threadModel';
import { autoApi, useAutoStore } from './autoStore';

/*
 * The open thread and the box. A snapshot sets the thread, its stream keeps
 * it current while the tab is in view, and a message typed in the box stays
 * in the outbox until the service has it.
 */

export interface ThreadStore {
  /** The open thread's id, `new` for the empty one, or null when none is open. */
  openId: string | null;
  view: ThreadView | null;
  loading: boolean;
  /** Why the thread could not be read. */
  problem: string | null;
  token: number | null;
  /** The tab is in view, so the open thread's stream is followed. */
  watching: boolean;
  /** Sent from here and not yet shown by the thread. */
  pending: PendingMessage[];
  box: BoxState;
  /** The line above the box after a message did not go, and the thread it is for. */
  notSent: { thread: string; text: string } | null;
  failed: Failed | null;
  picks: Picks;
  /** What the service said to an answer it did not take. */
  cardProblem: string | null;
  /** The model a new thread starts with. */
  newModel: string;

  open: (id: string | null) => void;
  load: () => Promise<void>;
  setWatching: (watching: boolean) => void;
  handle: (message: AutoStreamMessage) => void;
  setDraft: (text: string) => void;
  /**
   * Sends words as his message; `typed` says they came from the box, which is
   * then emptied. Opal never marks a message as a send request.
   */
  send: (text: string, typed?: boolean) => Promise<boolean>;
  stop: () => Promise<void>;
  answer: (answer: AutoAnswer) => Promise<boolean>;
  setPicks: (picks: Picks) => void;
  /** Starts a waiting entry with its own words alone. */
  handOver: () => Promise<void>;
  rename: (title: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  /** Sends again what a closed app left on its way, and gives the rest back to its box. */
  flush: () => void;
}

/** The key a thread's draft is kept under. */
export const draftKey = (openId: string | null): string => openId ?? NEW_THREAD;

export const useThreadStore = create<ThreadStore>((set, get) => {
  const keep = (box: BoxState) => {
    writeBox(box);
    set({ box });
  };

  const follow = async (id: string, cursor: string | null) => {
    const api = autoApi();
    if (!api || !get().watching || get().openId !== id) return;
    const result = await api.follow({ stream: 'thread', id, cursor }).catch((): null => null);
    if (result?.success && get().openId === id && get().watching) set({ token: result.data.token });
  };

  const unfollow = () => {
    if (get().token === null) return;
    set({ token: null });
    void autoApi()?.unfollow('thread').catch(() => undefined);
  };

  /** The messages being posted now, so none is posted twice at once. */
  const onTheirWay = new Set<string>();

  /** One message on its way. Answers the thread it went to, or null when it did not go. */
  const deliver = async (entry: OutboxEntry): Promise<string | null> => {
    const api = autoApi();
    if (!api || onTheirWay.has(entry.cid)) return null;
    onTheirWay.add(entry.cid);
    const result = entry.thread
      ? await api.request({ kind: 'message', id: entry.thread, text: entry.text, cid: entry.cid }).catch((): null => null)
      : await api.request({ kind: 'create', text: entry.text, model: entry.model, cid: entry.cid }).catch((): null => null);
    onTheirWay.delete(entry.cid);
    if (result?.success) {
      keep(drop(get().box, entry.cid));
      if ('thread' in result.data) {
        useAutoStore.getState().upsert(result.data.thread);
        return result.data.thread.id;
      }
      return entry.thread;
    }
    // Its words go back into the box. The same words sent again go under the same id, so a copy that did arrive is dropped.
    keep(giveBack(get().box, entry));
    const thread = draftKey(entry.thread);
    set({
      pending: get().pending.filter((message) => message.cid !== entry.cid),
      failed: { thread: entry.thread, text: entry.text, cid: entry.cid },
      notSent: { thread, text: result?.error.kind === 'refused' ? `Not sent: ${result.error.message}` : 'Not sent' },
    });
    return null;
  };

  return {
    openId: null,
    view: null,
    loading: false,
    problem: null,
    token: null,
    watching: false,
    pending: [],
    box: readBox(),
    notSent: null,
    failed: null,
    picks: {},
    cardProblem: null,
    newModel: '',

    open: (id) => {
      if (id === get().openId) return;
      unfollow();
      set({ openId: id, view: null, loading: false, problem: null, pending: [], picks: {}, cardProblem: null });
      if (id && id !== NEW_THREAD) void get().load();
    },

    load: async () => {
      const id = get().openId;
      const api = autoApi();
      if (!api || !id || id === NEW_THREAD) return;
      unfollow();
      set({ loading: get().view === null });
      const result = await api.request({ kind: 'thread', id }).catch((): null => null);
      if (get().openId !== id) return;
      if (!result?.success) {
        // A thread that is gone says so; a service out of reach is the list's to report.
        set({ loading: false, problem: result?.error.kind === 'refused' ? result.error.message : get().view ? null : "Can't reach Auto." });
        return;
      }
      const view = fromSnapshot(result.data);
      set({ view, loading: false, problem: null, pending: unconfirmed(get().pending, view) });
      // A message the service could not hand to the agent goes back into an empty box.
      if (view.unsent && !(get().box.drafts[id] ?? '').trim()) {
        keep(setDraft(get().box, id, view.unsent));
        set({ notSent: { thread: id, text: 'Not sent' } });
      }
      useAutoStore.getState().upsert(view.thread);
      await follow(id, view.cursor);
    },

    setWatching: (watching) => {
      if (get().watching === watching) return;
      set({ watching });
      if (!watching) unfollow();
      // Back in view: what happened meanwhile comes with a new snapshot.
      else void get().load();
    },

    handle: (message) => {
      const { token, view } = get();
      if (token === null || message.token !== token) return;
      if (message.type === 'closed') {
        set({ token: null, problem: message.message });
        return;
      }
      if (message.type !== 'event' || message.stream !== 'thread' || !view) return;
      const event = message.event;
      if (event.kind === 'reset') {
        void get().load();
        return;
      }
      const next = { ...applyEvent(view, event), cursor: message.cursor ?? view.cursor };
      set({
        view: next,
        pending: unconfirmed(get().pending, next),
        ...(event.kind === 'question' ? { picks: {}, cardProblem: null } : {}),
        ...(event.kind === 'turn' ? { notSent: null } : {}),
      });
      if (event.kind === 'thread') useAutoStore.getState().upsert(event.thread);
    },

    setDraft: (text) => {
      const key = draftKey(get().openId);
      keep(setDraft(get().box, key, text));
      if (get().notSent?.thread === key) set({ notSent: null });
    },

    send: async (text, typed = true) => {
      const words = text.trim();
      const openId = get().openId;
      const key = draftKey(openId);
      if (!words) return false;
      // While the service is out of reach the box is left as it is.
      if (!useAutoStore.getState().reachable) {
        set({ notSent: { thread: key, text: 'Not sent' } });
        return false;
      }
      const thread = key === NEW_THREAD ? null : key;
      const entry: OutboxEntry = { cid: cidFor(get().failed, thread, words), thread, text: words, model: thread ? '' : get().newModel, at: Date.now() };
      keep(typed ? setDraft(put(get().box, entry), key, '') : put(get().box, entry));
      const view = get().view;
      set({
        pending: [...get().pending, { cid: entry.cid, text: words }],
        notSent: null,
        failed: null,
        view: view ? { ...view, next: [] } : view,
      });
      const went = await deliver(entry);
      if (went && !thread && get().openId === openId) {
        // The new thread opens with the message it was started by.
        unfollow();
        set({ openId: went, view: null, problem: null, picks: {}, cardProblem: null });
        void get().load();
      }
      return went !== null;
    },

    stop: async () => {
      const id = get().openId;
      if (!id || id === NEW_THREAD) return;
      const result = await autoApi()?.request({ kind: 'stop', id }).catch((): null => null);
      if (!result?.success) {
        if (result?.error.kind === 'refused') set({ cardProblem: result.error.message });
        return;
      }
      // The queued messages it dropped go back into the box.
      const back = result.data.returned.map((queued) => queued.text).join('\n\n');
      if (!back) return;
      const typed = get().box.drafts[id] ?? '';
      keep(setDraft(get().box, id, typed.trim() ? `${typed}\n\n${back}` : back));
    },

    answer: async (answer) => {
      const id = get().openId;
      if (!id || id === NEW_THREAD) return false;
      const result = await autoApi()?.request({ kind: 'answer', id, answer }).catch((): null => null);
      if (result?.success) {
        set({ picks: {}, cardProblem: null });
        return true;
      }
      set({ cardProblem: result?.error.message ?? "Can't reach Auto." });
      return false;
    },

    setPicks: (picks) => set({ picks }),

    handOver: async () => {
      const id = get().openId;
      if (!id || id === NEW_THREAD) return;
      const result = await autoApi()?.request({ kind: 'start', id }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
      else set({ cardProblem: result?.error.message ?? "Can't reach Auto." });
    },

    rename: async (title) => {
      const id = get().openId;
      const said = title.trim();
      if (!id || id === NEW_THREAD || !said || said === get().view?.thread.title) return;
      const result = await autoApi()?.request({ kind: 'rename', id, title: said }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
    },

    setModel: async (model) => {
      const id = get().openId;
      if (!id || id === NEW_THREAD) {
        set({ newModel: model });
        return;
      }
      const result = await autoApi()?.request({ kind: 'model', id, model }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
    },

    flush: () => {
      const waiting = { ...get().box, outbox: get().box.outbox.filter((entry) => !onTheirWay.has(entry.cid)) };
      const { resend, returned } = leftOver(waiting, Date.now());
      const state = returned.reduce(giveBack, get().box);
      if (returned.length > 0) {
        keep(state);
        const [first] = returned;
        set({ notSent: { thread: draftKey(first.thread), text: 'Not sent' } });
      }
      for (const entry of resend) void deliver(entry);
    },
  };
});

// The list hears of a thread's changes too; the open thread keeps the newer entry.
// A thread that leaves the list, as an archived one does, is no longer open.
useAutoStore.subscribe((state, before) => {
  if (state.threads === before.threads) return;
  const { view, openId, open } = useThreadStore.getState();
  if (!view || view.thread.id !== openId) return;
  const entry = state.threads.find((thread) => thread.id === openId);
  if (entry && entry !== view.thread) useThreadStore.setState({ view: { ...view, thread: entry } });
  else if (!entry && before.threads.some((thread) => thread.id === openId)) open(null);
});

/** Every stream message from the main process, handed to the store that follows that stream. */
export function dispatchStream(message: AutoStreamMessage): void {
  useAutoStore.getState().handle(message);
  useThreadStore.getState().handle(message);
}
