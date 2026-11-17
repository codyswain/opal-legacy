import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AUTO_COLLECTION, fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  allTabs,
  removePathsFromTabsState,
  selectOpenedPath,
  selectPaneTab,
  tabFile,
  useTabsStore,
  type TabsStore,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { MIN_PANE_COLUMN, fitsTwoPanes, leftPaneWidth, splitFor } from '@/renderer/features/disk-explorer/panes/paneLayout';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import { openTabs, resetTabs } from '@/tests/helpers/tabs';

const A = '/V/a.md';
const B = '/V/b.md';
const C = '/V/c.md';
const AUTO = { mode: 'browse', collection: AUTO_COLLECTION } as const;

beforeEach(() => {
  window.localStorage.clear();
  resetTabs();
});

const state = () => useTabsStore.getState();
const open = (path: string, options: { newTab?: boolean; side?: boolean } = {}) => state().open(fileLocation(path), options);
/** The files of each pane's tabs, left pane first. */
const panePaths = () => state().panes.map((pane) => pane.tabs.map(tabFile));
const paneOpen = (index: number) => {
  const pane = state().panes[index];
  return pane ? (selectPaneTab(state(), pane.id) ? tabFile(selectPaneTab(state(), pane.id)!) : null) : undefined;
};
const activePaneIndex = () => state().panes.findIndex((pane) => pane.id === state().activePaneId);

describe('two panes', () => {
  it('starts with one pane, and Split right opens an empty pane at the right and makes it active', () => {
    openTabs([A, B]);
    expect(state().panes).toHaveLength(1);
    state().splitRight();
    expect(panePaths()).toEqual([[A, B], []]);
    expect(activePaneIndex()).toBe(1);
    // The active pane's view of the store: no tab open.
    expect(state().tabs).toEqual([]);
    expect(state().activeId).toBeNull();
  });

  it('opens in the active pane, and the old selectors read the active pane', () => {
    openTabs([A]);
    state().splitRight();
    open(B);
    expect(panePaths()).toEqual([[A], [B]]);
    expect(selectOpenedPath(state())).toBe(B);
    state().focusOtherPane();
    expect(selectOpenedPath(state())).toBe(A);
    expect(state().tabs.map(tabFile)).toEqual([A]);
  });

  it('with two panes, Split right makes the other one active', () => {
    openTabs([A]);
    state().splitRight();
    state().splitRight();
    expect(state().panes).toHaveLength(2);
    expect(activePaneIndex()).toBe(0);
  });

  it('activating a tab of the other pane makes its pane active', () => {
    openTabs([A]);
    state().splitRight();
    open(B);
    const left = state().panes[0].tabs[0];
    state().activate(left.id);
    expect(activePaneIndex()).toBe(0);
    expect(selectOpenedPath(state())).toBe(A);
  });

  it('an open of the page the other pane shows goes to that pane', () => {
    openTabs([A, B], 0);
    state().splitRight();
    open(C);
    open(A);
    expect(panePaths()).toEqual([[A, B], [C]]);
    expect(activePaneIndex()).toBe(0);
    expect(paneOpen(0)).toBe(A);
    // Also for a new tab.
    state().focusOtherPane();
    open(A, { newTab: true });
    expect(panePaths()).toEqual([[A, B], [C]]);
    expect(activePaneIndex()).toBe(0);
  });

  it('a page in a tab behind the other pane’s open one opens here', () => {
    openTabs([A, B], 0);
    state().splitRight();
    open(C);
    // Right: C. Left: A open, B behind it. B opens at the right; the left does not change.
    open(B);
    expect(panePaths()).toEqual([[A, B], [B]]);
    expect(activePaneIndex()).toBe(1);
    expect(paneOpen(0)).toBe(A);
    expect(paneOpen(1)).toBe(B);
  });

  it('keeps the one Auto tab one tab, in either pane', () => {
    openTabs([A]);
    state().open(AUTO, { newTab: true });
    state().moveToPane(state().activeId!);
    expect(state().panes[1].tabs.map((tab) => tab.history[0].location)).toEqual([AUTO]);
    state().focusOtherPane();
    state().open(AUTO, { newTab: true });
    expect(allTabs(state())).toHaveLength(2);
    expect(activePaneIndex()).toBe(1);
  });

  it('closing a pane’s last tab closes the pane, and the other takes the whole width', () => {
    openTabs([A, B]);
    state().splitRight();
    open(C);
    state().close(state().activeId!);
    expect(state().panes).toHaveLength(1);
    expect(panePaths()).toEqual([[A, B]]);
    expect(selectOpenedPath(state())).toBe(A);
  });

  it('a single pane left with no tab stays, empty', () => {
    openTabs([A]);
    state().close(state().activeId!);
    expect(state().panes).toHaveLength(1);
    expect(state().tabs).toEqual([]);
  });

  it('Close pane closes a pane with its tabs, and they reopen where they were while the pane exists', () => {
    openTabs([A]);
    state().splitRight();
    open(B);
    open(C, { newTab: true });
    const right = state().panes[1].id;
    state().close(state().panes[1].tabs[1].id);
    expect(state().reopenClosed()).toBe(true);
    expect(state().panes[1].tabs.map(tabFile)).toEqual([B, C]);
    expect(state().activePaneId).toBe(right);
    state().closePane(right);
    expect(panePaths()).toEqual([[A]]);
    // The pane is gone, so they come back in the active one, at the place they had.
    state().reopenClosed();
    expect(panePaths()).toEqual([[B, A]]);
  });

  it('does not close the only pane', () => {
    openTabs([A]);
    state().closePane(state().activePaneId);
    expect(panePaths()).toEqual([[A]]);
  });
});

