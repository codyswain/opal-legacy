import type { AutoThread } from '@/types/auto';
import { fromDigest, nextAfter, putBack, shortUntil, shownOrder, upsertThread } from '../model/listModel';
import { NEW_THREAD } from '../model/pane';
import { autoApi, unconfirmedThreads, useAutoStore } from './autoStore';
import { useSaidStore } from './saidStore';
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
 * has since undone would take the row away a second time.
 */

/** Where the action came from: a row keeps the keyboard in the list, the open thread's header keeps it in the box. */
export type From = 'row' | 'pane';

const UNREACHABLE = "Can't reach Auto.";
const name = (thread: AutoThread): string => thread.title || 'Untitled';

/**
 * Moves on from a thread that is about to leave the list. From its row,
 * focus goes to the row below (the one above, if it was last). If it was
 * open, the next thread opens in its place. Answers whether it was open.
 */
function moveOn(thread: AutoThread, from: From): boolean {
  const auto = useAutoStore.getState();
  const next = nextAfter(shownOrder(auto.threads, auto.snoozedOpen), thread.id);
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

/** Archives a thread; `done` also marks the digest entry it came from as done. */
export async function archiveThread(thread: AutoThread, options: { done?: boolean; from?: From } = {}): Promise<void> {
  const { done = false, from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const earlier = useAutoStore.getState().threads;
  const wasOpen = moveOn(thread, from);
  let kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, archived: true }));
  leave(thread.id);
  const said = useSaidStore.getState();
  const post = api.request({ kind: 'archive', id: thread.id, archived: true, ...(done && fromDigest(thread) ? { done: true } : {}) }).catch((): null => null);
  let undone = false;
  // On offer from the moment the row leaves, while the post is still on its way.
  const offer = said.offer({
    name: name(thread),
    text: done ? 'done' : 'archived',
    subject: thread.id,
    undo: () => {
      undone = true;
      kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, archived: false }));
      comeBack(thread, earlier, wasOpen, from);
      // The archive goes first, then its undoing: the service must not see them the other way round.
      void post.then((result) => {
        if (!result?.success) {
          unconfirmedThreads.end(thread.id, kept);
          return;
        }
        return api.request({ kind: 'archive', id: thread.id, archived: false }).catch((): null => null).then((back) => {
          unconfirmedThreads.end(thread.id, kept);
          if (back?.success) useAutoStore.getState().upsert(back.data.thread);
          else {
            // It is still archived: the row goes again, with why.
            leave(thread.id);
            useSaidStore.getState().refuse(back?.error.message ?? UNREACHABLE, name(thread));
          }
        });
      });
    },
  });
  const result = await post;
  // Undone meanwhile: the undo ends what it kept, once its own post has landed.
  if (undone) return;
  unconfirmedThreads.end(thread.id, kept);
  if (result?.success) return;
  said.drop(offer);
  comeBack(thread, earlier, wasOpen, from);
  said.refuse(result?.error.message ?? UNREACHABLE, name(thread));
}

/** Snoozes a thread until a time, or brings it back with null. Snoozing can be undone. */
export async function snoozeThread(thread: AutoThread, until: number | null, options: { from?: From } = {}): Promise<void> {
  const { from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const said = useSaidStore.getState();
  const earlier = useAutoStore.getState().threads;
  const hiding = until !== null && thread.snoozed === null;
  const wasOpen = hiding ? moveOn(thread, from) : false;
  let kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, snoozed: until }));
  useAutoStore.getState().upsert({ ...thread, snoozed: until });
  // An older line about this thread, such as "until Friday", no longer holds.
  said.dropSubject(thread.id);
  const post = api.request({ kind: 'snooze', id: thread.id, until }).catch((): null => null);
  let undone = false;
  let offer = 0;
  if (until !== null) {
    // Undo gives it the time it had, or brings it back if it had none.
    const before = thread.snoozed !== null && thread.snoozed * 1000 > Date.now() ? thread.snoozed : null;
    offer = said.offer({
      name: name(thread),
      text: `until ${shortUntil(until, Date.now())}`,
      subject: thread.id,
      undo: () => {
        undone = true;
        kept = unconfirmedThreads.keep(thread.id, (now) => ({ ...now, snoozed: before }));
        useAutoStore.getState().upsert({ ...thread, snoozed: before });
        if (hiding) comeBack({ ...thread, snoozed: before }, earlier, wasOpen, from);
        void post.then((result) => {
          if (!result?.success) {
            unconfirmedThreads.end(thread.id, kept);
            return;
          }
          return api.request({ kind: 'snooze', id: thread.id, until: before }).catch((): null => null).then((back) => {
            unconfirmedThreads.end(thread.id, kept);
            if (back?.success) useAutoStore.getState().upsert(back.data.thread);
            else {
              useAutoStore.getState().upsert({ ...thread, snoozed: until });
              useSaidStore.getState().refuse(back?.error.message ?? UNREACHABLE, name(thread));
            }
          });
        });
      },
    });
  } else if (from === 'row') {
    // Brought back, it is a row of the list again: the keyboard goes with it.
    useAutoStore.getState().requestFocus(thread.id);
  }
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
