import type { AutoThread } from '@/types/auto';
import { isWaitingOnReply, lower, returns, waitLine } from '../model/awayModel';
import { nextAfter, putBack, shownOrder, upsertThread } from '../model/listModel';
import { NEW_THREAD } from '../model/pane';
import { autoApi, heldPlaces, unconfirmedThreads, useAutoStore } from './autoStore';
import { useDigestStore } from './digestStore';
import { UNDO_MS, useSaidStore } from './saidStore';
import { useThreadStore } from './threadStore';

/*
 * What he does to a thread from its row or from its header: archive, done,
 * snooze, and an answer picked on its row. The row changes at once and the
 * action is on offer to be undone from that moment; the post follows. Undo
 * shows the thread again at once, and takes the action back at the service
 * as soon as the action itself has reached it. If the service refuses, the
 * row comes back with the service's sentence and the offer goes. Until the
 * posts have landed, what he did holds against whatever the service says of
 * the thread meanwhile (`unconfirmedThreads`): its own word of an archive he
 * has since undone would take the row away a second time. A put-away says
 * what it did in the phone's words: "Snoozed until tomorrow 9:00 am.",
 * "Waiting on a reply until Tue 5:00 pm.", "Archived: Seed order", and
 * "Back in the list." for what is brought back.
 */

/** Where the action came from: a row keeps the keyboard in the list, the open thread's header keeps it in the box. */
export type From = 'row' | 'pane';

const UNREACHABLE = "Can't reach Auto.";
/** What the line says of anything brought back: a snoozed thread, a waiting one, an archived one. */
export const BACK = 'Back in the list.';
const name = (thread: AutoThread): string => thread.title || 'Untitled';

/**
 * A thread just put on a wait says "Waiting on a reply". Once Auto has named
 * the conversation, the line says who it waits on, with the same way back.
 * It stops when the line has gone, or the thread came back with a question.
 */
