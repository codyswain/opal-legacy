import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoRoute } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { forgetPlaces } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { browseAuto } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { ShellProvider } from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { autoDigest, autoSnapshot, autoThread, digestEntry, installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';
import { installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { pasteFiles, PNG_ID, screenshot } from '@/tests/helpers/imagePaste';
import { entry as diskEntry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const DAY = '2026-11-13';
const EARLIER = '2026-11-12';
const BARE = '2026-11-11';

const BEDS = autoThread('beds', {
  title: 'Raised bed plan', status: 'waiting',
  ask: { id: 'q0', kind: 'ask', text: 'Which wood for the frames?', options: ['Cedar', 'Larch'], question: 'Which wood for the frames?' },
});
const BREAD = autoThread('bread', { title: 'Sourdough timings', last: 'Start the starter at 8.' });
const SEEDS = autoThread('seeds', { title: 'Seed order', last: 'Twelve packets.' });
const INSPECTION = autoThread('inspect', { title: 'Book the inspection', last: 'The committee walks the plots.', waits: true, digest: { date: DAY, id: 'item-2' } });

const day = () => autoDigest(DAY, [
  ['Meetings', [digestEntry('meeting-committee', { kind: 'meeting', title: 'Committee', md: '**10:00 Committee** (in the hall)\n- The water butts' })]],
  ['Top 3', [
    digestEntry('item-1', { kind: 'item', title: 'Order the trays', md: 'Two trays of 40 cells. See [Beds](Projects/Beds.md).', draft: { title: 'Garden centre', paste: 'Two trays, please.\n\nI can collect them.' } }),
    digestEntry('item-2', { kind: 'item', title: 'Book the inspection', priority: 'High', md: 'The committee walks the plots.', state: 'thread', thread: 'inspect' }),
    digestEntry('item-3', { kind: 'item', title: 'Fix the tap', priority: 'Medium', md: 'The hot side drips.', state: 'thread', thread: 'gone' }),
  ]],
  ['Plots', [digestEntry('text-plots', { title: 'Plots', md: '| Plot | Bed |\n| --- | --- |\n| 4 | 2 |' })]],
  ['Yesterday', [
    digestEntry('text-a', { md: 'Turned the compost.', state: 'resolved' }),
    digestEntry('text-b', { md: 'Sowed the beans.' }),
    digestEntry('text-c', { md: 'Mended the hose.', note: 'Buy a new washer' }),
  ]],
]);
const earlier = () => autoDigest(EARLIER, [['Top 3', [
  digestEntry('item-1', { kind: 'item', title: 'Sharpen the secateurs', md: 'The stone is in the tin.', state: 'resolved' }),
  digestEntry('item-2', { kind: 'item', title: 'Net the brassicas', md: 'Before the pigeons do.' }),
]]]);

let auto: FakeAuto;

function Sync(): null {
  useAutoSync();
  return null;
}

/** Renders the tab on a service with a digest, and waits for the list and the count. */
async function open(options: Parameters<typeof installAutoApi>[0] = {}) {
  auto = installAutoApi({
    threads: [BEDS, BREAD, SEEDS, INSPECTION],
    snapshots: { bread: autoSnapshot(BREAD), inspect: autoSnapshot(INSPECTION, { seed: 'Book the inspection' }) },
    digests: { [DAY]: day(), [EARLIER]: earlier(), [BARE]: autoDigest(BARE, []) },
    ...options,
  });
  const view = render(
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
  await waitFor(() => expect(useDigestStore.getState().status).not.toBe('unknown'));
  return view;
}

const digestRow = () => screen.getByTestId('auto-digest-row');
/** The Digest row's first line: its name and how much is left. */
const digestWord = () => (digestRow().textContent ?? '').replace(screen.queryByTestId('auto-digest-line')?.textContent ?? '\u0000', '');
/** The line at the foot of the list, as one string, and its buttons. */
const said = () => screen.queryByTestId('auto-said');
const saidText = () => (said()?.textContent ?? '').replace(/\s+/g, ' ');
const pressSaid = (name: string) => fireEvent.click(within(said() as HTMLElement).getByRole('button', { name }));
const row = (id: string) => screen.getByTestId(`auto-row-${id}`);
const entry = (id: string) => screen.getByTestId(`auto-entry-${id}`);
const entryIds = () => [...screen.getByTestId('auto-queue').querySelectorAll('li[data-state]')].map((element) => element.getAttribute('data-testid')?.replace('auto-entry-', ''));
const rowIds = () => [...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
const press = (id: string, name: string) => fireEvent.click(within(entry(id)).getByRole('button', { name }));
const last = <K extends AutoRoute['kind']>(kind: K) => auto.asked(kind).at(-1);
const service = (id: string, date = DAY) => auto.state.digests[date].sections.flatMap((section) => section.entries).find((each) => each.id === id);

/** Opens the queue beside the list. */
async function openQueue(options: Parameters<typeof installAutoApi>[0] = {}) {
  await open(options);
  fireEvent.click(digestRow());
  return screen.findByTestId('auto-queue-pane');
}

const openEntry = (id: string) => fireEvent.click(entry(id).querySelector('[data-auto-entry]') as HTMLElement);

beforeEach(() => {
  window.localStorage.clear();
  useSaidStore.getState().clear();
  hold.ms = HOLD_MS;
  forgetPlaces();
  forgetViews();
  useAutoStore.setState(useAutoStore.getInitialState(), true);
  useThreadStore.setState({ ...useThreadStore.getInitialState(), box: { outbox: [], drafts: {} } }, true);
  useDigestStore.setState(useDigestStore.getInitialState(), true);
  installDiskApi();
  installActivityApi();
  installCollectionsApi();
  useDiskStore.setState({ roots: [ROOT], rootsLoaded: true, listings: { [ROOT]: [diskEntry({ path: '/Vault/Projects', name: 'Projects', kind: 'directory', isDirectory: true })] } });
  openTabs([browseAuto().location]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the mark for the Mac', () => {
  const menuOf = async (id: string) => {
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: within(row(id)).getAllByRole('button')[0] });
    return within(await screen.findByTestId(`auto-row-menu-${id}`));
  };

  it('marks a thread from its menu, and shows it first under "For the Mac"', async () => {
    await open();
    expect(screen.queryByRole('heading', { name: 'For the Mac' })).toBeNull();
    fireEvent.click((await menuOf('seeds')).getByRole('menuitem', { name: 'Mark for the Mac' }));
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'seeds', on: true }));
    await waitFor(() => expect(rowIds()).toEqual(['seeds', 'beds', 'bread', 'inspect']));
    const group = within(screen.getByTestId('auto-group-desk'));
    expect(group.getByRole('heading', { name: 'For the Mac' })).toBeInTheDocument();
    expect(group.getByTestId('auto-row-seeds')).toBeInTheDocument();
  });

  it('keeps a marked thread that waits there, with the yellow dot', async () => {
    await open({ threads: [BREAD, { ...BEDS, desk: { at: 1_794_000_100, by: 'phone' } }, SEEDS] });
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds']);
    const group = within(screen.getByTestId('auto-group-desk'));
    expect(group.getByText('For the Mac')).toBeInTheDocument();
    expect(group.getByRole('img', { name: 'Waits on you' })).toBeInTheDocument();
  });

  it('takes the mark off from the same menu', async () => {
    await open({ threads: [BREAD, { ...SEEDS, desk: { at: 1_794_000_100, by: 'phone' } }] });
    const menu = await menuOf('seeds');
    expect(menu.queryByRole('menuitem', { name: 'Mark for the Mac' })).toBeNull();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Take off the Mac mark' }));
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'seeds', on: false }));
    await waitFor(() => expect(screen.queryByTestId('auto-group-desk')).toBeNull());
    expect(rowIds()).toEqual(['bread', 'seeds']);
  });

  it('follows the service when it ends the mark, and never ends it itself', async () => {
    const marked = { ...SEEDS, desk: { at: 1_794_000_100, by: 'phone' } };
    await open({ threads: [BREAD, marked], snapshots: { seeds: autoSnapshot(marked), bread: autoSnapshot(BREAD) } });
    // Opening it and writing in it here leaves the mark alone.
    fireEvent.click(within(row('seeds')).getAllByRole('button')[0]);
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    fireEvent.change(screen.getByTestId('auto-box'), { target: { value: 'Add the chard' } });
    await userEvent.setup().type(screen.getByTestId('auto-box'), '{Enter}');
    await waitFor(() => expect(auto.asked('message')).toHaveLength(1));
    expect(screen.getByTestId('auto-group-desk')).toBeInTheDocument();
    expect(auto.asked('desk')).toEqual([]);
    // The service says the mark is over.
    act(() => auto.list({ kind: 'thread', thread: { ...marked, desk: null } }));
    await waitFor(() => expect(screen.queryByTestId('auto-group-desk')).toBeNull());
  });

  it('puts a marked thread that is snoozed on the Snoozed page', async () => {
    await open({ threads: [BREAD, { ...SEEDS, desk: { at: 1_794_000_100, by: 'phone' }, snoozed: 4_000_000_000 }] });
    expect(screen.queryByTestId('auto-group-desk')).toBeNull();
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed1');
  });
});

