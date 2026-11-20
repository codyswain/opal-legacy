import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoItem, AutoQuestion, AutoRoute } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { unconfirmedThreads } from '@/renderer/features/auto/store/autoStore';
import { forgetPlaces, keepPlace, placeOf, threadPlace } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { SLOW_MS, forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { CommandPalette, usePaletteStore } from '@/renderer/features/commands';
import { commandRegistry } from '@/renderer/features/commands/services/commandRegistry';
import { browseAuto, focusFile } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
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
const SEEDS = autoThread('seeds', { title: 'Seed order', last: 'Twelve packets.' });
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
            <AutoScreen />
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

const rowButton = (id: string) => document.querySelector(`[data-auto-list] [data-row-id="${id}"]`) as HTMLElement;
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
  hold.ms = HOLD_MS;
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
  it('gives Digest its own Tab stop above the Threads fold and keeps the list in one run', async () => {
    await open();
    const stops = [...screen.getByTestId('auto-list').querySelectorAll<HTMLElement>('button, [tabindex]')].filter((element) => element.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(rowButton('beds'));
    const digest = rowButton(':digest');
    const threads = screen.getByTestId('sidebar-threads');
    expect(digest.tabIndex).toBe(0);
    expect(digest.compareDocumentPosition(threads)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // The run of rows the arrows walk.
    expect([...screen.getByTestId('auto-list').querySelectorAll('[data-auto-row]')].map((element) => element.getAttribute('data-row-id'))).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect', ':away']);
    fireEvent.click(within(threads).getByRole('button', { name: /^Threads/ }));
    expect(digest).toBeVisible();
    expect(screen.queryByTestId('auto-list')).toBeNull();
    fireEvent.click(within(threads).getByRole('button', { name: /^Threads/ }));
  });

  it('moves with the arrows, Home and End, and J and K', async () => {
    await open();
    rowButton(':digest').focus();
    key('j');
    expect(focusedRow()).toBe('beds');
    key('End');
    expect(focusedRow()).toBe(':away');
    key('ArrowDown');
    expect(focusedRow()).toBe(':away');
    key('k');
    expect(focusedRow()).toBe('inspect');
    key('ArrowUp');
    expect(focusedRow()).toBe('trellis');
    key('Home');
    expect(focusedRow()).toBe('beds');
    // The row the keyboard was last on is the list's Tab stop.
    key('ArrowDown');
    expect(rowButton('bread').tabIndex).toBe(0);
    expect(rowButton('beds').tabIndex).toBe(-1);
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
    expect(said()).toBe('Done: Book the inspectionUndo');
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
    // In the phone's words, whole.
    expect(said()).toBe('Snoozed until tomorrow 9:00 am.Undo');
  });

  it('marks and unmarks for the Mac with M, the keyboard going with the row', async () => {
    await open();
    rowButton('seeds').focus();
    key('m');
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'seeds', on: true }));
    await waitFor(() => expect(rowIds()[0]).toBe('seeds'));
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    expect(within(screen.getByTestId('auto-group-desk')).getByTestId('auto-row-seeds')).toBeInTheDocument();
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
    expect(menu.getAllByRole('menuitem')[0].textContent).toBe('Rename');
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['Mark for the MacM', 'DoneD', 'ArchiveE']);
  });

  it('renames from the row’s menu: the thread opens, and its row’s title is the field', async () => {
    await open();
    await openThread('bread');
    rowButton('trellis').focus();
    key('F10', { shiftKey: true });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const title = await within(row('trellis')).findByRole('textbox', { name: 'Thread title' });
    expect(title).toHaveValue('Tomato trellis');
    await waitFor(() => expect(document.activeElement).toBe(title));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('trellis'));
    fireEvent.change(title, { target: { value: 'Trellis for the tomatoes' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'trellis', title: 'Trellis for the tomatoes' }));
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
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
    await userEvent.setup().click(screen.getByTestId('auto-thread-menu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const title = await screen.findByRole('textbox', { name: 'Thread title' });
    fireEvent.change(title, { target: { value: 'Bread, the long way' } });
    // The Enter ends in the title: the keyboard moves to the box within the same press, and the key must not follow it there as a new line.
    expect(fireEvent.keyDown(title, { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'bread', title: 'Bread, the long way' }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(box().value).toBe('');
  });

  it('picks an option of the open card with 1 to 3 while the keyboard is in the card, and types the number in the box', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Which bed?', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: ASK }));
    const card = screen.getByTestId('auto-question');
    // Each option says its number, beside its name and not as part of it.
    expect(within(card).getAllByRole('button').map((button) => button.textContent)).toEqual(['Bed 31', 'Bed 42']);
    expect(within(card).getByRole('button', { name: 'Bed 3' })).toBeInTheDocument();
    // In the box a number is a number: his answer may well start with one.
    expect(fireEvent.keyDown(box(), { key: '2' })).toBe(true);
    expect(auto.asked('answer')).toEqual([]);
    const option = within(card).getByRole('button', { name: 'Bed 3' });
    option.focus();
    // Past the options, or with a modifier, nothing is picked.
    key('3');
    key('1', { metaKey: true });
    expect(auto.asked('answer')).toEqual([]);
    key('2');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q1', answers: { 'Which bed?': 'Bed 4' } }));
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
  it('is on offer the moment the row leaves, before the service has answered', async () => {
    await open();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    rowButton('bread').focus();
    key('e');
    expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']);
    expect(said()).toBe('Archived: Sourdough timingsUndo');
    // While the archive is on its way, word of the thread from the service (a new title, say) does not bring the row back.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, title: 'Sourdough, timed' } }));
    expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']);
    // Taken back while the archive is still on its way: the row is back at once, and the service hears both, in order.
    key('z', { metaKey: true });
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    await waitFor(() => expect(focusedRow()).toBe('bread'));
    expect(screen.queryByTestId('auto-said')).toBeNull();
    // The archive lands, and the list stream says so before its undoing has: the row he brought back stays.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, archived: true } }));
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    release();
    await waitFor(() => expect(auto.asked('archive')).toEqual([{ kind: 'archive', id: 'bread', archived: true }, { kind: 'archive', id: 'bread', archived: false }]));
    expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    // Once both have landed the service has the last word again: archived somewhere else, the row leaves.
    await waitFor(() => expect(unconfirmedThreads.has('bread')).toBe(false));
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, archived: true } }));
    expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']);
  });

  it('keeps the open thread open when it is archived from its header and brought back before the post lands', async () => {
    await open();
    await openThread('bread');
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(useThreadStore.getState().openId).toBe('seeds'));
    key('z', { metaKey: true });
    expect(useThreadStore.getState().openId).toBe('bread');
    // The service's own word of the archive would close a thread that has left the list. This one has not.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, archived: true } }));
    expect(useThreadStore.getState().openId).toBe('bread');
    expect(rowButton('bread').getAttribute('aria-current')).toBe('true');
    release();
    await waitFor(() => expect(auto.asked('archive')).toHaveLength(2));
    expect(useThreadStore.getState().openId).toBe('bread');
  });

  it('keeps a snooze taken back while the service still says the thread is snoozed', async () => {
    await open();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    rowButton('bread').focus();
    key('s');
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    expect(rowIds()).not.toContain('bread');
    key('z', { metaKey: true });
    expect(rowIds()).toContain('bread');
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, snoozed: 4_000_000_000 } }));
    expect(rowIds()).toContain('bread');
    release();
    await waitFor(() => expect(auto.asked('snooze').map((route) => route.until === null)).toEqual([false, true]));
    expect(rowIds()).toContain('bread');
  });

  it('keeps the last actions and takes them back newest first, saying how many more there are', async () => {
    await open();
    rowButton('bread').focus();
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('inspect'));
    expect(rowIds()).toEqual(['beds', 'inspect']);
    expect(said()).toBe('Archived: Tomato trellisUndo2 more');
    expect(screen.getAllByTestId('auto-said')).toHaveLength(1);
    key('z', { metaKey: true });
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'trellis', 'inspect']));
    expect(said()).toBe('Archived: Seed orderUndo1 more');
    key('z', { metaKey: true });
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']));
    expect(said()).toBe('Archived: Sourdough timingsUndo');
    key('z', { metaKey: true });
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']));
    expect(screen.queryByTestId('auto-said')).toBeNull();
    await waitFor(() => expect(auto.asked('archive').filter((route) => route.archived === false).map((route) => route.id)).toEqual(['trellis', 'seeds', 'bread']));
    // With nothing on offer the key is left alone.
    expect(fireEvent.keyDown(rowButton('bread'), { key: 'z', metaKey: true })).toBe(true);
  });

  it('undoes from an empty box, and leaves Cmd+Z to the box while it holds text', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    await waitFor(() => expect(document.activeElement).toBe(box()));
    // Text in the box: Cmd+Z is the box's own undo, and the thread stays archived.
    fireEvent.change(box(), { target: { value: 'half a thought' } });
    expect(fireEvent.keyDown(box(), { key: 'z', metaKey: true })).toBe(true);
    expect(rowIds()).not.toContain('bread');
    // Empty, there is nothing of the box's to undo: the archive is taken back.
    fireEvent.change(box(), { target: { value: '' } });
    expect(fireEvent.keyDown(box(), { key: 'z', metaKey: true })).toBe(false);
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    expect(rowIds()).toContain('bread');
  });

  it('follows the same rule in the note and in an entry’s box', async () => {
    await open();
    await openQueue();
    key('ArrowDown');
    key('e');
    await waitFor(() => expect(entryIds()).toEqual(['item-1', 'text-b']));
    key('ArrowUp');
    key('n');
    const note = await within(screen.getByTestId('auto-entry-item-1')).findByRole('textbox', { name: 'Your note' });
    fireEvent.change(note, { target: { value: 'typing' } });
    expect(fireEvent.keyDown(note, { key: 'z', metaKey: true })).toBe(true);
    expect(entryIds()).toEqual(['item-1', 'text-b']);
    const words = within(screen.getByTestId('auto-entry-item-1')).getByTestId('auto-entry-box');
    expect(fireEvent.keyDown(words, { key: 'z', metaKey: true })).toBe(false);
    await waitFor(() => expect(entryIds()).toEqual(['item-1', 'text-a', 'text-b']));
  });

  it('brings the row back with the service’s sentence when the post fails, and the offer goes', async () => {
    await open();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    auto.state.failWrites = { kind: 'refused', message: 'Auto is busy.', code: 'busy', status: 503 };
    fireEvent.click(screen.getByTestId('auto-archive-bread'));
    // Gone, and on offer, before the service has said a word.
    expect(rowIds()).toEqual(['beds', 'seeds', 'trellis', 'inspect']);
    expect(said()).toBe('Archived: Sourdough timingsUndo');
    release();
    await waitFor(() => expect(rowIds()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']));
    // The reason first and whole, then the name, which is the part that may be cut.
    expect(said()).toBe('Auto is busy.Sourdough timings');
    expect(screen.getByTestId('auto-said-reason').textContent).toBe('Auto is busy.');
    expect(screen.getByTestId('auto-said-about').className).toContain('truncate');
    expect(screen.getByTestId('auto-said').getAttribute('data-problem')).toBe('true');
    expect(within(screen.getByTestId('auto-said')).queryByRole('button')).toBeNull();
    expect(useSaidStore.getState().stack).toEqual([]);
  });

  it('undoes a snooze, gives a thread snoozed again the time it had, and says so on Bring back', async () => {
    // A Wednesday morning: Next week is its own choice on any day but a Sunday.
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 11, 10, 0).getTime());
    await open();
    fireEvent.click(screen.getByTestId('auto-away-row'));
    await userEvent.setup().click(await screen.findByTestId('auto-snooze-labels'));
    const menu = within(await screen.findByTestId('auto-snooze-menu'));
    // A snoozed thread's clock also brings it back, so a key reaches that.
    expect(menu.getAllByRole('menuitem')[0].textContent).toBe('Bring back');
    fireEvent.click(menu.getByRole('menuitem', { name: /^Next week/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('labels'));
    expect(said()).toMatch(/^Snoozed until .+\.Undo$/);
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until: 4_000_000_000 }));
    // Snoozed again and then brought back: the line about the snooze no longer holds.
    await userEvent.setup().click(screen.getByTestId('auto-snooze-labels'));
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    expect(said()).toBe('Snoozed until tomorrow 9:00 am.Undo');
    const before = document.activeElement;
    // The snooze goes once the undo before it on this thread has landed.
    await waitFor(() => expect(last('snooze')?.until).not.toBe(4_000_000_000));
    const until = last('snooze')?.until;
    await userEvent.setup().click(within(row('labels')).getByRole('button', { name: 'Bring back' }));
    // One line about the thread: the snooze's gives way to the bring back's.
    expect(said()).toBe('Back in the list.Undo');
    expect(useSaidStore.getState().stack).toHaveLength(1);
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until: null }));
    // Brought back by a click, it is a row of the list again, and the keyboard stays where it was.
    expect(rowIds()).toContain('labels');
    expect(document.activeElement).toBe(before);
    // Undo puts it away again as it was, to the time it had.
    key('z', { metaKey: true });
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until }));
    expect(screen.getByTestId('auto-snoozed').querySelector('[data-thread-id="labels"]')).not.toBeNull();
  });

  it('takes an action back with Cmd+Z from a sidebar row with a page in front, and never from a page’s text', async () => {
    await open();
    rowButton('bread').focus();
    key('e');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    // A page's text, wherever it sits: Cmd+Z there is the page's own.
    const page = document.createElement('div');
    page.contentEditable = 'true';
    document.body.appendChild(page);
    page.focus();
    fireEvent.keyDown(page, { key: 'z', metaKey: true });
    expect(auto.asked('archive')).toHaveLength(1);
    expect(rowIds()).not.toContain('bread');
    // A page in front, the keyboard on a row of the sidebar: Cmd+Z is Auto's.
    act(() => useTabsStore.getState().open(focusFile('/Vault/Recipes/Bread.md').location, { newTab: true }));
    rowButton('seeds').focus();
    key('z', { metaKey: true });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: false }));
    expect(rowIds()).toContain('bread');
    page.remove();
  });

  it('picks nothing with a number on a row: a question is answered in the open thread', async () => {
    await open();
    rowButton('beds').focus();
    key('1');
    expect(useAutoStore.getState().held).toEqual({});
    expect(screen.queryByTestId('auto-said')).toBeNull();
  });

  it('offers nothing to undo, and posts no held answer, once the address has changed', async () => {
    hold.ms = 80;
    await open();
    rowButton('bread').focus();
    key('e');
    rowButton('beds').focus();
    key('e');
    await waitFor(() => expect(auto.asked('archive')).toHaveLength(2));
    expect(useSaidStore.getState().stack).toHaveLength(2);
    // Another address is another service: what was done at the old one is not this one's to take back.
    act(() => useAutoStore.setState({ address: 'https://other.example/agent' }));
    expect(useSaidStore.getState().stack).toEqual([]);
    expect(screen.queryByTestId('auto-said')).toBeNull();
    key('z', { metaKey: true });
    expect(auto.asked('archive')).toHaveLength(2);
  });

  it('opens what the last action made with O, from a row or an entry', async () => {
    await open();
    await openQueue();
    // A thread without words is one step further in: T, then the quiet button under the box.
    key('t');
    fireEvent.click(await screen.findByTestId('auto-entry-wordless'));
    expect(said()).toBe('Order the trays, made a threadOpenUndo');
    await waitFor(() => expect(focusedRow()).toBe('text-a'));
    await waitFor(() => expect(auto.asked('digest-thread')).toHaveLength(1));
    key('o');
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
    expect(screen.queryByTestId('auto-said')).toBeNull();
  });
});

