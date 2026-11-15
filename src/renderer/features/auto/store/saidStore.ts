import { create } from 'zustand';

/*
 * One line that says what the last action did, with the way back from it.
 * It sits at the foot of the list, names the thread or entry, and goes
 * after a few seconds. One at a time: a newer one takes the older one's
 * place. Auto's actions say what they did here, never in the app's corner.
 */

export interface Said {
  id: number;
  /** What happened: "Archived", "Snoozed until tomorrow at 8:00 am", "Resolved". */
  text: string;
  /** The thread or entry it happened to. */
  name: string;
  /** The way back, when there is one. */
  undo: (() => void) | null;
  /** A way on to what was made, when something was. */
  open: (() => void) | null;
  /** The service refused: its sentence is the text, and there is nothing to undo. */
  problem: boolean;
}

/** How long a line stays, in ms. */
export const SAID_MS = 6_000;

export interface SaidStore {
  said: Said | null;
  say: (said: Partial<Omit<Said, 'id' | 'text'>> & { text: string }) => void;
  /** The service's sentence for something that did not happen. */
  refuse: (text: string, name?: string) => void;
  clear: () => void;
  /** Takes the last action back, if it can be. Answers whether there was one. */
  undo: () => boolean;
  /** Goes on to what the last action made. */
  open: () => void;
}

let count = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useSaidStore = create<SaidStore>((set, get) => {
  const show = (said: Said) => {
    if (timer) clearTimeout(timer);
    set({ said });
    timer = setTimeout(() => {
      if (get().said?.id === said.id) set({ said: null });
    }, SAID_MS);
  };
  const take = (): Said | null => {
    const said = get().said;
    if (timer) clearTimeout(timer);
    timer = null;
    set({ said: null });
    return said;
  };
  return {
    said: null,
    say: (said) => {
      count += 1;
      show({ id: count, name: '', undo: null, open: null, problem: false, ...said });
    },
    refuse: (text, name = '') => get().say({ text, name, problem: true }),
    clear: () => void take(),
    undo: () => {
      if (!get().said?.undo) return false;
      take()?.undo?.();
      return true;
    },
    open: () => take()?.open?.(),
  };
});