describe('the Digest row', () => {
  it('heads the Threads section on one line with how much is left, and is not a thread row', async () => {
    await open();
    await waitFor(() => expect(digestWord()).toBe('Digest5 left'));
    expect(screen.queryByTestId('auto-digest-line')).toBeNull();
    const rows = [...screen.getByTestId('auto-list').querySelectorAll('[data-auto-row]')];
    expect(rows).not.toContain(digestRow());
    expect(digestRow().closest('[data-thread-id]')).toBeNull();
    expect(digestRow().closest('[draggable="true"]')).toBeNull();
    // The new thread is the heading's button, outside the run of rows.
    expect(screen.getByTestId('auto-list').contains(screen.getByTestId('auto-new-thread'))).toBe(false);
    expect(auto.asked('digest')).toEqual([{ kind: 'digest', date: null }]);
    expect(auto.asked('digests')).toHaveLength(1);
  });

  it('says Done with nothing left, and nothing with no digest', async () => {
    const view = await open({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a', { state: 'resolved' })]]]) } });
    await waitFor(() => expect(digestWord()).toBe('DigestDone'));
    view.unmount();
    await open({ digests: {} });
    await waitFor(() => expect(useDigestStore.getState().status).toBe('none'));
    expect(digestWord()).toBe('Digest');
    expect(screen.queryByTestId('auto-digest-line')).toBeNull();
  });

  it('opens the queue where a thread would be, and a thread row takes its place again', async () => {
    await openQueue();
    expect(screen.queryByTestId('auto-thread')).toBeNull();
    expect(digestRow().getAttribute('aria-current')).toBe('true');
    expect(auto.followed.thread).toBeNull();
    fireEvent.click(within(row('bread')).getAllByRole('button')[0]);
    await screen.findByTestId('auto-thread');
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
    expect(digestRow().getAttribute('aria-current')).toBeNull();
  });
});

describe('the queue', () => {
  it('shows the day written out, Left and All with their counts, and the open entries under their sections', async () => {
    const pane = within(await openQueue());
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13');
    expect(screen.getByTestId('auto-queue-left').textContent).toBe('Left5');
    expect(screen.getByTestId('auto-queue-all').textContent).toBe('All8');
    expect(screen.getByTestId('auto-queue-left').getAttribute('aria-pressed')).toBe('true');
    expect(pane.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Meetings', 'Top 3', 'Plots', 'Yesterday']);
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-b', 'text-c']);
  });

  it('snoozes an open entry with an Auto preset and can bring it back from All', async () => {
    const digest = day();
    const top = digest.sections[1];
    top.entries[0] = { ...top.entries[0], snoozedUntil: null };
    await openQueue({ digests: { [DAY]: digest } });
    const pointer = userEvent.setup();
    const menu = async () => {
      await pointer.click(within(entry('item-1')).getByRole('button', { name: 'Snooze entry' }));
      return within(await screen.findByRole('menu'));
    };
    await pointer.click((await menu()).getByRole('menuitem', { name: /Tomorrow/ }));
    await waitFor(() => expect(last('digest-snooze')).toMatchObject({ date: DAY, id: 'item-1', until: expect.any(Number) }));
    expect(screen.queryByTestId('auto-entry-item-1')).toBeNull();
    expect(screen.getByTestId('auto-queue-left')).toHaveTextContent('Left4');
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    expect(within(entry('item-1')).getByText(/Snoozed until/)).toBeInTheDocument();
    await pointer.click((await menu()).getByRole('menuitem', { name: 'Bring back' }));
    await waitFor(() => expect(last('digest-snooze')).toEqual({ kind: 'digest-snooze', date: DAY, id: 'item-1', until: null }));
    fireEvent.click(screen.getByTestId('auto-queue-left'));
    expect(entry('item-1')).toBeInTheDocument();
  });

  it('keeps closed rows to one line and shows details on demand', async () => {
    await openQueue();
    // Titled entries show their title, and meetings keep their time.
    expect(entry('item-1').querySelector('p')?.textContent).toBe('Order the trays');
    const words = within(entry('item-1')).getByTestId('auto-entry-words');
    expect(words.textContent).toBe('Two trays of 40 cells. See Beds.');
    expect(words.className).toContain('sr-only');
    // A meeting's words open with its name in bold: it is said once, and its time is at the row's right.
    expect(entry('meeting-committee').querySelector('p')?.textContent).toBe('Committee');
    expect(within(entry('meeting-committee')).getByTestId('auto-entry-time').textContent).toBe('10:00');
    expect(within(entry('meeting-committee')).getByTestId('auto-entry-words').textContent).toBe('(in the hall)\nThe water butts');
    // A table is named by its section, so it has no title of its own: its rows are its words, and no table is drawn until it is open.
    expect(within(entry('text-plots')).queryByText('Plots')).toBeNull();
    expect(within(entry('text-plots')).queryByRole('table')).toBeNull();
    expect(within(entry('text-plots')).getByTestId('auto-entry-words').textContent).toBe('Plot, Bed\n4, 2');
    expect(within(entry('text-plots')).getByTestId('auto-entry-words').className).toContain('text-foreground');
    openEntry('text-c');
    expect(within(entry('text-c')).getByRole('textbox', { name: 'Your note' })).toHaveValue('Buy a new washer');
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    expect(entry('item-2').querySelector('p')?.textContent).toBe('High Book the inspection');
    // Opened, it reads whole: the table is drawn.
    openEntry('text-plots');
    expect(within(entry('text-plots')).getByRole('table')).toBeInTheDocument();
  });

  it('resolves one entry at once, says so by name at the foot of the list, and Undo reopens it', async () => {
    await openQueue();
    press('text-b', 'Resolve');
    // The row leaves before the service has answered.
    expect(entryIds()).not.toContain('text-b');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b'], resolved: true }));
    // The line is there the moment the row leaves, before the service has answered.
    expect(saidText()).toBe('Sowed the beans., resolvedUndo');
    expect(digestWord()).toBe('Digest4 left');
    expect(screen.getByTestId('auto-queue-left').textContent).toBe('Left4');
    // The line is the sidebar's, not the page's and not the app's corner.
    expect(screen.getByTestId('auto').contains(said())).toBe(false);
    pressSaid('Undo');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b'], resolved: false }));
    await waitFor(() => expect(entryIds()).toContain('text-b'));
    expect(digestWord()).toBe('Digest5 left');
    expect(said()).toBeNull();
  });

  it('takes two resolves back before the service has answered either, each after its own post', async () => {
    await openQueue();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    press('text-b', 'Resolve');
    press('text-c', 'Resolve');
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots']);
    expect(saidText()).toBe('Mended the hose., resolvedUndo1 more');
    // Both come back at once, the newest first, while the service still has neither.
    pressSaid('Undo');
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-c']);
    expect(saidText()).toBe('Sowed the beans., resolvedUndo');
    pressSaid('Undo');
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-b', 'text-c']);
    expect(said()).toBeNull();
    expect(auto.asked('digest-resolve').map((route) => route.resolved)).toEqual([true, true]);
    release();
    // The service hears each resolve before its undoing, and ends with both open.
    await waitFor(() => expect(auto.asked('digest-resolve')).toHaveLength(4));
    const heard = auto.asked('digest-resolve').map((route) => `${route.ids[0]} ${route.resolved}`);
    expect(heard.indexOf('text-b true')).toBeLessThan(heard.indexOf('text-b false'));
    expect(heard.indexOf('text-c true')).toBeLessThan(heard.indexOf('text-c false'));
    await waitFor(() => expect(service('text-b')?.state).toBe('open'));
    await waitFor(() => expect(service('text-c')?.state).toBe('open'));
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-b', 'text-c']);
    expect(digestWord()).toBe('Digest5 left');
  });

  it('keeps an entry he brought back while the service still says it is resolved', async () => {
    await openQueue();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    press('text-b', 'Resolve');
    pressSaid('Undo');
    expect(entryIds()).toContain('text-b');
    // The resolve lands; its undoing is still on the way.
    let releaseSecond: () => void = () => undefined;
    release();
    auto.state.gate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    await waitFor(() => expect(service('text-b')?.state).toBe('resolved'));
    // The service says the day changed, and it is read again: resolved there, and still open here.
    act(() => auto.list({ kind: 'digest', date: DAY }));
    await waitFor(() => expect(auto.asked('digest').length).toBeGreaterThan(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entryIds()).toContain('text-b');
    expect(digestWord()).toBe('Digest5 left');
    releaseSecond();
    await waitFor(() => expect(service('text-b')?.state).toBe('open'));
    expect(entryIds()).toContain('text-b');
  });

  it('keeps a second resolve when the answer to the first one arrives without it', async () => {
    await openQueue();
    // The first answer comes back before the second post has landed: it still shows the second entry open.
    const request = auto.api.request as unknown as ReturnType<typeof vi.fn>;
    const answer = request.getMockImplementation() as (route: AutoRoute) => Promise<unknown>;
    let releaseSecond: () => void = () => undefined;
    const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
    request.mockImplementation(async (route: AutoRoute) => {
      if (route.kind === 'digest-resolve' && route.ids[0] === 'text-c') await second;
      return answer(route);
    });
    press('text-b', 'Resolve');
    press('text-c', 'Resolve');
    await waitFor(() => expect(service('text-b')?.state).toBe('resolved'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots']);
    expect(digestWord()).toBe('Digest3 left');
    releaseSecond();
    await waitFor(() => expect(service('text-c')?.state).toBe('resolved'));
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots']);
  });

  it('resolves a section’s open entries in one post, and Undo reopens them all', async () => {
    await openQueue();
    fireEvent.click(within(screen.getByRole('region', { name: 'Yesterday' })).getByRole('button', { name: 'Resolve all' }));
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b', 'text-c'], resolved: true }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Yesterday' })).toBeNull());
    expect(auto.asked('digest-resolve')).toHaveLength(1);
    expect(saidText()).toBe('Yesterday, 2 resolvedUndo');
    pressSaid('Undo');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b', 'text-c'], resolved: false }));
    await waitFor(() => expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-b', 'text-c']));
  });

  it('offers Resolve all only for a section of reading with more than one entry left', async () => {
    await openQueue();
    const offered = () => screen.getAllByTestId('auto-queue-section').filter((section) => within(section).queryByRole('button', { name: 'Resolve all' })).map((section) => section.getAttribute('aria-label'));
    expect(offered()).toEqual(['Yesterday']);
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    expect(offered()).toEqual(['Yesterday']);
    // To-dos are each a thing to do, however many are left.
    auto.state.digests[DAY] = autoDigest(DAY, [['Top 3', [digestEntry('item-1', { kind: 'item' }), digestEntry('item-2', { kind: 'item' })]], ['People', [digestEntry('p1'), digestEntry('p2'), digestEntry('p3', { state: 'resolved' })]]]);
    act(() => auto.list({ kind: 'digest', date: DAY }));
    await waitFor(() => expect(entryIds()).toEqual(['item-1', 'item-2', 'p1', 'p2', 'p3']));
    expect(offered()).toEqual(['People']);
  });

  it('brings the row back with the service’s sentence when it refuses', async () => {
    await openQueue();
    auto.state.failWrites = { kind: 'refused', message: 'That entry is no longer in the digest.', code: 'gone', status: 409 };
    press('text-b', 'Resolve');
    expect(entryIds()).not.toContain('text-b');
    // The reason first and whole; what it was about after it.
    await waitFor(() => expect(saidText()).toBe('That entry is no longer in the digest.Sowed the beans.'));
    expect(said()?.getAttribute('data-problem')).toBe('true');
    expect(within(said() as HTMLElement).queryByRole('button')).toBeNull();
    expect(entryIds()).toContain('text-b');
    expect(digestWord()).toBe('Digest5 left');
  });

  it('opens an entry with the caret in its box for Thread, and makes nothing until he says what he wants done', async () => {
    await openQueue();
    press('meeting-committee', 'Thread');
    const words = within(entry('meeting-committee')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(words));
    expect(entry('meeting-committee').getAttribute('data-open')).toBe('true');
    expect(words.placeholder).toBe('Say what you want done');
    // Nothing is made by the button, by Enter on no words, or by stepping out.
    fireEvent.keyDown(words, { key: 'Enter' });
    expect(within(entry('meeting-committee')).getByRole('button', { name: 'Start a thread with it' })).toBeDisabled();
    fireEvent.keyDown(words, { key: 'Escape' });
    openEntry('meeting-committee');
    expect(entry('meeting-committee').getAttribute('data-open')).toBeNull();
    expect(auto.asked('digest-thread')).toEqual([]);
    expect(entryIds()).toContain('meeting-committee');
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'inspect']);

    // The way without words is offered only while the box is empty.
    press('meeting-committee', 'Thread');
    expect(within(entry('meeting-committee')).getByTestId('auto-entry-wordless').textContent).toBe('Make it without words');
    fireEvent.change(within(entry('meeting-committee')).getByTestId('auto-entry-box'), { target: { value: 'Add the water butts to the agenda' } });
    expect(within(entry('meeting-committee')).queryByTestId('auto-entry-wordless')).toBeNull();
    // His words start the thread, with the entry, and it opens.
    fireEvent.keyDown(within(entry('meeting-committee')).getByTestId('auto-entry-box'), { key: 'Enter' });
    await waitFor(() => expect(last('digest-thread')).toMatchObject({ kind: 'digest-thread', date: DAY, id: 'meeting-committee', words: 'Add the water butts to the agenda', cid: expect.any(String) }));
    expect(auto.asked('digest-thread')).toHaveLength(1);
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-meeting-committee'));
  });

  it('makes a thread without words that waits on top of the list, says so with Open and Undo, and he stays in the queue', async () => {
    await openQueue();
    press('meeting-committee', 'Thread');
    fireEvent.click(within(entry('meeting-committee')).getByTestId('auto-entry-wordless'));
    // The entry leaves Left at once.
    expect(entryIds()).not.toContain('meeting-committee');
    await waitFor(() => expect(last('digest-thread')).toEqual({ kind: 'digest-thread', date: DAY, id: 'meeting-committee', words: null, cid: null }));
    // On top of the list, under the thread that waits on him.
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'from-meeting-committee', 'bread', 'seeds', 'inspect']));
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
    expect(auto.followed.thread).toBeNull();
    expect(digestWord()).toBe('Digest4 left');
    expect(saidText()).toBe('Committee, made a threadOpenUndo');
    // Undo archives the thread nobody has started, and the entry is open again.
    auto.state.digests[DAY] = day();
    pressSaid('Undo');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'from-meeting-committee', archived: true }));
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'inspect']));
    await waitFor(() => expect(entryIds()).toContain('meeting-committee'));
  });

  it('opens the thread it made from the line at the foot of the list', async () => {
    await openQueue();
    press('meeting-committee', 'Thread');
    fireEvent.click(within(entry('meeting-committee')).getByTestId('auto-entry-wordless'));
    expect(saidText()).toBe('Committee, made a threadOpenUndo');
    pressSaid('Open');
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-meeting-committee'));
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
    expect(said()).toBeNull();
  });
});

