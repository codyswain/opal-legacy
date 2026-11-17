import { create } from 'zustand';

/**
 * Which pane has a live editor for which file. A page shows in one place:
 * two editors on one file would each save over the other. A click on a page
 * the other pane shows goes to that pane; every other way in (Back, Forward,
 * a reopened tab, a page in a tab behind the other pane's open one, a day in
 * the stream and the same day opened alone) opens where it is, and this
 * record, at the view, draws the line there in place of a second editor.
 *
 * A pane takes a path when its editor mounts and lets it go when it unmounts.
 * `count` is how many of that pane's editors hold it, so a remount inside one
 * pane never drops the hold. A hand-over leaves a hold of 0 for the receiving
 * pane, which its editor takes up as it mounts.
 */
interface Holder {
  paneId: string;
  count: number;
}

interface LiveEditorsState {
  holders: Record<string, Holder>;
  /** Takes the path for a pane; false while the other pane holds it. */
  take: (path: string, paneId: string) => boolean;
  release: (path: string, paneId: string) => void;
  /** Gives the path to a pane, whoever holds it now ("Show it here"). */
  handOver: (path: string, paneId: string) => void;
}

const without = (holders: Record<string, Holder>, path: string): Record<string, Holder> => {
  const next = { ...holders };
  delete next[path];
  return next;
};

export const useLiveEditors = create<LiveEditorsState>((set, get) => ({
  holders: {},

  take: (path, paneId) => {
    const holder = get().holders[path];
    if (holder && holder.paneId !== paneId) return false;
    set((state) => ({ holders: { ...state.holders, [path]: { paneId, count: (holder?.count ?? 0) + 1 } } }));
    return true;
  },

  release: (path, paneId) =>
    set((state) => {
      const holder = state.holders[path];
      if (!holder || holder.paneId !== paneId) return {};
      return {
        holders: holder.count > 1 ? { ...state.holders, [path]: { paneId, count: holder.count - 1 } } : without(state.holders, path),
      };
    }),

  handOver: (path, paneId) => set((state) => ({ holders: { ...state.holders, [path]: { paneId, count: 0 } } })),
}));

/** The pane holding a path's live editor, if any. */
export function liveEditorPane(path: string): string | null {
  return useLiveEditors.getState().holders[path]?.paneId ?? null;
}
