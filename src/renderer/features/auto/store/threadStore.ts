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
import { DIGEST_QUEUE, paneThread } from '../model/pane';
import { forgetPlaces } from '../model/places';
import { answerTyped, mayAnswer, type Picks } from '../model/questionModel';
import { applyEvent, fromSnapshot, unconfirmed, type PendingMessage, type ThreadView } from '../model/threadModel';
import { autoApi, unconfirmedThreads, useAutoStore } from './autoStore';
import { useSaidStore } from './saidStore';

/*
 * The open thread and the box. A snapshot sets the thread, its stream keeps
 * it current while the tab is in view, and a message typed in the box stays
 * in the outbox until the service has it. The last view of each thread is
 * kept in memory, so a thread seen before shows at once while the fresh
 * snapshot loads.
 */

/** How many threads' last views are kept. */
const KEPT_LIMIT = 40;
/** "Loading…" shows only when nothing is kept and the wait passes this, in ms. */
export const SLOW_MS = 300;

export interface ThreadStore {
  /**
   * What the pane beside the list shows: a thread's id, NEW_THREAD for the
   * empty thread, DIGEST_QUEUE for the digest, or null for nothing.
   */
  openId: string | null;
  view: ThreadView | null;
  /**
   * What was in the pane before a thread never seen was opened. It stays
   * until that thread arrives or 300 ms pass, whichever is first, so a
   * first open does not blank the pane for the round trip.
   */
  ghost: ThreadView | null;
  loading: boolean;
  /** The wait for a thread with nothing kept has passed 300 ms: say so. */
  slow: boolean;
  /** The open thread's title is being changed, asked for from its row's menu or its own. */
  renaming: boolean;
  /** Why the thread could not be read. */
  problem: string | null;
  /** The last read failed, so what shows may be old: it is read again once Auto answers. */
  stale: boolean;
  /** The thread had a reply he had not read when it was opened: it opens at that reply's start. */
  openedUnread: boolean;
  /** Counts up each time the box should take the keyboard focus. */
  boxFocus: number;
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

  /**
   * Opens a pane. The box takes the focus unless `focus` is false, as when
   * the next thread opens after a row's key archived the one before.
   */
  open: (id: string | null, options?: { focus?: boolean }) => void;
  load: () => Promise<void>;
  /** Reads the open thread again if its last read failed or never happened. */
  recover: () => void;
  focusBox: () => void;
  setRenaming: (renaming: boolean) => void;
  /** Opens a thread with its title ready to be changed. */
  startRename: (id: string) => void;
  setWatching: (watching: boolean) => void;
  handle: (message: AutoStreamMessage) => void;
  setDraft: (text: string) => void;
  /**
   * Sends words as his message; `typed` says they came from the box, which is
   * then emptied. While a question waits, words typed in the box are his
   * answer to it. Opal never marks a message as a send request.
   */
  send: (text: string, typed?: boolean) => Promise<boolean>;
  /** Puts a follow-up into the box, to change before it is sent. */
  editNext: (line: string) => void;
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

/** The last view of each thread seen this session, the oldest dropped first. */
const kept = new Map<string, ThreadView>();

function remember(view: ThreadView): void {
  kept.delete(view.thread.id);
  kept.set(view.thread.id, view);
  for (const oldest of kept.keys()) {
    if (kept.size <= KEPT_LIMIT) break;
    kept.delete(oldest);
  }
}

/** Drops every kept view: they belong to the service they were read from. */
export function forgetViews(): void {
  kept.clear();
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

  let slowTimer: ReturnType<typeof setTimeout> | null = null;

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
      // The service answers: a thread that could not be read is read now.
      get().recover();
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
    ghost: null,
    loading: false,
    slow: false,
    renaming: false,
    problem: null,
    stale: false,
    openedUnread: false,
    boxFocus: 0,
    token: null,
    watching: false,
    pending: [],
    box: readBox(),
    notSent: null,
    failed: null,
    picks: {},
    cardProblem: null,
    newModel: '',

    open: (id, options = {}) => {
      const focus = options.focus !== false;
      if (id === get().openId) {
        // A click on the row of a thread that could not be read tries again.
        get().recover();
        if (focus) get().focusBox();
        return;
      }
      unfollow();
      const thread = paneThread(id);
      const entry = thread ? useAutoStore.getState().threads.find((candidate) => candidate.id === thread) : undefined;
      const seen = (thread && kept.get(thread)) || null;
      set({
        openId: id,
        // What was last seen of it shows at once; the fresh snapshot takes its place.
        view: seen,
        // Never seen: what the pane held stays for a moment, in place of nothing.
        ghost: thread && !seen ? get().view ?? get().ghost : null,
        loading: false,
        slow: false,
        renaming: false,
        problem: null,
        stale: false,
        openedUnread: entry?.unread === true,
        pending: [],
        picks: {},
        cardProblem: null,
        ...(focus ? { boxFocus: get().boxFocus + 1 } : {}),
      });
      if (thread) void get().load();
    },

    focusBox: () => set({ boxFocus: get().boxFocus + 1 }),

    setRenaming: (renaming) => set({ renaming }),

    startRename: (id) => {
      get().open(id, { focus: false });
      set({ renaming: true });
    },

    recover: () => {
      const { view, problem, stale, loading } = get();
      if (paneThread(get().openId) && !loading && (view === null || problem !== null || stale)) void get().load();
    },

    load: async () => {
      const id = paneThread(get().openId);
      const api = autoApi();
      if (!api || !id) return;
      unfollow();
      set({ loading: true, slow: false });
      if (slowTimer) clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        if (get().openId === id && get().loading && get().view === null) set({ slow: true, ghost: null });
      }, SLOW_MS);
      const result = await api.request({ kind: 'thread', id }).catch((): null => null);
      if (get().openId !== id) return;
      if (!result?.success) {
        // A thread that is gone says so; a service out of reach is the list's to report.
        const refused = result?.error.kind === 'refused';
        if (refused) kept.delete(id);
        set({
          loading: false,
          slow: false,
          ghost: null,
          stale: !refused,
          view: refused ? null : get().view,
          problem: refused ? result.error.message : get().view ? null : "Can't reach Auto.",
        });
        return;
      }
      const view = fromSnapshot(result.data);
      remember(view);
      set({ view, ghost: null, loading: false, slow: false, problem: null, stale: false, pending: unconfirmed(get().pending, view) });
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
      remember(next);
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

