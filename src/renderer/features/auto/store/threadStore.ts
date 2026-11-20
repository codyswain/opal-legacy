import { create } from 'zustand';
import { MAX_AUTO_IMAGES } from '@/common/autoImages';
import { modeChoice, replyChoice, visibleModel } from '@/common/autoReplyModel';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import type { AutoAnswer, AutoGrant, AutoModeChoice, AutoModelChoice, AutoQuestion, AutoStreamMessage } from '@/types/auto';
import {
  NEW_THREAD,
  cidFor,
  drop,
  giveBack,
  leftOver,
  put,
  readBox,
  setDraft,
  setDraftImages,
  writeBox,
  type BoxState,
  type Failed,
  type OutboxEntry,
} from '../model/outbox';
import { AWAY, DIGEST_QUEUE, paneThread } from '../model/pane';
import { groupOf, type Hold } from '../model/listModel';
import { forgetPlaces } from '../model/places';
import { answerNo, answerPicks, answerTyped, isSingle, mayAnswer, picksReady, type Picks } from '../model/questionModel';
import { applyEvent, fromSnapshot, unconfirmed, type PendingMessage, type ThreadView } from '../model/threadModel';
import { autoApi, forgetListWorking, unconfirmedThreads, undoneArchives, useAutoStore } from './autoStore';
import { useSaidStore } from './saidStore';

/*
 * The open thread and the box. A snapshot sets the thread, its stream keeps
 * it current while the tab is in view, and a message typed in the box stays
 * in the outbox until the service has it. The last view of each thread is
 * kept in memory, so a thread seen before shows at once while the fresh
 * snapshot loads.
 */

/** The questions whose answer from the box is on its way, so a second Enter does not say it twice. */
const answering = new Set<string>();

/**
 * The record of questions that found words in the box, after one thread's
 * question changed: marked when the box of that thread holds words now,
 * since they were begun before the question came, and cleared otherwise.
 */
function begunBefore(earlier: Record<string, string>, box: BoxState, thread: string, question: AutoQuestion | null): Record<string, string> {
  const next = { ...earlier };
  if (question && ((box.drafts[thread] ?? '').trim() || box.images?.[thread]?.length)) next[thread] = question.id;
  else delete next[thread];
  return next;
}

/** Where a title is being changed: in the open thread's header, or on its row in the sidebar. */
export interface Renaming {
  id: string;
  at: 'header' | 'row';
}

/** The longest title the field takes. */
export const TITLE_LIMIT = 120;

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
  /**
   * The one title being changed, in the header or on its row, or null. It is
   * always the open thread's: starting a rename opens the thread.
   */
  renaming: Renaming | null;
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
  /**
   * By thread, the question that arrived while its box already held words.
   * Those words were begun as a message, so they stay one: Enter sends
   * them, and the box becomes the card's answer field only once it has
   * been emptied.
   */
  earlier: Record<string, string>;
  /** What the service said to an answer it did not take. */
  cardProblem: string | null;
  /** The model a new thread starts with. */
  newModel: AutoModelChoice;
  /** The mode a new thread starts with: Solo, or Orchestrate with a default model for its agents. */
  newMode: AutoModeChoice;
  /** What shows was opened from the Put away page: the sidebar's Put away row stays marked, and it leads back there. */
  fromAway: boolean;
  /** The open thread keeps the group it was in when it was opened, until another opens or he leaves the tab. */
  hold: Hold | null;
  releaseHold: () => void;

  /**
   * Opens a pane. The box takes the focus unless `focus` is false, as when
   * the next thread opens after a row's key archived the one before.
   * `fromAway` says it was opened from the Put away page.
   */
  open: (id: string | null, options?: { focus?: boolean; fromAway?: boolean }) => void;
  load: () => Promise<void>;
  /** Reads the open thread again if its last read failed or never happened. */
  recover: () => void;
  focusBox: () => void;
  /** Opens a thread with its title ready to be changed, in the header unless `at` says its row. */
  startRename: (id: string, at?: Renaming['at']) => void;
  /** Ends that rename, and only that one: a newer one started meanwhile stays. */
  endRename: (renaming: Renaming) => void;
  setWatching: (watching: boolean) => void;
  handle: (message: AutoStreamMessage) => void;
  setDraft: (text: string) => void;
  setDraftImages: (key: string, ids: string[], beforeQuestion?: boolean) => void;
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
  /** Allows the open send with this Mac's key: the main process asks for Touch ID, signs and answers. */
  allowSend: (question: AutoGrant) => Promise<boolean>;
  setPicks: (picks: Picks) => void;
  /** Starts a waiting entry with its own words alone. */
  handOver: () => Promise<void>;
  /** Posts a new title for a thread, the open one unless `id` names another. An empty or unchanged title posts nothing. */
  rename: (title: string, id?: string) => Promise<void>;
  setModel: (model: AutoModelChoice) => Promise<void>;
  /** Posts the open thread's mode, to apply from its next turn; for a new thread it is remembered on this Mac. */
  setMode: (mode: AutoModeChoice) => Promise<void>;
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