function sayWhoOnceFound(id: string, offer: number): void {
  let stop = (): void => undefined;
  const timer = setTimeout(() => stop(), UNDO_MS);
  const look = (threads: readonly AutoThread[]) => {
    const now = threads.find((candidate) => candidate.id === id);
    const onLine = useSaidStore.getState().stack.some((each) => each.id === offer);
    const found = onLine && now && isWaitingOnReply(now) && now.wait?.state === 'watching';
    // Still looking: the line stays as it is. Anything else ends the watch.
    if (onLine && now && isWaitingOnReply(now) && !found) return;
    if (found) useSaidStore.getState().reword(offer, `${waitLine(now, Date.now())}.`);
    stop();
  };
  const unsubscribe = useAutoStore.subscribe((state, before) => {
    if (state.threads !== before.threads) look(state.threads);
  });
  stop = () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

/**
 * Moves on from a thread that is about to leave the list. From its row,
 * focus goes to the row below (the one above, if it was last). If it was
 * open, the next thread opens in its place. Answers whether it was open.
 */
function moveOn(thread: AutoThread, from: From): boolean {
  const auto = useAutoStore.getState();
  const next = nextAfter(shownOrder(auto.threads, { waiting: auto.waitingOpen, snoozed: auto.snoozedOpen }), thread.id);
  const pane = useThreadStore.getState();
  const wasOpen = pane.openId === thread.id;
  if (wasOpen) pane.open(next, { focus: from === 'pane' });
  if (from === 'row') auto.requestFocus(next ?? NEW_THREAD);
  return wasOpen;
}

/** Shows a thread again where it was, and opens it again if it was open. */
function comeBack(thread: AutoThread, earlier: readonly AutoThread[], wasOpen: boolean, from: From): void {
  const now = useAutoStore.getState().threads;
  const there = now.some((candidate) => candidate.id === thread.id);
  useAutoStore.setState({ threads: there ? upsertThread(now, thread) : putBack(now, earlier, thread) });
  if (wasOpen) useThreadStore.getState().open(thread.id, { focus: from === 'pane' });
  if (from === 'row') useAutoStore.getState().requestFocus(thread.id);
}

const leave = (id: string) => useAutoStore.setState({ threads: useAutoStore.getState().threads.filter((candidate) => candidate.id !== id) });

/** The thread that sat under this one in his order and is still in the list, or null when it was last. */
function satAbove(thread: AutoThread, earlier: readonly AutoThread[]): string | null {
  const here = new Set(useAutoStore.getState().threads.map((candidate) => candidate.id));
  const after = earlier.slice(earlier.findIndex((candidate) => candidate.id === thread.id) + 1);
  return after.find((candidate) => candidate.id !== thread.id && here.has(candidate.id))?.id ?? null;
}

/** Archives a thread; `done` also marks the digest entry it came from as done. */
export async function archiveThread(thread: AutoThread, options: { done?: boolean; from?: From } = {}): Promise<void> {
  const { done = false, from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const auto = useAutoStore.getState();
  const earlier = auto.threads;
  const entry = done ? thread.digest : null;
  const wasOpen = moveOn(thread, from);
  let kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, archived: true }));
  leave(thread.id);
  // The archive, once read, shows it at once. Archiving ends the Mac mark and a wait, as the service does.
  auto.archiveChanged({ ...thread, archived: true, archivedAt: Date.now() / 1000, desk: null, snoozed: null, snoozedAt: null, wait: null });
  const said = useSaidStore.getState();
  // Done also resolves the entry. Whether it was open before is read first, so Undo can open it again.
  const before = entry ? useDigestStore.getState().entryState(entry.date, entry.id) : Promise.resolve(null);
  const post = before.then(() => api.request({ kind: 'archive', id: thread.id, archived: true, ...(entry ? { done: true } : {}) }).catch((): null => null));
  let undone = false;
  // On offer from the moment the row leaves, while the post is still on its way.
  const offer = said.offer({
    name: name(thread),
    // The line names what went: a key is easy to land on the wrong row.
    text: done ? 'Done:' : 'Archived:',
    whole: true,
    subject: thread.id,
    undo: () => {
      undone = true;
      // Back as it was, the Mac mark included: archiving took the mark off, and the undo sets it again.
      kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, archived: false, archivedAt: null, ...(thread.desk ? { desk: thread.desk } : {}) }));
      useAutoStore.getState().archiveChanged({ ...thread, archived: false, archivedAt: null });
      comeBack(thread, earlier, wasOpen, from);
      // The archive goes first, then its undoing: the service must not see them the other way round.
      void post.then(async (result) => {
        if (!result?.success) {
          unconfirmedThreads.end(thread.id, kept);
          return;
        }
        const back = await api.request({ kind: 'archive', id: thread.id, archived: false }).catch((): null => null);
        if (!back?.success) {
          unconfirmedThreads.end(thread.id, kept);
          // It is still archived: the row goes again, with why.
          leave(thread.id);
          useAutoStore.getState().archiveChanged({ ...thread, archived: true, archivedAt: Date.now() / 1000 });
          useSaidStore.getState().refuse(back?.error.message ?? UNREACHABLE, name(thread));
          return;
        }
        // The mark is kept on the row until the service has it again, so the row never leaves its group.
        const marked = thread.desk ? await api.request({ kind: 'desk', id: thread.id, on: true }).catch((): null => null) : null;
        unconfirmedThreads.end(thread.id, kept);
        useAutoStore.getState().upsert(marked?.success ? marked.data.thread : back.data.thread);
        // Done ticked its entry: an entry that was open before is open again.
        if (entry && (await before) !== 'resolved') {
          const reopened = await api.request({ kind: 'digest-resolve', date: entry.date, ids: [entry.id], resolved: false }).catch((): null => null);
          if (reopened?.success) useDigestStore.getState().take(reopened.data);
          else useSaidStore.getState().refuse(reopened?.error.message ?? UNREACHABLE, name(thread));
        }
      });
    },
  });
  const result = await post;
  // Undone meanwhile: the undo ends what it kept, once its own post has landed.
  if (undone) return;
  unconfirmedThreads.end(thread.id, kept);
  if (result?.success) return;
  said.drop(offer);
  useAutoStore.getState().archiveChanged({ ...thread, archived: false, archivedAt: null });
  comeBack(thread, earlier, wasOpen, from);
  said.refuse(result?.error.message ?? UNREACHABLE, name(thread));
}

/**
 * Brings an archived thread back into the list. It shows on top at once;
 * the service's order then puts it where it sat. It can be undone like any
 * action, which archives it again.
 */
