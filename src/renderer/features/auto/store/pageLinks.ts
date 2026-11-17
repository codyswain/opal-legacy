import * as React from 'react';
import { create } from 'zustand';
import type { AutoAPI, FolderUpdateOutcome } from '@/types/auto';

/*
 * What the page knows of the pages a reply links to: each one's first
 * heading, read once per path from the main process, and asked again after
 * the opened folders were brought up to date. Bringing them up to date is
 * the main process's work: the page only asks, with no arguments, and hears
 * one word back.
 */

const api = (): AutoAPI | undefined => (typeof window !== 'undefined' ? window.autoAPI : undefined);

interface PageLinksStore {
  /** Each page path's first heading as last read: null when it has none or is not on this Mac. */
  titles: Record<string, string | null>;
  /** Goes up each time a checkout moved forward, so each heading is read again. */
  generation: number;
}

export const usePageLinksStore = create<PageLinksStore>(() => ({ titles: {}, generation: 0 }));

/** The generation each path was last asked in. */
const asked = new Map<string, number>();

/** Reads a page's heading, once per path and generation. */
export function askTitle(path: string): void {
  const { generation } = usePageLinksStore.getState();
  if (asked.get(path) === generation) return;
  asked.set(path, generation);
  void api()
    ?.resolvePage(path)
    .then(
      (result) => {
        if (usePageLinksStore.getState().generation !== generation) return;
        const title = result.success ? result.data.title ?? null : null;
        usePageLinksStore.setState((state) => ({ titles: { ...state.titles, [path]: title } }));
      },
      () => undefined
    );
}

/** A page's first heading, null until it has been read or when it has none. Null for no path. */
export function usePageTitle(path: string | null): string | null {
  const generation = usePageLinksStore((state) => state.generation);
  const title = usePageLinksStore((state) => (path ? state.titles[path] ?? null : null));
  React.useEffect(() => {
    if (path) askTitle(path);
  }, [path, generation]);
  return title;
}

/**
 * Asks the main process to bring the opened folders up to date, only when an
 * address is set. Answers what happened; after an update every heading is
 * read again.
 */
export async function updateFolders(address: string | null): Promise<FolderUpdateOutcome> {
  if (!address) return 'none';
  const result = await api()?.updateFolders().catch((): null => null);
  const outcome: FolderUpdateOutcome = result?.success ? result.data : 'none';
  if (outcome === 'updated') usePageLinksStore.setState((state) => ({ generation: state.generation + 1 }));
  return outcome;
}

/** Turn ends that arrive within this time of each other are one ask. */
export const TURN_END_SETTLE_MS = 500;
let turnEndTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A thread's turn has ended: the files its reply names may be on the remote
 * now. A burst of ends asks once; the main process keeps to one run at a time
 * and ten seconds between runs as well.
 */
export function turnEnded(address: () => string | null): void {
  if (turnEndTimer) clearTimeout(turnEndTimer);
  turnEndTimer = setTimeout(() => {
    turnEndTimer = null;
    void updateFolders(address());
  }, TURN_END_SETTLE_MS);
}

/** For tests: forgets every heading and any ask still waiting. */
export function resetPageLinks(): void {
  if (turnEndTimer) clearTimeout(turnEndTimer);
  turnEndTimer = null;
  asked.clear();
  usePageLinksStore.setState({ titles: {}, generation: 0 });
}
