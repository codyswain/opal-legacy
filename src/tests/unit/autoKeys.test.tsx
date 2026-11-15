import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoItem, AutoQuestion, AutoRoute } from '@/types/auto';
import { AutoView, useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { forgetPlaces, keepPlace, placeOf, threadPlace } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { SLOW_MS, forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { CommandPalette, usePaletteStore } from '@/renderer/features/commands';
import { commandRegistry } from '@/renderer/features/commands/services/commandRegistry';
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

const ROOT = '/Vault';
const DAY = '2026-11-13';
const user = (text: string, cid: string | null = null): AutoItem => ({ role: 'user', text, cid });
const reply = (text: string, open = false): AutoItem => ({ role: 'assistant', text, open });

const BEDS = autoThread('beds', {
  title: 'Raised bed plan', status: 'waiting',
  ask: { id: 'q0', kind: 'ask', text: 'Which wood for the frames?', options: ['Cedar', 'Larch'], question: 'Which wood for the frames?' },
});
const BREAD = autoThread('bread', { title: 'Sourdough timings', last: 'Start the starter at 8.' });
const SEEDS = autoThread('seeds', { title: 'Seed order', last: 'Twelve packets.', unread: true });
const TRELLIS = autoThread('trellis', { title: 'Tomato trellis', last: 'String every 20 cm.' });
const INSPECTION = autoThread('inspect', { title: 'Book the inspection', last: 'The committee walks the plots.', waits: true, digest: { date: DAY, id: 'item-2' } });
const LABELS = autoThread('labels', { title: 'Pantry labels', last: 'A4, 21 to a page.', snoozed: 4_000_000_000 });
const ASK: AutoQuestion = { id: 'q1', kind: 'ask', questions: [{ question: 'Which bed?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 3', description: '' }, { label: 'Bed 4', description: '' }] }] };

const day = () => autoDigest(DAY, [
  ['Top 3', [digestEntry('item-1', { kind: 'item', title: 'Order the trays', md: 'Two trays.' }), digestEntry('item-2', { kind: 'item', title: 'Book the inspection', state: 'thread', thread: 'inspect' })]],
  ['Yesterday', [digestEntry('text-a', { md: 'Turned the compost.' }), digestEntry('text-b', { md: 'Sowed the beans.' }), digestEntry('text-c', { md: 'Mended the hose.', state: 'resolved' })]],
]);

let auto: FakeAuto;

function Sync(): null {
  useAutoSync();
  return null;
}

async function open(options: Parameters<typeof installAutoApi>[0] = {}) {
  auto = installAutoApi({
    threads: [BEDS, BREAD, SEEDS, TRELLIS, INSPECTION, LABELS],
    snapshots: {
      beds: autoSnapshot(BEDS, { items: [user('Plan the beds')] }),
      bread: autoSnapshot(BREAD, { items: [user('When do I start?'), reply('Start the starter at **8**.')], next: ['Scale it to two loaves', 'Put the times in the page'] }),
      seeds: autoSnapshot(SEEDS, { items: [user('Order the seeds'), reply('Twelve packets.')] }),
      trellis: autoSnapshot(TRELLIS, { items: [user('How far apart?'), reply('String every 20 cm.')] }),
      inspect: autoSnapshot(INSPECTION, { seed: 'Digest, Friday November 13, item 2: Book the inspection\n\nPriority: High\n\nThe committee walks the plots.' }),
    },
    digests: { [DAY]: day() },
    ...options,
  });
  const view = render(
    <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ThemeProvider>
        <TooltipProvider>
          <ShellProvider>
            <Sync />
            <AutoView />
            <CommandPalette />
          </ShellProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  await screen.findByTestId('auto-list');
  await waitFor(() => expect(useDigestStore.getState().status).not.toBe('unknown'));
  return view;
}

const rowButton = (id: string) => screen.getByTestId('auto-list').querySelector(`[data-row-id="${id}"]`) as HTMLElement;
const row = (id: string) => screen.getByTestId(`auto-row-${id}`);
const rowIds = () => [...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
const entryRow = (id: string) => screen.getByTestId('auto-queue').querySelector(`[data-entry-id="${id}"]`) as HTMLElement;
const entryIds = () => [...screen.getByTestId('auto-queue').querySelectorAll('li[data-state]')].map((element) => element.getAttribute('data-testid')?.replace('auto-entry-', ''));
const box = () => screen.getByTestId('auto-box') as HTMLTextAreaElement;
const last = <K extends AutoRoute['kind']>(kind: K) => auto.asked(kind).at(-1);
const focusedRow = () => document.activeElement?.getAttribute('data-row-id') ?? document.activeElement?.getAttribute('data-entry-id') ?? document.activeElement?.getAttribute('data-testid') ?? null;
const said = () => (screen.queryByTestId('auto-said')?.textContent ?? '').replace(/\s+/g, ' ');
const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key, ...init });
/** A key pressed wherever the keyboard is. */
const key = (name: string, init: KeyboardEventInit = {}) => press(document.activeElement as HTMLElement, name, init);

