import type { AutoThread } from '@/types/auto';
import { fromDigest, nextAfter, putBack, returnTime, shownOrder, upsertThread } from '../model/listModel';
import { NEW_THREAD } from '../model/pane';
import { autoApi, useAutoStore } from './autoStore';
import { useSaidStore } from './saidStore';
import { useThreadStore } from './threadStore';

/*
 * What he does to a thread from its row or from its header: archive, done
 * and snooze. The row leaves at once and the next thread takes its place;
 * the post follows. If the service refuses, the row comes back with the
 * service's sentence. Undo puts the thread back and opens it again.
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

/** Archives a thread; `done` also marks the digest entry it came from as done. */
export async function archiveThread(thread: AutoThread, options: { done?: boolean; from?: From } = {}): Promise<void> {
  const { done = false, from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const earlier = useAutoStore.getState().threads;
  const wasOpen = moveOn(thread, from);
  useAutoStore.setState({ threads: earlier.filter((candidate) => candidate.id !== thread.id) });
  const said = useSaidStore.getState();
  const result = await api.request({ kind: 'archive', id: thread.id, archived: true, ...(done && fromDigest(thread) ? { done: true } : {}) }).catch((): null => null);
  if (!result?.success) {
    comeBack(thread, earlier, wasOpen, from);
    said.refuse(result?.error.message ?? UNREACHABLE, name(thread));
    return;
  }
  said.say({
    text: done ? 'Done' : 'Archived',
    name: name(thread),
    undo: () => {
      comeBack(thread, earlier, wasOpen, from);
      void api.request({ kind: 'archive', id: thread.id, archived: false }).catch((): null => null).then((undone) => {
        if (undone?.success) useAutoStore.getState().upsert(undone.data.thread);
        else {
          // It is still archived: the row goes again, with why.
          useAutoStore.setState({ threads: useAutoStore.getState().threads.filter((candidate) => candidate.id !== thread.id) });
          useSaidStore.getState().refuse(undone?.error.message ?? UNREACHABLE, name(thread));
        }
      });
    },
  });
}

/** Snoozes a thread until a time, or brings it back with null. Snoozing can be undone. */
export async function snoozeThread(thread: AutoThread, until: number | null, options: { from?: From } = {}): Promise<void> {
  const { from = 'row' } = options;
  const api = autoApi();
  if (!api) return;
  const earlier = useAutoStore.getState().threads;
  const hiding = until !== null && thread.snoozed === null;
  const wasOpen = hiding ? moveOn(thread, from) : false;
  useAutoStore.getState().upsert({ ...thread, snoozed: until });
  const result = await api.request({ kind: 'snooze', id: thread.id, until }).catch((): null => null);
  if (!result?.success) {
    useAutoStore.getState().upsert(thread);
    if (hiding) comeBack(thread, earlier, wasOpen, from);
    useSaidStore.getState().refuse(result?.error.message ?? UNREACHABLE, name(thread));
    return;
  }
  useAutoStore.getState().upsert(result.data.thread);
  if (until === null) return;
  // Undo gives it the time it had, or brings it back if it had none.
  const before = thread.snoozed !== null && thread.snoozed * 1000 > Date.now() ? thread.snoozed : null;
  useSaidStore.getState().say({
    text: `Snoozed until ${returnTime(until, Date.now())}`,
    name: name(thread),
    undo: () => {
      void api.request({ kind: 'snooze', id: thread.id, until: before }).catch((): null => null).then((undone) => {
        if (!undone?.success) {
          useSaidStore.getState().refuse(undone?.error.message ?? UNREACHABLE, name(thread));
          return;
        }
        useAutoStore.getState().upsert(undone.data.thread);
        if (wasOpen) useThreadStore.getState().open(thread.id, { focus: from === 'pane' });
        if (from === 'row') useAutoStore.getState().requestFocus(thread.id);
      });
    },
  });
}
