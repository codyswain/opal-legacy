import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoRoute } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { forgetPlaces } from '@/renderer/features/auto/model/places';
import { NO_MATCH, useDigestStore } from '@/renderer/features/auto/store/digestStore';
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
import { entry as diskEntry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs } from '@/tests/helpers/tabs';

/*
 * An open entry that matches a thread he has: "Continues: <thread>" on its
 * row, and one click adds it there instead of making a new thread. Nothing
 * is added but by his click or his Enter.
 */

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
const LABELS = autoThread('labels', { title: 'Pantry labels', last: 'A4, 21 to a page.', snoozed: 4_000_000_000 });
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
    // Two entries that match a thread he has: one in the list, one snoozed.
    digestEntry('text-b', { md: 'Sowed the beans.', continues: { id: 'seeds', title: 'Seed order', snoozed: false } }),
    digestEntry('text-c', { md: 'Mended the hose.', note: 'Buy a new washer', continues: { id: 'labels', title: 'Pantry labels', snoozed: true } }),
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
    threads: [BEDS, BREAD, SEEDS, INSPECTION, LABELS],
    snapshots: { bread: autoSnapshot(BREAD), seeds: autoSnapshot(SEEDS), labels: autoSnapshot(LABELS), inspect: autoSnapshot(INSPECTION, { seed: 'Book the inspection' }) },
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
const entry = (id: string) => screen.getByTestId(`auto-entry-${id}`);
const entryIds = () => [...screen.getByTestId('auto-queue').querySelectorAll('li[data-state]')].map((element) => element.getAttribute('data-testid')?.replace('auto-entry-', ''));
const press = (id: string, name: string) => fireEvent.click(within(entry(id)).getByRole('button', { name }));
const last = <K extends AutoRoute['kind']>(kind: K) => auto.asked(kind).at(-1);

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

