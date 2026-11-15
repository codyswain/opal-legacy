import { create } from 'zustand';

/*
 * What his last actions did, each with the way back from it. An action is
 * on offer from the moment its row or entry leaves, not from the service's
 * answer, and stays for half a minute. The last ten are kept: the line at
 * the foot of the list shows the newest and says how many more there are,
 * and Undo takes them back newest first. A put-away says what it did in the
 * phone's sentence ("Snoozed until tomorrow 9:00 am.", "Archived: Seed
 * order"). A refusal from the service is one line of its own, with nothing
 * to undo. Auto's actions say what they did here, never in the app's corner.
 */

export interface Said {
  id: number;
  /** The thread or entry it happened to: first on the line, so a long one is cut, not left out. */
  name: string;
  /** What happened, short: "resolved", "made a thread". For a put-away, the phone's own sentence. */
  text: string;
  /**
   * The text is a sentence of its own and comes first, whole: "Snoozed until
   * tomorrow 9:00 am.", or "Archived:" with the name after it.
   */
  whole: boolean;
  /** What it happened to, so a later action on the same thing can take the line away. */
  subject: string;
  /** The way back, when there is one. */
  undo: (() => void) | null;
  /** A way on to what was made, when something was. */
  open: (() => void) | null;
  /** The service refused: its sentence is the text, and there is nothing to undo. */
  problem: boolean;
  /** When it goes, in ms. */
  until: number;
}

/** How long an action can be taken back, in ms. */
export const UNDO_MS = 30_000;
/** How long a refusal's sentence stays, in ms. */
export const NOTICE_MS = 6_000;
/** How many actions back Undo reaches. */
export const UNDO_DEPTH = 10;

export interface SaidStore {
  /** The actions that can still be taken back, the newest last. */
  stack: Said[];
  /** The service's sentence for something that did not happen. */
  notice: Said | null;

  /**
   * Puts an action on offer and answers its id. `lasts` is for one that
   * can be taken back for less than the usual time, such as an answer held
   * a few seconds before it is posted.
   */
  offer: (action: { name: string; text: string; whole?: boolean; subject?: string; undo?: () => void; open?: () => void; lasts?: number }) => number;
  /** Says an offer still on the line in other words, and gives it its time again: a wait, once Auto has named who it is on. */
  reword: (id: number, text: string) => void;
  /** Takes an offer away without running it: its post failed, or its time to be taken back is over. */
  drop: (id: number) => void;
  /** Takes away every offer about one thread or entry. */
  dropSubject: (subject: string) => void;
  refuse: (text: string, name?: string) => void;
  clear: () => void;
  /** Takes the newest action back. Answers whether there was one. */
  undo: () => boolean;
  /** Goes on to what the newest action made. Answers whether there was anything to open. */
  open: () => boolean;
}

/** The line that shows: a refusal while it lasts, else the newest action. */
export const selectSaid = (state: Pick<SaidStore, 'stack' | 'notice'>): Said | null => state.notice ?? state.stack[state.stack.length - 1] ?? null;

/** How many more actions Undo can reach behind the one that shows. */
export const selectMore = (state: Pick<SaidStore, 'stack' | 'notice'>): number => (state.notice ? 0 : Math.max(0, state.stack.length - 1));

let count = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useSaidStore = create<SaidStore>((set, get) => {
  /** Drops what has run out, and wakes again when the next one does. */
  const prune = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const now = Date.now();
    const { stack, notice } = get();
    const kept = stack.filter((each) => each.until > now);
    const still = notice && notice.until > now ? notice : null;
    if (kept.length !== stack.length || still !== notice) set({ stack: kept, notice: still });
    const next = Math.min(...kept.map((each) => each.until), still ? still.until : Infinity);
    if (Number.isFinite(next)) timer = setTimeout(prune, Math.max(0, next - now) + 1);
  };

  return {
    stack: [],
    notice: null,

    offer: (action) => {
      count += 1;
      const said: Said = {
        id: count,
        name: action.name,
        text: action.text,
        whole: action.whole ?? false,
        subject: action.subject ?? '',
        undo: action.undo ?? null,
        open: action.open ?? null,
        problem: false,
        until: Date.now() + (action.lasts ?? UNDO_MS),
      };
      // A new action is what he looks at: an older refusal gives way to it.
      set({ stack: [...get().stack, said].slice(-UNDO_DEPTH), notice: null });
      prune();
      return said.id;
    },

    reword: (id, text) => {
      if (!get().stack.some((each) => each.id === id)) return;
      set({ stack: get().stack.map((each) => (each.id === id ? { ...each, text, until: Date.now() + UNDO_MS } : each)) });
      prune();
    },

    drop: (id) => {
      if (!get().stack.some((each) => each.id === id)) return;
      set({ stack: get().stack.filter((each) => each.id !== id) });
      prune();
    },

    dropSubject: (subject) => {
      if (!subject || !get().stack.some((each) => each.subject === subject)) return;
      set({ stack: get().stack.filter((each) => each.subject !== subject) });
      prune();
    },

    refuse: (text, name = '') => {
      count += 1;
      set({ notice: { id: count, name, text, whole: true, subject: '', undo: null, open: null, problem: true, until: Date.now() + NOTICE_MS } });
      prune();
    },

    clear: () => {
      set({ stack: [], notice: null });
      prune();
    },

    undo: () => {
      const stack = get().stack;
      const at = stack.map((each) => each.undo !== null && each.until > Date.now()).lastIndexOf(true);
      if (at === -1) return false;
      const said = stack[at];
      set({ stack: stack.filter((each) => each.id !== said.id), notice: null });
      prune();
      said.undo?.();
      return true;
    },

    open: () => {
      const stack = get().stack;
      const said = stack[stack.length - 1];
      if (!said?.open || get().notice) return false;
      set({ stack: stack.slice(0, -1) });
      prune();
      said.open();
      return true;
    },
  };
});
