import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoItem, AutoQuestion, AutoRoute, AutoThread, AutoWait } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { forgetPlaces } from '@/renderer/features/auto/model/places';
import { useAutoCommands } from '@/renderer/features/auto/useAutoCommands';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
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
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';

/*
 * What is put away, in the tab: the archive, a thread waiting on a reply,
 * how long a thread has been working, and the small things the third review
 * listed (what Undo leaves behind, words begun before a card, where the
 * keyboard goes).
 */

const ROOT = '/Vault';
const DAY = '2026-11-13';
// A Saturday afternoon, in whatever zone the tests run in.
const NOW = new Date(2026, 10, 14, 15, 10, 0).getTime();
const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime() / 1000;
const user = (text: string, cid: string | null = null): AutoItem => ({ role: 'user', text, cid });
const reply = (text: string, open = false): AutoItem => ({ role: 'assistant', text, open });

const wait = (fields: Partial<AutoWait> = {}): AutoWait => ({
  say: 'until Sam sends the quote', state: 'watching', on: 'Sam', what: 'the quote for the glass', where: 'Gmail', link: 'https://mail.example/t/18c2',
  check: 'Any reply from Sam with a price', since: at(11, 14, 10, 10), expires: at(11, 17, 17), heard: 'Sam: I will measure the frames on Monday.', reply: '', ...fields,
});

const BEDS = autoThread('beds', {
  title: 'Raised bed plan', status: 'waiting', updated: at(11, 14, 14),
  ask: { id: 'q0', kind: 'ask', text: 'Which wood for the frames?', options: ['Cedar', 'Larch'], question: 'Which wood for the frames?' },
});
const BREAD = autoThread('bread', { title: 'Sourdough timings', last: 'Start the starter at 8.', updated: at(11, 14, 9, 5) });
const SEEDS = autoThread('seeds', { title: 'Seed order', last: 'Twelve packets.', updated: at(11, 13, 12) });
const TRELLIS = autoThread('trellis', { title: 'Tomato trellis', last: 'String every 20 cm.', updated: at(11, 12, 12) });
const INSPECTION = autoThread('inspect', { title: 'Book the inspection', last: 'The committee walks the plots.', waits: true, digest: { date: DAY, id: 'item-2' }, updated: at(11, 13, 8) });
const LABELS = autoThread('labels', { title: 'Pantry labels', last: 'A4, 21 to a page.', snoozed: at(11, 15, 9), snoozedAt: at(11, 14, 14, 10), updated: at(11, 14, 14, 10) });
const GLASS = autoThread('glass', {
  title: 'Greenhouse glass', last: 'Waiting on Sam in Gmail.', snoozed: at(11, 17, 17), snoozedAt: at(11, 14, 10, 10), updated: at(11, 14, 10, 10), wait: wait(),
});
/** Twelve archived threads, the first archived last. */
const GONE = Array.from({ length: 12 }, (_each, n) =>
  autoThread(`gone${n + 1}`, { title: `Old thread ${n + 1}`, last: `Last of ${n + 1}`, archived: true, archivedAt: at(11, 13, 10) - n * 86_400, updated: at(11, 1, 9) })
);

const PARTS: AutoQuestion = {
  id: 'q2', kind: 'ask',
  questions: [
    { question: 'Which bed gets the squash?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 1', description: '' }, { label: 'Bed 2', description: '' }] },
    { question: 'Which go beside it?', header: 'Beside', multiSelect: true, options: [{ label: 'Borage', description: '' }, { label: 'Dill', description: '' }] },
  ],
};
const ASK: AutoQuestion = { id: 'q1', kind: 'ask', questions: [{ question: 'Which bed?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 3', description: '' }, { label: 'Bed 4', description: '' }] }] };
const PERMISSION: AutoQuestion = { id: 'p1', kind: 'permission', tool: 'Bash', title: 'Run a command: move three drafts', detail: 'mv Notes/drafts/*.md Archive/', reason: 'They are old.' };

const day = () => autoDigest(DAY, [['Top 3', [
  digestEntry('item-1', { kind: 'item', title: 'Order the trays', md: 'Two trays of 40 cells.' }),
  digestEntry('item-2', { kind: 'item', title: 'Book the inspection', md: 'The committee walks the plots.', state: 'thread', thread: 'inspect' }),
]]]);

let auto: FakeAuto;

function Sync(): null {
  useAutoSync();
  useAutoCommands();
  return null;
}

