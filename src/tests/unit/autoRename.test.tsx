import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoItem, AutoRoute } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { forgetPlaces } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
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

/*
 * Renaming a thread: a double-click on its row's title, on the open
 * thread's title, or Rename at the top of the row's menu. One rename at a
 * time, posted through the one route the header's menu already used.
 */

const ROOT = '/Vault';
const DAY = '2026-11-13';
const user = (text: string): AutoItem => ({ role: 'user', text, cid: null });

const BREAD = autoThread('bread', { title: 'Sourdough timings', last: 'Start the starter at 8.' });
const SEEDS = autoThread('seeds', { title: 'Seed order', last: 'Twelve packets.' });
const TRELLIS = autoThread('trellis', { title: 'Tomato trellis', last: 'String every 20 cm.' });
const LABELS = autoThread('labels', { title: 'Pantry labels', last: 'A4, 21 to a page.', snoozed: 4_000_000_000 });

let auto: FakeAuto;

function Sync(): null {
  useAutoSync();
  return null;
}

async function open() {
  auto = installAutoApi({
    threads: [BREAD, SEEDS, TRELLIS, LABELS],
    snapshots: {
      bread: autoSnapshot(BREAD, { items: [user('When do I start?')] }),
      seeds: autoSnapshot(SEEDS, { items: [user('Order the seeds')] }),
      trellis: autoSnapshot(TRELLIS, { items: [user('How far apart?')] }),
    },
    digests: { [DAY]: autoDigest(DAY, [['Top 3', [digestEntry('item-1', { kind: 'item', title: 'Order the trays', md: 'Two trays.' })]]]) },
  });
  render(
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
}

const rowButton = (id: string) => document.querySelector(`[data-auto-list] [data-row-id="${id}"]`) as HTMLElement;
const row = (id: string) => screen.getByTestId(`auto-row-${id}`);
const rowField = (id: string) => within(row(id)).queryByRole('textbox', { name: 'Thread title' }) as HTMLInputElement | null;
const fields = () => screen.queryAllByRole('textbox', { name: 'Thread title' });
const rowTitle = (id: string) => screen.getByTestId(`auto-row-title-${id}`).textContent;
const box = () => screen.getByTestId('auto-box') as HTMLTextAreaElement;
const header = () => screen.getByTestId('auto-thread-header');
const focusedRow = () => document.activeElement?.getAttribute('data-row-id') ?? null;
const writes = () => auto.routes().filter((route) => !['status', 'threads', 'archived', 'thread', 'digest', 'digests', 'usage'].includes(route.kind));
const last = <K extends AutoRoute['kind']>(kind: K) => auto.asked(kind).at(-1);
const allSelected = (field: HTMLInputElement) => field.selectionStart === 0 && field.selectionEnd === field.value.length;

/** A double-click with the pointer on a row's title, as he does it. */
async function doubleClickRow(id: string) {
  await userEvent.setup().dblClick(screen.getByTestId(`auto-row-title-${id}`));
  const field = await waitFor(() => {
    const found = rowField(id);
    expect(found).not.toBeNull();
    return found as HTMLInputElement;
  });
  await waitFor(() => expect(document.activeElement).toBe(field));
  return field;
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

describe('renaming on a row', () => {
  it('turns the title into a field with all of it selected, the thread opening behind it with the caret staying in the field', async () => {
    await open();
    let release = () => undefined as void;
    auto.state.threadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const field = await doubleClickRow('seeds');
    expect(field).toHaveValue('Seed order');
    expect(allSelected(field)).toBe(true);
    expect(field.maxLength).toBe(120);
    // The first click opened the thread.
    expect(useThreadStore.getState().openId).toBe('seeds');
    expect(useThreadStore.getState().renaming).toEqual({ id: 'seeds', at: 'row' });
    // The thread arrives; the box does not take the caret.
    act(() => release());
    await waitFor(() => expect(auto.followed.thread?.id).toBe('seeds'));
    await waitFor(() => expect(screen.getByTestId('auto-box')).toBeInTheDocument());
    expect(document.activeElement).toBe(field);
    // The header stays a title.
    expect(within(header()).queryByRole('textbox')).toBeNull();
  });

  it('posts one rename on Enter, shows the new title on the row, and puts the keyboard back on the row', async () => {
    await open();
    const field = await doubleClickRow('seeds');
    fireEvent.change(field, { target: { value: '  Seed order for spring ' } });
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(rowTitle('seeds')).toBe('Seed order for spring'));
    expect(auto.asked('rename')).toEqual([{ kind: 'rename', id: 'seeds', title: 'Seed order for spring' }]);
    expect(rowField('seeds')).toBeNull();
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    // The arrows work at once.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(focusedRow()).toBe('trellis');
  });

  it('leaves the title as it was on Escape, posting nothing, with the row’s keys working again', async () => {
    await open();
    const field = await doubleClickRow('seeds');
    fireEvent.change(field, { target: { value: 'Something else' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    expect(rowTitle('seeds')).toBe('Seed order');
    expect(auto.asked('rename')).toEqual([]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'e' });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'seeds', archived: true }));
  });

  it('saves when the field is left', async () => {
    await open();
    const field = await doubleClickRow('trellis');
    fireEvent.change(field, { target: { value: 'Trellis' } });
    act(() => box().focus());
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'trellis', title: 'Trellis' }));
    expect(auto.asked('rename')).toHaveLength(1);
    expect(rowField('trellis')).toBeNull();
  });

  it('posts nothing for an empty or an unchanged title, and keeps the old one', async () => {
    await open();
    let field = await doubleClickRow('seeds');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(rowField('seeds')).toBeNull());
    field = await doubleClickRow('seeds');
    fireEvent.change(field, { target: { value: ' Seed order ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(rowField('seeds')).toBeNull());
    expect(auto.asked('rename')).toEqual([]);
    expect(rowTitle('seeds')).toBe('Seed order');
  });

  it('takes letters and Cmd+Z as his text: no snooze, archive, mark or undo', async () => {
    await open();
    // An archive, so an Undo is on offer.
    rowButton('trellis').focus();
    fireEvent.keyDown(rowButton('trellis'), { key: 'e' });
    await waitFor(() => expect(auto.asked('archive')).toHaveLength(1));
    const field = await doubleClickRow('seeds');
    const before = writes().length;
    fireEvent.change(field, { target: { value: '' } });
    for (const letter of ['s', 'e', 'm', 'd', 'o', 'j', 'k']) fireEvent.keyDown(field, { key: letter });
    fireEvent.keyDown(field, { key: 'z', metaKey: true });
    await userEvent.setup().keyboard('see');
    expect(field).toHaveValue('see');
    expect(document.activeElement).toBe(field);
    expect(screen.queryByTestId('auto-snooze-menu')).toBeNull();
    expect(writes()).toHaveLength(before);
    expect(screen.getByTestId('auto-said').textContent).toMatch(/^Archived: Tomato trellis/);
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'seeds', title: 'see' }));
    expect(auto.asked('snooze')).toEqual([]);
    expect(auto.asked('archive')).toHaveLength(1);
    expect(auto.asked('desk')).toEqual([]);
  });

  it('does not drag, open the row’s menu, or leave the field for a press inside it', async () => {
    await open();
    expect(row('seeds').getAttribute('draggable')).toBe('true');
    const field = await doubleClickRow('seeds');
    expect(row('seeds').getAttribute('draggable')).toBeNull();
    fireEvent.contextMenu(field);
    expect(screen.queryByTestId('auto-row-menu-seeds')).toBeNull();
    await userEvent.setup().click(field);
    expect(document.activeElement).toBe(field);
    expect(rowField('seeds')).toBe(field);
  });

  it('keeps the old title when the post fails, as the header’s rename does', async () => {
    await open();
    const field = await doubleClickRow('seeds');
    auto.state.failWrites = { kind: 'refused', message: 'Not now.', code: 'busy', status: 409 };
    fireEvent.change(field, { target: { value: 'Seeds' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(auto.asked('rename')).toHaveLength(1));
    await waitFor(() => expect(rowField('seeds')).toBeNull());
    expect(rowTitle('seeds')).toBe('Seed order');
  });

  it('starts from Rename, the first item of the row’s menu', async () => {
    await open();
    const pointer = userEvent.setup();
    await pointer.pointer({ keys: '[MouseRight]', target: rowButton('trellis') });
    const menu = within(await screen.findByTestId('auto-row-menu-trellis'));
    expect(menu.getAllByRole('menuitem')[0].textContent).toBe('Rename');
    await pointer.click(menu.getByRole('menuitem', { name: 'Rename' }));
    const field = await waitFor(() => rowField('trellis') as HTMLInputElement);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field).toHaveValue('Tomato trellis');
  });
});

