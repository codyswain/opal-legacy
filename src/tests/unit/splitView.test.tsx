import * as React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useRoutes, type RouteObject } from 'react-router-dom';
import { FilesRoute } from '@/renderer/features/disk-explorer';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { pathMutationCoordinator } from '@/renderer/features/disk-explorer/navigation/pathMutationCoordinator';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { tabFile, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { TAB_DRAG_TYPE } from '@/renderer/features/disk-explorer/components/TabStrip';
import { AppShell, DEFAULT_SHELL_PREFERENCES, ShellProvider, useShellStore } from '@/renderer/features/shell';
import { DEFAULT_DAY_SIDEBAR_PREFERENCES, useDaySidebarStore } from '@/renderer/features/day-sidebar';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, resetTabs } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const LEFT = '/Vault/left.txt';
const RIGHT = '/Vault/right.txt';
const OTHER = '/Vault/other.txt';

const ROUTES: RouteObject[] = [{ path: '/files', element: <FilesRoute /> }];
const Routes = () => useRoutes(ROUTES);

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider>
            <AppShell>
              <Routes />
            </AppShell>
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

const state = () => useTabsStore.getState();
const columns = () => [...document.querySelectorAll<HTMLElement>('[data-pane-column]')];
const rowOf = (column: HTMLElement) => within(within(column).getByTestId('titlebar'));

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(1600);
  installActivityApi();
  installDiskApi({
    listRoots: vi.fn(async () => ({ success: true as const, data: [ROOT] })),
    readDirectory: vi.fn(async (dirPath: string) => ({
      success: true as const,
      data: { path: dirPath, entries: dirPath === ROOT ? useDiskStore.getState().listings[ROOT] ?? [] : [] },
    })),
    readTextFile: vi.fn(async (path: string) => ({
      success: true as const,
      data: { path, text: `text of ${path}`, truncated: false, size: 1 },
    })),
  });
  useDiskStore.setState({
    roots: [ROOT],
    rootsLoaded: true,
    listings: {
      [ROOT]: [
        entry({ path: LEFT, name: 'left.txt', kind: 'text' }),
        entry({ path: RIGHT, name: 'right.txt', kind: 'text' }),
        entry({ path: OTHER, name: 'other.txt', kind: 'text' }),
      ],
    },
    expanded: {},
    loading: { isLoading: false, error: null },
  });
  pathMutationCoordinator.reconcileAllowedRoots([ROOT]);
  useShellStore.setState({ ...DEFAULT_SHELL_PREFERENCES, narrowLayout: false, narrowSidebarOpen: false });
  useDaySidebarStore.setState({ ...DEFAULT_DAY_SIDEBAR_PREFERENCES, open: false, pickedDay: null, lastDay: null, narrowOpen: false });
  resetTabs();
});

/** Two panes: left.txt and other.txt at the left, right.txt at the right, which is active. */
function twoPanes() {
  openTabs([LEFT, OTHER]);
  state().open(fileLocation(RIGHT), { side: true });
}