async function open(options: Parameters<typeof installAutoApi>[0] = {}) {
  const threads = options.threads ?? [BEDS, BREAD, SEEDS, TRELLIS, INSPECTION, LABELS, GLASS];
  const glass = threads.find((thread) => thread.id === 'glass') ?? GLASS;
  auto = installAutoApi({
    archived: GONE,
    digests: { [DAY]: day() },
    ...options,
    threads,
    snapshots: {
      // Every thread can be opened: a snapshot with nothing in it unless a test says more.
      ...Object.fromEntries(threads.map((thread) => [thread.id, autoSnapshot(thread)])),
      bread: autoSnapshot(BREAD, { items: [user('When do I start the bread?'), reply('Start the starter at 8.')] }),
      beds: autoSnapshot(BEDS, { items: [user('Plan the beds')], live: { items: [], activity: 'Waiting for you', state: 'waiting', question: null } }),
      inspect: autoSnapshot(INSPECTION, { seed: 'Digest, Friday November 13, item 2: Book the inspection\n\nThe committee walks the plots.' }),
      glass: autoSnapshot(glass, { items: [user('Ask Sam for a quote.'), reply('The request is drafted.'), user('Wait for a reply: until Sam sends the quote'), reply('Waiting on Sam in Gmail.')] }),
      gone1: autoSnapshot(GONE[0], { items: [user('About the old thread.'), reply('Last of 1')] }),
      ...options.snapshots,
    },
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

const row = (id: string) => screen.getByTestId(`auto-row-${id}`);
/** A row's own button, in the sidebar or on the Snoozed page. */
const rowButton = (id: string) =>
  (document.querySelector(`[data-auto-list] [data-row-id="${id}"]`) ?? document.querySelector(`[data-testid="auto-away-page"] [data-row-id="${id}"]`)) as HTMLElement;
/** What a row of the Snoozed page offers beside its words: the clock's label, then the words on its button. */
const actionsOf = (id: string) => [...row(id).querySelectorAll('button:not([data-away-row])')].map((button) => button.getAttribute('aria-label') ?? button.textContent);
/** Opens the Snoozed page from its row at the foot of Threads. */
async function openAway() {
  fireEvent.click(screen.getByTestId('auto-away-row'));
  await screen.findByTestId('auto-away-page');
}
const headings = () => [...screen.getByTestId('auto-away-page').querySelectorAll('h2')].map((heading) => heading.textContent);
const rowIds = (within_ = 'auto-list') => [...screen.getByTestId(within_).querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
/** The threads in the list proper, without what is put away. */
const listed = () => [...screen.getByTestId('auto-list').querySelectorAll('[data-testid^="auto-group-"] [data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
const box = () => screen.getByTestId('auto-box') as HTMLTextAreaElement;
const last = <K extends AutoRoute['kind']>(kind: K) => auto.asked(kind).at(-1);
const said = () => (screen.queryByTestId('auto-said')?.textContent ?? '').replace(/\s+/g, ' ');
const focusedRow = () => document.activeElement?.getAttribute('data-row-id') ?? document.activeElement?.getAttribute('data-testid') ?? null;
const key = (name: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: name, ...init });
const command = (id: string) => commandRegistry.getAllCommands().find((each) => each.id === id);

async function openThread(id: string) {
  fireEvent.click(rowButton(id));
  await waitFor(() => expect(auto.followed.thread?.id).toBe(id));
}

async function type(text: string, enter = true) {
  fireEvent.change(box(), { target: { value: text } });
  if (enter) await userEvent.setup().type(box(), '{Enter}');
}

/** Opens the snooze menu of a row and its "Until a reply" dialog. */
async function untilAReply(id: string) {
  await userEvent.setup().click(screen.getByTestId(`auto-snooze-${id}`));
  fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: 'Until a reply…' }));
  return within(await screen.findByTestId('auto-snooze-reply'));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
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
});

describe('what is put away, one row and a page', () => {
  it('offers Open to the side on the row’s right-click, which takes the Auto tab to the other pane', async () => {
    // A page beside the Auto tab, so the tab has a pane to leave.
    openTabs([browseAuto().location, '/Vault/Notes.md'], 0);
    await open();
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: screen.getByTestId('auto-away-row') });
    const menu = await screen.findByTestId('auto-away-menu-row');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Open to the side']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open to the side' }));
    await screen.findByTestId('auto-away-page');
    const tabs = useTabsStore.getState();
    expect(tabs.panes).toHaveLength(2);
    expect(tabs.activePaneId).toBe(tabs.panes[1].id);
    expect(tabs.panes.map((pane) => pane.tabs.length)).toEqual([1, 1]);
  });

  it('keeps one row at the foot of Threads that counts what is waiting and snoozed, never the archive, and opens the three groups', async () => {
    await open();
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed2');
    // Outside the part that scrolls, so it is in view however long the list is; no rows behind it in the sidebar.
    expect(screen.getByTestId('auto-list-rows').contains(screen.getByTestId('auto-away-row'))).toBe(false);
    expect(screen.queryByTestId('auto-row-glass')).toBeNull();
    // Nothing of the archive is asked for until the page opens.
    expect(auto.asked('archived')).toEqual([]);
    await openAway();
    await screen.findByTestId('auto-row-gone1');
    expect(headings()).toEqual(['Waiting on a reply', 'Snoozed', 'Archived']);
    expect(screen.getByTestId('auto-away-row').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed2');
  });

  it('leaves out the groups that hold nothing, and says so when nothing is archived', async () => {
    await open({ threads: [BEDS, BREAD], archived: [] });
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed');
    await openAway();
    expect(headings()).toEqual(['Archived']);
    await waitFor(() => expect(screen.getByTestId('auto-archived-empty').textContent).toBe('Nothing is archived.'));
  });

  it('is the last stop of the list’s arrows, and Escape on the page puts the keyboard back on it', async () => {
    await open();
    rowButton('inspect').focus();
    key('ArrowDown');
    expect(focusedRow()).toBe(':away');
    key('ArrowDown');
    expect(focusedRow()).toBe(':away');
    // By a key, the page opens with the keyboard on its first row.
    key('Enter');
    fireEvent.click(document.activeElement as HTMLElement);
    await screen.findByTestId('auto-away-page');
    await waitFor(() => expect(focusedRow()).toBe('glass'));
    await screen.findByTestId('auto-row-gone1');
    key('j');
    expect(focusedRow()).toBe('labels');
    key('ArrowDown');
    expect(focusedRow()).toBe('gone1');
    key('k');
    expect(focusedRow()).toBe('labels');
    key('Escape');
    expect(focusedRow()).toBe(':away');
  });

  it('opens a row to read with the Snoozed row still marked, and goes back to the page where he left it', async () => {
    await open();
    await openAway();
    await screen.findByTestId('auto-row-gone1');
    await openThread('glass');
    expect(screen.getByTestId('auto-away')).toBeInTheDocument();
    expect(screen.getByTestId('auto-away-row').getAttribute('aria-current')).toBe('true');
    // The caret is in the box, as for any thread opened by a click.
    expect(document.activeElement).toBe(box());
    await openAway();
    expect(screen.getByTestId('auto-row-glass')).toBeInTheDocument();
  });
});

