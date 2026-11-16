import { AWAY, DIGEST_QUEUE, paneThread } from './model/pane';
import { useAutoStore } from './store/autoStore';
import { useThreadStore } from './store/threadStore';

/**
 * The Auto tab's name, after what it shows: the open thread's title,
 * "Digest", "Put away" or "New thread". "Auto" while it shows the address form or
 * Auto cannot be read.
 */
export function useAutoTabName(): string {
  const openId = useThreadStore((state) => state.openId);
  const viewTitle = useThreadStore((state) => (state.view && state.view.thread.id === paneThread(state.openId) ? state.view.thread.title : null));
  const entryTitle = useAutoStore((state) => {
    const id = paneThread(openId);
    if (!id) return null;
    return (state.threads.find((thread) => thread.id === id) ?? state.archive.threads.find((thread) => thread.id === id))?.title ?? null;
  });
  const form = useAutoStore((state) => !state.configured || !state.address || state.editing || !state.loaded);
  if (form) return 'Auto';
  if (openId === DIGEST_QUEUE) return 'Digest';
  if (openId === AWAY) return 'Put away';
  if (paneThread(openId) === null) return 'New thread';
  const title = entryTitle ?? viewTitle;
  return title === null ? 'Auto' : title || 'Untitled';
}