async function openThread(id: string) {
  fireEvent.click(rowButton(id));
  await waitFor(() => expect(auto.followed.thread?.id).toBe(id));
}
async function openQueue() {
  fireEvent.click(rowButton(':digest'));
  await screen.findByTestId('auto-queue-pane');
  await waitFor(() => expect(focusedRow()).toBe('item-1'));
}
/** Gives the thread's scroller a size, since the test page lays nothing out. */
function sizeTalk(scrollHeight: number, clientHeight = 500) {
  const talk = screen.getByTestId('auto-talk');
  Object.defineProperty(talk, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(talk, 'clientHeight', { configurable: true, get: () => clientHeight });
  return talk;
}

beforeEach(() => {
  window.localStorage.clear();
  for (const command of commandRegistry.getAllCommands()) commandRegistry.unregisterCommand(command);
  usePaletteStore.setState({ open: false, initialQuery: '', newTab: false, filesOnly: false });
  useAutoStore.setState(useAutoStore.getInitialState(), true);
  useThreadStore.setState({ ...useThreadStore.getInitialState(), box: { outbox: [], drafts: {} } }, true);
  useDigestStore.setState(useDigestStore.getInitialState(), true);
  useSaidStore.getState().clear();
  forgetPlaces();
  forgetViews();
  installDiskApi();
  installActivityApi();
  installCollectionsApi();
  useDiskStore.setState({ roots: [ROOT], rootsLoaded: true, listings: { [ROOT]: [diskEntry({ path: '/Vault/Recipes', name: 'Recipes', kind: 'directory', isDirectory: true })] } });
  openTabs([browseAuto().location]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the list under the keyboard', () => {
  it('is one Tab stop: New thread, Digest and every row in one run, and no button inside a row', async () => {
    await open();
    const stops = [...screen.getByTestId('auto-list').querySelectorAll<HTMLElement>('button, [tabindex]')].filter((element) => element.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(rowButton(':new'));
    // The run of rows the arrows walk.
    expect([...screen.getByTestId('auto-list').querySelectorAll('[data-auto-row]')].map((element) => element.getAttribute('data-row-id'))).toEqual([':new', ':digest', 'beds', 'bread', 'seeds', 'trellis', 'inspect', ':snoozed']);
  });

  it('moves with the arrows, Home and End, and J and K', async () => {
    await open();
    rowButton(':new').focus();
    key('ArrowDown');
    expect(focusedRow()).toBe(':digest');
    key('j');
    expect(focusedRow()).toBe('beds');
    key('End');
    expect(focusedRow()).toBe(':snoozed');
    key('ArrowDown');
    expect(focusedRow()).toBe(':snoozed');
    key('k');
    key('ArrowUp');
    expect(focusedRow()).toBe('trellis');
    key('Home');
    expect(focusedRow()).toBe(':new');
    // The row the keyboard was last on is the Tab stop.
    key('ArrowDown');
    key('ArrowDown');
    expect(rowButton('beds').tabIndex).toBe(0);
    expect(rowButton(':new').tabIndex).toBe(-1);
  });

  it('archives with E and moves the keyboard to the row below, or the one above from the last', async () => {
    await open();
    rowButton('bread').focus();
    key('e');
    expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']);
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    rowButton('inspect').focus();
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
    expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true });
  });

  it('marks a digest thread done with D, and D does nothing on any other thread', async () => {
    await open();
    rowButton('bread').focus();
    key('d');
    expect(auto.asked('archive')).toEqual([]);
    rowButton('inspect').focus();
    key('d');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
    await waitFor(() => expect(said()).toBe('Done Book the inspectionUndo'));
  });

  it('opens the snooze menu with S, and a pick snoozes with the keyboard moving on', async () => {
    await open();
    rowButton('bread').focus();
    key('s');
    const menu = within(await screen.findByTestId('auto-snooze-menu'));
    fireEvent.click(menu.getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('bread'));
    expect(rowIds()).not.toContain('bread');
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    await waitFor(() => expect(said()).toMatch(/^Snoozed until tomorrow at 8:00 am Sourdough timingsUndo$/));
  });

  it('marks and unmarks for the Mac with M, the keyboard going with the row', async () => {
    await open();
    rowButton('seeds').focus();
    key('m');
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'seeds', on: true }));
    await waitFor(() => expect(rowIds()[0]).toBe('seeds'));
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    expect(within(row('seeds')).getByRole('img', { name: 'Marked for the Mac' })).toBeInTheDocument();
    key('m');
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'seeds', on: false }));
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
  });

  it('moves a row with Option+Up and Option+Down, the same post as a drag', async () => {
    await open();
    rowButton('bread').focus();
    key('ArrowDown', { altKey: true });
    // The row moves at once; the service's order then takes its place.
    expect(rowIds()).toEqual(['beds', 'seeds', 'bread', 'trellis', 'inspect']);
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'bread', before: 'trellis' }));
    await waitFor(() => expect(focusedRow()).toBe('bread'));
    rowButton('seeds').focus();
    key('ArrowUp', { altKey: true });
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'seeds', before: 'bread' }));
    rowButton('bread').focus();
    // At the top of the rest there is nowhere to go, and a thread that waits does not move.
    const moves = auto.asked('move').length;
    key('ArrowUp', { altKey: true });
    rowButton('beds').focus();
    key('ArrowDown', { altKey: true });
    expect(auto.asked('move')).toHaveLength(moves);
  });

  it('opens the row’s menu with Shift+F10, with the keys beside its items', async () => {
    await open();
    rowButton('inspect').focus();
    key('F10', { shiftKey: true });
    const menu = within(await screen.findByTestId('auto-row-menu-inspect'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['Mark for the MacM', 'DoneD', 'ArchiveE']);
  });

  it('acts on single keys only from a row: not from the box, and not with a modifier', async () => {
    await open();
    await openThread('bread');
    fireEvent.keyDown(box(), { key: 'e' });
    fireEvent.keyDown(box(), { key: 's' });
    fireEvent.keyDown(box(), { key: 'm' });
    rowButton('bread').focus();
    key('e', { metaKey: true });
    key('e', { ctrlKey: true });
    key('m', { shiftKey: true });
    expect(auto.asked('archive')).toEqual([]);
    expect(auto.asked('desk')).toEqual([]);
    expect(screen.queryByTestId('auto-snooze-menu')).toBeNull();
    expect(rowIds()).toContain('bread');
  });

  it('shows each key in its button’s tooltip', async () => {
    await open();
    const pointer = userEvent.setup();
    await pointer.hover(screen.getByTestId('auto-archive-bread'));
    expect((await screen.findByRole('tooltip')).textContent).toBe('ArchiveE');
  });
});