describe('archived threads', () => {
  const openArchive = async () => {
    await openAway();
    await screen.findByTestId('auto-row-gone1');
  };

  it('reads the newest few when the line opens, each saying when it was archived, and all of them on Show all', async () => {
    await open();
    await openArchive();
    expect(auto.asked('archived')).toEqual([{ kind: 'archived', limit: 10 }]);
    // Newest archived first.
    expect(rowIds('auto-archived')).toEqual(GONE.slice(0, 10).map((thread) => thread.id));
    expect(within(row('gone1')).getByText('Old thread 1')).toBeInTheDocument();
    expect(within(row('gone1')).getByText('Last of 1')).toBeInTheDocument();
    expect(within(row('gone1')).getByTestId('auto-archived-when').textContent).toBe('Archived yesterday.');
    expect(within(row('gone2')).getByTestId('auto-archived-when').textContent).toBe('Archived Thu.');
    expect(within(row('gone9')).getByTestId('auto-archived-when').textContent).toBe('Archived Nov 5.');
    // Only the way back on an archived row, in words.
    expect(actionsOf('gone1')).toEqual(['Bring back']);
    expect(screen.getByTestId('auto-archived-all').textContent).toBe('Show all 12');
    fireEvent.click(screen.getByTestId('auto-archived-all'));
    await waitFor(() => expect(rowIds('auto-archived')).toHaveLength(12));
    expect(last('archived')).toEqual({ kind: 'archived', limit: null });
    expect(screen.queryByTestId('auto-archived-all')).toBeNull();
    // No thread's history was read for any of it.
    expect(auto.asked('thread')).toEqual([]);
  });

  it('reads the archive again each time the page opens, since another device may have archived something', async () => {
    await open();
    await openArchive();
    fireEvent.click(rowButton('bread'));
    expect(screen.queryByTestId('auto-away-page')).toBeNull();
    auto.state.archived = [autoThread('fresh', { title: 'Fresh one', archived: true, archivedAt: NOW / 1000 - 30 }), ...GONE];
    fireEvent.click(screen.getByTestId('auto-away-row'));
    await screen.findByTestId('auto-row-fresh');
    expect(within(row('fresh')).getByTestId('auto-archived-when').textContent).toBe('Archived just now.');
    expect(auto.asked('archived')).toHaveLength(2);
  });

  it('says so in the service’s own sentence when the archive cannot be read', async () => {
    await open();
    auto.state.fail = { kind: 'refused', message: 'The service failed.', code: 'server_error', status: 500 };
    await openAway();
    await waitFor(() => expect(screen.getByTestId('auto-archived-empty').textContent).toBe('The service failed.'));
    expect(screen.getByTestId('auto-archived-empty').getAttribute('role')).toBe('alert');
  });

  it('opens an archived thread in the pane to read it, with Bring back in its header in place of Archive', async () => {
    await open();
    await openArchive();
    await openThread('gone1');
    expect(screen.getByTestId('auto-title').textContent).toBe('Old thread 1');
    await waitFor(() => expect(screen.getAllByTestId('auto-message')[0].textContent).toBe('About the old thread.'));
    expect(screen.getByTestId('auto-restore-open').getAttribute('aria-label')).toBe('Bring back');
    for (const gone of ['auto-archive-open', 'auto-snooze-open', 'auto-thread-menu', 'auto-done-open']) expect(screen.queryByTestId(gone)).toBeNull();
    // Above the box it says where the thread is, with the same way back.
    expect(screen.getByTestId('auto-away-lead').textContent).toBe('Archived');
    expect(screen.getByTestId('auto-away-detail').textContent).toBe('Yesterday');
    expect(screen.getByTestId('auto-bring-back').textContent).toBe('Bring back');
    expect(screen.getByTestId('auto-away-row').getAttribute('aria-current')).toBe('true');
  });

  it('brings a thread back from its row: it joins the list, the line says so, and Undo archives it again', async () => {
    await open();
    await openArchive();
    const before = document.activeElement;
    await userEvent.setup().click(screen.getByTestId('auto-restore-gone1'));
    // At once, before the service has answered.
    expect(listed()).toContain('gone1');
    expect(rowIds('auto-archived')).not.toContain('gone1');
    expect(said()).toBe('Back in the list.Undo');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'gone1', archived: false }));
    // A click leaves the keyboard where it was.
    expect(document.activeElement).toBe(before);
    // The service's order then says where it sits.
    act(() => auto.list({ kind: 'order', ids: ['beds', 'bread', 'gone1', 'seeds', 'trellis', 'inspect'] }));
    expect(listed()).toEqual(['beds', 'bread', 'gone1', 'seeds', 'trellis', 'inspect']);
    key('z', { metaKey: true });
    expect(listed()).not.toContain('gone1');
    expect(rowIds('auto-archived')[0]).toBe('gone1');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'gone1', archived: true }));
    expect(auto.asked('archive').map((route) => route.archived)).toEqual([false, true]);
  });

  it('brings a thread back with E on its row, from the open thread’s header, and from the strip above the box', async () => {
    await open();
    await openArchive();
    rowButton('gone2').focus();
    expect(rowButton('gone2').getAttribute('aria-keyshortcuts')).toBe('E');
    key('e');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'gone2', archived: false }));
    // The keyboard takes the row in its place on the page; Cmd+Z puts it back on its own row, not in a box.
    await waitFor(() => expect(focusedRow()).toBe('gone3'));
    key('z', { metaKey: true });
    await waitFor(() => expect(focusedRow()).toBe('gone2'));
    await waitFor(() => expect(auto.asked('archive')).toHaveLength(2));
    // No other key of a row does anything to an archived one.
    rowButton('gone3').focus();
    for (const name of ['s', 'd', 'm', '1']) key(name);
    expect(auto.asked('archive')).toHaveLength(2);
    expect(auto.asked('snooze')).toEqual([]);
    expect(screen.queryByTestId('auto-snooze-menu')).toBeNull();

    await openThread('gone1');
    fireEvent.click(screen.getByTestId('auto-restore-open'));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'gone1', archived: false }));
    // Still open, now as a thread of the list: Archive is back in its header, and the strip has gone.
    await waitFor(() => expect(screen.getByTestId('auto-archive-open')).toBeInTheDocument());
    expect(screen.queryByTestId('auto-away')).toBeNull();
    expect(screen.getByTestId('auto-title').textContent).toBe('Old thread 1');

    auto.state.snapshots.gone4 = autoSnapshot(GONE[3]);
    await openAway();
    await screen.findByTestId('auto-row-gone4');
    await openThread('gone4');
    fireEvent.click(screen.getByTestId('auto-bring-back'));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'gone4', archived: false }));
  });

  it('keeps a thread opened from the page under the marked Snoozed row when its bringing back is undone', async () => {
    await open();
    await openArchive();
    await openThread('gone1');
    fireEvent.click(screen.getByTestId('auto-restore-open'));
    await waitFor(() => expect(screen.getByTestId('auto-archive-open')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByTestId('auto-away')).toBeInTheDocument());
    expect(screen.getByTestId('auto-title').textContent).toBe('Old thread 1');
    expect(screen.getByTestId('auto-away-row').getAttribute('aria-current')).toBe('true');
  });

  it('puts it back in the archive with the service’s sentence when the service refuses', async () => {
    await open();
    await openArchive();
    auto.state.failWrites = { kind: 'refused', message: 'Auto is busy.', code: 'busy', status: 503 };
    fireEvent.click(screen.getByTestId('auto-restore-gone1'));
    await waitFor(() => expect(said()).toBe('Auto is busy.Old thread 1'));
    expect(listed()).not.toContain('gone1');
    expect(rowIds('auto-archived')).toContain('gone1');
  });

  it('shows a thread archived here on top of the archive at once, and takes it out again on Undo', async () => {
    await open();
    await openArchive();
    rowButton('bread').focus();
    key('e');
    // On the page, which shows beside the list.
    expect(rowIds('auto-archived')[0]).toBe('bread');
    expect(within(row('bread')).getByTestId('auto-archived-when').textContent).toBe('Archived just now.');
    expect(said()).toBe('Archived: Sourdough timingsUndo');
    key('z', { metaKey: true });
    expect(rowIds('auto-archived')).not.toContain('bread');
    expect(listed()).toContain('bread');
  });

  it('finds archived threads by title in the palette once the archive is read, and brings the open one back by one verb', async () => {
    await open();
    expect(command('auto.thread.gone1')).toBeUndefined();
    await openArchive();
    await waitFor(() => expect(command('auto.thread.gone1')).toMatchObject({ name: 'Old thread 1', hint: 'Archived Auto thread' }));
    expect(command('auto.thread.bread')).toMatchObject({ name: 'Sourdough timings', hint: 'Auto thread' });
    expect(command('auto.bringBackThread')).toBeUndefined();
    act(() => command('auto.thread.gone1')?.perform());
    await waitFor(() => expect(auto.followed.thread?.id).toBe('gone1'));
    await waitFor(() => expect(command('auto.bringBackThread')).toMatchObject({ name: 'Bring back thread' }));
    // Nothing else is offered for a thread that is archived.
    for (const id of ['auto.archiveThread', 'auto.snoozeThread', 'auto.renameThread', 'auto.restoreThread']) expect(command(id)).toBeUndefined();
    act(() => command('auto.bringBackThread')?.perform());
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'gone1', archived: false }));
    await waitFor(() => expect(command('auto.bringBackThread')).toBeUndefined());
    expect(command('auto.archiveThread')).toBeDefined();
  });
});