// Finish model changes in click order for each thread. A reply waits only for its own thread.
const modelChanges = new Map<string, Promise<boolean>>();

/** Drops every kept view and model change: they belong to the service they were read from. */
export function forgetViews(): void {
  kept.clear();
  modelChanges.clear();
}

/** The key a thread's draft is kept under. */
export const draftKey = (openId: string | null): string => openId ?? NEW_THREAD;

const MODEL_PREF = 'auto.reply-model';
const MODE_PREF = 'auto.mode';

/** The next new thread or digest reply starts with the last model picked on this Mac. */
export function rememberReplyModel(model: AutoModelChoice): void {
  writePref(MODEL_PREF, model);
  useThreadStore.setState({ newModel: model });
}

export const useThreadStore = create<ThreadStore>((set, get) => {
  const saved = readPref<string | AutoModelChoice | null>(MODEL_PREF, '');
  const preferred = replyChoice(typeof saved === 'string' ? { model: saved } : saved ?? {});
  const savedMode = modeChoice(readPref<Partial<AutoModeChoice> | null>(MODE_PREF, null) ?? {});
  const keep = (box: BoxState) => {
    writeBox(box, useAutoStore.getState().address);
    set({ box });
  };

  // Counts follows and unfollows. A follow answered after a later call is stale: its
  // stream starts from an older cursor and would replay what the pane has moved past.
  let following = 0;
  let asking = false;
  // Counts loads. A snapshot asked for before a later load is dropped: the later one stands for it.
  let loads = 0;

  const follow = async (id: string, cursor: string | null) => {
    const api = autoApi();
    if (!api || !get().watching || get().openId !== id) return;
    const ask = ++following;
    asking = true;
    const result = await api.follow({ stream: 'thread', id, cursor }).catch((): null => null);
    if (ask !== following) return;
    asking = false;
    if (result?.success && get().openId === id && get().watching) set({ token: result.data.token });
  };

  const unfollow = () => {
    following += 1;
    // A follow still on its way is ended too: the main process takes the two in order.
    if (get().token === null && !asking) return;
    asking = false;
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
    const change = entry.thread && modelChanges.get(entry.thread);
    const address = useAutoStore.getState().address;
    const ready = !change || ((await change) && useAutoStore.getState().address === address);
    if (entry.awaitingModel && ready) {
      // Once confirmed, this message may be replayed normally if Opal closes during the post.
      keep(put(get().box, { ...entry, awaitingModel: false }));
    }
    const attachments = entry.images?.length ? { images: entry.images } : {};
    const result = !ready ? null : entry.thread
      ? await api.request({ kind: 'message', id: entry.thread, text: entry.text, cid: entry.cid, ...attachments }).catch((): null => null)
      : await api.request({ kind: 'create', text: entry.text, model: entry.model, effort: entry.effort, speed: entry.speed, ...(entry.mode ? { mode: entry.mode, agentsModel: entry.agentsModel ?? '' } : {}), cid: entry.cid, ...attachments }).catch((): null => null);
    onTheirWay.delete(entry.cid);
    if (useAutoStore.getState().address !== address) {
      const old = readBox(address);
      writeBox(result?.success ? drop(old, entry.cid) : giveBack(old, entry), address);
      return null;
    }
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
      failed: { thread: entry.thread, text: entry.text, cid: entry.cid, ...attachments },
      notSent: { thread, text: !ready ? 'Choose a reply model again before sending.' : result?.error.kind === 'refused' ? `Not sent: ${result.error.message}` : 'Not sent' },
    });
    return null;
  };

  return {
    openId: null,
    view: null,
    ghost: null,
    loading: false,
    slow: false,
    renaming: null,
    problem: null,
    stale: false,
    openedUnread: false,
    earlier: {},
    boxFocus: 0,
    token: null,
    watching: false,
    pending: [],
    box: { drafts: {}, outbox: [] },
    notSent: null,
    failed: null,
    picks: {},
    cardProblem: null,
    newModel: preferred && visibleModel(preferred.model) ? preferred : { model: '' },
    newMode: savedMode ?? { mode: '', agentsModel: '' },
    fromAway: false,
    hold: null,

    releaseHold: () => {
      if (get().hold) set({ hold: null });
    },

    open: (id, options = {}) => {
      const focus = options.focus !== false;
      const fromAway = options.fromAway === true || id === AWAY;
      if (fromAway !== get().fromAway) set({ fromAway });
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
        renaming: null,
        problem: null,
        stale: false,
        openedUnread: entry?.unread === true,
        hold: thread ? (() => {
          const group = groupOf(useAutoStore.getState().threads, thread);
          return group ? { id: thread, group } : null;
        })() : null,
        pending: [],
        picks: {},
        cardProblem: null,
        ...(focus ? { boxFocus: get().boxFocus + 1 } : {}),
      });
      if (thread) void get().load();
    },

    focusBox: () => set({ boxFocus: get().boxFocus + 1 }),

    startRename: (id, at = 'header') => {
      get().open(id, { focus: false });
      set({ renaming: { id, at } });
    },

    endRename: (renaming) => {
      const now = get().renaming;
      if (now && now.id === renaming.id && now.at === renaming.at) set({ renaming: null });
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
      const asked = ++loads;
      const address = useAutoStore.getState().address;
      set({ loading: true, slow: false });
      if (slowTimer) clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        if (get().openId === id && get().loading && get().view === null) set({ slow: true, ghost: null });
      }, SLOW_MS);
      const result = await api.request({ kind: 'thread', id }).catch((): null => null);
      if (get().openId !== id || asked !== loads || useAutoStore.getState().address !== address) return;
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
      set({
        view,
        ghost: null,
        loading: false,
        slow: false,
        problem: null,
        stale: false,
        pending: unconfirmed(get().pending, view),
        // A question that came while he was away finds the box as it is now; one he had already seen keeps what was known.
        ...(view.question?.id === get().view?.question?.id ? {} : { earlier: begunBefore(get().earlier, get().box, id, view.question) }),
      });
      // A message the service could not hand to the agent goes back into an empty box.
      if ((view.unsent || view.unsentImages?.length) && !(get().box.drafts[id] ?? '').trim() && !get().box.images?.[id]?.length) {
        keep(setDraftImages(setDraft(get().box, id, view.unsent ?? ''), id, view.unsentImages ?? []));
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
        // A card that arrives while he is typing finds words that were begun as a message. The same card
        // said again finds only what he has typed under it since.
        ...(event.kind === 'question' && next.question?.id !== view.question?.id ? { earlier: begunBefore(get().earlier, get().box, view.thread.id, next.question) } : {}),
        ...(event.kind === 'turn' ? { notSent: null } : {}),
      });
      // The list's own stream says when a thread joins or leaves the list. This one can replay
      // from an older snapshot's cursor, where an old "archived" would take away a row that is back.
      if (event.kind === 'thread' && !event.thread.archived && useAutoStore.getState().threads.some((thread) => thread.id === event.thread.id)) {
        useAutoStore.getState().upsert(event.thread);
      }
    },

    setDraft: (text) => {
      const key = draftKey(get().openId);
      keep(setDraft(get().box, key, text));
      if (get().notSent?.thread === key) set({ notSent: null });
      // Emptied once, the box is the card's answer field.
      if (text === '' && !get().box.images?.[key]?.length && get().earlier[key] !== undefined) set({ earlier: begunBefore(get().earlier, get().box, key, null) });
    },

    setDraftImages: (key, images, beforeQuestion) => {
      const box = setDraftImages(get().box, key, images);
      keep(box);
      if (get().notSent?.thread === key) set({ notSent: null });
      if (draftKey(get().openId) === key && (beforeQuestion || get().earlier[key])) {
        set({ earlier: begunBefore(get().earlier, box, key, get().view?.question ?? null) });
      }
    },

    editNext: (line) => {
      get().setDraft(line);
      get().focusBox();
    },

    send: async (text, typed = true) => {
      const words = text.trim();
      const openId = get().openId;
      const key = draftKey(openId);
      const images = typed ? get().box.images?.[key] ?? [] : [];
      const attachments = images.length ? { images } : {};
      // The queue has boxes of its own.
      if ((!words && !images.length) || openId === DIGEST_QUEUE) return false;
      if (images.length > MAX_AUTO_IMAGES) {
        set({ notSent: { thread: key, text: `Choose up to ${MAX_AUTO_IMAGES} images for one message.` } });
        return false;
      }
      // While a question waits, the box is its answer field: his words answer it and are not queued behind it.
      const question = get().view?.question;
      // Words begun before the card arrived are not its answer: they go as the message they were begun as.
      if (question && typed && !images.length && get().earlier[key] !== question.id) {
        const picked = question.kind === 'ask' && !isSingle(question) && picksReady(question, get().picks);
        if (question.kind !== 'grant' && !picked) {
          const took = await get().answer(answerTyped(question, words, get().picks));
          if (took && get().openId === openId) keep(setDraft(get().box, key, ''));
          return took;
        }
        // Two answers take no words. A send he is asked to allow reads only the no. A question whose every
        // part has its pick is answered by the picks. So the answer goes alone, and once the service has
        // taken it his words follow as an ordinary message. If it is not taken, the words stay in the box
        // and nothing is sent.
        if (answering.has(question.id)) return false;
        answering.add(question.id);
        const took = await get().answer(question.kind === 'grant' ? answerNo(question) : answerPicks(question as Extract<AutoQuestion, { kind: 'ask' }>, get().picks));
        answering.delete(question.id);
        if (!took || get().openId !== openId) return false;
      }
      // While the service is out of reach the box is left as it is.
      if (!useAutoStore.getState().reachable) {
        set({ notSent: { thread: key, text: 'Not sent' } });
        return false;
      }
      const thread = key === NEW_THREAD ? null : key;
      const entry: OutboxEntry = {
        cid: cidFor(get().failed, thread, words, images), thread, text: words, ...attachments, ...(thread ? { model: '' } : { ...get().newModel, ...(get().newMode.mode ? get().newMode : {}) }), at: Date.now(),
        ...(thread && modelChanges.has(thread) ? { awaitingModel: true } : {}),
      };
      const box = put(get().box, entry);
      keep(typed ? setDraftImages(setDraft(box, key, ''), key, []) : box);
      const view = get().view;
      set({
        pending: [...get().pending, { cid: entry.cid, text: words, ...attachments }],
        notSent: null,
        failed: null,
        view: view ? { ...view, next: [] } : view,
        // The box is empty again: what is typed next under a card is its answer.
        ...(typed ? { earlier: begunBefore(get().earlier, get().box, key, null) } : {}),
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
      const address = useAutoStore.getState().address;
      const result = await autoApi()?.request({ kind: 'stop', id }).catch((): null => null);
      const sameService = useAutoStore.getState().address === address;
      // The keyboard goes back to the box, whatever held it when he stopped the turn.
      if (sameService && get().openId === id) get().focusBox();
      if (!result?.success) {
        if (sameService && result?.error.kind === 'refused') set({ cardProblem: result.error.message });
        return;
      }
      // The queued messages it dropped go back into the box.
      const returned = result.data.returned;
      if (!returned.length) return;
      const box = sameService ? get().box : readBox(address);
      const words = [box.drafts[id] ?? '', ...returned.map((queued) => queued.text)].filter((line) => line.trim()).join('\n\n');
      const images = [...new Set([...(box.images?.[id] ?? []), ...returned.flatMap((queued) => queued.images ?? [])])];
      const restored = setDraftImages(setDraft(box, id, words), id, images);
      if (sameService) keep(restored);
      else writeBox(restored, address);
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

    allowSend: async (question) => {
      const id = paneThread(get().openId);
      if (!id || get().view?.question?.id !== question.id) return false;
      set({ cardProblem: null });
      const result = await autoApi()?.allowSend(id, question).catch((): null => null);
      if (result?.success) {
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
      const change = modelChanges.get(id);
      if (change && !(await change)) return;
      const result = await autoApi()?.request({ kind: 'start', id }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
      else set({ cardProblem: result?.error.message ?? "Can't reach Auto." });
      // The button has gone with the hand-over: the keyboard goes to the box.
      if (get().openId === id) get().focusBox();
    },

    rename: async (title, id = paneThread(get().openId) ?? undefined) => {
      const said = title.trim();
      if (!id || !said) return;
      // Unchanged: the title the row shows, or the open thread's while the list has none.
      const view = get().view;
      const was = useAutoStore.getState().threads.find((thread) => thread.id === id)?.title ?? (view?.thread.id === id ? view.thread.title : undefined);
      if (said === was) return;
      const result = await autoApi()?.request({ kind: 'rename', id, title: said }).catch((): null => null);
      if (result?.success) useAutoStore.getState().upsert(result.data.thread);
    },

    setModel: async (model) => {
      const id = paneThread(get().openId);
      if (!id) {
        rememberReplyModel(model);
        return;
      }
      const address = useAutoStore.getState().address;
      const previous = modelChanges.get(id);
      const change = (async () => {
        if (previous) await previous;
        if (useAutoStore.getState().address !== address) return false;
        const result = await autoApi()?.request({ kind: 'model', id, ...model }).catch((): null => null);
        if (useAutoStore.getState().address !== address) return false;
        if (!result?.success) {
          useSaidStore.getState().refuse(result?.error.message ?? "Couldn't change the reply model.");
          return false;
        }
        useAutoStore.getState().upsert(result.data.thread);
        return true;
      })();
      modelChanges.set(id, change);
      // Keep a failed choice until he picks again. Replies never silently use the previous model.
      if (await change && modelChanges.get(id) === change) modelChanges.delete(id);
    },

    setMode: async (mode) => {
      const id = paneThread(get().openId);
      if (!id) {
        writePref(MODE_PREF, mode);
        set({ newMode: mode });
        return;
      }
      const result = await autoApi()?.request({ kind: 'mode', id, ...mode }).catch((): null => null);
      if (!result?.success) {
        useSaidStore.getState().refuse(result?.error.message ?? "Couldn't change the mode.");
        return;
      }
      useAutoStore.getState().upsert(result.data.thread);
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
    if (before.address) useThreadStore.getState().open(null, { focus: false });
    useThreadStore.setState({ box: state.address ? readBox(state.address) : { outbox: [], drafts: {} }, notSent: null, failed: null, earlier: {}, pending: [] });
    forgetViews();
    forgetPlaces();
    // An Undo on offer would take back something the other service did.
    useSaidStore.getState().clear();
    unconfirmedThreads.clear();
    undoneArchives.clear();
    forgetListWorking();
  }
  if ((state.reachable && !before.reachable) || (state.reachable && state.refreshedAt !== before.refreshedAt)) useThreadStore.getState().recover();
  if (state.threads === before.threads) return;
  const { view, openId, open } = useThreadStore.getState();
  if (!view || view.thread.id !== openId) return;
  const entry = state.threads.find((thread) => thread.id === openId);
  if (entry && entry !== view.thread) useThreadStore.setState({ view: { ...view, thread: entry } });
  else if (!entry && before.threads.some((thread) => thread.id === openId)) open(null);
});