describe('the box under the keyboard', () => {
  it('leaves the box for the open thread’s row on Escape, and never stops a turn that way', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Go on', 'a1')], state: 'working', activity: '' }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(focusedRow()).toBe('bread'));
    expect(auto.asked('stop')).toEqual([]);
    expect(screen.getByTestId('auto-thread')).toBeInTheDocument();
    // From a new thread it is the New thread row.
    fireEvent.click(rowButton(':new'));
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(focusedRow()).toBe(':new'));
  });

  it('stops the running turn with Cmd+. and returns the keyboard to the box', async () => {
    await open();
    await openThread('bread');
    fireEvent.keyDown(box(), { key: '.', metaKey: true });
    expect(auto.asked('stop')).toEqual([]);
    act(() => auto.thread({ kind: 'turn', items: [user('Go on', 'a1')], state: 'working', activity: '' }));
    rowButton('bread').focus();
    fireEvent.keyDown(rowButton('bread'), { key: '.', metaKey: true });
    await waitFor(() => expect(last('stop')).toEqual({ kind: 'stop', id: 'bread' }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it('scrolls the thread with PageUp and PageDown from the box', async () => {
    await open();
    await openThread('bread');
    const talk = sizeTalk(3000, 600);
    talk.scrollTop = 2000;
    fireEvent.keyDown(box(), { key: 'PageUp' });
    expect(talk.scrollTop).toBe(2000 - 552);
    fireEvent.keyDown(box(), { key: 'PageDown' });
    expect(talk.scrollTop).toBe(2000);
  });

  it('returns the keyboard to the box after an answered card and after a rename', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Which bed?', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: ASK }));
    const option = within(screen.getByTestId('auto-question')).getByRole('button', { name: 'Bed 4' });
    option.focus();
    fireEvent.click(option);
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q1', answers: { 'Which bed?': 'Bed 4' } }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    fireEvent.click(screen.getByTestId('auto-title'));
    const title = screen.getByRole('textbox', { name: 'Thread title' });
    fireEvent.change(title, { target: { value: 'Bread, the long way' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'bread', title: 'Bread, the long way' }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it('puts a follow-up in the box on Option-click or Edit first, and sends nothing', async () => {
    await open();
    await openThread('bread');
    const next = within(screen.getByTestId('auto-next')).getByRole('button', { name: 'Scale it to two loaves' });
    fireEvent.click(next, { altKey: true });
    expect(box().value).toBe('Scale it to two loaves');
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(auto.asked('message')).toEqual([]);
    fireEvent.change(box(), { target: { value: '' } });
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: within(screen.getByTestId('auto-next')).getByRole('button', { name: 'Put the times in the page' }) });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit first' }));
    await waitFor(() => expect(box().value).toBe('Put the times in the page'));
    expect(auto.asked('message')).toEqual([]);
  });
});

describe('undo', () => {
  it('takes back the last action with Cmd+Z, from a row and not from a field', async () => {
    await open();
    await openThread('trellis');
    rowButton('bread').focus();
    key('e');
    await waitFor(() => expect(said()).toBe('Archived Sourdough timingsUndo'));
    // In the box Cmd+Z undoes typing: the thread stays archived.
    fireEvent.keyDown(box(), { key: 'z', metaKey: true });
    expect(auto.asked('archive')).toHaveLength(1);
    rowButton('seeds').focus();
    key('z', { metaKey: true });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: false }));
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']));
    await waitFor(() => expect(focusedRow()).toBe('bread'));
    expect(screen.queryByTestId('auto-said')).toBeNull();
    // With no Undo on offer the key is left alone.
    const left = fireEvent.keyDown(rowButton('bread'), { key: 'z', metaKey: true });
    expect(left).toBe(true);
  });

  it('names the newest action only, one line at a time', async () => {
    await open();
    rowButton('bread').focus();
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    key('e');
    await waitFor(() => expect(said()).toBe('Archived Seed orderUndo'));
    expect(screen.getAllByTestId('auto-said')).toHaveLength(1);
    expect(useSaidStore.getState().said?.name).toBe('Seed order');
  });

  it('takes a row away at once and brings it back with the service’s sentence when the post fails', async () => {
    await open();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    auto.state.failWrites = { kind: 'refused', message: 'Auto is busy.', code: 'busy', status: 503 };
    fireEvent.click(screen.getByTestId('auto-archive-bread'));
    // Gone before the service has said a word.
    expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']);
    expect(screen.queryByTestId('auto-said')).toBeNull();
    release();
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']));
    expect(said()).toBe('Sourdough timings: Auto is busy.');
    expect(screen.getByTestId('auto-said').getAttribute('data-problem')).toBe('true');
    expect(within(screen.getByTestId('auto-said')).queryByRole('button')).toBeNull();
  });

  it('undoes a snooze, and gives a thread snoozed again the time it had', async () => {
    await open();
    fireEvent.click(screen.getByTestId('auto-snoozed-line'));
    await userEvent.setup().click(screen.getByTestId('auto-snooze-labels'));
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Next week/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('labels'));
    await waitFor(() => expect(said()).toMatch(/^Snoozed until .+ Pantry labelsUndo$/));
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until: 4_000_000_000 }));
  });
});