describe('a thread waiting on a reply', () => {
  it('says on its row who it waits on and until when, then what for, where, and what was last heard', async () => {
    await open();
    await openAway();
    expect(rowIds('auto-waiting')).toEqual(['glass']);
    expect(within(row('glass')).getByTestId('auto-wait-line').textContent).toBe('Waiting on Sam until Tue 5:00 pm');
    expect(within(row('glass')).getByTestId('auto-wait-detail').textContent).toBe('The quote for the glass. In Gmail. Last heard: I will measure the frames on Monday.');
    // The clock for another time, then Bring back in words. Archive is in its right-click menu.
    expect(actionsOf('glass')).toEqual(['Snooze', 'Bring back']);
    // A thread snoozed to a time says when it returns, and is not among them.
    expect(rowIds('auto-snoozed')).toEqual(['labels']);
    expect(within(row('labels')).getByTestId('auto-returns').textContent).toBe('Returns tomorrow 9:00 am');
  });

  it('says so in the open thread, above the box, with the conversation one click away', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    await open();
    await openAway();
    await openThread('glass');
    expect(screen.getByTestId('auto-away-lead').textContent).toBe('Waiting on Sam until Tue 5:00 pm');
    expect(screen.getByTestId('auto-away-detail').textContent).toBe('The quote for the glass. In Gmail. Last heard: I will measure the frames on Monday. Open the conversation');
    // His words for the wait show as his message, as the service writes them.
    expect(screen.getAllByTestId('auto-message').map((message) => message.textContent)).toContain('Wait for a reply: until Sam sends the quote');
    fireEvent.click(screen.getByTestId('auto-away-link'));
    expect(opened).toHaveBeenCalledWith('https://mail.example/t/18c2', '_blank');
    // Bring back ends the wait.
    fireEvent.click(screen.getByTestId('auto-bring-back'));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'glass', until: null }));
    expect(listed()).toContain('glass');
    expect(screen.queryByTestId('auto-away')).toBeNull();
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed1');
    // It can be put on the same wait again, in the words he gave for it.
    expect(said()).toBe('Back in the list.Undo');
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'glass', until: at(11, 17, 17), wait: { say: 'until Sam sends the quote' } }));
    expect(listed()).not.toContain('glass');
  });

  it('offers the conversation only for a web address', async () => {
    for (const link of ['whatsapp:120363', 'imessage:+15550100', 'file:///etc/hosts', 'javascript:alert(1)', '']) {
      const view = await open({ threads: [BREAD, { ...GLASS, wait: wait({ link, heard: '' }) }] });
      await openAway();
      await openThread('glass');
      expect(screen.getByTestId('auto-away-detail').textContent).toBe('The quote for the glass. In Gmail.');
      expect(screen.queryByTestId('auto-away-link')).toBeNull();
      expect(screen.getByTestId('auto-away').querySelector('a')).toBeNull();
      view.unmount();
      useThreadStore.setState({ ...useThreadStore.getInitialState(), box: { outbox: [], drafts: {} } }, true);
      useAutoStore.setState(useAutoStore.getInitialState(), true);
      forgetViews();
    }
  });

  it('names the place in the service’s own word, a text in Messages and a place it has never heard of alike', async () => {
    const text = { ...GLASS, wait: wait({ where: 'Messages', link: 'imessage:+15550100', heard: '' }) };
    const pigeon = { ...BREAD, snoozed: at(11, 18, 17), snoozedAt: at(11, 14, 10), wait: wait({ on: 'Robin', what: 'the seed list', where: 'Pigeon post', link: '', heard: '' }) };
    await open({ threads: [SEEDS, text, pigeon] });
    await openAway();
    expect(within(row('glass')).getByTestId('auto-wait-detail').textContent).toBe('The quote for the glass. In Messages.');
    expect(within(row('bread')).getByTestId('auto-wait-detail').textContent).toBe('The seed list. In Pigeon post.');
    // A text's number is not a web address: nothing offers to open it.
    await openThread('glass');
    expect(screen.getByTestId('auto-away-detail').textContent).toBe('The quote for the glass. In Messages.');
    expect(screen.getByTestId('auto-away').querySelector('a')).toBeNull();
    expect(screen.getByTestId('auto-thread').textContent).not.toContain('+15550100');
  });

  it('says Finding the conversation, and when it gives up, while Auto is still naming it', async () => {
    // Auto's own line about the wait is a reply nobody has read: a row that is put away still carries no dot.
    await open({ threads: [{ ...BREAD, unread: true }, { ...GLASS, unread: true, wait: wait({ state: 'finding', on: '', what: '', where: '', link: '', check: '', heard: '' }) }] });
    await openAway();
    expect(within(row('glass')).getByTestId('auto-wait-line').textContent).toBe('Finding the conversation');
    expect(within(row('glass')).getByTestId('auto-wait-detail').textContent).toBe('Gives up Tue 5:00 pm.');
    expect(within(row('bread')).getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    expect(within(row('glass')).queryByRole('img')).toBeNull();
    expect(within(row('glass')).getByText('Greenhouse glass').className).not.toContain('font-semibold');
  });

  it('is put away from the snooze menu: who he waits on, when it gives up, and one post with his words', async () => {
    await open();
    const dialog = await untilAReply('bread');
    expect(dialog.getByTestId('auto-snooze-name').textContent).toBe('Sourdough timings');
    expect(dialog.getByText('It comes back when they reply.')).toBeInTheDocument();
    const say = dialog.getByTestId('auto-wait-say') as HTMLInputElement;
    expect(say.placeholder).toBe('Say who you are waiting on');
    // The caret is in the field, and stays there when the menu it came from gives the keyboard back.
    await waitFor(() => expect(document.activeElement).toBe(say));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.activeElement).toBe(say);
    // The phone's times, each with the day it means, and two working days on unless he says otherwise.
    const gives = dialog.getByTestId('auto-wait-gives') as HTMLSelectElement;
    expect([...gives.options].map((option) => option.textContent)).toEqual(['Next working day, Mon 5:00 pm', 'Two working days, Tue 5:00 pm', 'A week, Nov 21 5:00 pm', 'Pick a time…']);
    expect(gives.value).toBe(String(at(11, 17, 17)));
    // Nothing to wait for without his words.
    expect(dialog.getByRole('button', { name: 'Wait' })).toBeDisabled();
    fireEvent.submit(say.closest('form') as HTMLFormElement);
    expect(auto.asked('snooze')).toEqual([]);

    fireEvent.change(say, { target: { value: '  Robin, about the seed swap  ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Wait' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: at(11, 17, 17), wait: { say: 'Robin, about the seed swap' } }));
    expect(auto.asked('snooze')).toHaveLength(1);
    expect(screen.queryByTestId('auto-snooze-reply')).toBeNull();
    // It leaves the list for the Waiting line, and the line at the foot says so in the phone's words.
    expect(listed()).not.toContain('bread');
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed3');
    expect(said()).toBe('Waiting on a reply until Tue 5:00 pm.Undo');
    await openAway();
    expect(rowIds('auto-waiting')).toEqual(['bread', 'glass']);
    expect(within(row('bread')).getByTestId('auto-wait-line').textContent).toBe('Finding the conversation');

    // Auto names the conversation: the row and the line then say who he waits on, with the same way back.
    const named: AutoThread = { ...BREAD, snoozed: at(11, 17, 17), snoozedAt: NOW / 1000, wait: wait({ say: 'Robin, about the seed swap', on: 'Robin', what: 'an answer about the seed swap', where: 'Slack', heard: '' }) };
    act(() => auto.list({ kind: 'thread', thread: named }));
    expect(within(row('bread')).getByTestId('auto-wait-line').textContent).toBe('Waiting on Robin until Tue 5:00 pm');
    expect(within(row('bread')).getByTestId('auto-wait-detail').textContent).toBe('An answer about the seed swap. In Slack.');
    expect(said()).toBe('Waiting on Robin until Tue 5:00 pm.Undo');
    expect(useSaidStore.getState().stack).toHaveLength(1);
    // Undo brings it back, to where it sat.
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: null }));
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'bread', before: 'seeds' }));
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
  });

  it('takes a day and a time of his own for when the wait gives up, and refuses one that has passed', async () => {
    await open();
    const dialog = await untilAReply('bread');
    fireEvent.change(dialog.getByTestId('auto-wait-say'), { target: { value: 'Robin' } });
    fireEvent.change(dialog.getByTestId('auto-wait-gives'), { target: { value: 'own' } });
    fireEvent.change(dialog.getByLabelText('Gives up on'), { target: { value: '2026-11-14' } });
    fireEvent.change(dialog.getByLabelText('Gives up at'), { target: { value: '15:00' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Wait' }));
    expect(dialog.getByRole('alert').textContent).toBe('Choose a time from now on, within a year.');
    expect(auto.asked('snooze')).toEqual([]);
    fireEvent.change(dialog.getByLabelText('Gives up on'), { target: { value: '2026-11-19' } });
    fireEvent.change(dialog.getByLabelText('Gives up at'), { target: { value: '12:30' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Wait' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: at(11, 19, 12, 30), wait: { say: 'Robin' } }));
    expect(said()).toBe('Waiting on a reply until Thu 12:30 pm.Undo');
  });

  it('is offered in the row’s right-click menu and in the open thread’s clock as well', async () => {
    await open();
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: rowButton('seeds') });
    fireEvent.click(within(await screen.findByTestId('auto-row-menu-seeds')).getByRole('menuitem', { name: 'Until a reply…' }));
    expect(within(await screen.findByTestId('auto-snooze-reply')).getByTestId('auto-snooze-name').textContent).toBe('Seed order');
    fireEvent.click(within(screen.getByTestId('auto-snooze-reply')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('auto-snooze-reply')).toBeNull());
    await openThread('bread');
    await userEvent.setup().click(screen.getByTestId('auto-snooze-open'));
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: 'Until a reply…' }));
    const dialog = within(await screen.findByTestId('auto-snooze-reply'));
    fireEvent.change(dialog.getByTestId('auto-wait-say'), { target: { value: 'Sam' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Wait' }));
    await waitFor(() => expect(last('snooze')).toMatchObject({ id: 'bread', wait: { say: 'Sam' } }));
  });

  it('comes back saying who replied and what they said, or that nobody did, until he opens it', async () => {
    await open();
    const met: AutoThread = { ...GLASS, snoozed: null, snoozedAt: null, woke: NOW / 1000, last: 'Sam: 4 mm toughened, 86 for the lot.', updated: NOW / 1000, wait: wait({ state: 'met', reply: 'Sam: 4 mm toughened, 86 for the lot.' }) };
    act(() => auto.list({ kind: 'thread', thread: met }));
    // With what is new, under the question, and no longer behind its line.
    expect(listed()).toEqual(['beds', 'glass', 'bread', 'seeds', 'trellis', 'inspect']);
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Snoozed1');
    expect(within(row('glass')).getByTestId('auto-wait-back').textContent).toBe('Sam replied: 4 mm toughened, 86 for the lot.');
    act(() => auto.list({ kind: 'thread', thread: { ...met, last: 'No reply from Sam.', wait: wait({ state: 'expired' }) } }));
    expect(within(row('glass')).getByTestId('auto-wait-back').textContent).toBe('No reply from Sam.');
    // Opened, the service clears `woke`, and the row is one line again: the first words of a reply stay out of the sidebar.
    act(() => auto.list({ kind: 'thread', thread: { ...met, woke: null } }));
    expect(within(row('glass')).queryByTestId('auto-wait-back')).toBeNull();
    expect(within(row('glass')).queryByText('Sam: 4 mm toughened, 86 for the lot.')).toBeNull();
  });

  it('shows the service’s note in the thread where the wait ended', async () => {
    const back: AutoThread = { ...GLASS, snoozed: null, snoozedAt: null, woke: NOW / 1000, wait: wait({ state: 'met', reply: 'Sam: 86 for the lot.' }) };
    await open({
      threads: [BREAD, back],
      snapshots: { glass: autoSnapshot(back, { items: [user('Wait for a reply: until Sam sends the quote'), reply('Waiting on Sam in Gmail.'), { role: 'note', text: 'Sam replied' }, reply('Sam replied: 86 for the lot.')] }) },
    });
    await openThread('glass');
    await waitFor(() => expect(screen.getByTestId('auto-talk').textContent).toContain('Sam replied'));
    const note = within(screen.getByTestId('auto-talk')).getByText('Sam replied');
    expect(note.className).toContain('text-foreground-tertiary');
    // Back in the list, it is a thread like any other: nothing above the box.
    expect(screen.queryByTestId('auto-away')).toBeNull();
  });
});

describe('the sign at the end of a row', () => {
  it('shows no time: a turning ring while it works, a yellow dot when it waits on him, else nothing', async () => {
    await open({
      threads: [
        autoThread('a', { title: 'Just began', status: 'working', updated: NOW / 1000 - 20 }),
        autoThread('c', { title: 'Long', status: 'queued', updated: NOW / 1000 - 65 * 60 }),
        autoThread('ask', { title: 'Ask', status: 'waiting', ask: { id: 'q', kind: 'ask', text: 'Which bed?', options: ['One'], question: 'Which bed?' } }),
        autoThread('mine', { title: 'Mine', last: 'Drafted.', yours: 'Read it' }),
        { ...BREAD },
      ],
    });
    for (const id of ['a', 'c', 'ask', 'mine', 'bread']) expect(rowButton(id).querySelector('.tabular-nums')).toBeNull();
    expect(rowButton('a').querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(rowButton('c').querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(rowButton('ask').querySelector('[aria-label="Waits on you"]')).not.toBeNull();
    expect(rowButton('mine').querySelector('[aria-label="Waits on you"]')).not.toBeNull();
    expect(rowButton('bread').querySelector('[role="img"]')).toBeNull();
    // The ring sits at the end of the line, after the title, where the time was.
    const line = rowButton('a').querySelector('.auto-row-line') as HTMLElement;
    expect(line.lastElementChild?.querySelector('[aria-label="Working"]')).not.toBeNull();
  });
});

describe('what Undo leaves behind', () => {
  it('opens the digest entry again when a Done is undone, if it was open before', async () => {
    await open();
    rowButton('inspect').focus();
    key('d');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
    expect(said()).toBe('Done: Book the inspectionUndo');
    key('z', { metaKey: true });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: false }));
    await waitFor(() => expect(last('digest-resolve')).toEqual({ kind: 'digest-resolve', date: DAY, ids: ['item-2'], resolved: false }));
    expect(listed()).toContain('inspect');
  });

  it('leaves an entry that was resolved before the Done resolved', async () => {
    const resolved = autoDigest(DAY, [['Top 3', [digestEntry('item-2', { kind: 'item', title: 'Book the inspection', state: 'resolved', thread: 'inspect' })]]]);
    await open({ digests: { [DAY]: resolved } });
    rowButton('inspect').focus();
    key('d');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
    key('z', { metaKey: true });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auto.asked('digest-resolve')).toEqual([]);
  });

  it('asks nothing of the digest when a plain archive is undone', async () => {
    await open();
    rowButton('inspect').focus();
    key('e');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true }));
    key('z', { metaKey: true });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auto.asked('digest-resolve')).toEqual([]);
  });

  it('puts a snoozed thread back where it sat: the undo posts a move before the thread it sat above', async () => {
    await open();
    rowButton('bread').focus();
    key('s');
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('bread'));
    key('z', { metaKey: true });
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'bread', until: null }));
    // The service brings a thread back on top of his order, and says so. The row is held where it sat until the move has landed.
    act(() => auto.list({ kind: 'order', ids: ['bread', 'beds', 'seeds', 'trellis', 'inspect'] }));
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'bread', before: 'seeds' }));
    await waitFor(() => expect(focusedRow()).toBe('bread'));
  });

  it('names the thread it sat above, when one is still in the list', async () => {
    await open();
    rowButton('trellis').focus();
    key('s');
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('trellis'));
    key('z', { metaKey: true });
    // "inspect" sat under it.
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'trellis', before: 'inspect' }));
  });

  it('moves the last thread of his order to the end again', async () => {
    await open({ threads: [BEDS, BREAD, SEEDS] });
    rowButton('seeds').focus();
    key('s');
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('seeds'));
    key('z', { metaKey: true });
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'seeds', before: null }));
  });

  it('keeps its place among the threads that are put away too, which are part of his order', async () => {
    await open();
    rowButton('inspect').focus();
    key('s');
    fireEvent.click(within(await screen.findByTestId('auto-snooze-menu')).getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('inspect'));
    key('z', { metaKey: true });
    // The snoozed thread under it is still in his order at the service.
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'inspect', before: 'labels' }));
  });

  it('keeps a thread he has just brought back where it is when the service’s order does not name it yet', async () => {
    await open();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    rowButton('bread').focus();
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    key('e');
    await waitFor(() => expect(focusedRow()).toBe('trellis'));
    key('z', { metaKey: true });
    key('z', { metaKey: true });
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    // The service has brought one of the two back and says its order, in which the other is still archived.
    act(() => auto.list({ kind: 'order', ids: ['beds', 'bread', 'trellis', 'inspect', 'labels', 'glass'] }));
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    // The other way round: the one above is the one still to come.
    act(() => auto.list({ kind: 'order', ids: ['beds', 'seeds', 'trellis', 'inspect', 'labels', 'glass'] }));
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    // Neither named: both stay, in their order.
    act(() => auto.list({ kind: 'order', ids: ['beds', 'trellis', 'inspect', 'labels', 'glass'] }));
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    release();
    await waitFor(() => expect(auto.asked('archive').filter((route) => route.archived === false)).toHaveLength(2));
    // A thread the order has never heard of, which is not one he brought back, still goes on top.
    act(() => auto.list({ kind: 'thread', thread: autoThread('fresh', { title: 'Made on the phone' }) }));
    act(() => auto.list({ kind: 'order', ids: ['beds', 'bread', 'seeds', 'trellis', 'inspect', 'labels', 'glass'] }));
    expect(listed()).toEqual(['beds', 'fresh', 'bread', 'seeds', 'trellis', 'inspect']);
  });

  it('keeps the thread open and in the list when the snapshot an undo asked for still says it is archived', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(screen.getByTestId('auto-archive-open'));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    await waitFor(() => expect(screen.getByTestId('auto-title').textContent).not.toBe('Sourdough timings'));
    // The undo opens the thread again and reads it while its own post is on the way. The service still had it
    // archived when that read reached it, and the answer arrives after the unarchive has landed.
    let release: () => void = () => undefined;
    auto.state.threadGate = new Promise<void>((resolve) => { release = resolve; });
    auto.state.snapshots.bread = autoSnapshot({ ...BREAD, archived: true, archivedAt: NOW / 1000 }, { items: [user('When do I start the bread?'), reply('Start the starter at 8.')] });
    fireEvent.keyDown(box(), { key: 'z', metaKey: true });
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listed()).toContain('bread');
    release();
    auto.state.threadGate = null;
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The late copy neither takes the row away nor closes the pane.
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    expect(screen.getByTestId('auto-title').textContent).toBe('Sourdough timings');
    expect(row('bread').className).toContain('bg-sidebar-selected');
    expect(screen.queryByTestId('auto-away')).toBeNull();
  });

  it('sets the Mac mark again when the archive of a marked thread is undone, with the keyboard on its row', async () => {
    const marked = { ...SEEDS, desk: { at: at(11, 14, 9), by: 'phone' } };
    await open({ threads: [BEDS, BREAD, marked, TRELLIS] });
    expect(within(screen.getByTestId('auto-group-desk')).getByTestId('auto-row-seeds')).toBeInTheDocument();
    rowButton('seeds').focus();
    key('e');
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'seeds', archived: true }));
    key('z', { metaKey: true });
    // Back in its group at once, mark and all.
    expect(within(screen.getByTestId('auto-group-desk')).getByTestId('auto-row-seeds')).toBeInTheDocument();
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'seeds', archived: false }));
    await waitFor(() => expect(last('desk')).toEqual({ kind: 'desk', id: 'seeds', on: true }));
    await waitFor(() => expect(focusedRow()).toBe('seeds'));
    expect(within(screen.getByTestId('auto-group-desk')).getByTestId('auto-row-seeds')).toBeInTheDocument();
    // A thread that was not marked gets no mark.
    rowButton('bread').focus();
    key('e');
    key('z', { metaKey: true });
    await waitFor(() => expect(auto.asked('archive')).toHaveLength(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auto.asked('desk')).toHaveLength(1);
  });
});