describe('an entry that matches a thread', () => {
  it('can start a thread with only images and keeps them in the entry until the request succeeds', async () => {
    await openQueue();
    const digest = useDigestStore.getState();
    const image = '1'.repeat(64);
    const key = `${DAY}/item-1`;
    act(() => digest.setImages(DAY, 'item-1', [image]));
    auto.state.failWrites = { kind: 'unreachable', message: 'Offline' };
    await act(() => digest.say('item-1', '').then(() => undefined));
    const first = last('digest-thread');
    expect(first).toMatchObject({ words: null, cid: expect.any(String), images: [image] });
    expect(useDigestStore.getState().images[key]).toEqual([image]);
    auto.state.failWrites = null;
    await act(() => digest.say('item-1', '').then(() => undefined));
    expect(last('digest-thread')).toEqual(first);
    expect(useDigestStore.getState().images[key]).toBeUndefined();
  });

  it('attaches the matched entry’s images on submit and leaves them out of a row shortcut', async () => {
    await openQueue();
    const digest = useDigestStore.getState();
    const first = 'a'.repeat(64);
    const second = 'b'.repeat(64);
    act(() => {
      digest.setImages(DAY, 'text-b', [first]);
      digest.setImages(DAY, 'text-c', [second]);
    });
    await act(() => digest.continueThread('text-b').then(() => undefined));
    expect(last('digest-continue')).not.toHaveProperty('images');
    auto.state.failWrites = { kind: 'unreachable', message: 'Offline' };
    await act(() => digest.continueThread('text-c', '').then(() => undefined));
    const original = last('digest-continue');
    expect(original).toMatchObject({ thread: 'labels', words: null, images: [second] });
    act(() => digest.setImages(DAY, 'text-c', [first, second]));
    auto.state.failWrites = null;
    await act(() => digest.continueThread('text-c', '').then(() => undefined));
    expect(last('digest-continue')).toMatchObject({ words: null, images: [first, second] });
    expect(last('digest-continue')?.cid).not.toBe(original?.cid);
    expect(useDigestStore.getState().images[`${DAY}/text-c`]).toBeUndefined();
  });

  it('shows the target model, remembers a digest choice across entries, and sends it with the matched reply', async () => {
    await openQueue({ threads: [BEDS, BREAD, { ...SEEDS, model: 'small' }, INSPECTION, { ...LABELS, model: 'large' }] });
    openEntry('text-b');
    const picker = () => within(entry('text-b')).getByTestId('auto-model');
    expect(picker()).toHaveAccessibleName('Model: Small');
    await userEvent.setup().click(picker());
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Default' }));
    openEntry('text-c');
    expect(within(entry('text-c')).getByTestId('auto-model')).toHaveAccessibleName('Model: Large');
    openEntry('text-b');
    expect(picker()).toHaveAccessibleName('Model: Default');
    fireEvent.keyDown(within(entry('text-b')).getByTestId('auto-entry-box'), { key: 'Enter' });
    await waitFor(() => expect(last('digest-continue')).toMatchObject({ thread: 'seeds', model: '' }));
    expect(auto.asked('model')).toHaveLength(0);
  });

  it('shows the matched thread and the note when the row expands', async () => {
    await openQueue();
    expect(within(entry('text-c')).queryByTestId('auto-entry-continues-open')).toBeNull();
    openEntry('text-c');
    expect(within(entry('text-c')).getByTestId('auto-entry-continues-open')).toHaveTextContent('Continues: Pantry labels (snoozed)');
    expect(within(entry('text-c')).getByRole('textbox', { name: 'Your note' })).toHaveValue('Buy a new washer');
  });

  it('offers Add to it in the place of Thread, and New thread in its menu; a row without a match is as it was', async () => {
    await openQueue();
    expect(within(entry('text-b')).getByRole('button', { name: 'Add to it' })).toBeInTheDocument();
    expect(within(entry('text-b')).queryByRole('button', { name: 'Thread' })).toBeNull();
    expect(within(entry('item-1')).getByRole('button', { name: 'Thread' })).toBeInTheDocument();
    expect(within(entry('item-1')).queryByRole('button', { name: 'Add to it' })).toBeNull();
    const pointer = userEvent.setup();
    await pointer.pointer({ keys: '[MouseRight]', target: entry('text-b').querySelector('[data-auto-entry]') as HTMLElement });
    const menu = within(await screen.findByTestId('auto-entry-menu-text-b'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Add to itT', 'New thread']);
    fireEvent.click(menu.getByRole('menuitem', { name: 'New thread' }));
    await waitFor(() => expect(last('digest-thread')).toEqual({ kind: 'digest-thread', date: DAY, id: 'text-b', words: null, cid: null }));
    expect(auto.asked('digest-continue')).toEqual([]);
    // An entry with no match has no menu of its own.
    fireEvent.contextMenu(entry('item-1').querySelector('[data-auto-entry]') as HTMLElement);
    expect(screen.queryByTestId('auto-entry-menu-item-1')).toBeNull();
  });

  it('adds it from the row in one post per click, and says so with a way on and no Undo', async () => {
    await openQueue();
    const before = Number(/(\d+) left/.exec(digestWord())?.[1]);
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    press('text-b', 'Add to it');
    // On its way: it leaves Left at once, and a second click sends nothing more.
    expect(entryIds()).not.toContain('text-b');
    await act(() => useDigestStore.getState().continueThread('text-b').then(() => undefined));
    release();
    await waitFor(() => expect(auto.asked('digest-continue')).toHaveLength(1));
    expect(last('digest-continue')).toEqual({ kind: 'digest-continue', date: DAY, id: 'text-b', thread: 'seeds', words: null, cid: expect.stringMatching(/^[0-9a-f]{10}$/) });
    expect(JSON.stringify(last('digest-continue'))).not.toMatch(/sends/);
    await waitFor(() => expect(saidText()).toBe('Added to Seed orderOpen'));
    expect(within(said() as HTMLElement).queryByRole('button', { name: 'Undo' })).toBeNull();
    await waitFor(() => expect(digestWord()).toBe(`Digest${before - 1} left`));
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
    pressSaid('Open');
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    expect(auto.asked('digest-thread')).toEqual([]);
  });

  it('adds it with T on its row', async () => {
    await openQueue();
    const rowButton = entry('text-c').querySelector('[data-auto-entry]') as HTMLElement;
    rowButton.focus();
    fireEvent.keyDown(rowButton, { key: 't' });
    await waitFor(() => expect(last('digest-continue')).toMatchObject({ id: 'text-c', thread: 'labels', words: null }));
    // The snoozed thread is back.
    await waitFor(() => expect(useAutoStore.getState().threads.find((thread) => thread.id === 'labels')?.snoozed).toBeNull());
  });

  it('shows the line in full above the open entry’s box, its title opening that thread', async () => {
    await openQueue();
    openEntry('text-c');
    const line = within(entry('text-c')).getByTestId('auto-entry-continues-open');
    expect(line.textContent).toBe('Continues: Pantry labels (snoozed)');
    fireEvent.click(within(line).getByRole('button', { name: 'Pantry labels' }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('labels'));
    expect(auto.asked('digest-continue')).toEqual([]);
  });

  it('reads Add to it on the box, ready with no words, and Enter adds it with whatever is typed', async () => {
    await openQueue();
    openEntry('text-b');
    const send = within(entry('text-b')).getByTestId('auto-send');
    expect(send).toHaveAccessibleName(/^Add to it/);
    expect(send).toBeEnabled();
    expect(within(entry('text-b')).getByTestId('auto-entry-new-thread').textContent).toBe('New thread instead');
    // The box says where the entry goes, to the eye and to a screen reader.
    const field = within(entry('text-b')).getByRole('textbox', { name: 'Add to Seed order. Say more if you want.' });
    expect(field).toHaveAttribute('placeholder', 'Add to Seed order. Say more if you want.');
    expect(within(entry('text-b')).queryByTestId('auto-entry-wordless')).toBeNull();
    const box = within(entry('text-b')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '  Note the bean variety  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(last('digest-continue')).toMatchObject({ date: DAY, id: 'text-b', thread: 'seeds', words: 'Note the bean variety' }));
    expect(auto.asked('digest-continue')).toHaveLength(1);
    await waitFor(() => expect(useDigestStore.getState().words).toEqual({}));

    openEntry('text-c');
    fireEvent.keyDown(within(entry('text-c')).getByTestId('auto-entry-box'), { key: 'Enter' });
    await waitFor(() => expect(last('digest-continue')).toMatchObject({ id: 'text-c', thread: 'labels', words: null }));
  });

  it('cuts a long thread title in the box’s placeholder so the sentence’s end still shows, and keeps the plain one without a match', async () => {
    const long = 'Seed order for the spring beds and the cold frame by the shed';
    const only = autoDigest(DAY, [['Yesterday', [digestEntry('text-b', { md: 'Sowed the beans.', continues: { id: 'seeds', title: long, snoozed: false } }), digestEntry('text-x', { md: 'Swept the path.' })]]]);
    await openQueue({ digests: { [DAY]: only } });
    openEntry('text-b');
    const placeholder = within(entry('text-b')).getByTestId('auto-entry-box').getAttribute('placeholder') ?? '';
    expect(placeholder).toBe('Add to Seed order for the spring beds and the… Say more if you want.');
    expect(within(entry('text-b')).getByTestId('auto-entry-box')).toHaveAccessibleName(placeholder);
    openEntry('text-x');
    expect(within(entry('text-x')).getByTestId('auto-entry-box').getAttribute('placeholder')).toBe('Say what you want done');
    expect(within(entry('text-x')).getByTestId('auto-entry-box')).toHaveAccessibleName('Say what you want done');
  });

  it('makes a new thread instead, with the box’s words or without any', async () => {
    await openQueue();
    openEntry('text-c');
    fireEvent.click(within(entry('text-c')).getByTestId('auto-entry-new-thread'));
    await waitFor(() => expect(last('digest-thread')).toEqual({ kind: 'digest-thread', date: DAY, id: 'text-c', words: null, cid: null }));
    // With words it starts the thread with them, and opens it.
    openEntry('text-b');
    fireEvent.change(within(entry('text-b')).getByTestId('auto-entry-box'), { target: { value: 'Start a bean log' } });
    fireEvent.click(within(entry('text-b')).getByTestId('auto-entry-new-thread'));
    await waitFor(() => expect(last('digest-thread')).toMatchObject({ kind: 'digest-thread', date: DAY, id: 'text-b', words: 'Start a bean log' }));
    expect(auto.asked('digest-continue')).toEqual([]);
  });

  it('reads the day again when the match has gone, and says so once, with no retry', async () => {
    await openQueue();
    // The service dropped the match after the day was read.
    const now = auto.state.digests[DAY];
    auto.state.digests[DAY] = { ...now, sections: now.sections.map((section) => ({ ...section, entries: section.entries.map((each) => (each.id === 'text-b' ? { ...each, continues: null } : each)) })) };
    press('text-b', 'Add to it');
    await waitFor(() => expect(saidText()).toContain(NO_MATCH));
    expect(auto.asked('digest-continue')).toHaveLength(1);
    await waitFor(() => expect(within(entry('text-b')).getByRole('button', { name: 'Thread' })).toBeInTheDocument());
    expect(entry('text-b').getAttribute('data-state')).toBe('open');
    expect(within(entry('text-b')).getByRole('button', { name: 'Thread' })).toBeInTheDocument();
    expect(auto.asked('digest-continue')).toHaveLength(1);
  });

  it('opens the entry again with his words under Not sent when the post does not arrive, and Retry sends them under the same id', async () => {
    await openQueue();
    openEntry('text-b');
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    const box = () => within(entry('text-b')).getByTestId('auto-entry-box') as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: 'Note the variety' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(within(entry('text-b')).getByTestId('auto-entry-not-sent').textContent).toBe('Not sentRetry'));
    expect(entry('text-b').getAttribute('data-state')).toBe('open');
    expect(box().value).toBe('Note the variety');
    const first = last('digest-continue')?.cid;
    auto.state.failWrites = null;
    fireEvent.click(within(within(entry('text-b')).getByTestId('auto-entry-not-sent')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(auto.asked('digest-continue')).toHaveLength(2));
    expect(last('digest-continue')).toMatchObject({ words: 'Note the variety', cid: first });
    await waitFor(() => expect(saidText()).toBe('Added to Seed orderOpen'));
  });

  it('does the same from the row with no words: the entry opens again under Not sent, and Retry is ready', async () => {
    await openQueue();
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    press('text-b', 'Add to it');
    await waitFor(() => expect(within(entry('text-b')).getByTestId('auto-entry-not-sent')).toBeInTheDocument());
    expect(entry('text-b').getAttribute('data-open')).toBe('true');
    expect(within(within(entry('text-b')).getByTestId('auto-entry-not-sent')).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