describe('the open thread’s own actions', () => {
  it('has Snooze, Archive and a menu in its header, and Done for a thread from the digest', async () => {
    await open();
    await openThread('bread');
    const header = within(screen.getByTestId('auto-thread').querySelector('header') as HTMLElement);
    expect(header.getByRole('button', { name: 'Snooze' })).toBeInTheDocument();
    expect(header.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(header.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(header.queryByTestId('auto-stop')).toBeNull();
    await userEvent.setup().click(header.getByRole('button', { name: 'Thread menu' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Mark for the Mac', 'Rename']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark for the Mac' }));
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'bread', on: true }));
    await openThread('inspect');
    fireEvent.click(within(screen.getByTestId('auto-thread')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
  });

  it('opens the next thread after an archive, with the caret in its box, and Undo opens it again', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(rowIds()).not.toContain('bread');
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
  });

  it('opens the row above when the last one leaves, and an empty pane when none is left', async () => {
    await open({ threads: [BREAD, TRELLIS] });
    await openThread('trellis');
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(useThreadStore.getState().openId).toBeNull());
    expect(within(screen.getByTestId('auto-thread')).getByText('New thread')).toBeInTheDocument();
  });

  it('opens the next thread after a snooze from the header, and Undo brings it back open', async () => {
    await open();
    await openThread('bread');
    await userEvent.setup().click(screen.getByTestId('auto-snooze-open'));
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: null }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
  });

  it('renames from the menu', async () => {
    await open();
    await openThread('bread');
    await userEvent.setup().click(screen.getByTestId('auto-thread-menu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    expect(await screen.findByRole('textbox', { name: 'Thread title' })).toHaveValue('Sourdough timings');
  });

  it('takes a day and a time for a snooze, in a dialog that names the thread', async () => {
    await open();
    await userEvent.setup().click(screen.getByTestId('auto-snooze-bread'));
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: 'Pick a time…' }));
    const dialog = within(await screen.findByTestId('auto-snooze-date'));
    expect(dialog.getByTestId('auto-snooze-name').textContent).toBe('Sourdough timings');
    expect(dialog.getByLabelText('Time')).toHaveValue('08:00');
    const date = (dialog.getByLabelText('Date') as HTMLInputElement).value;
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Snooze' }));
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: new Date(year, month - 1, dayOfMonth, 14, 30).getTime() / 1000 }));
    expect(screen.queryByTestId('auto-snooze-date')).toBeNull();
  });

  it('offers a snoozed row another time beside Bring back', async () => {
    await open();
    fireEvent.click(screen.getByTestId('auto-snoozed-line'));
    const snoozed = within(row('labels'));
    expect(snoozed.getByRole('button', { name: 'Bring back' })).toBeInTheDocument();
    expect(snoozed.getByRole('button', { name: 'Snooze' })).toBeInTheDocument();
  });
});