describe('words begun before a card arrived', () => {
  const turn = () => act(() => auto.thread({ kind: 'turn', items: [user('Plan it', 'a1')], state: 'working', activity: '' }));

  it('stay a message when a question arrives: Enter sends them, queued behind the turn, and answers nothing', async () => {
    await open();
    await openThread('bread');
    turn();
    await type('Also add the oven temperature to the', false);
    act(() => auto.thread({ kind: 'question', question: ASK }));
    // The box still says what it will do with his words.
    expect(box().placeholder).toBe('Message Auto');
    expect(box().getAttribute('aria-label')).toBe('Message');
    await type('Also add the oven temperature to the note');
    await waitFor(() => expect(last('message')).toMatchObject({ kind: 'message', id: 'bread', text: 'Also add the oven temperature to the note' }));
    expect(auto.asked('answer')).toEqual([]);
    // The box has been emptied once: from here words in it are the answer.
    await waitFor(() => expect(box().value).toBe(''));
    expect(box().placeholder).toBe('Your answer');
    await type('Bed 5, by the fence');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q1', answers: { 'Which bed?': 'Bed 5, by the fence' } }));
    expect(auto.asked('message')).toHaveLength(1);
  });

  it('are not sent as the reason for a no when a permission card arrives', async () => {
    await open();
    await openThread('bread');
    turn();
    await type('And tell me the flour weight', false);
    act(() => auto.thread({ kind: 'question', question: PERMISSION }));
    expect(box().placeholder).toBe('Message Auto');
    await type('And tell me the flour weight');
    await waitFor(() => expect(last('message')).toMatchObject({ text: 'And tell me the flour weight' }));
    expect(auto.asked('answer')).toEqual([]);
    await waitFor(() => expect(box().placeholder).toBe('Say no, with a reason'));
  });

  it('become the answer’s once he has emptied the box himself', async () => {
    await open();
    await openThread('bread');
    turn();
    await type('Half a thought', false);
    act(() => auto.thread({ kind: 'question', question: ASK }));
    expect(box().placeholder).toBe('Message Auto');
    await type('', false);
    expect(box().placeholder).toBe('Your answer');
    await type('Bed 4');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q1', answers: { 'Which bed?': 'Bed 4' } }));
    expect(auto.asked('message')).toEqual([]);
  });

  it('are the answer when they are typed into an empty box while the card waits, as before', async () => {
    await open();
    await openThread('bread');
    turn();
    act(() => auto.thread({ kind: 'question', question: ASK }));
    expect(box().placeholder).toBe('Your answer');
    await type('Bed 6');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q1', answers: { 'Which bed?': 'Bed 6' } }));
    expect(auto.asked('message')).toEqual([]);
  });

  it('are counted again for the next card: a new question finds what is in the box then', async () => {
    await open();
    await openThread('bread');
    turn();
    act(() => auto.thread({ kind: 'question', question: ASK }));
    await type('An answer I have not sent', false);
    // The same question again changes nothing: these words were typed while it waited.
    act(() => auto.thread({ kind: 'question', question: ASK }));
    expect(box().placeholder).toBe('Your answer');
    // Another question arrives over them: they were begun before it.
    act(() => auto.thread({ kind: 'question', question: { ...ASK, id: 'q9' } }));
    expect(box().placeholder).toBe('Message Auto');
  });
});

