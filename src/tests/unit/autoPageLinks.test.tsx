import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoItem, AutoResult, FolderUpdateOutcome, ResolvedVaultPage } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { forgetListWorking } from '@/renderer/features/auto/store/autoStore';
import { MISSING_LINE, MISSING_LINE_MS, Markdown, MarkdownLinksContext, type VaultOpen } from '@/renderer/features/auto/markdown/Markdown';
import { ownWords, tidyName } from '@/renderer/features/auto/model/links';
import { forgetPlaces } from '@/renderer/features/auto/model/places';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { TURN_END_SETTLE_MS, resetPageLinks, updateFolders } from '@/renderer/features/auto/store/pageLinks';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { browseAuto } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { allTabs, selectPaneTab, tabFile, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { ShellProvider } from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { autoSnapshot, autoThread, installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, tabId, tabPaths } from '@/tests/helpers/tabs';

/*
 * Links to pages in a reply: how they read, and what a click does when the
 * page is not on this Mac yet. The main process is a fake here; its git work
 * is tested in FolderUpdates.test.ts.
 */

const CONTEXT = { roots: ['/Users/me/Vault'], tops: new Set(['Library', 'Projects', 'Recipes']) };
const ok = <T,>(data: T): AutoResult<T> => ({ success: true, data }) as AutoResult<T>;
const missing = (path: string): AutoResult<ResolvedVaultPage> => ({ success: false, error: { kind: 'missing', message: `Could not find ${path}.` } });
const found = (path: string, title: string | null = null) => ok<ResolvedVaultPage>({ path: `/Vault/${path}`, title });
const sleep = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** Headings the fake main process knows, by path. */
let headings: Record<string, string | null>;

beforeEach(() => {
  resetPageLinks();
  headings = {};
  window.autoAPI = {
    resolvePage: vi.fn(async (path: string) => (path in headings ? found(path, headings[path]) : missing(path))),
    updateFolders: vi.fn(async () => ok<FolderUpdateOutcome>('current')),
  } as unknown as typeof window.autoAPI;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function draw(markdown: string, openVault: (...args: never[]) => Promise<VaultOpen> | void = vi.fn()) {
  const result = render(
    <TooltipProvider>
      <MarkdownLinksContext.Provider value={{ context: CONTEXT, openVault: openVault as never }}>
        <Markdown text={markdown} />
      </MarkdownLinksContext.Provider>
    </TooltipProvider>
  );
  return { ...result, openVault };
}

const linkTo = (container: HTMLElement, path: string) => container.querySelector(`[data-vault-path="${path}"]`) as HTMLElement;

describe('the words of a link to a page', () => {
  it('keeps words of its own', () => {
    const { container } = draw('See [the seed plan](Projects/Garden/Seeds.md) and [[Recipes/Bread|the loaf]].');
    expect(linkTo(container, 'Projects/Garden/Seeds.md').textContent).toBe('the seed plan');
    expect(linkTo(container, 'Recipes/Bread').textContent).toBe('the loaf');
  });

  it('shows the tidy file name for a path, the target, or no words, then the heading once it arrives', async () => {
    headings = { 'Library/notes/plan.md': 'Planting plan for spring', 'Projects/Garden/Beds.md': 'Raised beds', 'Recipes/Bread': null };
    const { container } = draw('A `Library/notes/plan.md`, [Projects/Garden/Beds.md](Projects/Garden/Beds.md), [[Recipes/Bread]] and [](Recipes/Rye.md).');
    // At once: the file's name, with no folder and no extension.
    expect(linkTo(container, 'Library/notes/plan.md').textContent).toBe('plan');
    expect(linkTo(container, 'Projects/Garden/Beds.md').textContent).toBe('Beds');
    expect(linkTo(container, 'Recipes/Bread').textContent).toBe('Bread');
    expect(linkTo(container, 'Recipes/Rye.md').textContent).toBe('Rye');
    // Then the heading, where the page has one and is here.
    await waitFor(() => expect(linkTo(container, 'Library/notes/plan.md').textContent).toBe('Planting plan for spring'));
    expect(linkTo(container, 'Projects/Garden/Beds.md').textContent).toBe('Raised beds');
    expect(linkTo(container, 'Recipes/Bread').textContent).toBe('Bread');
    expect(linkTo(container, 'Recipes/Rye.md').textContent).toBe('Rye');
  });

  it('asks the main process once per path', async () => {
    headings = { 'Library/notes/plan.md': 'Plan' };
    const { container } = draw('`Library/notes/plan.md` and again [Library/notes/plan.md](Library/notes/plan.md).');
    await waitFor(() => expect(container.querySelectorAll('[data-vault-path="Library/notes/plan.md"]')[1].textContent).toBe('Plan'));
    expect(window.autoAPI.resolvePage).toHaveBeenCalledTimes(1);
  });

  it('gives the path from the folder’s top on hover and as the description, with the words as the name, and a page icon', () => {
    const { container } = draw('[[Library/notes/A rather long name for a page]]');
    const link = screen.getByRole('link', { name: 'A rather long name for a page' });
    expect(link).toBe(linkTo(container, 'Library/notes/A rather long name for a page'));
    expect(link.getAttribute('title')).toBe('Library/notes/A rather long name for a page');
    expect(link).toHaveAccessibleDescription('Library/notes/A rather long name for a page');
    expect(link.querySelector('svg.auto-page-icon')).not.toBeNull();
    // One line, cut inside the column: the words have their own box for the ellipsis.
    expect(link.querySelector('.auto-page-words')?.textContent).toBe('A rather long name for a page');
  });

  it('leaves web links and links to files that are not pages as they were', () => {
    const { container } = draw('A [video](https://example.com/v) and [the chart](Library/files/chart.png).');
    expect(screen.getByRole('link', { name: 'video' }).querySelector('svg')).toBeNull();
    const chart = linkTo(container, 'Library/files/chart.png');
    expect(chart.textContent).toBe('the chart');
    expect(chart.querySelector('svg')).toBeNull();
    expect(chart.hasAttribute('data-page')).toBe(false);
  });

  it('decides which words are the link’s own', () => {
    expect(ownWords('Projects/Beds.md', 'Projects/Beds.md', 'Projects/Beds.md', 'link')).toBe(false);
    expect(ownWords('./Projects/Beds.md', 'Projects/Beds.md', 'Projects/Beds.md', 'link')).toBe(false);
    expect(ownWords('Beds.md', 'Projects/Beds.md', 'Projects/Beds.md', 'link')).toBe(false);
    expect(ownWords('Projects/Beds', 'Projects/Beds.md', 'Projects/Beds.md', 'link')).toBe(false);
    expect(ownWords('Beds', 'Projects/Beds.md', 'Projects/Beds.md', 'link')).toBe(true);
    expect(ownWords('Beds', 'Projects/Beds', 'Projects/Beds', 'wiki')).toBe(false);
    expect(ownWords('the beds', 'Projects/Beds', 'Projects/Beds', 'wiki')).toBe(true);
    expect(ownWords('anything', 'x', 'x.md', 'code')).toBe(false);
    expect(tidyName('Library/daily/2026-11-16.mdo')).toBe('2026-11-16');
    expect(tidyName('Library/notes/plan')).toBe('plan');
  });
});

describe('a link to a page that is not here yet', () => {
  it('shows the working mark while the folders are brought up to date, then says so at the link and announces it', async () => {
    let finish: (outcome: VaultOpen) => void = () => undefined;
    const openVault = vi.fn((_path: string, _newTab: boolean, options?: { onWorking?: () => void }) => {
      options?.onWorking?.();
      return new Promise<VaultOpen>((resolve) => {
        finish = resolve;
      });
    });
    const { container } = draw('See `Library/notes/new.md`.', openVault as never);
    const link = linkTo(container, 'Library/notes/new.md');
    fireEvent.click(link);
    expect(openVault).toHaveBeenCalledWith('Library/notes/new.md', false, expect.objectContaining({ atLink: true }));
    expect(link.getAttribute('data-working')).toBe('true');
    expect(link.getAttribute('aria-busy')).toBe('true');
    expect(link.querySelector('.auto-spin')).not.toBeNull();
    expect(link.querySelector('svg')).toBeNull();
    // A second click while it works asks nothing more.
    fireEvent.click(link);
    expect(openVault).toHaveBeenCalledTimes(1);
    await act(async () => finish('missing'));
    expect(link.hasAttribute('data-working')).toBe(false);
    const line = within(container).getByRole('status');
    expect(line.textContent).toBe(MISSING_LINE);
    expect(line.textContent).toBe('This file is not on this Mac yet.');
    expect(link.parentElement?.contains(line)).toBe(true);
  });

  it('takes the line away after a few seconds, or on the next click anywhere', async () => {
    vi.useFakeTimers();
    const openVault = vi.fn(async (): Promise<VaultOpen> => 'missing');
    const { container } = draw('See `Library/notes/new.md`.', openVault as never);
    const link = linkTo(container, 'Library/notes/new.md');
    const line = () => within(container).getByRole('status').textContent;
    await act(async () => fireEvent.click(link));
    expect(line()).toBe(MISSING_LINE);
    await act(async () => vi.advanceTimersByTime(MISSING_LINE_MS));
    expect(line()).toBe('');
    await act(async () => fireEvent.click(link));
    expect(line()).toBe(MISSING_LINE);
    fireEvent.pointerDown(document.body);
    expect(line()).toBe('');
  });
});

// --- In the app: the real link handling against a fake main process.

const ROOT = '/Vault';
const user = (text: string): AutoItem => ({ role: 'user', text, cid: null });
const reply = (text: string): AutoItem => ({ role: 'assistant', text, open: false });
const NOTES = autoThread('notes', { title: 'New notes', last: 'Two new pages.' });
const OTHER = autoThread('other', { title: 'Other work', last: 'Done.' });
let auto: FakeAuto;

function Sync(): null {
  useAutoSync();
  return null;
}

async function openNotes(options: Parameters<typeof installAutoApi>[0] = {}) {
  auto = installAutoApi({
    threads: [NOTES, OTHER],
    snapshots: {
      notes: autoSnapshot(NOTES, { items: [user('Write the notes'), reply('Here: `Library/notes/new.md` and [Beds](Projects/Beds.md).')] }),
    },
    ...options,
  });
  render(
    <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider>
            <Sync />
            <AutoScreen />
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  await screen.findByTestId('auto-list');
  fireEvent.click(within(screen.getByTestId('auto-row-notes')).getAllByRole('button')[0]);
  await waitFor(() => expect(auto.followed.thread?.id).toBe('notes'));
}

const pageLink = (path: string) => document.querySelector(`[data-testid="auto-talk"] [data-vault-path="${path}"]`) as HTMLElement;
const refusals = () => useSaidStore.getState().notice;
/** The file a pane's open tab shows. */
const paneFile = (paneId: string): string | null => {
  const tab = selectPaneTab(useTabsStore.getState(), paneId);
  return tab ? tabFile(tab) : null;
};

describe('following a link to a page in the app', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAutoStore.setState(useAutoStore.getInitialState(), true);
    forgetListWorking();
    useThreadStore.setState({ ...useThreadStore.getInitialState(), box: { outbox: [], drafts: {} } }, true);
    useDigestStore.setState(useDigestStore.getInitialState(), true);
    useSaidStore.getState().clear();
    hold.ms = HOLD_MS;
    forgetPlaces();
    forgetViews();
    installDiskApi();
    installActivityApi();
    installCollectionsApi();
    useDiskStore.setState({ roots: [ROOT], rootsLoaded: true, listings: { [ROOT]: [entry({ path: '/Vault/Library', name: 'Library', kind: 'directory', isDirectory: true })] } });
    openTabs([browseAuto().location]);
  });

  it('opens a page that is found at once, with no update asked', async () => {
    await openNotes();
    await waitFor(() => expect(pageLink('Projects/Beds.md')).not.toBeNull());
    fireEvent.click(pageLink('Projects/Beds.md'));
    await waitFor(() => expect(tabPaths()).toContain('/Vault/Projects/Beds.md'));
    expect(auto.api.updateFolders).not.toHaveBeenCalled();
  });

  it('opens in the active pane, as a click in the sidebar does, and brings forward a page the other pane shows instead of opening it twice', async () => {
    openTabs([browseAuto().location, '/Vault/Projects/Beds.md']);
    // Beds goes to a pane at the right; the Auto tab's pane is made the active one again.
    useTabsStore.getState().moveToPane(tabId(1));
    const [left, right] = useTabsStore.getState().panes;
    useTabsStore.getState().focusPane(left.id);
    await openNotes();
    await waitFor(() => expect(pageLink('Projects/Beds.md')).not.toBeNull());
    fireEvent.click(pageLink('Projects/Beds.md'));
    await waitFor(() => expect(useTabsStore.getState().activePaneId).toBe(right.id));
    expect(allTabs(useTabsStore.getState()).map(tabFile).filter((file) => file === '/Vault/Projects/Beds.md')).toHaveLength(1);
    // A page neither pane shows opens in the active pane, beside the Auto tab, which keeps the thread.
    useTabsStore.getState().focusPane(left.id);
    vi.mocked(auto.api.resolvePage).mockImplementation(async (path: string) => found(path));
    fireEvent.click(pageLink('Library/notes/new.md'));
    await waitFor(() => expect(paneFile(left.id)).toBe('/Vault/Library/notes/new.md'));
    expect(useTabsStore.getState().activePaneId).toBe(left.id);
    expect(useTabsStore.getState().panes.find((pane) => pane.id === left.id)?.tabs).toHaveLength(2);
    expect(paneFile(right.id)).toBe('/Vault/Projects/Beds.md');
  });

  it('for a page that is missing, brings the folders up to date once, looks again and opens it', async () => {
    await openNotes();
    await waitFor(() => expect(pageLink('Library/notes/new.md')).not.toBeNull());
    let arrived = false;
    vi.mocked(auto.api.resolvePage).mockImplementation(async (path: string) => (path === 'Library/notes/new.md' && !arrived ? missing(path) : found(path, 'A new page')));
    vi.mocked(auto.api.updateFolders).mockImplementation(async () => {
      arrived = true;
      return ok<FolderUpdateOutcome>('updated');
    });
    const looks = vi.mocked(auto.api.resolvePage).mock.calls.length;
    fireEvent.click(pageLink('Library/notes/new.md'));
    await waitFor(() => expect(tabPaths()).toContain('/Vault/Library/notes/new.md'));
    expect(auto.api.updateFolders).toHaveBeenCalledTimes(1);
    expect(auto.api.updateFolders).toHaveBeenCalledWith();
    expect(vi.mocked(auto.api.resolvePage).mock.calls.slice(looks).filter(([path]) => path === 'Library/notes/new.md').length).toBeGreaterThanOrEqual(2);
    expect(refusals()).toBeNull();
    // After an update the heading is read again, and the link shows it.
    await waitFor(() => expect(pageLink('Library/notes/new.md').textContent).toBe('A new page'));
  });

  it('for a page still missing after the update, says so at the link and not at the foot of the sidebar', async () => {
    await openNotes();
    await waitFor(() => expect(pageLink('Library/notes/new.md')).not.toBeNull());
    vi.mocked(auto.api.resolvePage).mockImplementation(async (path: string) => (path === 'Library/notes/new.md' ? missing(path) : found(path)));
    fireEvent.click(pageLink('Library/notes/new.md'));
    await waitFor(() => expect(pageLink('Library/notes/new.md').parentElement?.querySelector('[role="status"]')?.textContent).toBe(MISSING_LINE));
    expect(auto.api.updateFolders).toHaveBeenCalledTimes(1);
    expect(refusals()).toBeNull();
    expect(screen.queryByTestId('auto-said')).toBeNull();
    expect(tabPaths()).not.toContain('/Vault/Library/notes/new.md');
  });

  it('asks once when a thread stops working on the list stream, and once for a burst', async () => {
    await openNotes();
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'working' } }));
    act(() => auto.list({ kind: 'thread', thread: { ...OTHER, status: 'queued' } }));
    await sleep(TURN_END_SETTLE_MS + 100);
    // Starting work asks nothing.
    expect(auto.api.updateFolders).not.toHaveBeenCalled();
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'idle' } }));
    await sleep(TURN_END_SETTLE_MS + 100);
    expect(auto.api.updateFolders).toHaveBeenCalledTimes(1);
    // A thread that was not working ending again asks nothing.
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'idle', last: 'Still idle.' } }));
    await sleep(TURN_END_SETTLE_MS + 100);
    expect(auto.api.updateFolders).toHaveBeenCalledTimes(1);
    // Two ends together are one ask.
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'working' } }));
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'idle' } }));
    act(() => auto.list({ kind: 'thread', thread: { ...OTHER, status: 'failed' } }));
    await sleep(TURN_END_SETTLE_MS + 100);
    expect(auto.api.updateFolders).toHaveBeenCalledTimes(2);
  });

  it('asks once when the open thread’s own stream puts the end in the list before the list stream says it', async () => {
    await openNotes();
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'working' } }));
    // The thread's stream, which the open thread follows, gets there first.
    act(() => useAutoStore.getState().upsert({ ...NOTES, status: 'idle' }));
    act(() => auto.list({ kind: 'thread', thread: { ...NOTES, status: 'idle' } }));
    await sleep(TURN_END_SETTLE_MS + 100);
    expect(auto.api.updateFolders).toHaveBeenCalledTimes(1);
  });

  it('asks nothing with no address set', async () => {
    installAutoApi({ url: null });
    useAutoStore.setState({ configured: true, address: null, threads: [{ ...NOTES, status: 'working' }], listToken: 7 });
    act(() => useAutoStore.getState().handle({ token: 7, type: 'event', stream: 'list', event: { kind: 'thread', thread: { ...NOTES, status: 'idle' } }, cursor: null }));
    await sleep(TURN_END_SETTLE_MS + 100);
    expect(window.autoAPI.updateFolders).not.toHaveBeenCalled();
    // The one way to ask, which a click on a missing page also goes through, asks nothing either.
    expect(await updateFolders(null)).toBe('none');
    expect(window.autoAPI.updateFolders).not.toHaveBeenCalled();
  });
});