describe('a thread that is slow or out of reach', () => {
  it('keeps the title from the list while it cannot be read, and reads it by itself once Auto answers', async () => {
    await open({ failThread: { kind: 'unreachable', message: "Can't reach Auto." } });
    fireEvent.click(rowButton('bread'));
    await waitFor(() => expect(within(screen.getByTestId('auto-talk')).getByRole('alert').textContent).toBe("Can't reach Auto."));
    expect(screen.getByTestId('auto-title').textContent).toBe('Sourdough timings');
    act(() => auto.stream('list', 'down'));
    auto.state.failThread = null;
    act(() => auto.stream('list', 'open'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    expect(within(screen.getByTestId('auto-talk')).getByText('When do I start?')).toBeInTheDocument();
  });

  it('tries again on a click on the open row, and after any request that gets through', async () => {
    await open({ failThread: { kind: 'unreachable', message: "Can't reach Auto." } });
    fireEvent.click(rowButton('bread'));
    await waitFor(() => expect(within(screen.getByTestId('auto-talk')).getByRole('alert')).toBeInTheDocument());
    const reads = auto.asked('thread').length;
    fireEvent.click(rowButton('bread'));
    await waitFor(() => expect(auto.asked('thread')).toHaveLength(reads + 1));
    // A message sent from the pane goes out; once it has, the thread is read.
    auto.state.failThread = null;
    fireEvent.change(box(), { target: { value: 'Still there?' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(auto.asked('message')).toHaveLength(1));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
  });

  it('shows a thread seen before at once, and says Loading only when nothing is kept and the wait passes 300 ms', async () => {
    await open();
    await openThread('bread');
    await openThread('seeds');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const request = auto.api.request as unknown as ReturnType<typeof vi.fn>;
    const answer = request.getMockImplementation() as (route: AutoRoute) => Promise<unknown>;
    request.mockImplementation(async (route: AutoRoute) => {
      if (route.kind === 'thread') await held;
      return answer(route);
    });
    // Seen before: its last view is there before the fresh one has come.
    fireEvent.click(rowButton('bread'));
    expect(within(screen.getByTestId('auto-talk')).getByText('When do I start?')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
    // Never seen: the title at once, and Loading only after the wait.
    fireEvent.click(rowButton('trellis'));
    expect(screen.getByTestId('auto-title').textContent).toBe('Tomato trellis');
    expect(screen.queryByText('Loading…')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 60));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    release();
    await waitFor(() => expect(within(screen.getByTestId('auto-talk')).getByText('How far apart?')).toBeInTheDocument());
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('his place in a thread', () => {
  it('is where he left it when he comes back to the thread', async () => {
    await open();
    await openThread('bread');
    const talk = sizeTalk(3000);
    talk.scrollTop = 120;
    fireEvent.scroll(talk);
    expect(placeOf(threadPlace('bread'))).toMatchObject({ top: 120, atEnd: false });
    await openThread('seeds');
    talk.scrollTop = 0;
    await openThread('bread');
    expect(screen.getByTestId('auto-talk').scrollTop).toBe(120);
    expect(screen.queryByTestId('auto-jump')).toBeNull();
  });

  it('is kept when the tab is left and shown again', async () => {
    const view = await open();
    await openThread('bread');
    const talk = sizeTalk(3000);
    talk.scrollTop = 400;
    fireEvent.scroll(talk);
    view.unmount();
    keepPlace(threadPlace('bread'), { top: 400, atEnd: false, height: 3000 });
    render(
      <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider><TooltipProvider><ShellProvider><Sync /><AutoView /></ShellProvider></TooltipProvider></ThemeProvider>
      </MemoryRouter>
    );
    await screen.findByTestId('auto-thread');
    await waitFor(() => expect(screen.getByTestId('auto-talk').scrollTop).toBe(400));
  });

  it('stays put when text arrives while he is scrolled up, and offers Jump to the end', async () => {
    await open();
    await openThread('bread');
    let height = 3000;
    const talk = screen.getByTestId('auto-talk');
    Object.defineProperty(talk, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(talk, 'clientHeight', { configurable: true, get: () => 500 });
    talk.scrollTop = 120;
    fireEvent.scroll(talk);
    height = 3600;
    act(() => auto.thread({ kind: 'turn', items: [user('From the phone', 'p1')], state: 'working', activity: '' }));
    expect(talk.scrollTop).toBe(120);
    fireEvent.click(await screen.findByRole('button', { name: 'Jump to the end' }));
    expect(talk.scrollTop).toBe(3600);
    expect(screen.queryByTestId('auto-jump')).toBeNull();
  });

  it('follows new text while he is at the end, with nothing to jump to', async () => {
    await open();
    await openThread('bread');
    let height = 3000;
    const talk = screen.getByTestId('auto-talk');
    Object.defineProperty(talk, 'scrollHeight', { configurable: true, get: () => height });
    Object.defineProperty(talk, 'clientHeight', { configurable: true, get: () => 500 });
    talk.scrollTop = 2500;
    fireEvent.scroll(talk);
    height = 3600;
    act(() => auto.thread({ kind: 'turn', items: [user('More', 'p1')], state: 'working', activity: '' }));
    expect(talk.scrollTop).toBe(3600);
    expect(screen.queryByTestId('auto-jump')).toBeNull();
  });

  it('marks the start of the newest reply in a thread he has not read, to open there', async () => {
    await open();
    await openThread('seeds');
    expect(useThreadStore.getState().openedUnread).toBe(true);
    const anchors = screen.getByTestId('auto-talk').querySelectorAll('[data-anchor]');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].textContent).toBe('Twelve packets.');
    await openThread('bread');
    expect(useThreadStore.getState().openedUnread).toBe(false);
  });
});

describe('the queue under the keyboard', () => {
  it('opens with the keyboard on its first entry, which is its one Tab stop', async () => {
    await open();
    await openQueue();
    const stops = [...screen.getByTestId('auto-queue').querySelectorAll<HTMLElement>('[data-auto-entry]')].filter((element) => element.tabIndex === 0);
    expect(stops.map((element) => element.getAttribute('data-entry-id'))).toEqual(['item-1']);
    // The words on a row are out of the Tab order: the row's keys do the same.
    expect(within(screen.getByTestId('auto-entry-item-1')).getAllByRole('button').filter((button) => button.tagName === 'BUTTON').every((button) => button.tabIndex === -1)).toBe(true);
  });

  it('moves with the arrows, Home, End, J and K', async () => {
    await open();
    await openQueue();
    key('ArrowDown');
    expect(focusedRow()).toBe('text-a');
    key('j');
    expect(focusedRow()).toBe('text-b');
    key('k');
    key('End');
    expect(focusedRow()).toBe('text-b');
    key('Home');
    expect(focusedRow()).toBe('item-1');
  });

  it('resolves with E and moves on, and reopens with E under All', async () => {
    await open();
    await openQueue();
    key('ArrowDown');
    key('e');
    expect(entryIds()).toEqual(['item-1', 'text-b']);
    await waitFor(() => expect(focusedRow()).toBe('text-b'));
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-a'], resolved: true }));
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('item-1'));
    fireEvent.click(screen.getByTestId('auto-queue-all'));
    entryRow('text-c').focus();
    key('e');
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['text-c'], resolved: false }));
    // Under All the entry stays where it is, and so does the keyboard.
    expect(focusedRow()).toBe('text-c');
  });

  it('makes a thread with T, opens the note with N, and saves it with Cmd+Enter', async () => {
    await open();
    await openQueue();
    key('n');
    const note = await within(screen.getByTestId('auto-entry-item-1')).findByRole('textbox', { name: 'Your note' });
    await waitFor(() => expect(document.activeElement).toBe(note));
    fireEvent.change(note, { target: { value: 'Ask about peat-free' } });
    fireEvent.keyDown(note, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(last('digest-note')).toEqual({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'Ask about peat-free' }));
    // Escape in the field goes back to the row; Escape on the row closes the entry.
    fireEvent.keyDown(note, { key: 'Escape' });
    expect(focusedRow()).toBe('item-1');
    expect(screen.getByTestId('auto-entry-item-1').getAttribute('data-open')).toBe('true');
    key('Escape');
    expect(screen.getByTestId('auto-entry-item-1').getAttribute('data-open')).toBeNull();
    key('t');
    await waitFor(() => expect(last('digest-thread')).toEqual({ kind: 'digest-thread', date: DAY, id: 'item-1', words: null, cid: null }));
    await waitFor(() => expect(focusedRow()).toBe('text-a'));
  });

  it('opens an entry with Enter or Space, and goes back to the Digest row on Escape from a closed one', async () => {
    await open();
    await openQueue();
    key('Enter');
    expect(screen.getByTestId('auto-entry-item-1').getAttribute('data-open')).toBe('true');
    key(' ');
    expect(screen.getByTestId('auto-entry-item-1').getAttribute('data-open')).toBeNull();
    key('Escape');
    await waitFor(() => expect(focusedRow()).toBe(':digest'));
    expect(screen.getByTestId('auto-queue-pane')).toBeInTheDocument();
  });

  it('hands the keyboard to the queue’s first word when the last entry leaves', async () => {
    await open({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('only', { md: 'Fed the tomatoes.' })]]]) } });
    fireEvent.click(rowButton(':digest'));
    await waitFor(() => expect(focusedRow()).toBe('only'));
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('auto-queue-left'));
  });
});

