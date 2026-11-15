import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoRoute } from '@/types/auto';
import { AutoView, useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { browseAuto } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { ShellProvider } from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { autoDigest, autoSnapshot, autoThread, digestEntry, installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';
import { installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { entry as diskEntry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, tabPaths } from '@/tests/helpers/tabs';

const { toastPlain, toastError } = vi.hoisted(() => ({ toastPlain: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(toastPlain, { error: toastError }) }));

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
            <AutoView />
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
  toastPlain.mockClear();
  toastError.mockClear();
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

  it('keeps a marked thread that waits there, with its question and its buttons', async () => {
    await open({ threads: [BREAD, { ...BEDS, desk: { at: 1_794_000_100, by: 'phone' } }, SEEDS] });
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds']);
    const group = within(screen.getByTestId('auto-group-desk'));
    expect(group.getByText('Which wood for the frames?')).toBeInTheDocument();
    fireEvent.click(group.getByRole('button', { name: 'Larch' }));
    await waitFor(() => expect(last('answer')).toEqual({ kind: 'answer', id: 'beds', answer: { id: 'q0', answers: { 'Which wood for the frames?': 'Larch' } } }));
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

  it('hides a marked thread that is snoozed behind the Snoozed line', async () => {
    await open({ threads: [BREAD, { ...SEEDS, desk: { at: 1_794_000_100, by: 'phone' }, snoozed: 4_000_000_000 }] });
    expect(screen.queryByTestId('auto-group-desk')).toBeNull();
    expect(screen.getByTestId('auto-snoozed-line').textContent).toBe('Snoozed1');
  });
});

describe('the Digest row', () => {
  it('sits under New thread with how much is left, and is not a thread row', async () => {
    await open();
    await waitFor(() => expect(digestRow().textContent).toBe('Digest5 left'));
    const rows = [...screen.getByTestId('auto-list').querySelectorAll('[data-auto-row]')];
    expect(rows[0].getAttribute('data-testid')).toBe('auto-new-thread');
    expect(rows[1]).toBe(digestRow());
    expect(digestRow().closest('[data-thread-id]')).toBeNull();
    expect(digestRow().closest('[draggable="true"]')).toBeNull();
    expect(auto.asked('digest')).toEqual([{ kind: 'digest', date: null }]);
    expect(auto.asked('digests')).toHaveLength(1);
  });

  it('says Done with nothing left, and nothing with no digest', async () => {
    const view = await open({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a', { state: 'resolved' })]]]) } });
    await waitFor(() => expect(digestRow().textContent).toBe('DigestDone'));
    view.unmount();
    await open({ digests: {} });
    await waitFor(() => expect(useDigestStore.getState().status).toBe('none'));
    expect(digestRow().textContent).toBe('Digest');
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

  it('shows an entry’s title, its words clipped to three lines, a table whole and his note', async () => {
    await openQueue();
    expect(within(entry('item-1')).getByText('Order the trays')).toBeInTheDocument();
    expect(entry('item-1').querySelector('.auto-clip')).not.toBeNull();
    // A meeting's words open with its name in bold: it is not said twice.
    expect(entry('meeting-committee').textContent).toBe('10:00 Committee (in the hall)The water buttsResolveThread');
    // A table is named by its section, so it has no title of its own.
    expect(within(entry('text-plots')).queryByText('Plots')).toBeNull();
    expect(within(entry('text-plots')).getByRole('table')).toBeInTheDocument();
    expect(within(entry('text-c')).getByTestId('auto-entry-note').textContent).toBe('Buy a new washer');
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    expect(entry('item-2').querySelector('p')?.textContent).toBe('High Book the inspection');
  });

  it('resolves one entry, offers Undo, and Undo reopens the same entry', async () => {
    await openQueue();
    press('text-b', 'Resolve');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b'], resolved: true }));
    await waitFor(() => expect(entryIds()).not.toContain('text-b'));
    expect(digestRow().textContent).toBe('Digest4 left');
    expect(screen.getByTestId('auto-queue-left').textContent).toBe('Left4');
    expect(toastPlain).toHaveBeenCalledTimes(1);
    const [message, options] = toastPlain.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect([message, options.action.label]).toEqual(['Resolved', 'Undo']);
    act(() => options.action.onClick());
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b'], resolved: false }));
    await waitFor(() => expect(entryIds()).toContain('text-b'));
    expect(digestRow().textContent).toBe('Digest5 left');
  });

  it('resolves a section’s open entries in one post, and Undo reopens them all', async () => {
    await openQueue();
    fireEvent.click(within(screen.getByRole('region', { name: 'Yesterday' })).getByRole('button', { name: 'Resolve all' }));
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-b', 'text-c'], resolved: true }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Yesterday' })).toBeNull());
    expect(auto.asked('digest-resolve')).toHaveLength(1);
    const [message, options] = toastPlain.mock.calls[0] as [string, { action: { onClick: () => void } }];
    expect(message).toBe('2 resolved');
    act(() => options.action.onClick());
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

  it('says why when the service refuses, and changes nothing', async () => {
    await openQueue();
    auto.state.failWrites = { kind: 'refused', message: 'That entry is no longer in the digest.', code: 'gone', status: 409 };
    press('text-b', 'Resolve');
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That entry is no longer in the digest.'));
    expect(entryIds()).toContain('text-b');
    expect(toastPlain).not.toHaveBeenCalled();
  });

  it('makes a thread that waits on top of the list, and he stays in the queue', async () => {
    await openQueue();
    press('meeting-committee', 'Thread');
    await waitFor(() => expect(last('digest-thread')).toEqual({ kind: 'digest-thread', date: DAY, id: 'meeting-committee', words: null, cid: null }));
    // On top of the list, under the thread that waits on him.
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'from-meeting-committee', 'bread', 'seeds', 'inspect']));
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
    expect(auto.followed.thread).toBeNull();
    await waitFor(() => expect(entryIds()).not.toContain('meeting-committee'));
    expect(digestRow().textContent).toBe('Digest4 left');
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
    expect(opened.getByTestId('auto-entry-box').getAttribute('placeholder')).toBe('Say what to do with it');
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

  it('keeps his words in the box under Not sent when the post fails, and sends them again under the same id', async () => {
    await openQueue();
    openEntry('item-1');
    const box = () => within(entry('item-1')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    fireEvent.change(box(), { target: { value: 'Ask for collection on Saturday' } });
    await userEvent.setup().type(box(), '{Enter}');
    await waitFor(() => expect(within(entry('item-1')).getByTestId('auto-entry-not-sent').textContent).toBe('Not sent'));
    expect(box().value).toBe('Ask for collection on Saturday');
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
    const first = last('digest-thread')?.cid;
    auto.state.failWrites = null;
    await userEvent.setup().type(box(), '{Enter}');
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
    fireEvent.click(within(entry('item-1')).getByRole('link', { name: 'Beds' }));
    await waitFor(() => expect(tabPaths()).toEqual([null, '/Vault/Projects/Beds.md']));
    expect(auto.api.resolvePage).toHaveBeenCalledWith('Projects/Beds.md');
    // Following the link did not open the entry.
    expect(entry('item-1').getAttribute('data-open')).toBeNull();
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
    expect(within(entry('text-a')).getAllByRole('button').filter((button) => button.getAttribute('role') !== 'button').map((button) => button.textContent)).toEqual(['Reopen']);
    expect(within(entry('item-2')).getByText('A thread')).toBeInTheDocument();
    expect(within(entry('item-2')).getByRole('button', { name: 'Open the thread' })).toBeInTheDocument();
    // Its thread is not in the list (archived or snoozed away): nothing to open.
    expect(within(entry('item-3')).getByText('A thread')).toBeInTheDocument();
    expect(within(entry('item-3')).queryByRole('button', { name: 'Open the thread' })).toBeNull();
    // An open entry has neither word.
    expect(entry('text-b').textContent).not.toMatch(/Resolved|A thread/);
  });

  it('reopens a resolved entry, with no Undo to offer', async () => {
    await openQueue();
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    press('text-a', 'Reopen');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-a'], resolved: false }));
    await waitFor(() => expect(entry('text-a').getAttribute('data-state')).toBe('open'));
    expect(toastPlain).not.toHaveBeenCalled();
    expect(digestRow().textContent).toBe('Digest6 left');
  });

  it('opens the thread an entry became', async () => {
    await openQueue();
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    press('item-2', 'Open the thread');
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
    openEntry('item-2');
    expect(within(entry('item-2')).queryByTestId('auto-entry-box')).toBeNull();
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
    expect(digestRow().textContent).toBe('Digest5 left');
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
    expect(digestRow().textContent).toBe('Digest5 left');
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

describe('the empty queue', () => {
  it('says Nothing left with Show all, which shows the day whole', async () => {
    await openQueue({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a', { state: 'resolved' }), digestEntry('b', { state: 'thread', thread: 'inspect' })]]]) } });
    expect(screen.getByTestId('auto-queue-empty').textContent).toBe('Nothing left in this digest.Show all 2');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 2' }));
    expect(entryIds()).toEqual(['a', 'b']);
    expect(screen.getByTestId('auto-queue-all').getAttribute('aria-pressed')).toBe('true');
  });

  it('says so once the last open entry is resolved', async () => {
    await openQueue({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('a')]]]) } });
    press('a', 'Resolve');
    await waitFor(() => expect(screen.getByTestId('auto-queue-empty').textContent).toBe('Nothing left in this digest.Show all 1'));
    expect(digestRow().textContent).toBe('DigestDone');
  });

  it('says it can’t read the digest when the service fails on it alone, and Retry reads it again', async () => {
    await openQueue({ failDigest: { kind: 'refused', message: 'The service failed.', code: 'server_error', status: 500 } });
    await waitFor(() => expect(useDigestStore.getState().status).toBe('failed'));
    expect(screen.getByTestId('auto-queue-failed').textContent).toBe("Can't read the digest.Retry");
    expect(digestRow().textContent).toBe('Digest');
    // The list is not held up by it.
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'inspect']);
    auto.state.failDigest = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13'));
    expect(digestRow().textContent).toBe('Digest5 left');
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
    expect(digestRow().textContent).toBe('Digest2 left');
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
    expect(digestRow().textContent).toBe('Digest5 left');
  });

  it('moves the row’s count to a newer day when one arrives', async () => {
    await open();
    await waitFor(() => expect(digestRow().textContent).toBe('Digest5 left'));
    auto.state.digests['2026-11-14'] = autoDigest('2026-11-14', [['Top 3', [digestEntry('item-1'), digestEntry('item-2')]]]);
    act(() => auto.list({ kind: 'digest', date: '2026-11-14' }));
    await waitFor(() => expect(digestRow().textContent).toBe('Digest2 left'));
    expect(useDigestStore.getState().days[0]).toBe('2026-11-14');
  });

  it('reads the digest again when the list stream resets', async () => {
    await openQueue();
    auto.state.digests[DAY] = autoDigest(DAY, [['Yesterday', [digestEntry('text-z', { md: 'Fed the tomatoes.' })]]]);
    act(() => auto.list({ kind: 'reset' }));
    await waitFor(() => expect(entryIds()).toEqual(['text-z']));
    expect(digestRow().textContent).toBe('Digest1 left');
  });

  it('forgets the digest with the address it came from', async () => {
    await openQueue();
    act(() => useAutoStore.setState({ address: 'https://other.example/agent' }));
    expect(useDigestStore.getState()).toMatchObject({ latest: null, status: 'unknown', days: [], past: null, words: {} });
  });
});

describe('the narrow layout', () => {
  it('treats the queue like an open thread: it hides the list, and its back button shows the list alone', async () => {
    class Observer {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: 600 } }]); }
      disconnect() { /* nothing to release */ }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    await open();
    expect(screen.getByTestId('auto').getAttribute('data-narrow')).toBe('true');
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
    fireEvent.click(digestRow());
    await screen.findByTestId('auto-queue-pane');
    expect(screen.queryByTestId('auto-list')).toBeNull();
    fireEvent.click(screen.getByTestId('auto-back'));
    expect(screen.getByTestId('auto-list')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
  });
});

describe('what the queue asks the service for', () => {
  it('never a tick by number, never the inbox, never a send', async () => {
    await openQueue();
    press('text-b', 'Resolve');
    await waitFor(() => expect(auto.asked('digest-resolve')).toHaveLength(1));
    press('meeting-committee', 'Thread');
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
    expect(kinds.sort()).toEqual(['digest', 'digest-note', 'digest-resolve', 'digest-thread', 'digests', 'status', 'thread', 'threads']);
    expect(JSON.stringify(auto.routes())).not.toMatch(/tick|inbox|sends|confirm/);
  });
});