describe('split view', () => {
  it('draws one pane as before: one row of tabs, one card, no divider', async () => {
    openTabs([LEFT]);
    renderShell();
    expect(columns()).toHaveLength(1);
    expect(screen.getAllByTestId('titlebar')).toHaveLength(1);
    expect(screen.getByTestId('workspace-surface')).toHaveClass('mx-page', 'mb-page');
    expect(screen.queryByTestId('pane-divider')).toBeNull();
    expect(await screen.findByTestId('text-viewer')).toHaveTextContent(`text of ${LEFT}`);
  });

  it('gives each pane its own row of tabs over its own card, each showing its own page', async () => {
    twoPanes();
    renderShell();
    const [left, right] = columns();
    expect(rowOf(left).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['left.txt', 'other.txt']);
    expect(rowOf(right).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['right.txt']);
    expect(await within(left).findByTestId('text-viewer')).toHaveTextContent(`text of ${LEFT}`);
    expect(await within(right).findByTestId('text-viewer')).toHaveTextContent(`text of ${RIGHT}`);
    // The left sidebar's controls go in the first row, the right sidebar's toggle in the last.
    expect(rowOf(left).queryByRole('button', { name: 'Show right sidebar' })).toBeNull();
    expect(rowOf(right).getByRole('button', { name: 'Show right sidebar' })).toBeInTheDocument();
    expect(screen.getByTestId('pane-divider')).toBeInTheDocument();
  });

  it('draws the inactive pane’s open tab quieter, and a click in a pane makes it active', async () => {
    twoPanes();
    renderShell();
    const [left, right] = columns();
    expect(rowOf(left).getByRole('tab', { name: 'left.txt' })).toHaveAttribute('data-quiet', 'true');
    expect(rowOf(right).getByRole('tab', { name: 'right.txt' })).not.toHaveAttribute('data-quiet');
    fireEvent.pointerDown(within(left).getByTestId('workspace-surface'));
    expect(state().activePaneId).toBe(state().panes[0].id);
    expect(rowOf(left).getByRole('tab', { name: 'left.txt' })).not.toHaveAttribute('data-quiet');
    expect(rowOf(right).getByRole('tab', { name: 'right.txt' })).toHaveAttribute('data-quiet', 'true');
  });

  it('shows the quiet words in an empty pane, with a way to close it', async () => {
    openTabs([LEFT]);
    renderShell();
    act(() => state().splitRight());
    const right = columns()[1];
    expect(within(right).getByTestId('no-page-open')).toHaveTextContent('No file is open.');
    fireEvent.click(within(right).getByRole('button', { name: 'Close pane' }));
    expect(columns()).toHaveLength(1);
    // A lone pane with no tab has nothing to close.
    act(() => state().close(state().activeId as string));
    expect(screen.getByTestId('no-page-open')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
  });

  it('shows only the active pane in a window too narrow for two, and both again once it widens', async () => {
    twoPanes();
    setViewportWidth(980);
    renderShell();
    // 980 px less the 240 px sidebar leaves room for one 360 px card only.
    expect(columns()).toHaveLength(1);
    expect(rowOf(columns()[0]).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['right.txt']);
    expect(screen.queryByTestId('pane-divider')).toBeNull();
    expect(state().panes[0].tabs).toHaveLength(2);
    setViewportWidth(1600);
    act(() => void window.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(columns()).toHaveLength(2));
  });

  it('a double click on the divider makes the panes equal', () => {
    twoPanes();
    act(() => state().setSplit(0.3));
    renderShell();
    fireEvent.doubleClick(screen.getByTestId('pane-divider'));
    expect(state().split).toBe(0.5);
  });

  it('moves a tab dragged onto the other pane’s row of tabs, at the place it lands', () => {
    twoPanes();
    renderShell();
    const [left, right] = columns();
    const dataTransfer = transfer();
    const moving = rowOf(left).getByRole('tab', { name: 'other.txt' });
    const target = rowOf(right).getByRole('tab', { name: 'right.txt' });
    target.getBoundingClientRect = () => ({ left: 800, width: 100, right: 900, top: 0, bottom: 28, height: 28, x: 800, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.dragStart(moving, { dataTransfer });
    drag('dragOver', within(right).getByTestId('tab-strip'), dataTransfer, 810);
    drag('drop', within(right).getByTestId('tab-strip'), dataTransfer, 810);
    expect(state().panes.map((pane) => pane.tabs.map(tabFile))).toEqual([[LEFT], [OTHER, RIGHT]]);
    expect(state().activePaneId).toBe(state().panes[1].id);
  });

  it('with one pane, a tab dropped on the card’s right half splits and lands in the new pane', () => {
    openTabs([LEFT, OTHER]);
    renderShell();
    const card = screen.getByTestId('workspace-surface');
    card.getBoundingClientRect = () => ({ left: 300, width: 800, right: 1100, top: 40, bottom: 900, height: 860, x: 300, y: 40, toJSON: () => ({}) }) as DOMRect;
    const dataTransfer = transfer({ [TAB_DRAG_TYPE]: state().tabs[1].id });
    // The left half is no drop zone.
    drag('dragOver', card, dataTransfer, 400);
    expect(screen.queryByTestId('pane-drop-zone')).toBeNull();
    drag('dragOver', card, dataTransfer, 900);
    expect(screen.getByTestId('pane-drop-zone')).toBeInTheDocument();
    drag('drop', card, dataTransfer, 900);
    expect(state().panes.map((pane) => pane.tabs.map(tabFile))).toEqual([[LEFT], [OTHER]]);
    expect(columns()).toHaveLength(2);
  });
});

describe('where the keyboard and a click end up', () => {
  it('Split right from a tab’s menu leaves the new pane active once the menu has closed', async () => {
    openTabs([LEFT, OTHER], 0);
    renderShell();
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: rowOf(columns()[0]).getByRole('tab', { name: 'left.txt' }) });
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Split right/ }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await act(async () => {
      for (let frame = 0; frame < 3; frame += 1) await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(state().panes).toHaveLength(2);
    expect(state().activePaneId).toBe(state().panes[1].id);
    // The next page he opens goes to the new pane, and the one he was on stays.
    act(() => state().open(fileLocation(RIGHT)));
    expect(state().panes.map((pane) => pane.tabs.map(tabFile))).toEqual([[LEFT, OTHER], [RIGHT]]);
  });

  it('a tab behind the other pane’s open one, clicked, comes forward showing its own page', async () => {
    twoPanes();
    renderShell();
    const left = columns()[0];
    await waitFor(() => expect(within(columns()[1]).getByTestId('text-viewer')).toHaveTextContent(`text of ${RIGHT}`));
    const behind = rowOf(left).getByRole('tab', { name: 'left.txt' });
    // The press makes the left pane active, and its route writes its open page, before the click brings this one forward.
    fireEvent.pointerDown(behind);
    fireEvent.click(behind);
    await waitFor(() => expect(within(left).getByTestId('text-viewer')).toHaveTextContent(`text of ${LEFT}`));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
    expect(state().panes[0].tabs.map(tabFile)).toEqual([LEFT, OTHER]);
    expect(within(left).getByTestId('text-viewer')).toHaveTextContent(`text of ${LEFT}`);
  });

  it('an empty pane takes a tab dropped anywhere on its row', () => {
    openTabs([LEFT, OTHER]);
    act(() => state().splitRight());
    renderShell();
    const [, right] = columns();
    const dataTransfer = transfer({ [TAB_DRAG_TYPE]: state().panes[0].tabs[1].id });
    // The row's empty end, past its New tab button: not the part that holds the tabs.
    const row = within(right).getByTestId('titlebar');
    drag('dragOver', row, dataTransfer, 1200);
    drag('drop', row, dataTransfer, 1200);
    expect(state().panes.map((pane) => pane.tabs.map(tabFile))).toEqual([[LEFT], [OTHER]]);
  });

  it('a tab dragged over the other pane’s card shows the drop zone there and lands in that pane', () => {
    twoPanes();
    renderShell();
    const [left, right] = columns();
    const dataTransfer = transfer();
    fireEvent.dragStart(rowOf(left).getByRole('tab', { name: 'other.txt' }), { dataTransfer });
    const card = within(right).getByTestId('workspace-surface');
    drag('dragOver', card, dataTransfer, 1200);
    expect(within(right).getByTestId('pane-drop-zone')).toBeInTheDocument();
    // Its own pane's card is no drop zone.
    drag('dragOver', within(left).getByTestId('workspace-surface'), dataTransfer, 500);
    expect(within(left).queryByTestId('pane-drop-zone')).toBeNull();
    drag('dragOver', card, dataTransfer, 1200);
    drag('drop', card, dataTransfer, 1200);
    expect(state().panes.map((pane) => pane.tabs.map(tabFile))).toEqual([[LEFT], [RIGHT, OTHER]]);
    expect(state().activePaneId).toBe(state().panes[1].id);
    expect(screen.queryByTestId('pane-drop-zone')).toBeNull();
  });

  it('in a window too narrow for both, a quiet button at the row’s end shows the other pane', async () => {
    twoPanes();
    setViewportWidth(980);
    renderShell();
    expect(columns()).toHaveLength(1);
    const button = screen.getByRole('button', { name: /Show the other pane/ });
    fireEvent.click(button);
    expect(rowOf(columns()[0]).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['left.txt', 'other.txt']);
    // Wide enough for both: no button.
    setViewportWidth(1600);
    act(() => void window.dispatchEvent(new Event('resize')));
    await waitFor(() => expect(columns()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /Show the other pane/ })).toBeNull();
  });

  it('draws the divider as one line, and gives a pane’s size no transition', () => {
    twoPanes();
    renderShell();
    const divider = screen.getByTestId('pane-divider');
    expect(divider.querySelectorAll('[aria-hidden]')).toHaveLength(1);
    expect(screen.getByTestId('pane-divider-line')).toHaveClass('right-px');
    for (const column of columns()) expect(column).toHaveClass('transition-none');
  });
});

/** A drag event at a place across the window; happy-dom's drag events take no clientX. */
function drag(type: 'dragOver' | 'drop', element: HTMLElement, dataTransfer: ReturnType<typeof transfer>, clientX: number) {
  const event = createEvent[type](element, { dataTransfer });
  Object.defineProperty(event, 'clientX', { value: clientX });
  act(() => void fireEvent(element, event));
}

/** A dataTransfer stand-in; happy-dom's drag events carry none. */
function transfer(data: Record<string, string> = {}) {
  const store = { ...data };
  return {
    setData: (type: string, value: string) => { store[type] = value; },
    getData: (type: string) => store[type] ?? '',
    get types() { return Object.keys(store); },
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}