    editNext: (line) => {
      get().setDraft(line);
      get().focusBox();
    },

    send: async (text, typed = true) => {
      const words = text.trim();
      const openId = get().openId;
      const key = draftKey(openId);
      // The queue has boxes of its own.
      if (!words || openId === DIGEST_QUEUE) return false;
      // While a question waits, the box is its answer field: his words answer it and are not queued behind it.
      const question = get().view?.question;
      if (question && typed) {
        const took = await get().answer(answerTyped(question, words, get().picks));
        if (took && get().openId === openId) keep(setDraft(get().box, key, ''));
        return took;
      }
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
        set({ openId: went, view: null, ghost: null, problem: null, stale: false, openedUnread: false, picks: {}, cardProblem: null });
        void get().load();
      }
      return went !== null;
    },

    stop: async () => {
      const id = paneThread(get().openId);
      if (!id) return;
      const result = await autoApi()?.request({ kind: 'stop', id }).catch((): null => null);
      // The keyboard goes back to the box, whatever held it when he stopped the turn.
      if (get().openId === id) get().focusBox();
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
      const id = paneThread(get().openId);
      if (!id) return false;
      // A send he is asked to allow takes only a "no" from this app, whatever built the answer.
      if (!mayAnswer(get().view?.question ?? null, answer)) return false;
      const result = await autoApi()?.request({ kind: 'answer', id, answer }).catch((): null => null);
      if (result?.success) {
        set({ picks: {}, cardProblem: null });
        // The card is answered: the keyboard goes back to the box.
        if (get().openId === id) get().focusBox();
        return true;
      }
      set({ cardProblem: result?.error.message ?? "Can't reach Auto." });
      return false;
    },

    setPicks: (picks) => set({ picks }),

    handOver: async () => {
      const id = paneThread(get().openId);
      if (!id) return;
      const result = await autoApi()?.request({ kind: 'start', id }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
      else set({ cardProblem: result?.error.message ?? "Can't reach Auto." });
    },

    rename: async (title) => {
      const id = paneThread(get().openId);
      const said = title.trim();
      if (!id || !said || said === get().view?.thread.title) return;
      const result = await autoApi()?.request({ kind: 'rename', id, title: said }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
    },

    setModel: async (model) => {
      const id = paneThread(get().openId);
      if (!id) {
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
// A thread that leaves the list, as one archived on another device does, is no longer open.
// Once Auto answers again, a thread that could not be read is read by itself.
useAutoStore.subscribe((state, before) => {
  // Another address is another service: nothing kept from the old one stays.
  if (state.address !== before.address) {
    forgetViews();
    forgetPlaces();
    // An Undo on offer would take back something the other service did.
    useSaidStore.getState().clear();
    unconfirmedThreads.clear();
  }
  if ((state.reachable && !before.reachable) || (state.reachable && state.refreshedAt !== before.refreshedAt)) useThreadStore.getState().recover();
  if (state.threads === before.threads) return;
  const { view, openId, open } = useThreadStore.getState();
  if (!view || view.thread.id !== openId) return;
  const entry = state.threads.find((thread) => thread.id === openId);
  if (entry && entry !== view.thread) useThreadStore.setState({ view: { ...view, thread: entry } });
  else if (!entry && before.threads.some((thread) => thread.id === openId)) open(null);
});