describe('words typed after every part of a question is picked', () => {
  it('posts the picks, then sends the words as an ordinary message', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Two things', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: PARTS }));
    const card = within(screen.getByTestId('auto-question'));
    fireEvent.click(card.getByRole('button', { name: 'Bed 2' }));
    fireEvent.click(card.getByRole('button', { name: 'Dill' }));
    await type('And leave room for the path');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q2', answers: { 'Which bed gets the squash?': 'Bed 2', 'Which go beside it?': ['Dill'] } }));
    await waitFor(() => expect(last('message')).toMatchObject({ kind: 'message', id: 'bread', text: 'And leave room for the path' }));
    // In that order, each once.
    const order = auto.routes().filter((route) => route.kind === 'answer' || route.kind === 'message').map((route) => route.kind);
    expect(order).toEqual(['answer', 'message']);
    expect(box().value).toBe('');
  });

  it('keeps the words in the box, and sends nothing, when the picks are refused', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Two things', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: PARTS }));
    const card = within(screen.getByTestId('auto-question'));
    fireEvent.click(card.getByRole('button', { name: 'Bed 2' }));
    fireEvent.click(card.getByRole('button', { name: 'Dill' }));
    auto.state.failWrites = { kind: 'refused', message: 'That question has closed.', code: 'gone', status: 409 };
    await type('And leave room for the path');
    await waitFor(() => expect(auto.asked('answer')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(auto.asked('message')).toEqual([]);
    expect(box().value).toBe('And leave room for the path');
  });

  it('still answers the part he has not picked for with his words', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Two things', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: PARTS }));
    fireEvent.click(within(screen.getByTestId('auto-question')).getByRole('button', { name: 'Bed 1' }));
    await type('Whatever fits');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q2', answers: { 'Which bed gets the squash?': 'Bed 1', 'Which go beside it?': 'Whatever fits' } }));
    expect(auto.asked('message')).toEqual([]);
  });
});