describe('an entry opened in place', () => {
  it('opens on a click with its note, its drafted reply and a box, one entry at a time', async () => {
    await openQueue();
    openEntry('item-1');
    const opened = within(entry('item-1'));
    expect(entry('item-1').getAttribute('data-open')).toBe('true');
    expect(entry('item-1').querySelector('.auto-clip')).toBeNull();
    expect(opened.getByRole('textbox', { name: 'Your note' }).getAttribute('placeholder')).toBe('Add a note');
    expect(opened.getByTestId('auto-entry-draft').textContent).toBe('Reply drafted for Garden centreTwo trays, please.\n\nI can collect them.Copy');
    expect(opened.getByTestId('auto-entry-box').getAttribute('placeholder')).toBe('Say what you want done');
    // Opened to read, the caret is not put in the box.
    expect(document.activeElement).not.toBe(opened.getByTestId('auto-entry-box'));
    // No button until the note differs from the saved one.
    expect(opened.queryByRole('button', { name: /the note$/ })).toBeNull();
    openEntry('text-c');
    expect(entry('item-1').getAttribute('data-open')).toBeNull();
    expect(entry('text-c').getAttribute('data-open')).toBe('true');
    expect((within(entry('text-c')).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe('Buy a new washer');
    expect(within(entry('text-c')).queryByTestId('auto-entry-draft')).toBeNull();
    openEntry('text-c');
    expect(entry('text-c').getAttribute('data-open')).toBeNull();
  });

  it('saves his note, and removes it when the field is emptied', async () => {
    await openQueue();
    openEntry('item-1');
    const note = within(entry('item-1')).getByRole('textbox', { name: 'Your note' });
    fireEvent.change(note, { target: { value: '  Ask about peat-free too ' } });
    fireEvent.click(within(entry('item-1')).getByRole('button', { name: 'Save the note' }));
    await waitFor(() => expect(last('digest-note')).toEqual({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'Ask about peat-free too' }));
    await waitFor(() => expect(within(entry('item-1')).queryByRole('button', { name: 'Save the note' })).toBeNull());
    expect(service('item-1')?.note).toBe('Ask about peat-free too');
    fireEvent.change(note, { target: { value: '' } });
    fireEvent.click(within(entry('item-1')).getByRole('button', { name: 'Remove the note' }));
    await waitFor(() => expect(last('digest-note')).toEqual({ kind: 'digest-note', date: DAY, id: 'item-1', text: '' }));
    await waitFor(() => expect(within(entry('item-1')).queryByRole('button', { name: 'Remove the note' })).toBeNull());
    expect(service('item-1')?.note).toBe('');
  });

  it('copies the drafted reply to the clipboard, and offers nothing that sends it', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await openQueue();
    openEntry('item-1');
    const draft = within(within(entry('item-1')).getByTestId('auto-entry-draft'));
    expect(draft.getAllByRole('button').map((button) => button.textContent)).toEqual(['Copy']);
    const before = auto.routes().length;
    fireEvent.click(draft.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Two trays, please.\n\nI can collect them.');
    expect(draft.getByRole('button').textContent).toBe('Copied');
    expect(auto.routes()).toHaveLength(before);
    expect(screen.getByTestId('auto-queue-pane').textContent).not.toMatch(/\bSend\b|Send it|Confirm/);
  });

  it('keeps the chosen reply model on the digest draft, in the thread it creates, and for later new threads', async () => {
    await openQueue();
    openEntry('item-1');
    const picker = () => within(entry('item-1')).getByTestId('auto-model');
    await userEvent.setup().click(picker());
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Large' }));
    await userEvent.setup().click(within(entry('item-1')).getByRole('button', { name: 'Effort: Default effort' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Ultra' }));
    await userEvent.setup().click(within(entry('item-1')).getByRole('button', { name: 'Speed: Standard' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Fast' }));
    openEntry('meeting-committee');
    expect(within(entry('meeting-committee')).getByTestId('auto-model')).toHaveAccessibleName('Model: Large');
    await userEvent.setup().click(within(entry('meeting-committee')).getByTestId('auto-model'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Small' }));
    openEntry('item-1');
    expect(picker()).toHaveAccessibleName('Model: Large');
    const box = within(entry('item-1')).getByTestId('auto-entry-box');
    fireEvent.change(box, { target: { value: 'Plan the collection' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(last('digest-thread')).toMatchObject({ model: 'large', effort: 'ultra', speed: 'priority', words: 'Plan the collection' }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
    expect(screen.getByTestId('auto-model')).toHaveAccessibleName('Model: Large');
    expect(screen.getByRole('button', { name: 'Effort: Ultra' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Speed: Fast' })).toBeVisible();
    expect(useThreadStore.getState().newModel).toEqual({ model: 'small' });
    fireEvent.click(digestRow());
    openEntry('meeting-committee');
    await userEvent.setup().click(within(entry('meeting-committee')).getByTestId('auto-model'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Default' }));
    fireEvent.click(within(entry('meeting-committee')).getByTestId('auto-entry-wordless'));
    await waitFor(() => expect(last('digest-thread')).toMatchObject({ id: 'meeting-committee', words: null, model: '' }));
  });

  it('starts a thread from a digest entry with a pasted image', async () => {
    await openQueue();
    openEntry('item-1');
    const form = within(entry('item-1'));
    const box = form.getByTestId('auto-entry-box');
    pasteFiles(box, [screenshot()]);
    await waitFor(() => expect(form.getByTestId('auto-send')).toBeEnabled());
    expect(auto.asked('digest-thread')).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(last('digest-thread')).toMatchObject({ date: DAY, id: 'item-1', images: [PNG_ID] }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
  });

  it('starts a thread with his words on Enter and opens it', async () => {
    await openQueue();
    openEntry('item-1');
    const box = within(entry('item-1')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Ask for collection on Saturday' } });
    await userEvent.setup().type(box, '{Shift>}{Enter}{/Shift}');
    expect(auto.asked('digest-thread')).toEqual([]);
    fireEvent.change(box, { target: { value: 'Ask for collection on Saturday' } });
    await userEvent.setup().type(box, '{Enter}');
    await waitFor(() => expect(auto.asked('digest-thread')).toHaveLength(1));
    const said = last('digest-thread');
    expect(said).toMatchObject({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Ask for collection on Saturday' });
    expect(said?.cid).toMatch(/^[0-9a-f]{10}$/);
    expect(JSON.stringify(said)).not.toMatch(/sends/);
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
    expect(rowIds()).toEqual(['beds', 'from-item-1', 'bread', 'seeds', 'inspect']);
    expect(useDigestStore.getState().words).toEqual({});
  });

  it('shows his words on their way the moment Enter is taken, before the thread exists', async () => {
    await openQueue();
    openEntry('item-1');
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    const box = within(entry('item-1')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Ask for collection on Saturday' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(within(entry('item-1')).getByTestId('auto-entry-pending').textContent).toBe('Ask for collection on Saturday');
    expect(box.value).toBe('');
    // A second Enter while it is on its way starts nothing more.
    fireEvent.keyDown(box, { key: 'Enter' });
    release();
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
    expect(auto.asked('digest-thread')).toHaveLength(1);
  });

  it('keeps his words in the box under Not sent when the post fails, and sends them again under the same id', async () => {
    await openQueue();
    openEntry('item-1');
    const box = () => within(entry('item-1')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    fireEvent.change(box(), { target: { value: 'Ask for collection on Saturday' } });
    await userEvent.setup().type(box(), '{Enter}');
    await waitFor(() => expect(within(entry('item-1')).getByTestId('auto-entry-not-sent').textContent).toBe('Not sentRetry'));
    expect(box().value).toBe('Ask for collection on Saturday');
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
    const first = last('digest-thread')?.cid;
    auto.state.failWrites = null;
    fireEvent.click(within(within(entry('item-1')).getByTestId('auto-entry-not-sent')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
    expect(auto.asked('digest-thread')).toHaveLength(2);
    expect(last('digest-thread')?.cid).toBe(first);
  });

  it('keeps what he typed for an entry while he looks at another', async () => {
    await openQueue();
    openEntry('item-1');
    fireEvent.change(within(entry('item-1')).getByTestId('auto-entry-box'), { target: { value: 'Half typed' } });
    openEntry('text-b');
    expect((within(entry('text-b')).getByTestId('auto-entry-box') as HTMLTextAreaElement).value).toBe('');
    openEntry('item-1');
    expect((within(entry('item-1')).getByTestId('auto-entry-box') as HTMLTextAreaElement).value).toBe('Half typed');
  });

  it('opens a vault file linked in an entry as a page, and the digest’s own file from the header', async () => {
    await openQueue();
    // A closed entry is plain words; opened, its links can be followed.
    expect(within(entry('item-1')).queryByRole('link')).toBeNull();
    openEntry('item-1');
    fireEvent.click(within(entry('item-1')).getByRole('link', { name: 'Beds' }));
    await waitFor(() => expect(tabPaths()).toEqual([null, null, '/Vault/Projects/Beds.md']));
    expect(auto.api.resolvePage).toHaveBeenCalledWith('Projects/Beds.md');
    // Returning from the page still shows the expanded entry.
    fireEvent.click(screen.getByTestId('auto-digest-row'));
    expect(entry('item-1').getAttribute('data-open')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Open the digest' }));
    await waitFor(() => expect(auto.api.resolvePage).toHaveBeenCalledWith(`Library/digests/${DAY} digest.md`));
    await waitFor(() => expect(tabPaths()).toContain(`/Vault/Library/digests/${DAY} digest.md`));
  });
});

describe('All', () => {
  it('shows the day whole, with what became of each entry', async () => {
    await openQueue();
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    expect(screen.getByTestId('auto-queue-all').getAttribute('aria-pressed')).toBe('true');
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'item-2', 'item-3', 'text-plots', 'text-a', 'text-b', 'text-c']);
    expect(entry('text-a').getAttribute('data-state')).toBe('resolved');
    expect(within(entry('text-a')).getByText('Resolved')).toBeInTheDocument();
    expect(within(entry('text-a')).getAllByRole('button').filter((button) => button.tagName === 'BUTTON').map((button) => button.textContent)).toEqual(['Reopen']);
    // One that became a thread shows that thread's own line, as its row in the list does.
    expect(entry('item-2').textContent).toContain('The committee walks the plots.');
    expect(within(entry('item-2')).queryByText('A thread')).toBeNull();
    expect(within(entry('item-2')).queryByRole('button', { name: 'Open the thread' })).toBeNull();
    // Its thread is not in the list (archived or snoozed away): it only says what it became.
    expect(within(entry('item-3')).getByText('A thread')).toBeInTheDocument();
    // An open entry has neither word.
    expect(entry('text-b').textContent).not.toMatch(/Resolved|A thread/);
    // The line follows the thread: while it works, its live line.
    act(() => auto.list({ kind: 'thread', thread: { ...INSPECTION, waits: false, status: 'working', activity: 'Reading the rota' } }));
    expect(entry('item-2').textContent).toContain('Reading the rota');
  });

  it('reopens a resolved entry, with no Undo to offer', async () => {
    await openQueue();
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    press('text-a', 'Reopen');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-a'], resolved: false }));
    await waitFor(() => expect(entry('text-a').getAttribute('data-state')).toBe('open'));
    expect(said()).toBeNull();
    expect(digestWord()).toBe('Digest6 left');
  });

  it('opens the thread an entry became from its row', async () => {
    await openQueue();
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    openEntry('item-2');
    await waitFor(() => expect(auto.followed.thread?.id).toBe('inspect'));
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
    expect(screen.getByTestId('auto-thread')).toBeInTheDocument();
  });

  it('has no box for an entry that is resolved or already a thread', async () => {
    await openQueue();
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    openEntry('text-a');
    expect(within(entry('text-a')).getByRole('textbox', { name: 'Your note' })).toBeInTheDocument();
    expect(within(entry('text-a')).queryByTestId('auto-entry-box')).toBeNull();
    // A thread that is not in the list opens in place, with no box either.
    openEntry('item-3');
    expect(entry('item-3').getAttribute('data-open')).toBe('true');
    expect(within(entry('item-3')).queryByTestId('auto-entry-box')).toBeNull();
  });
});

describe('the days', () => {
  it('steps to the earlier day, shown whole, while the row still counts the latest', async () => {
    await openQueue();
    expect(screen.getByRole('button', { name: 'Later day' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier day' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12'));
    expect(last('digest')).toEqual({ kind: 'digest', date: EARLIER });
    expect(screen.getByTestId('auto-queue-all').getAttribute('aria-pressed')).toBe('true');
    expect(entryIds()).toEqual(['item-1', 'item-2']);
    expect(screen.getByTestId('auto-queue-left').textContent).toBe('Left1');
    expect(digestWord()).toBe('Digest5 left');
  });

  it('writes to the day that is shown', async () => {
    await openQueue();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier day' }));
    await waitFor(() => expect(entryIds()).toEqual(['item-1', 'item-2']));
    press('item-2', 'Resolve');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: EARLIER, ids: ['item-2'], resolved: true }));
    await waitFor(() => expect(entry('item-2').getAttribute('data-state')).toBe('resolved'));
    expect(screen.getByTestId('auto-queue-left').textContent).toBe('Left0');
    // The latest day's count is its own.
    expect(digestWord()).toBe('Digest5 left');
    expect(service('text-b')?.state).toBe('open');
  });

  it('says a digest has no entries, stops at the first day, and steps back to the latest on Left', async () => {
    await openQueue();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier day' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12'));
    fireEvent.click(screen.getByRole('button', { name: 'Earlier day' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Wednesday, November 11'));
    expect(screen.getByTestId('auto-queue-empty').textContent).toBe('This digest has no entries.');
    expect(screen.getByRole('button', { name: 'Earlier day' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Later day' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12'));
    fireEvent.click(screen.getByRole('button', { name: 'Later day' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13'));
    expect(screen.getByTestId('auto-queue-left').getAttribute('aria-pressed')).toBe('true');
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-b', 'text-c']);
  });
});

describe('the queue’s own keys', () => {
  const pane = () => screen.getByTestId('auto-queue-pane');
  const focusedEntry = () => document.activeElement?.getAttribute('data-entry-id') ?? null;

  it('steps to the earlier day with [ and the later with ], with the keyboard on the day’s first entry', async () => {
    await openQueue();
    await waitFor(() => expect(focusedEntry()).toBe('meeting-committee'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: '[' });
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12'));
    await waitFor(() => expect(focusedEntry()).toBe('item-1'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: ']' });
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13'));
    await waitFor(() => expect(focusedEntry()).toBe('meeting-committee'));
    // At the latest day ] has nowhere to go.
    const reads = auto.asked('digest').length;
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: ']' });
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13');
    expect(auto.asked('digest')).toHaveLength(reads);
  });

  it('switches between Left and All with A', async () => {
    await openQueue();
    await waitFor(() => expect(focusedEntry()).toBe('meeting-committee'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'a' });
    expect(screen.getByTestId('auto-queue-all').getAttribute('aria-pressed')).toBe('true');
    expect(entryIds()).toContain('text-a');
    await waitFor(() => expect(focusedEntry()).toBe('meeting-committee'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'a' });
    expect(screen.getByTestId('auto-queue-left').getAttribute('aria-pressed')).toBe('true');
    expect(entryIds()).not.toContain('text-a');
  });

  it('leaves the keys alone in a field, with a modifier, and in a menu', async () => {
    await openQueue();
    openEntry('item-1');
    const words = within(entry('item-1')).getByTestId('auto-entry-box');
    for (const name of ['[', ']', 'a']) expect(fireEvent.keyDown(words, { key: name })).toBe(true);
    const note = within(entry('item-1')).getByRole('textbox', { name: 'Your note' });
    for (const name of ['[', ']', 'a']) expect(fireEvent.keyDown(note, { key: name })).toBe(true);
    expect(fireEvent.keyDown(pane(), { key: 'a', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(pane(), { key: '[', metaKey: true })).toBe(true);
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13');
    expect(screen.getByTestId('auto-queue-left').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('archiving the digest', () => {
  const archiveFromMenu = async () => {
    await userEvent.setup().click(screen.getByTestId('auto-digest-menu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive the digest' }));
  };
  const openArchive = async () => {
    fireEvent.click(screen.getByTestId('auto-away-row'));
    await screen.findByTestId('auto-archived');
  };

  it('archives the digest from its own row, by E or its right-click menu, with Undo', async () => {
    await open();
    await waitFor(() => expect(digestWord()).toBe('Digest5 left'));
    const next = [...screen.getByTestId('auto-list').querySelectorAll('[data-auto-row]')][0].getAttribute('data-row-id');
    digestRow().focus();
    expect(digestRow().getAttribute('aria-keyshortcuts')).toBe('E');
    fireEvent.keyDown(digestRow(), { key: 'e' });
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    expect(saidText()).toBe('Digest archived. It is off the list.Undo');
    // By a key, the keyboard takes the row below.
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(next);
    pressSaid('Undo');
    await waitFor(() => expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument());
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: digestRow() });
    const menu = await screen.findByTestId('auto-digest-menu-row');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open in new tab', 'Open to the side', 'Archive the digestE', 'Open the digest']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Archive the digest/ }));
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    await waitFor(() => expect(auto.asked('digest-archive').map((route) => route.archived)).toEqual([true, false, true]));
  });

  it('takes the Digest row off the list from the queue’s menu, says so, and Undo puts it back', async () => {
    await openQueue();
    await userEvent.setup().click(screen.getByTestId('auto-digest-menu'));
    // One thing in the menu, as on the phone.
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Archive the digest']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive the digest' }));
    // At once: the row has left, and the queue stays open to read.
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    expect(saidText()).toBe('Digest archived. It is off the list.Undo');
    await waitFor(() => expect(last('digest-archive')).toEqual({ kind: 'digest-archive', date: DAY, archived: true }));
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
    expect(entryIds()).toEqual(['meeting-committee', 'item-1', 'text-plots', 'text-b', 'text-c']);
    // Nothing in it changed.
    expect(auto.asked('digest-resolve')).toEqual([]);
    pressSaid('Undo');
    expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument();
    await waitFor(() => expect(last('digest-archive')).toEqual({ kind: 'digest-archive', date: DAY, archived: false }));
    expect(auto.asked('digest-archive').map((route) => route.archived)).toEqual([true, false]);
    expect(digestWord()).toBe('Digest5 left');
  });

  it('says Archived at its foot with the way back, as an archived thread does, and the menu offers Bring back', async () => {
    await openQueue();
    expect(screen.queryByTestId('auto-queue-archived')).toBeNull();
    await archiveFromMenu();
    const foot = await screen.findByTestId('auto-queue-archived');
    expect(foot.textContent).toBe('ArchivedIt is off the list until the next digest.Bring back');
    // The day's own title is as it was.
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13');
    await userEvent.setup().click(screen.getByTestId('auto-digest-menu'));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Bring back']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('auto-digest-back'));
    expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-queue-archived')).toBeNull();
    await waitFor(() => expect(last('digest-archive')).toEqual({ kind: 'digest-archive', date: DAY, archived: false }));
    // Bringing back can be undone too: it is put away again.
    expect(saidText()).toBe('Back in the list.Undo');
    pressSaid('Undo');
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    await waitFor(() => expect(auto.asked('digest-archive').map((route) => route.archived)).toEqual([true, false, true]));
  });

  it('lists an archived digest first under Archived, opens it from there, and brings it back from its row', async () => {
    await openQueue({ archived: [autoThread('old', { title: 'Old thread', archived: true, archivedAt: 1_794_000_000 })] });
    await archiveFromMenu();
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    // Away from the queue, the archive is the way to it.
    fireEvent.click(row('bread').querySelector('[data-auto-row]') as HTMLElement);
    await screen.findByTestId('auto-thread');
    await openArchive();
    const rows = [...screen.getByTestId('auto-archived').querySelectorAll('[data-away-row]')].map((element) => element.getAttribute('data-row-id'));
    expect(rows[0]).toBe(`:digest:${DAY}`);
    await waitFor(() => expect(screen.getByTestId('auto-archived').querySelector('[data-thread-id="old"]')).not.toBeNull());
    const digest = screen.getByTestId(`auto-archived-digest-${DAY}`);
    expect(within(digest).getByText('Digest')).toBeInTheDocument();
    expect(within(digest).getByText('Friday, November 13')).toBeInTheDocument();
    fireEvent.click(digest.querySelector('[data-away-row]') as HTMLElement);
    await screen.findByTestId('auto-queue-pane');
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13');
    expect(screen.getByTestId('auto-queue-archived')).toBeInTheDocument();
    // Opened from the page, the Snoozed row is the one marked, and it leads back there.
    expect(screen.getByTestId('auto-away-row').getAttribute('aria-current')).toBe('true');
    await openArchive();
    fireEvent.click(screen.getByTestId(`auto-restore-digest-${DAY}`));
    expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument();
    expect(screen.queryByTestId(`auto-archived-digest-${DAY}`)).toBeNull();
    await waitFor(() => expect(last('digest-archive')).toEqual({ kind: 'digest-archive', date: DAY, archived: false }));
  });

  it('brings an archived digest back with E on its row', async () => {
    await openQueue();
    await archiveFromMenu();
    await openArchive();
    const digest = screen.getByTestId(`auto-archived-digest-${DAY}`).querySelector('[data-away-row]') as HTMLElement;
    expect(digest.getAttribute('aria-keyshortcuts')).toBe('E');
    fireEvent.keyDown(digest, { key: 'e' });
    await waitFor(() => expect(last('digest-archive')).toEqual({ kind: 'digest-archive', date: DAY, archived: false }));
    expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument();
  });

  it('offers Archive the digest once nothing is left in it', async () => {
    await openQueue({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a')]]]) } });
    expect(screen.queryByTestId('auto-digest-archive-done')).toBeNull();
    press('a', 'Resolve');
    fireEvent.click(await screen.findByTestId('auto-digest-archive-done'));
    await waitFor(() => expect(last('digest-archive')).toEqual({ kind: 'digest-archive', date: DAY, archived: true }));
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    // Archived already, the button has done its work.
    expect(screen.queryByTestId('auto-digest-archive-done')).toBeNull();
    expect(screen.getByTestId('auto-queue-archived')).toBeInTheDocument();
  });

  it('reads an archived digest from the service: no Digest row, and the day in the archive', async () => {
    const archived = { ...day(), archived: true };
    await open({ digests: { [DAY]: archived, [EARLIER]: earlier() } });
    await waitFor(() => expect(useDigestStore.getState().archivedDays).toEqual([DAY]));
    expect(screen.queryByTestId('auto-digest-row')).toBeNull();
    await openArchive();
    expect(screen.getByTestId(`auto-archived-digest-${DAY}`)).toBeInTheDocument();
    // An older day he archived is listed too, and reads whole.
    auto.state.digests[EARLIER] = { ...earlier(), archived: true };
    act(() => auto.list({ kind: 'digest', date: EARLIER }));
    await screen.findByTestId(`auto-archived-digest-${EARLIER}`);
    fireEvent.click(screen.getByTestId(`auto-archived-digest-${EARLIER}`).querySelector('[data-away-row]') as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12'));
    expect(screen.getByTestId('auto-queue-all').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('auto-queue-archived')).toBeInTheDocument();
  });

  it('follows an archive made on another device, and shows the row again when the next digest arrives', async () => {
    await openQueue();
    auto.state.digests[DAY] = { ...day(), archived: true };
    act(() => auto.list({ kind: 'digest', date: DAY }));
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    expect(await screen.findByTestId('auto-queue-archived')).toBeInTheDocument();
    // The next day's digest is not archived: the row is back, counting the new day.
    const NEXT = '2026-11-14';
    auto.state.digests[NEXT] = autoDigest(NEXT, [['Top 3', [digestEntry('item-1', { kind: 'item', title: 'Water the beds' })]]]);
    act(() => auto.list({ kind: 'digest', date: NEXT }));
    await waitFor(() => expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument());
    expect(digestWord()).toBe('Digest1 left');
  });

  it('puts the row back with the service’s sentence when the service refuses', async () => {
    await openQueue();
    auto.state.failWrites = { kind: 'refused', message: 'Send archived, true or false.', code: 'bad_request', status: 400 };
    await archiveFromMenu();
    await waitFor(() => expect(saidText()).toBe('Send archived, true or false.Digest'));
    expect(screen.getByTestId('auto-digest-row')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-queue-archived')).toBeNull();
    expect(useSaidStore.getState().stack).toEqual([]);
  });

  it('keeps the row away while the archive is on its way, whatever is read of the day meanwhile', async () => {
    await openQueue();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    await archiveFromMenu();
    await waitFor(() => expect(screen.queryByTestId('auto-digest-row')).toBeNull());
    // The service still has it as not archived, and says the day changed for another reason.
    act(() => auto.list({ kind: 'digest', date: DAY }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId('auto-digest-row')).toBeNull();
    release();
    await waitFor(() => expect(auto.state.digests[DAY].archived).toBe(true));
    expect(screen.queryByTestId('auto-digest-row')).toBeNull();
  });
});

describe('the empty queue', () => {
  it('says Nothing left with Show all, which shows the day whole', async () => {
    await openQueue({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a', { state: 'resolved' }), digestEntry('b', { state: 'thread', thread: 'inspect' })]]]) } });
    expect(screen.getByTestId('auto-queue-empty').textContent).toBe('Nothing left in this digest.Show all 2Archive the digest');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2' }));
    expect(entryIds()).toEqual(['a', 'b']);
    expect(screen.getByTestId('auto-queue-all').getAttribute('aria-pressed')).toBe('true');
  });

  it('says so once the last open entry is resolved', async () => {
    await openQueue({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a')]]]) } });
    press('a', 'Resolve');
    await waitFor(() => expect(screen.getByTestId('auto-queue-empty').textContent).toBe('Nothing left in this digest.Show all 1Archive the digest'));
    expect(digestWord()).toBe('DigestDone');
  });

  it('says it can’t read the digest when the service fails on it alone, and Retry reads it again', async () => {
    await openQueue({ failDigest: { kind: 'refused', message: 'The service failed.', code: 'server_error', status: 500 } });
    await waitFor(() => expect(useDigestStore.getState().status).toBe('failed'));
    expect(screen.getByTestId('auto-queue-failed').textContent).toBe("Can't read the digest.Retry");
    expect(digestWord()).toBe('Digest');
    // The list is not held up by it.
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'inspect']);
    auto.state.failDigest = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13'));
    expect(digestWord()).toBe('Digest5 left');
  });

  it('says No digest yet when the service has none', async () => {
    await openQueue({ digests: {} });
    await waitFor(() => expect(screen.getByTestId('auto-queue-empty').textContent).toBe('No digest yet.'));
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Digest');
    expect(screen.queryByRole('button', { name: 'Earlier day' })).toBeNull();
    expect(screen.queryByTestId('auto-queue-left')).toBeNull();
  });
});

describe('changes made somewhere else', () => {
  it('reads the open day and the count again when the service says a digest changed', async () => {
    await openQueue();
    const reads = auto.asked('digest').length;
    auto.state.digests[DAY] = autoDigest(DAY, [['Yesterday', [digestEntry('text-b', { md: 'Sowed the beans.' }), digestEntry('text-z', { md: 'Fed the tomatoes.' })]]]);
    act(() => auto.list({ kind: 'digest', date: DAY }));
    await waitFor(() => expect(entryIds()).toEqual(['text-b', 'text-z']));
    expect(digestWord()).toBe('Digest2 left');
    expect(auto.asked('digest').length).toBeGreaterThan(reads);
  });

  it('reads an earlier day again when that is the one open, and leaves the row’s count alone', async () => {
    await openQueue();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier day' }));
    await waitFor(() => expect(entryIds()).toEqual(['item-1', 'item-2']));
    auto.state.digests[EARLIER] = autoDigest(EARLIER, [['Top 3', [digestEntry('item-2', { kind: 'item', title: 'Net the brassicas', state: 'resolved' })]]]);
    act(() => auto.list({ kind: 'digest', date: EARLIER }));
    await waitFor(() => expect(entryIds()).toEqual(['item-2']));
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12');
    expect(digestWord()).toBe('Digest5 left');
  });

  it('moves the row’s count to a newer day when one arrives', async () => {
    await open();
    await waitFor(() => expect(digestWord()).toBe('Digest5 left'));
    auto.state.digests['2026-11-14'] = autoDigest('2026-11-14', [['Top 3', [digestEntry('item-1'), digestEntry('item-2')]]]);
    act(() => auto.list({ kind: 'digest', date: '2026-11-14' }));
    await waitFor(() => expect(digestWord()).toBe('Digest2 left'));
    expect(useDigestStore.getState().days[0]).toBe('2026-11-14');
  });

  it('reads the digest again when the list stream resets', async () => {
    await openQueue();
    auto.state.digests[DAY] = autoDigest(DAY, [['Yesterday', [digestEntry('text-z', { md: 'Fed the tomatoes.' })]]]);
    act(() => auto.list({ kind: 'reset' }));
    await waitFor(() => expect(entryIds()).toEqual(['text-z']));
    expect(digestWord()).toBe('Digest1 left');
  });

  it('forgets the digest with the address it came from', async () => {
    await openQueue();
    act(() => useAutoStore.setState({ address: 'https://other.example/agent' }));
    expect(useDigestStore.getState()).toMatchObject({ latest: null, status: 'unknown', days: [], past: null, words: {} });
  });
});

describe('a re-read while he works', () => {
  /** Reads the list again as a return to the front does, and waits until the digest has been read with it. */
  const reread = async (date: string | null = null) => {
    const before = auto.asked('digest').filter((route) => route.date === date).length;
    await act(() => useAutoStore.getState().refresh());
    await waitFor(() => expect(auto.asked('digest').filter((route) => route.date === date).length).toBeGreaterThan(before));
  };

  it('keeps the day he stepped to and the entry he opened, while the row moves to a newer day', async () => {
    await openQueue();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier day' }));
    await waitFor(() => expect(entryIds()).toEqual(['item-1', 'item-2']));
    openEntry('item-2');
    expect(entry('item-2').getAttribute('data-open')).toBe('true');
    auto.state.digests['2026-11-14'] = autoDigest('2026-11-14', [['Top 3', [digestEntry('item-1'), digestEntry('item-2')]]]);
    await reread(EARLIER);
    await waitFor(() => expect(digestWord()).toBe('Digest2 left'));
    expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12');
    expect(entryIds()).toEqual(['item-1', 'item-2']);
    expect(entry('item-2').getAttribute('data-open')).toBe('true');
  });

  it('keeps the entry open on the latest day', async () => {
    await openQueue();
    openEntry('item-1');
    await reread();
    expect(screen.getByTestId('auto-queue-left').getAttribute('aria-pressed')).toBe('true');
    expect(entry('item-1').getAttribute('data-open')).toBe('true');
  });

  it('keeps the open thread, its words in the box and the caret', async () => {
    await open({ snapshots: { bread: autoSnapshot(BREAD) } });
    fireEvent.click(within(row('bread')).getAllByRole('button')[0]);
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    const box = screen.getByTestId('auto-box') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Add the chard' } });
    act(() => box.focus());
    const threadReads = auto.asked('thread').length;
    await reread();
    expect(useThreadStore.getState().openId).toBe('bread');
    expect(screen.getByTestId('auto-box')).toBe(box);
    expect(box.value).toBe('Add the chard');
    expect(document.activeElement).toBe(box);
    // A thread that reads well is not read again.
    expect(auto.asked('thread')).toHaveLength(threadReads);
  });

  it('keeps the keyboard on the row it was on', async () => {
    await open();
    const button = within(row('seeds')).getAllByRole('button')[0];
    act(() => button.focus());
    await reread();
    expect(document.activeElement).toBe(button);
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'inspect']);
  });
});

describe('what the queue asks the service for', () => {
  it('never a tick by number, never the inbox, never a send', async () => {
    await openQueue();
    press('text-b', 'Resolve');
    await waitFor(() => expect(auto.asked('digest-resolve')).toHaveLength(1));
    press('meeting-committee', 'Thread');
    fireEvent.click(within(entry('meeting-committee')).getByTestId('auto-entry-wordless'));
    await waitFor(() => expect(auto.asked('digest-thread')).toHaveLength(1));
    openEntry('item-1');
    fireEvent.change(within(entry('item-1')).getByRole('textbox', { name: 'Your note' }), { target: { value: 'A note' } });
    fireEvent.click(within(entry('item-1')).getByRole('button', { name: 'Save the note' }));
    await waitFor(() => expect(auto.asked('digest-note')).toHaveLength(1));
    const box = within(entry('item-1')).getByTestId('auto-entry-box');
    fireEvent.change(box, { target: { value: 'send it' } });
    await userEvent.setup().type(box, '{Enter}');
    await waitFor(() => expect(auto.asked('digest-thread')).toHaveLength(2));
    const kinds = [...new Set(auto.routes().map((route) => route.kind))];
    expect(kinds.sort()).toEqual(['digest', 'digest-note', 'digest-resolve', 'digest-thread', 'digests', 'status', 'thread', 'threads', 'usage']);
    expect(JSON.stringify(auto.routes())).not.toMatch(/tick|inbox|sends|confirm/);
  });
});