describe('the narrow layout', () => {
  const width = { now: 600 };
  beforeEach(() => {
    width.now = 600;
    class Observer {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: width.now } }]); }
      disconnect() { /* nothing to release */ }
    }
    vi.stubGlobal('ResizeObserver', Observer);
  });

  it('goes back to the list on Escape in the box and on Back, with the keyboard on the row he came from', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await screen.findByTestId('auto-thread');
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(focusedRow()).toBe('bread'));
    expect(screen.queryByTestId('auto-thread')).toBeNull();
    fireEvent.click(rowButton('seeds'));
    await screen.findByTestId('auto-thread');
    fireEvent.click(screen.getByTestId('auto-back'));
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
  });

  it('says what the last action did above the box while the list is hidden, and at the foot of the list when it shows', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await screen.findByTestId('auto-thread');
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(said()).toBe('Archived Sourdough timingsUndo'));
    const bar = screen.getByTestId('auto-said');
    const form = screen.getByTestId('auto-thread').querySelector('form') as HTMLElement;
    expect(screen.getByTestId('auto-thread').contains(bar)).toBe(true);
    expect(bar.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByTestId('auto-back'));
    await screen.findByTestId('auto-list');
    expect(screen.getByTestId('auto-list').contains(screen.getByTestId('auto-said'))).toBe(true);
  });

  it('puts the queue’s actions on a line under the words when the pane has no room for a column', async () => {
    await open();
    fireEvent.click(rowButton(':digest'));
    await screen.findByTestId('auto-queue-pane');
    // At 600 px there is room for the column at the row's right.
    const beside = screen.getByTestId('auto-entry-item-1');
    expect((beside.querySelector('[data-auto-entry]') as HTMLElement).parentElement?.contains(within(beside).getByRole('button', { name: 'Resolve' }))).toBe(true);
    fireEvent.click(screen.getByTestId('auto-back'));
    width.now = 400;
    fireEvent.click(rowButton(':digest'));
    await screen.findByTestId('auto-queue-pane');
    const item = screen.getByTestId('auto-entry-item-1');
    const words = item.querySelector('[data-auto-entry]') as HTMLElement;
    const resolve = within(item).getByRole('button', { name: 'Resolve' });
    // Not beside the words, but after them.
    expect(words.parentElement?.contains(resolve)).toBe(false);
    expect(words.compareDocumentPosition(resolve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Auto in the palette', () => {
  const show = async (query: string) => {
    act(() => usePaletteStore.getState().show(query));
    return within(await screen.findByTestId('command-palette'));
  };

  it('starts a new thread and opens the digest', async () => {
    await open();
    await openThread('bread');
    let palette = await show('>auto');
    expect(palette.getByTestId('palette-command-auto.newThread').textContent).toBe('New Auto thread');
    expect(palette.getByTestId('palette-command-auto.openDigest').textContent).toBe('Open Auto digest');
    fireEvent.click(palette.getByTestId('palette-command-auto.newThread'));
    await waitFor(() => expect(useThreadStore.getState().openId).toBe(':new'));
    palette = await show('>digest');
    fireEvent.click(palette.getByTestId('palette-command-auto.openDigest'));
    await screen.findByTestId('auto-queue-pane');
  });

  it('archives, snoozes and marks the open thread, and has none of these with no thread open', async () => {
    await open();
    let palette = await show('>thread');
    expect(palette.queryByTestId('palette-command-auto.archiveThread')).toBeNull();
    act(() => usePaletteStore.getState().hide());
    await openThread('bread');
    palette = await show('>thread');
    expect(palette.getByTestId('palette-command-auto.snoozeThread').textContent).toBe('Snooze thread…');
    expect(palette.getByTestId('palette-command-auto.markThread').textContent).toBe('Mark thread for the Mac');
    fireEvent.click(palette.getByTestId('palette-command-auto.archiveThread'));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    palette = await show('>snooze');
    fireEvent.click(palette.getByTestId('palette-command-auto.snoozeThread'));
    expect(within(await screen.findByTestId('auto-snooze-date')).getByTestId('auto-snooze-name').textContent).toBe('Seed order');
  });

  it('finds a thread by its title once something is typed, and opens it', async () => {
    await open();
    let palette = await show('>');
    // Threads are not commands of the app: none is listed until he types.
    expect(palette.queryByTestId('palette-command-auto.thread.bread')).toBeNull();
    act(() => usePaletteStore.getState().hide());
    palette = await show('>sourdough');
    const found = palette.getByTestId('palette-command-auto.thread.bread');
    // Its title as written, with what it is beside it.
    expect(found.textContent).toBe('Sourdough timingsAuto thread');
    fireEvent.click(found);
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    // A renamed thread is found by its new title.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, title: 'Rye, for Friday' } }));
    palette = await show('>rye');
    expect(palette.getByTestId('palette-command-auto.thread.bread').textContent).toBe('Rye, for FridayAuto thread');
  });
});