describe('the open thread’s own actions', () => {
  it('has Snooze and Archive at its header’s right, a menu on its title, and Done for a thread from the digest', async () => {
    await open();
    await openThread('bread');
    const header = within(screen.getByTestId('auto-thread').querySelector('header') as HTMLElement);
    expect(header.getByRole('button', { name: 'Snooze' })).toBeInTheDocument();
    expect(header.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(header.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(header.queryByTestId('auto-stop')).toBeNull();
    // The title's words, then the chevron that opens its menu.
    expect(header.getByTestId('auto-title').textContent).toBe('Sourdough timings');
    const chevron = header.getByRole('button', { name: 'Thread menu' });
    expect(chevron).toBe(header.getByTestId('auto-thread-menu'));
    expect(chevron.querySelector('[data-testid="auto-title-chevron"]')).not.toBeNull();
    await userEvent.setup().click(chevron);
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Rename', 'Mark for the Mac']);
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
    expect(dialog.getByLabelText('Time')).toHaveValue('09:00');
    const date = (dialog.getByLabelText('Date') as HTMLInputElement).value;
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '14:30' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Snooze' }));
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: new Date(year, month - 1, dayOfMonth, 14, 30).getTime() / 1000 }));
    expect(screen.queryByTestId('auto-snooze-date')).toBeNull();
  });

  it('takes any time from now on in the dialog, today included, and refuses one that has passed', async () => {
    const now = new Date(2026, 10, 14, 15, 10).getTime();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await open();
    await userEvent.setup().click(screen.getByTestId('auto-snooze-bread'));
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: 'Pick a time…' }));
    const dialog = within(await screen.findByTestId('auto-snooze-date'));
    const date = dialog.getByLabelText('Date') as HTMLInputElement;
    // It opens on tomorrow morning, and today can be picked.
    expect(date.value).toBe('2026-11-15');
    expect(date.min).toBe('2026-11-14');
    fireEvent.change(date, { target: { value: '2026-11-14' } });
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '15:10' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Snooze' }));
    expect(dialog.getByRole('alert').textContent).toBe('Choose a time from now on, within a year.');
    expect(auto.asked('snooze')).toEqual([]);
    fireEvent.change(dialog.getByLabelText('Time'), { target: { value: '23:30' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Snooze' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: new Date(2026, 10, 14, 23, 30).getTime() / 1000 }));
    expect(said()).toBe('Snoozed until 11:30 pm.Undo');
  });

  it('offers a snoozed row another time beside Bring back', async () => {
    await open();
    fireEvent.click(screen.getByTestId('auto-away-row'));
    const snoozed = within(await screen.findByTestId('auto-row-labels'));
    expect(snoozed.getByRole('button', { name: 'Bring back' })).toBeInTheDocument();
    expect(snoozed.getByRole('button', { name: 'Snooze' })).toBeInTheDocument();
  });
});