describe('moving a tab to the other pane', () => {
  it('splits with one pane, and the tab and its pane become active', () => {
    openTabs([A, B], 1);
    state().moveToPane(state().activeId!);
    expect(panePaths()).toEqual([[A], [B]]);
    expect(activePaneIndex()).toBe(1);
    expect(paneOpen(0)).toBe(A);
  });

  it('does nothing to the only tab of the only pane', () => {
    openTabs([A]);
    state().moveToPane(state().activeId!);
    expect(panePaths()).toEqual([[A]]);
  });

  it('moves at a position, keeping its history', () => {
    openTabs([A]);
    open(C);
    state().splitRight();
    open(B);
    const moving = state().panes[0].tabs[0];
    state().moveToPane(moving.id, state().panes[1].id, 0);
    expect(state().panes).toHaveLength(1);
    expect(panePaths()).toEqual([[C, B]]);
    expect(state().tabs[0].history.map((entry) => entry.location)).toEqual([fileLocation(A), fileLocation(C)]);
  });

  it('closes the pane it leaves empty', () => {
    openTabs([A, B]);
    state().splitRight();
    open(C);
    state().moveToPane(state().activeId!);
    expect(panePaths()).toEqual([[A, C, B]]);
    expect(selectOpenedPath(state())).toBe(C);
  });
});

describe('opening to the side', () => {
  it('opens in a new tab of the other pane, making it when there is one pane', () => {
    openTabs([A]);
    open(B, { side: true });
    expect(panePaths()).toEqual([[A], [B]]);
    expect(activePaneIndex()).toBe(1);
    open(C, { side: true });
    expect(panePaths()).toEqual([[A, C], [B]]);
    expect(activePaneIndex()).toBe(0);
  });

  it('goes to the other pane’s tab that shows the page', () => {
    openTabs([A]);
    open(B, { side: true });
    state().focusOtherPane();
    open(B, { side: true });
    expect(panePaths()).toEqual([[A], [B]]);
    expect(activePaneIndex()).toBe(1);
  });

  it('moves the tab that shows it here to the side', () => {
    openTabs([A, B], 1);
    open(B, { side: true });
    expect(panePaths()).toEqual([[A], [B]]);
  });

  it('never ends the split: a page that is all its pane has only comes forward', () => {
    openTabs([A]);
    open(B, { side: true });
    // The right pane has only B. Open to the side on B keeps both panes, the right one active.
    open(B, { side: true });
    expect(panePaths()).toEqual([[A], [B]]);
    expect(activePaneIndex()).toBe(1);
    // The same from the left, on A: A is all the left pane has.
    state().focusPane(state().panes[0].id);
    open(A, { side: true });
    expect(panePaths()).toEqual([[A], [B]]);
    expect(activePaneIndex()).toBe(0);
  });

  it('takes the active pane’s own page, even when a tab behind the other pane’s open one has it too', () => {
    openTabs([A, B], 0);
    state().splitRight();
    open(B);
    // Left: A open, B behind it. Right: B, all it has.
    open(B, { side: true });
    expect(panePaths()).toEqual([[A, B], [B]]);
    expect(activePaneIndex()).toBe(1);
    expect(paneOpen(0)).toBe(A);
  });
});

describe('the divider', () => {
  it('keeps the left pane’s share between 0 and 1', () => {
    state().setSplit(0.3);
    expect(state().split).toBe(0.3);
    state().setSplit(4);
    expect(state().split).toBe(1);
    state().setSplit(Number.NaN);
    expect(state().split).toBe(0.5);
  });

  it('never makes a card narrower than 360 px', () => {
    expect(MIN_PANE_COLUMN).toBe(372);
    expect(leftPaneWidth(0.5, 1000)).toBe(500);
    expect(leftPaneWidth(0.05, 1000)).toBe(372);
    expect(leftPaneWidth(0.95, 1000)).toBe(628);
    expect(splitFor(100, 1000)).toBeCloseTo(0.372);
    expect(fitsTwoPanes(743)).toBe(false);
    expect(fitsTwoPanes(744)).toBe(true);
  });
});