describe('where the keyboard goes', () => {
  it('goes to the box after Hand to Auto', async () => {
    await open();
    await openThread('inspect');
    const hand = screen.getByTestId('auto-hand-over');
    hand.focus();
    fireEvent.click(hand);
    await waitFor(() => expect(last('start')).toEqual({ kind: 'start', id: 'inspect' }));
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it('shows the numbers beside a question’s options only while the card has the keyboard, and a digit in the box is typed', async () => {
    await open();
    // A row has no options, so no numbers.
    expect(within(row('beds')).queryByTestId('auto-row-key')).toBeNull();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Plan it', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: ASK }));
    const cardKeys = within(screen.getByTestId('auto-question')).getAllByTestId('auto-option-key');
    expect(cardKeys.map((each) => each.textContent)).toEqual(['1', '2']);
    for (const each of cardKeys) {
      expect(each.className).toContain('invisible');
      expect(each.className).toContain('group-focus-within/card:visible');
    }
    // From the box a digit is a digit.
    box().focus();
    await userEvent.setup().type(box(), '1');
    expect(box().value).toBe('1');
    expect(auto.asked('answer')).toEqual([]);
  });

  it('stays with a row that is drawn again in another group, and does not follow one that left the list', async () => {
    await open();
    act(() => rowButton('bread').focus());
    expect(focusedRow()).toBe('bread');
    // A reply nobody has read lifts the thread under the questions: its row is a new element in another group.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, unread: true, last: 'A new reply.' } }));
    expect(listed()).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    expect(screen.getByTestId('auto-group-fresh').querySelector('[data-thread-id="bread"]')).not.toBeNull();
    expect(focusedRow()).toBe('bread');
    // Marked for the Mac on another device: it moves again, and the keyboard with it.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, unread: true, desk: { at: at(11, 14, 15), by: 'phone' } } }));
    expect(screen.getByTestId('auto-group-desk').querySelector('[data-thread-id="bread"]')).not.toBeNull();
    expect(focusedRow()).toBe('bread');
    // Archived somewhere else, the row is gone and the keyboard is not sent after it.
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, archived: true } }));
    expect(listed()).not.toContain('bread');
    expect(document.activeElement).toBe(document.body);
    // A row he put the keyboard down from is left alone when it moves.
    act(() => rowButton('seeds').focus());
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, unread: true } }));
    expect(document.activeElement).toBe(document.body);
  });

  it('lands on the open thread’s row when Tab comes back into the list', async () => {
    await open();
    await openThread('seeds');
    // The keyboard walks the list and then leaves it for the box.
    act(() => rowButton('trellis').focus());
    expect(rowButton('trellis').tabIndex).toBe(0);
    expect(rowButton('seeds').tabIndex).toBe(-1);
    fireEvent.blur(rowButton('trellis'), { relatedTarget: box() });
    act(() => box().focus());
    await waitFor(() => expect(rowButton('seeds').tabIndex).toBe(0));
    expect(rowButton('trellis').tabIndex).toBe(-1);
    expect([...screen.getByTestId('auto-list').querySelectorAll<HTMLElement>('[data-auto-row]')].filter((element) => element.tabIndex === 0)).toHaveLength(1);
  });

  it('reads the clock when the open thread’s snooze menu opens, not when the thread was opened', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 11, 10, 0).getTime());
    await open();
    await openThread('bread');
    // The day has moved on while the thread stayed open.
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 11, 18, 30).getTime());
    await userEvent.setup().click(screen.getByTestId('auto-snooze-open'));
    const items = within(await screen.findByTestId('auto-snooze-menu')).getAllByRole('menuitem').map((item) => item.textContent);
    expect(items[0]).toBe('Later today9:30 pm');
    expect(items.some((item) => item?.startsWith('Tonight'))).toBe(false);
    expect(items.some((item) => item?.includes('1:00 pm'))).toBe(false);
  });

  it('has Rename thread in the palette, and Stop only while a turn runs', async () => {
    await open();
    await openThread('bread');
    await waitFor(() => expect(command('auto.renameThread')).toMatchObject({ name: 'Rename thread' }));
    expect(command('auto.stopThread')).toBeUndefined();
    act(() => auto.thread({ kind: 'turn', items: [user('Plan it', 'a1')], state: 'working', activity: '' }));
    await waitFor(() => expect(command('auto.stopThread')).toMatchObject({ name: 'Stop' }));
    act(() => {
      void command('auto.stopThread')?.perform();
    });
    await waitFor(() => expect(last('stop')).toEqual({ kind: 'stop', id: 'bread' }));
    act(() => auto.thread({ kind: 'end', outcome: 'stopped', error: null, next: [] }));
    await waitFor(() => expect(command('auto.stopThread')).toBeUndefined());
    // Rename opens the title as a field, with the keyboard in it.
    vi.useFakeTimers();
    act(() => {
      void command('auto.renameThread')?.perform();
      vi.runAllTimers();
    });
    vi.useRealTimers();
    const field = await screen.findByRole('textbox', { name: 'Thread title' });
    expect(document.activeElement).toBe(field);
  });

  it('brings a snoozed thread back from the palette by the same verb', async () => {
    await open();
    await openAway();
    expect(command('auto.goToAway')).toMatchObject({ name: 'Go to Snoozed' });
    auto.state.snapshots.labels = autoSnapshot(LABELS);
    await openThread('labels');
    await waitFor(() => expect(command('auto.bringBackThread')).toMatchObject({ name: 'Bring back thread' }));
    expect(screen.getByTestId('auto-away-lead').textContent).toBe('Returns tomorrow 9:00 am');
    expect(screen.getByTestId('auto-away-detail').textContent).toBe('Snoozed at 2:10 pm.');
    act(() => command('auto.bringBackThread')?.perform());
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until: null }));
    await waitFor(() => expect(command('auto.bringBackThread')).toBeUndefined());
  });
});