describe('one rename at a time', () => {
  it('ends the row’s rename, saving it, when the header’s title is double-clicked', async () => {
    await open();
    const field = await doubleClickRow('bread');
    fireEvent.change(field, { target: { value: 'Bread' } });
    await userEvent.setup().dblClick(within(header()).getByTestId('auto-title'));
    await waitFor(() => expect(within(header()).queryByRole('textbox', { name: 'Thread title' })).not.toBeNull());
    expect(fields()).toHaveLength(1);
    expect(rowField('bread')).toBeNull();
    expect(auto.asked('rename')).toEqual([{ kind: 'rename', id: 'bread', title: 'Bread' }]);
  });

  it('has only one field when a row’s rename starts while the header’s is open', async () => {
    await open();
    await doubleClickRow('bread');
    act(() => useThreadStore.getState().startRename('bread', 'header'));
    act(() => useThreadStore.getState().startRename('seeds', 'row'));
    await waitFor(() => expect(rowField('seeds')).not.toBeNull());
    expect(fields()).toHaveLength(1);
  });
});

describe('renaming in the header', () => {
  it('turns the title into the field on a double-click, with no menu left open', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    await userEvent.setup().dblClick(within(header()).getByTestId('auto-title'));
    const field = await within(header()).findByRole('textbox', { name: 'Thread title' });
    expect(field).toHaveValue('Sourdough timings');
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(rowField('bread')).toBeNull();
    fireEvent.change(field, { target: { value: 'Bread timings' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(auto.asked('rename')).toEqual([{ kind: 'rename', id: 'bread', title: 'Bread timings' }]));
    // Done with the keyboard, it goes back to the box.
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it('opens holding the title as renamed in the row a moment ago, all of it selected', async () => {
    await open();
    const field = await doubleClickRow('bread');
    fireEvent.change(field, { target: { value: 'see' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(within(header()).getByTestId('auto-title').textContent).toBe('see'));
    await userEvent.setup().dblClick(within(header()).getByTestId('auto-title'));
    const title = (await within(header()).findByRole('textbox', { name: 'Thread title' })) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(title.value).toBe('see');
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 3]);
  });

  it('opens the menu from the chevron with one click, Rename first', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    await userEvent.setup().click(within(header()).getByTestId('auto-thread-menu'));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Rename', 'Mark for the Mac']);
  });

  it('reads as the thread’s heading, with the chevron its own button reached by Tab', async () => {
    await open();
    fireEvent.click(rowButton('bread'));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    const heading = within(header()).getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(within(header()).getByTestId('auto-title').textContent);
    expect(within(heading).queryByRole('button')).toBeNull();
    const chevron = within(header()).getByRole('button', { name: 'Thread menu' });
    expect(chevron.tabIndex).toBe(0);
    expect(chevron.className).toContain('focus-visible:ring-2');
  });

  it('is not renamed while it is a new thread', async () => {
    await open();
    fireEvent.click(rowButton(':new'));
    await userEvent.setup().dblClick(within(header()).getByTestId('auto-title'));
    expect(fields()).toEqual([]);
  });
});

describe('what is not renamed', () => {
  it('leaves the Digest row, the Put away row and a row on the Put away page as they are', async () => {
    await open();
    const pointer = userEvent.setup();
    await pointer.dblClick(rowButton(':digest'));
    expect(fields()).toEqual([]);
    await pointer.dblClick(screen.getByTestId('auto-away-row'));
    const page = await screen.findByTestId('auto-away-page');
    expect(fields()).toEqual([]);
    await pointer.pointer({ keys: '[MouseRight]', target: page.querySelector('[data-row-id="labels"]') as HTMLElement });
    const menu = within(await screen.findByTestId('auto-row-menu-labels'));
    expect(menu.getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(menu.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    await pointer.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('auto-row-menu-labels')).toBeNull());
    // A double-click opens the thread, as a click on the page does; no title turns into a field.
    await pointer.dblClick(page.querySelector('[data-row-id="labels"]') as HTMLElement);
    expect(fields()).toEqual([]);
    expect(auto.asked('rename')).toEqual([]);
  });
});