export async function restoreThread(thread: AutoThread, options: { from?: From } = {}): Promise<void> {
  const { from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const back: AutoThread = { ...thread, archived: false, archivedAt: null };
  const gone: AutoThread = { ...thread, archived: true, archivedAt: thread.archivedAt ?? Date.now() / 1000 };
  let kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, archived: false, archivedAt: null }));
  useAutoStore.getState().upsert(back);
  if (from === 'row') useAutoStore.getState().requestFocus(thread.id);
  const said = useSaidStore.getState();
  said.dropSubject(thread.id);
  const post = api.request({ kind: 'archive', id: thread.id, archived: false }).catch((): null => null);
  /** Back in the archive, and still open in the pane if he was reading it. */
  const putAway = () => {
    const wasOpen = useThreadStore.getState().openId === thread.id;
    leave(thread.id);
    useAutoStore.getState().archiveChanged(gone);
    if (wasOpen) useThreadStore.getState().open(thread.id, { focus: false });
  };
  let undone = false;
  const offer = said.offer({
    name: name(thread),
    text: BACK,
    whole: true,
    subject: thread.id,
    undo: () => {
      undone = true;
      kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, archived: true, archivedAt: gone.archivedAt }));
      putAway();
      void post.then(async (result) => {
        if (!result?.success) {
          unconfirmedThreads.end(thread.id, kept);
          return;
        }
        const again = await api.request({ kind: 'archive', id: thread.id, archived: true }).catch((): null => null);
        unconfirmedThreads.end(thread.id, kept);
        if (again?.success) useAutoStore.getState().upsert(again.data.thread);
        else {
          useAutoStore.getState().upsert(back);
          useSaidStore.getState().refuse(again?.error.message ?? UNREACHABLE, name(thread));
        }
      });
    },
  });
  const result = await post;
  if (undone) return;
  unconfirmedThreads.end(thread.id, kept);
  if (result?.success) {
    useAutoStore.getState().upsert(result.data.thread);
    return;
  }
  said.drop(offer);
  putAway();
  said.refuse(result?.error.message ?? UNREACHABLE, name(thread));
}

/**
 * Snoozes a thread until a time, or brings it back with null. With `wait`
 * it is put away until someone replies: `say` is who or what he waits for,
 * in his words, and `until` is when the wait gives up. Snoozing can be
 * undone, which also puts the thread back where it sat in his order.
 * Bringing back can be undone too, which puts it away again as it was.
 */