describe('a click never moves the keyboard onto a row', () => {
  /** A page's text with the caret in it, as the editor's is. */
  const pageText = () => {
    const text = document.createElement('div');
    text.contentEditable = 'true';
    document.body.appendChild(text);
    text.focus();
    return text;
  };

  it('leaves the caret in a page after a click on a row’s Archive icon, and E on a row still moves the keyboard on', async () => {
    await open();
    const text = pageText();
    expect(document.activeElement).toBe(text);
    await userEvent.setup().click(screen.getByTestId('auto-archive-bread'));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    // The keyboard is where it was: the letters he types next are the page's, not a row's.
    expect(document.activeElement).toBe(text);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(text);
    // An action taken with a key moves the keyboard to the next row, as before.
    rowButton('seeds').focus();
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
    text.remove();
  });

  it('leaves the caret in a page after a snooze picked from a row’s menu with the pointer', async () => {
    await open();
    const text = pageText();
    const user = userEvent.setup();
    await user.pointer({ keys: '[MouseRight]', target: rowButton('bread') });
    const menu = within(await screen.findByTestId('auto-row-menu-bread'));
    await user.click(menu.getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('bread'));
    await waitFor(() => expect(screen.queryByTestId('auto-row-menu-bread')).toBeNull());
    expect(document.activeElement).toBe(text);
    text.remove();
  });

  it('leaves the keyboard where it was after a click on the clock’s time, and a key pick moves it to the next row', async () => {
    await open();
    const text = pageText();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('auto-snooze-bread'));
    await user.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('bread'));
    await waitFor(() => expect(screen.queryByTestId('auto-snooze-menu')).toBeNull());
    expect(document.activeElement).toBe(text);
    // S and Enter on a row: the keyboard goes on to the row below.
    rowButton('seeds').focus();
    key('s');
    const menu = await screen.findByTestId('auto-snooze-menu');
    await waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    key('Enter');
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => expect(last('snooze')?.id).toBe('seeds'));
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
    text.remove();
  });

  it('leaves the caret in a page after a click on a queue entry’s Resolve', async () => {
    await open();
    await openQueue();
    const text = pageText();
    await userEvent.setup().click(within(screen.getByTestId('auto-entry-item-1')).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(last('digest-resolve')).toMatchObject({ ids: ['item-1'], resolved: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(text);
    text.remove();
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
    // Never seen: its row is marked at once, and the pane keeps what it held, out of reach, for the short wait.
    fireEvent.click(rowButton('trellis'));
    expect(rowButton('trellis').getAttribute('aria-current')).toBe('true');
    expect(rowButton('bread').getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sourdough timings');
    expect(within(screen.getByTestId('auto-talk')).getByText('When do I start?')).toBeInTheDocument();
    expect(screen.getByTestId('auto-talk').querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByTestId('auto-archive-open')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
    // Past the wait there is nothing left to hold on to: the title, and Loading.
    await new Promise((resolve) => setTimeout(resolve, SLOW_MS + 60));
    expect(screen.getByTestId('auto-title').textContent).toBe('Tomato trellis');
    expect(screen.queryByText('When do I start?')).toBeNull();
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
        <ThemeProvider><TooltipProvider><ShellProvider><Sync /><AutoScreen /></ShellProvider></TooltipProvider></ThemeProvider>
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

  it('stays at its end when the pane shrinks, and keeps the row at the top in place when he has scrolled up', async () => {
    const watched: Array<{ run: () => void; on: Element[] }> = [];
    vi.stubGlobal('ResizeObserver', class {
      private readonly entry: { run: () => void; on: Element[] };
      constructor(callback: () => void) {
        this.entry = { run: callback, on: [] };
        watched.push(this.entry);
      }
      observe(element: Element) { this.entry.on.push(element); }
      unobserve() { /* nothing to do */ }
      disconnect() { this.entry.on = []; }
    });
    const resized = (element: Element) => act(() => watched.filter((each) => each.on.includes(element)).forEach((each) => each.run()));
    await open();
    await openThread('bread');
    // At the end: the box grows by 200, the pane loses them, and the end of the reply is still in view.
    let talk = sizeTalk(3000, 500);
    talk.scrollTop = 2500;
    fireEvent.scroll(talk);
    talk = sizeTalk(3000, 300);
    resized(talk);
    expect(talk.scrollTop).toBe(3000);
    expect(screen.queryByTestId('auto-jump')).toBeNull();
    // Scrolled up: the row at the top of the pane stays at the top when the width, and so every height, changes.
    const rows = [...talk.querySelectorAll<HTMLElement>('[data-row]')];
    expect(rows.length).toBeGreaterThan(1);
    const lay = (heights: number[]) => rows.forEach((each, index) => {
      Object.defineProperty(each, 'offsetTop', { configurable: true, get: () => heights.slice(0, index).reduce((sum, height) => sum + height, 0) });
      Object.defineProperty(each, 'offsetHeight', { configurable: true, get: () => heights[index] });
    });
    lay(rows.map(() => 400));
    talk.scrollTop = 450;
    fireEvent.scroll(talk);
    lay(rows.map(() => 700));
    resized(talk);
    // The second row began 50 above the top of the pane, and still does.
    expect(talk.scrollTop).toBe(750);
  });

  it('marks the start of the newest reply in a thread he has not read, to open there', async () => {
    await open({ threads: [BEDS, BREAD, { ...SEEDS, unread: true }, TRELLIS, INSPECTION, LABELS] });
    await openThread('seeds');
    expect(useThreadStore.getState().openedUnread).toBe(true);
    const anchors = screen.getByTestId('auto-talk').querySelectorAll('[data-anchor]');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].textContent).toBe('Twelve packets.');
    await openThread('bread');
    expect(useThreadStore.getState().openedUnread).toBe(false);
  });
});

describe('his place in the list and in the queue', () => {
  const remount = () =>
    render(
      <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider><TooltipProvider><ShellProvider><Sync /><AutoScreen /></ShellProvider></TooltipProvider></ThemeProvider>
      </MemoryRouter>
    );

  it('keeps the list where he scrolled it when the tab is left and shown again', async () => {
    const view = await open();
    const rows = screen.getByTestId('auto-list-rows');
    rows.scrollTop = 260;
    fireEvent.scroll(rows);
    expect(placeOf('list')?.top).toBe(260);
    view.unmount();
    remount();
    await screen.findByTestId('auto-row-bread');
    expect(screen.getByTestId('auto-list-rows').scrollTop).toBe(260);
  });

  it('keeps each day of the queue where he scrolled it', async () => {
    const view = await open();
    await openQueue();
    const queue = screen.getByTestId('auto-queue');
    queue.scrollTop = 340;
    fireEvent.scroll(queue);
    expect(placeOf(`queue:${DAY}`)?.top).toBe(340);
    view.unmount();
    remount();
    await screen.findByTestId('auto-queue-pane');
    await waitFor(() => expect(screen.getByTestId('auto-queue').scrollTop).toBe(340));
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

  it('opens the note with N and saves it with Cmd+Enter, and T opens the box a thread starts from', async () => {
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
    // T makes nothing yet: it opens the entry with the caret in its box, for what he wants done.
    key('t');
    const words = within(screen.getByTestId('auto-entry-item-1')).getByTestId('auto-entry-box');
    await waitFor(() => expect(document.activeElement).toBe(words));
    expect(screen.getByTestId('auto-entry-item-1').getAttribute('data-open')).toBe('true');
    expect(auto.asked('digest-thread')).toEqual([]);
    // Enter on no words does nothing, and stepping out makes nothing.
    fireEvent.keyDown(words, { key: 'Enter' });
    fireEvent.keyDown(words, { key: 'Escape' });
    expect(focusedRow()).toBe('item-1');
    expect(auto.asked('digest-thread')).toEqual([]);
    // T again, with the entry open already, goes back to the box. His words start the thread.
    key('t');
    await waitFor(() => expect(document.activeElement).toBe(words));
    fireEvent.change(words, { target: { value: 'Order two trays' } });
    fireEvent.keyDown(words, { key: 'Enter' });
    await waitFor(() => expect(last('digest-thread')).toMatchObject({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Order two trays' }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('from-item-1'));
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

  it('brings an entry that opens into view whole, so the last one does not open under the fold', async () => {
    const into = vi.fn();
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Element.prototype.scrollIntoView = into;
    try {
      await open();
      await openQueue();
      key('End');
      expect(focusedRow()).toBe('text-b');
      expect(into).not.toHaveBeenCalled();
      key('Enter');
      await waitFor(() => expect(screen.getByTestId('auto-entry-text-b').getAttribute('data-open')).toBe('true'));
      expect(into).toHaveBeenCalledTimes(1);
      expect(into).toHaveBeenCalledWith({ block: 'nearest' });
      // It is the entry itself that is brought in, its box included.
      expect(into.mock.contexts[0]).toBe(screen.getByTestId('auto-entry-text-b'));
      expect(within(into.mock.contexts[0] as HTMLElement).getByTestId('auto-entry-box')).toBeInTheDocument();
    } finally {
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had);
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('puts the keyboard on the entry after a click on Save the note', async () => {
    await open();
    await openQueue();
    key('n');
    const note = await within(screen.getByTestId('auto-entry-item-1')).findByRole('textbox', { name: 'Your note' });
    fireEvent.change(note, { target: { value: 'Ask about peat-free' } });
    const save = within(screen.getByTestId('auto-entry-item-1')).getByRole('button', { name: /Save the note/ });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(last('digest-note')).toEqual({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'Ask about peat-free' }));
    // The button has gone with the save: the keyboard is on the entry it belonged to, not lost.
    await waitFor(() => expect(focusedRow()).toBe('item-1'));
    expect(within(screen.getByTestId('auto-entry-item-1')).queryByRole('button', { name: /Save the note/ })).toBeNull();
  });

  it('moves the keyboard to the other arrow when a day arrow reaches the last day', async () => {
    const EARLIER = '2026-11-12';
    await open({ digests: { [DAY]: day(), [EARLIER]: autoDigest(EARLIER, [['Top 3', [digestEntry('item-9', { kind: 'item', title: 'Sharpen the hoe' })]]]) } });
    await openQueue();
    const earlier = screen.getByRole('button', { name: 'Earlier day' });
    const later = screen.getByRole('button', { name: 'Later day' });
    // The arrows sit together at the right of the header, in a fixed place whatever the day is called.
    expect(earlier.nextElementSibling).toBe(later);
    earlier.focus();
    fireEvent.click(earlier);
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Thursday, November 12'));
    // There is no earlier day: its arrow is dead, so the keyboard is on the one that still goes somewhere.
    expect(earlier).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(later));
    fireEvent.click(later);
    await waitFor(() => expect(screen.getByTestId('auto-queue-day').textContent).toBe('Friday, November 13'));
    expect(later).toBeDisabled();
    await waitFor(() => expect(document.activeElement).toBe(earlier));
  });

  it('hands the keyboard to the queue’s first word when the last entry leaves', async () => {
    await open({ digests: { [DAY]: autoDigest(DAY, [['Yesterday', [digestEntry('only', { md: 'Fed the tomatoes.' })]]]) } });
    fireEvent.click(rowButton(':digest'));
    await waitFor(() => expect(focusedRow()).toBe('only'));
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('auto-queue-left'));
  });
});

describe('a narrow Auto page', () => {
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

  it('keeps the thread on Escape in the box, the keyboard going to its row in the sidebar', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await screen.findByTestId('auto-thread');
    fireEvent.keyDown(box(), { key: 'Escape' });
    await waitFor(() => expect(focusedRow()).toBe('bread'));
    expect(screen.getByTestId('auto-thread')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-back')).toBeNull();
  });

  it('says what the last action did at the sidebar’s foot, never in the page', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await screen.findByTestId('auto-thread');
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    expect(said()).toBe('Archived: Sourdough timingsUndo');
    expect(screen.getByTestId('auto').contains(screen.getByTestId('auto-said'))).toBe(false);
  });

  it('puts the queue’s actions on a line under the words when the pane has no room for a column', async () => {
    await open();
    fireEvent.click(rowButton(':digest'));
    await screen.findByTestId('auto-queue-pane');
    // At 600 px there is room for the column at the row's right.
    const beside = screen.getByTestId('auto-entry-item-1');
    expect((beside.querySelector('[data-auto-entry]') as HTMLElement).parentElement?.contains(within(beside).getByRole('button', { name: 'Resolve' }))).toBe(true);
    fireEvent.click(rowButton('bread'));
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

  it('keeps thread actions out of the palette and shortcuts while the digest is active', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [], state: 'working', activity: '' }));
    await openQueue();
    expect(useThreadStore.getState().openId).toBe('bread');
    expect(key('.', { metaKey: true })).toBe(true);
    expect(auto.asked('stop')).toHaveLength(0);
    const palette = await show('>thread');
    expect(palette.queryByTestId('palette-command-auto.archiveThread')).toBeNull();
    expect(palette.queryByTestId('palette-command-auto.renameThread')).toBeNull();
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

  it('gives the keyboard back to where it was opened from on Escape', async () => {
    await open();
    rowButton('trellis').focus();
    let palette = await show('>');
    fireEvent.keyDown(palette.getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull());
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
    // From the box as well, with what was typed still there.
    await openThread('bread');
    fireEvent.change(box(), { target: { value: 'half a thought' } });
    box().focus();
    palette = await show('>');
    fireEvent.keyDown(palette.getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(box()));
    expect(box().value).toBe('half a thought');
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