describe('path changes in two panes', () => {
  it('closes a pane whose every tab goes', () => {
    openTabs([A]);
    open(B, { side: true });
    const next = removePathsFromTabsState(state(), [B]);
    expect(next.panes).toHaveLength(1);
    expect(next.tabs.map(tabFile)).toEqual([A]);
  });
});

async function relaunch(): Promise<TabsStore> {
  vi.resetModules();
  const launched = await import('@/renderer/features/disk-explorer/store/tabsStore');
  return launched.useTabsStore.getState();
}

describe('persistence of panes', () => {
  it('brings back both panes, their tabs, the open tab in each, the active pane and the divider', async () => {
    openTabs([A, B], 1);
    open(C, { side: true });
    state().setSplit(0.4);
    state().focusOtherPane();
    const restored = await relaunch();
    expect(restored.panes.map((pane) => pane.tabs.map(tabFile))).toEqual([[A, B], [C]]);
    expect(restored.panes.map((pane) => pane.tabs.findIndex((tab) => tab.id === pane.activeId))).toEqual([1, 0]);
    expect(restored.panes.findIndex((pane) => pane.id === restored.activePaneId)).toBe(0);
    expect(restored.split).toBe(0.4);
    expect(selectOpenedPath(restored)).toBe(B);
  });

  it('brings back an empty pane just split', async () => {
    openTabs([A]);
    state().splitRight();
    const restored = await relaunch();
    expect(restored.panes.map((pane) => pane.tabs.length)).toEqual([1, 0]);
  });

  it('saves every tab in the shape from before panes too, for an older build', () => {
    openTabs([A]);
    open(B, { side: true });
    const saved = readPref<{ tabs: unknown[]; active: number }>('tabs.session', { tabs: [], active: -1 });
    expect(saved.tabs).toHaveLength(2);
    expect(saved.active).toBe(1);
  });

  it('loads a session saved before panes as one pane', async () => {
    writePref('tabs.session', {
      date: '2026-11-14',
      active: 1,
      tabs: [
        { history: [{ location: fileLocation(A) }], index: 0 },
        { history: [{ location: fileLocation(B) }], index: 0 },
      ],
    });
    const restored = await relaunch();
    expect(restored.panes).toHaveLength(1);
    expect(restored.tabs.map(tabFile)).toEqual([A, B]);
    expect(selectOpenedPath(restored)).toBe(B);
    expect(restored.split).toBe(0.5);
  });

  it('drops a pane whose every saved tab fails to read', async () => {
    writePref('tabs.session', {
      date: '2026-11-14',
      active: 0,
      tabs: [],
      panes: [
        { active: 0, tabs: [{ history: [{ location: fileLocation(A) }], index: 0 }] },
        { active: 0, tabs: [{ history: [{ location: { mode: 'focus', file: 'relative.md' } }], index: 0 }] },
      ],
      activePane: 1,
      split: 'wide',
    });
    const restored = await relaunch();
    expect(restored.panes).toHaveLength(1);
    expect(selectOpenedPath(restored)).toBe(A);
    expect(restored.split).toBe(0.5);
  });
});

describe('Back, Forward and Reopen Closed Tab act in their own pane', () => {
  it('Back onto a page the other pane shows steps this tab, and Back again goes past it', () => {
    openTabs([A]);
    open(C);
    open(B);
    state().splitRight();
    open(C);
    // Left: A, C, B in one tab's history; right: C.
    state().focusPane(state().panes[0].id);
    state().back();
    expect(activePaneIndex()).toBe(0);
    expect(paneOpen(0)).toBe(C);
    expect(paneOpen(1)).toBe(C);
    state().back();
    expect(activePaneIndex()).toBe(0);
    expect(paneOpen(0)).toBe(A);
    expect(paneOpen(1)).toBe(C);
  });

  it('Forward does the same', () => {
    openTabs([A]);
    open(B);
    state().back();
    state().splitRight();
    open(B);
    state().focusPane(state().panes[0].id);
    state().forward();
    expect(activePaneIndex()).toBe(0);
    expect(paneOpen(0)).toBe(B);
    expect(paneOpen(1)).toBe(B);
    expect(state().panes[0].tabs[0].index).toBe(1);
  });

  it('a step to a page nobody else shows moves as before', () => {
    openTabs([A]);
    open(B);
    state().splitRight();
    open(C);
    state().focusPane(state().panes[0].id);
    state().back();
    expect(activePaneIndex()).toBe(0);
    expect(paneOpen(0)).toBe(A);
  });

  it('a closed tab whose page the other pane shows now opens again in its own pane', () => {
    openTabs([A, B]);
    state().splitRight();
    state().focusPane(state().panes[0].id);
    state().close(state().panes[0].tabs[0].id);
    state().focusPane(state().panes[1].id);
    open(A);
    expect(state().reopenClosed()).toBe(true);
    expect(panePaths()).toEqual([[A, B], [A]]);
    expect(activePaneIndex()).toBe(0);
    expect(paneOpen(0)).toBe(A);
    expect(state().recentlyClosed).toHaveLength(0);
  });
});