export async function snoozeThread(thread: AutoThread, until: number | null, options: { from?: From; wait?: { say: string } } = {}): Promise<void> {
  const { from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const say = until !== null ? options.wait?.say.trim() ?? '' : '';
  const said = useSaidStore.getState();
  const earlier = useAutoStore.getState().threads;
  const hiding = until !== null && thread.snoozed === null;
  const wasOpen = hiding ? moveOn(thread, from) : false;
  const now = Date.now();
  // As the service will have it: put away now, and, with a wait, still finding the conversation.
  const away: AutoThread = {
    ...thread,
    snoozed: until,
    snoozedAt: until === null ? null : now / 1000,
    woke: until === null ? thread.woke : null,
    wait: say ? { say, state: 'finding', on: '', what: '', where: '', link: '', check: '', since: now / 1000, expires: until, heard: '', reply: '' } : null,
  };
  let kept = unconfirmedThreads.keep(thread.id, (held) => ({ ...held, snoozed: until, ...(until === null ? { wait: null } : {}) }));
  useAutoStore.getState().upsert(away);
  // An older line about this thread, such as "until Friday", no longer holds.
  said.dropSubject(thread.id);
  const post = api.request({ kind: 'snooze', id: thread.id, until, ...(say ? { wait: { say } } : {}) }).catch((): null => null);
  let undone = false;
  let offer = 0;
  if (until !== null) {
    // Undo gives it the time it had, or brings it back if it had none.
    const before = thread.snoozed !== null && thread.snoozed * 1000 > now ? thread.snoozed : null;
    const sat = satAbove(thread, earlier);
    offer = said.offer({
      name: name(thread),
      text: `${say ? 'Waiting on a reply' : 'Snoozed'} until ${lower(returns(until, now))}.`,
      whole: true,
      subject: thread.id,
      undo: () => {
        undone = true;
        kept = unconfirmedThreads.keep(thread.id, (held) => ({ ...held, snoozed: before, ...(before === null ? { wait: null } : {}) }));
        // The service puts a thread brought back on top of his order. Undone, it stays where it sat.
        if (hiding) heldPlaces.set(thread.id, sat);
        const back = before === null ? { ...thread, snoozed: null, snoozedAt: null } : thread;
        useAutoStore.getState().upsert(back);
        if (hiding) comeBack(back, earlier, wasOpen, from);
        void post.then(async (result) => {
          if (!result?.success) {
            unconfirmedThreads.end(thread.id, kept);
            heldPlaces.delete(thread.id);
            return;
          }
          const returned = await api.request({ kind: 'snooze', id: thread.id, until: before }).catch((): null => null);
          unconfirmedThreads.end(thread.id, kept);
          if (!returned?.success) {
            heldPlaces.delete(thread.id);
            useAutoStore.getState().upsert(away);
            useSaidStore.getState().refuse(returned?.error.message ?? UNREACHABLE, name(thread));
            return;
          }
          useAutoStore.getState().upsert(returned.data.thread);
          // The move says so to the service; until it has landed the row is held in its place here.
          if (hiding) await useAutoStore.getState().move(thread.id, sat).finally(() => heldPlaces.delete(thread.id));
        });
      },
    });
  } else {
    // Brought back, it is a row of the list again: the keyboard goes with it.
    if (from === 'row') useAutoStore.getState().requestFocus(thread.id);
    // It can be put away again as it was: to its time, or on its wait in the words he gave for it.
    const again = thread.snoozed !== null && thread.snoozed * 1000 > now ? thread.snoozed : null;
    const waited = isWaitingOnReply(thread);
    const words = waited ? thread.wait?.say.trim() ?? '' : '';
    if (again !== null && (!waited || words)) {
      const back: AutoThread = { ...thread, snoozed: null, snoozedAt: null, wait: null };
      offer = said.offer({
        name: name(thread),
        text: BACK,
        whole: true,
        subject: thread.id,
        undo: () => {
          undone = true;
          kept = unconfirmedThreads.keep(thread.id, (held) => ({ ...held, snoozed: again, snoozedAt: held.snoozedAt ?? thread.snoozedAt, wait: held.wait ?? thread.wait }));
          useAutoStore.getState().upsert(thread);
          void post.then(async (result) => {
            if (!result?.success) {
              unconfirmedThreads.end(thread.id, kept);
              return;
            }
            const put = await api.request({ kind: 'snooze', id: thread.id, until: again, ...(words ? { wait: { say: words } } : {}) }).catch((): null => null);
            unconfirmedThreads.end(thread.id, kept);
            if (put?.success) useAutoStore.getState().upsert(put.data.thread);
            else {
              useAutoStore.getState().upsert(back);
              useSaidStore.getState().refuse(put?.error.message ?? UNREACHABLE, name(thread));
            }
          });
        },
      });
    }
  }
  // Auto names the conversation in a turn of the thread: the line then says who he waits on.
  if (say && offer) sayWhoOnceFound(thread.id, offer);
  const result = await post;
  // Undone meanwhile: the undo ends what it kept, once its own post has landed.
  if (undone) return;
  unconfirmedThreads.end(thread.id, kept);
  if (result?.success) {
    useAutoStore.getState().upsert(result.data.thread);
    return;
  }
  said.drop(offer);
  useAutoStore.getState().upsert(thread);
  if (hiding) comeBack(thread, earlier, wasOpen, from);
  said.refuse(result?.error.message ?? UNREACHABLE, name(thread));
}

/** How long an answer picked on a row is held before it is posted, so it can be taken back, in ms. */
export const HOLD_MS = 4_000;
/** The hold as it is now. Tests shorten it. */
export const hold = { ms: HOLD_MS };

/**
 * An option picked on a waiting row, by a click or by its number. It is
 * held for a few seconds with Undo before it is posted, as on the phone: a
 * row is easy to hit by mistake, and an answer cannot be taken back once
 * Auto has it. The row shows the pick meanwhile.
 */
export function answerFromRow(thread: AutoThread, label: string): void {
  const api = autoApi();
  const ask = thread.ask;
  if (!api || !ask?.question || ask.kind !== 'ask' || !ask.options.includes(label)) return;
  const auto = useAutoStore.getState();
  if (auto.held[thread.id] !== undefined) return;
  const question = ask.question;
  const address = auto.address;
  const release = () => {
    const held = { ...useAutoStore.getState().held };
    delete held[thread.id];
    useAutoStore.setState({ held });
  };
  useAutoStore.setState({ held: { ...auto.held, [thread.id]: label } });
  // The button that was clicked has gone with the pick: the keyboard stays on the row.
  auto.requestFocus(thread.id);
  let offer = 0;
  const timer = setTimeout(() => {
    useSaidStore.getState().drop(offer);
    // The address changed while it was held: the answer was meant for another service.
    if (useAutoStore.getState().address !== address) {
      release();
      return;
    }
    void api.request({ kind: 'answer', id: thread.id, answer: { id: ask.id, answers: { [question]: label } } }).catch((): null => null).then((result) => {
      release();
      if (!result?.success) useSaidStore.getState().refuse(result?.error.message ?? UNREACHABLE, name(thread));
    });
  }, hold.ms);
  offer = useSaidStore.getState().offer({
    name: name(thread),
    text: label,
    subject: thread.id,
    lasts: hold.ms,
    undo: () => {
      clearTimeout(timer);
      release();
      useAutoStore.getState().requestFocus(thread.id);
    },
  });
}
