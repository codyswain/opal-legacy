import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoAnswer, AutoItem, AutoQuestion, AutoRoute } from '@/types/auto';
import { AutoView, useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { LIST_PLACE, forgetPlaces, keepPlace, placeOf } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { browseAuto, focusFile, isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { ShellProvider, WorkspaceSidebar } from '@/renderer/features/shell';
import { ThemeProvider } from '@/renderer/features/theme';
import { TooltipProvider } from '@/renderer/shared/ui';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { AUTO_STATUS, autoSnapshot, autoThread, installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';
import { installCollectionsApi } from '@/tests/helpers/collectionsApi';
import { entry, installDiskApi } from '@/tests/helpers/diskApi';
import { openTabs, resetTabs, tabPaths } from '@/tests/helpers/tabs';

const ROOT = '/Vault';
const user = (text: string, cid: string | null = null): AutoItem => ({ role: 'user', text, cid });
const reply = (text: string, open = false): AutoItem => ({ role: 'assistant', text, open });

const BEDS = autoThread('beds', {
  title: 'Raised bed plan', status: 'waiting',
  ask: { id: 'q0', kind: 'ask', text: 'Which wood for the frames?', options: ['Cedar', 'Larch'], question: 'Which wood for the frames?' },
});
const BREAD = autoThread('bread', { title: 'Sourdough timings', last: 'Start the starter at 8.' });
const SEEDS = autoThread('seeds', { title: 'Seed order', last: 'Twelve packets.', unread: true });
const TRELLIS = autoThread('trellis', { title: 'Tomato trellis', last: 'String every 20 cm.', woke: 1_794_000_500 });
const INSPECTION = autoThread('inspect', { title: 'Book the inspection', last: 'The committee walks the plots.', waits: true, digest: { date: '2026-11-13', id: 'item-2' } });
const LABELS = autoThread('labels', { title: 'Pantry labels', last: 'A4, 21 to a page.', snoozed: 4_000_000_000 });
const ENTRY = 'Digest, Friday November 13, item 2: Book the inspection\n\nThe committee walks the plots on the 21st.\n\nFrom Library/digests/2026-11-13 digest.md';

const ASK: AutoQuestion = {
  id: 'q1', kind: 'ask',
  questions: [{ question: 'Which bed gets the tomatoes? Bed 1 should rest.', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 3', description: 'Nearer the tap' }, { label: 'Bed 4', description: '' }] }],
};
// As the service words it: the title names the channel and the people, the detail is what it is about and how it would go.
const GRANT: Extract<AutoQuestion, { kind: 'grant' }> = {
  id: 'g1', kind: 'grant', title: 'Send this Slack message to Robin?', detail: 'the seed swap\n\nThese exact words, once, from this thread.',
  text: 'I will bring the bean seedlings on Saturday.',
};
const PERMISSION: AutoQuestion = { id: 'p1', kind: 'permission', tool: 'Bash', title: 'Run a command: move three drafts', detail: 'mv Notes/drafts/*.md Archive/', reason: 'They are old.' };

let auto: FakeAuto;

function Sync(): null {
  useAutoSync();
  return null;
}

function renderAuto() {
  return render(
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
}

function install(options: Parameters<typeof installAutoApi>[0] = {}) {
  auto = installAutoApi({
    threads: [BEDS, BREAD, SEEDS, TRELLIS, INSPECTION, LABELS],
    snapshots: {
      bread: autoSnapshot(BREAD, {
        items: [
          user('When do I start the bread?'),
          { role: 'steps', steps: [{ g: 'read', text: 'Recipes/Bread.md', path: 'Recipes/Bread.md' }, { g: 'quiet', text: 'Looked up a tool', path: null }] },
          reply('Start the starter at **8**. See [Bread](Recipes/Bread.md).'),
        ],
        next: ['Scale it to two loaves', 'Send the times to the club'],
        cursor: 'b.7',
      }),
      inspect: autoSnapshot(INSPECTION, { seed: ENTRY }),
      beds: autoSnapshot(BEDS, { items: [user('Plan the beds')], live: { items: [], activity: 'Waiting for you', state: 'waiting', question: null } }),
    },
    ...options,
  });
  return auto;
}

/** Renders the tab on a service that answers, and waits for the list. */
async function open(options: Parameters<typeof installAutoApi>[0] = {}) {
  install(options);
  const view = renderAuto();
  await screen.findByTestId('auto-list');
  return view;
}

const row = (id: string) => screen.getByTestId(`auto-row-${id}`);
const box = () => screen.getByTestId('auto-box') as HTMLTextAreaElement;
const kinds = () => auto.routes().map((route) => route.kind);
const last = <K extends AutoRoute['kind']>(kind: K) => auto.asked(kind).at(-1);

async function openThread(id: string) {
  fireEvent.click(within(row(id)).getAllByRole('button')[0]);
  await waitFor(() => expect(auto.followed.thread?.id).toBe(id));
}

async function type(text: string, key = '{Enter}') {
  fireEvent.change(box(), { target: { value: text } });
  await userEvent.setup().type(box(), key);
}

beforeEach(() => {
  window.localStorage.clear();
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
  useDiskStore.setState({ roots: [ROOT], rootsLoaded: true, listings: { [ROOT]: [entry({ path: '/Vault/Recipes', name: 'Recipes', kind: 'directory', isDirectory: true })] } });
  openTabs([browseAuto().location]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the address', () => {
  it('asks for it once, says why one is refused, and reads the list with a good one', async () => {
    install({ url: null });
    renderAuto();
    const address = await screen.findByRole('textbox', { name: 'Address' });
    expect(screen.queryByTestId('auto-list')).toBeNull();
    fireEvent.change(address, { target: { value: 'http://host.example/agent' } });
    fireEvent.submit(screen.getByTestId('auto-address-form'));
    expect((await screen.findByRole('alert')).textContent).toContain('The address must start with https://');
    expect(kinds()).toEqual([]);

    fireEvent.change(address, { target: { value: 'https://host.example/agent' } });
    fireEvent.submit(screen.getByTestId('auto-address-form'));
    await screen.findByTestId('auto-list');
    expect(auto.api.setAddress).toHaveBeenLastCalledWith('https://host.example/agent');
    expect(auto.followed.list).toEqual({ token: expect.any(Number), cursor: 'b.0' });
  });

  it('can be changed from the list, and Cancel keeps the old one', async () => {
    await open();
    await userEvent.setup().click(screen.getByTestId('auto-settings'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change address…' }));
    expect((screen.getByRole('textbox', { name: 'Address' }) as HTMLInputElement).value).toBe('https://host.example/agent');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByTestId('auto-list');
    expect(auto.api.setAddress).not.toHaveBeenCalled();
  });
});

describe('the states of the tab', () => {
  it("says it can't reach Auto, with Retry, when the list cannot be read", async () => {
    install({ fail: { kind: 'unreachable', message: "Can't reach Auto." } });
    renderAuto();
    const state = await screen.findByTestId('auto-unreachable');
    expect(state.textContent).toContain("Can't reach Auto.");
    expect(state.textContent).toContain('https://host.example/agent');
    auto.state.fail = null;
    fireEvent.click(within(state).getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('auto-list');
  });

  it("shows the service's own sentence when it refuses", async () => {
    install({ fail: { kind: 'refused', message: 'This is not your service.', code: 'not_owner', status: 403 } });
    renderAuto();
    expect((await screen.findByTestId('auto-unreachable')).textContent).toContain('This is not your service.');
  });

  it("shows the service's own sign-in line while it is signed out", async () => {
    await open({ status: { ...AUTO_STATUS, auth: { loggedIn: false, token: 'none', error: null } } });
    const notice = screen.getByTestId('auto-signed-out');
    expect(notice.textContent).toContain('Auto is signed out.');
    expect(within(notice).getByText('auto-login --on desk-mac')).toBeInTheDocument();
    expect(screen.getByTestId('auto-list')).toBeInTheDocument();
    act(() => auto.list({ kind: 'status', status: AUTO_STATUS }));
    expect(screen.queryByTestId('auto-signed-out')).toBeNull();
  });

  it('says so above the list when the service drops away, and carries on when it is back', async () => {
    await open();
    act(() => auto.stream('list', 'down'));
    expect(screen.getByTestId('auto-notice').textContent).toContain("Can't reach Auto.");
    expect(row('bread')).toBeInTheDocument();
    act(() => auto.stream('list', 'open'));
    expect(screen.queryByTestId('auto-notice')).toBeNull();
  });

  it('reads everything again when the list stream resets', async () => {
    await open();
    auto.state.threads = [autoThread('fresh', { title: 'After the restart' })];
    act(() => auto.list({ kind: 'reset' }));
    await screen.findByText('After the restart');
    expect(auto.asked('threads')).toHaveLength(2);
  });
});

describe('the list', () => {
  it('shows the threads that wait on him first, then the rest, and hides the snoozed', async () => {
    await open();
    const ids = [...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
    // What waits on him, then what is new to him (an unread reply, a thread back from snooze), then the rest.
    expect(ids).toEqual(['beds', 'seeds', 'trellis', 'bread', 'inspect']);
    expect(within(row('beds')).getByText('Which wood for the frames?')).toBeInTheDocument();
    // One line over the list says what it holds; a thread nobody has started says so.
    expect(screen.getByTestId('auto-summary').textContent).toBe('1 needs you, 2 new, 1 not started');
    expect(within(row('inspect')).getByTestId('auto-not-started').textContent).toBe('Not started');
    // The dot before a title, as on the phone: an unread reply, or a thread back from snooze. No other row has one.
    expect(within(row('seeds')).getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    expect(within(row('trellis')).getByRole('img', { name: 'Back from snooze' })).toBeInTheDocument();
    expect(within(row('bread')).queryByRole('img')).toBeNull();
    expect(row('trellis').textContent).toMatch(/Back \d/);
    // The rows that are his carry a heavier title: a question, something new, a thread nobody has started.
    const weight = (id: string) => (within(row(id)).getByText(new RegExp(`^${useAutoStore.getState().threads.find((thread) => thread.id === id)?.title}$`)).className.match(/font-(semibold|medium)/) ?? [])[1];
    expect(['beds', 'seeds', 'trellis', 'inspect', 'bread'].map(weight)).toEqual(['semibold', 'semibold', 'semibold', 'semibold', 'medium']);
    expect(row('inspect').textContent).toContain('The committee walks the plots.');
    expect(screen.getByTestId('auto-snoozed-line').textContent).toBe('Snoozed1');
    expect(screen.queryByTestId('auto-row-labels')).toBeNull();
  });

  it('says "Your move" on a thread that is his to act on, as words and never as a button', async () => {
    const NOTE = autoThread('note', { title: 'Club note', last: 'Drafted the note.', yours: 'Read the note and send it to the club' });
    await open({ threads: [BREAD, NOTE] });
    const line = within(row('note')).getByTestId('auto-yours');
    expect(line.textContent).toBe('Your move: Read the note and send it to the club');
    expect(line.closest('button')).toBe(within(row('note')).getAllByRole('button')[0]);
    expect(within(row('note')).getAllByRole('button').slice(1).map((button) => button.getAttribute('aria-label') ?? button.textContent).filter((name) => /move|send/i.test(name ?? ''))).toEqual([]);
    // It stays where his order has it: only a question or something new lifts a row.
    expect([...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'))).toEqual(['bread', 'note']);
    expect(screen.getByTestId('auto-summary').textContent).toBe('1 needs you');
    // Auto takes it back when the thread moves on.
    act(() => auto.list({ kind: 'thread', thread: { ...NOTE, yours: '' } }));
    expect(within(row('note')).queryByTestId('auto-yours')).toBeNull();
    expect(screen.queryByTestId('auto-summary')).toBeNull();
  });

  it('says what the list holds in one line, counts working threads, and says nothing when there is nothing to count', async () => {
    await open({ threads: [BREAD, TRELLIS, autoThread('herbs', { title: 'Herb spiral', status: 'working' })] });
    expect(screen.getByTestId('auto-summary').textContent).toBe('1 new, 1 working');
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null } }));
    act(() => auto.list({ kind: 'thread', thread: autoThread('herbs', { title: 'Herb spiral' }) }));
    expect(screen.queryByTestId('auto-summary')).toBeNull();
  });

  it('shows a send he is asked to allow on its row as a waiting thread, with its title and nothing to press', async () => {
    await open({ threads: [BREAD, autoThread('swap', { title: 'Seed swap', status: 'waiting', ask: { id: 'g1', kind: 'grant', text: 'Send this Slack message to Robin?', options: [], question: null } })] });
    expect([...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'))).toEqual(['swap', 'bread']);
    expect(within(row('swap')).getByText('Send this Slack message to Robin?')).toBeInTheDocument();
    expect(within(row('swap')).getAllByRole('button').slice(1).map((button) => button.getAttribute('aria-label') ?? button.textContent).filter((name) => /allow|yes|send/i.test(name ?? ''))).toEqual([]);
    // A number picks nothing on it: it has no options.
    fireEvent.keyDown(within(row('swap')).getAllByRole('button')[0], { key: '1' });
    expect(screen.queryByTestId('auto-row-held')).toBeNull();
    expect(auto.asked('answer')).toEqual([]);
  });

  it('opens the snoozed threads from their line, and brings one back', async () => {
    await open();
    fireEvent.click(screen.getByTestId('auto-snoozed-line'));
    const snoozed = within(screen.getByTestId('auto-snoozed'));
    fireEvent.click(snoozed.getByRole('button', { name: 'Bring back' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until: null }));
    await waitFor(() => expect(screen.queryByTestId('auto-snoozed-line')).toBeNull());
    expect(row('labels')).toBeInTheDocument();
  });

  it('says Nothing left when every thread is snoozed, and the Snoozed line still shows them', async () => {
    await open({ threads: [LABELS, autoThread('herbs', { title: 'Herb spiral', snoozed: 4_000_100_000 })] });
    expect(screen.getByTestId('auto-empty').textContent).toMatch(/^Nothing left\.The next snoozed one returns .+ at \d/);
    // How many are snoozed is said once, on the Snoozed line.
    expect(screen.getByTestId('auto-empty').textContent).not.toMatch(/2 snoozed/);
    expect(screen.getByTestId('auto-snoozed-line').textContent).toBe('Snoozed2');
    fireEvent.click(screen.getByTestId('auto-snoozed-line'));
    expect([...screen.getByTestId('auto-snoozed').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'))).toEqual(['labels', 'herbs']);
  });

  it('says Nothing left with no thread at all', async () => {
    await open({ threads: [] });
    expect(screen.getByTestId('auto-empty').textContent).toBe('Nothing left.');
    expect(screen.queryByTestId('auto-snoozed-line')).toBeNull();
  });

  it('holds a row’s answer a few seconds with Undo before it is posted, and shows the pick', async () => {
    hold.ms = 60;
    await open();
    // No option is filled in: a filled button reads as already chosen.
    expect(within(row('beds')).getAllByRole('button').slice(1, 3).every((button) => !button.className.includes('bg-primary'))).toBe(true);
    fireEvent.click(within(row('beds')).getByRole('button', { name: 'Larch' }));
    // Held: the row shows the pick, the foot of the list says it with Undo, and nothing has gone yet.
    expect(within(row('beds')).getByTestId('auto-row-held').textContent).toBe('Larch');
    expect(within(row('beds')).queryByRole('button', { name: 'Cedar' })).toBeNull();
    expect(screen.getByTestId('auto-said').textContent).toBe('Raised bed plan, LarchUndo');
    expect(auto.asked('answer')).toEqual([]);
    await waitFor(() => expect(last('answer')).toEqual({ kind: 'answer', id: 'beds', answer: { id: 'q0', answers: { 'Which wood for the frames?': 'Larch' } } }));
    // Posted, it can no longer be taken back.
    await waitFor(() => expect(screen.queryByTestId('auto-said')).toBeNull());
  });

  it('takes a row’s answer back before it is posted', async () => {
    hold.ms = 150;
    await open();
    fireEvent.click(within(row('beds')).getByRole('button', { name: 'Larch' }));
    fireEvent.click(within(screen.getByTestId('auto-said')).getByRole('button', { name: 'Undo' }));
    expect(within(row('beds')).getByRole('button', { name: 'Larch' })).toBeInTheDocument();
    expect(screen.queryByTestId('auto-row-held')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(auto.asked('answer')).toEqual([]);
  });

  it('follows the list stream: a changed entry, a new one on top, an archived one gone, a new order', async () => {
    await open();
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, title: 'Bread timings' } }));
    expect(within(row('bread')).getByText('Bread timings')).toBeInTheDocument();
    act(() => auto.list({ kind: 'thread', thread: autoThread('new1', { title: 'From the phone' }) }));
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, archived: true } }));
    act(() => auto.list({ kind: 'order', ids: ['trellis', 'bread', 'beds', 'inspect', 'labels'] }));
    const ids = [...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
    expect(ids).toEqual(['beds', 'trellis', 'new1', 'bread', 'inspect']);
  });

  it('snoozes from the row’s clock, with the times each choice means', async () => {
    // A Wednesday morning: what the menu offers depends on the day and the hour.
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 11, 10, 0).getTime());
    await open();
    await userEvent.setup().click(screen.getByTestId('auto-snooze-bread'));
    const menu = within(await screen.findByTestId('auto-snooze-menu'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent?.replace(/\d.*$/, '').replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ?$/, ''))).toEqual(['Later today', 'Tonight', 'Tomorrow', 'This weekend', 'Next week', 'Pick a time…', 'Until a reply…']);
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(0, 5)).toEqual(['Later today1:00 pm', 'Tonight7:00 pm', 'TomorrowThu 9:00 am', 'This weekendSat 9:00 am', 'Next weekMon 9:00 am']);
    const before = Date.now() / 1000;
    fireEvent.click(menu.getByRole('menuitem', { name: /^Tomorrow/ }));
    await waitFor(() => expect(last('snooze')?.id).toBe('bread'));
    expect(last('snooze')?.until).toBeGreaterThan(before);
    await waitFor(() => expect(screen.queryByTestId('auto-row-bread')).toBeNull());
  });

  it('offers Snooze and Archive on a right-click, and Done as well for a digest item', async () => {
    await open();
    const pointer = userEvent.setup();
    await pointer.pointer({ keys: '[MouseRight]', target: within(row('bread')).getAllByRole('button')[0] });
    let menu = within(await screen.findByTestId('auto-row-menu-bread'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-4)).toEqual(['Until a reply…', 'Mark for the MacM', 'Rename', 'ArchiveE']);
    // The keys beside the items are for the eye; an item is still called by its name.
    expect(menu.getByRole('menuitem', { name: 'Mark for the Mac' })).toBeInTheDocument();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    await waitFor(() => expect(screen.queryByTestId('auto-row-bread')).toBeNull());

    await pointer.pointer({ keys: '[MouseRight]', target: within(row('inspect')).getAllByRole('button')[0] });
    menu = within(await screen.findByTestId('auto-row-menu-inspect'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-4)).toEqual(['Mark for the MacM', 'Rename', 'DoneD', 'ArchiveE']);
    fireEvent.click(menu.getByRole('menuitem', { name: 'Done' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
  });

  it('offers the same on hover: Snooze and Archive, and Done as well for a thread from the digest', async () => {
    await open();
    expect(within(row('bread')).getAllByRole('button').map((button) => button.getAttribute('aria-label')).filter(Boolean)).toEqual(['Snooze', 'Archive']);
    expect(within(row('inspect')).getAllByRole('button').map((button) => button.getAttribute('aria-label')).filter(Boolean)).toEqual(['Snooze', 'Done', 'Archive']);
    fireEvent.click(within(row('inspect')).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
    fireEvent.click(within(row('seeds')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'seeds', archived: true }));
  });

  it('drags a row to a new place among the rest', async () => {
    await open();
    const data = { store: {} as Record<string, string>, types: [] as string[], effectAllowed: '', dropEffect: '' };
    const dataTransfer = {
      ...data,
      setData: (type: string, value: string) => { data.store[type] = value; dataTransfer.types = Object.keys(data.store); },
      getData: (type: string) => data.store[type] ?? '',
    };
    fireEvent.dragStart(row('inspect'), { dataTransfer });
    // The pointer is above the middle of the first row of the group.
    vi.spyOn(row('bread'), 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40, left: 0, width: 300, right: 300, bottom: 140, x: 0, y: 100, toJSON: () => ({}) });
    const over = createEvent.dragOver(row('bread'), { dataTransfer });
    Object.defineProperty(over, 'clientY', { value: 105 });
    fireEvent(row('bread'), over);
    expect(row('bread').getAttribute('data-drop')).toBe('above');
    fireEvent.drop(row('bread'), { dataTransfer });
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'inspect', before: 'bread' }));
    // A thread that waits on him, and one lifted because it is new to him, do not drag.
    expect(within(row('beds')).getAllByRole('button')[0].closest('[draggable]')).toBeNull();
    expect(within(row('seeds')).getAllByRole('button')[0].closest('[draggable]')).toBeNull();
  });
});

describe('a thread', () => {
  it('opens with its history, follows its stream from the snapshot’s cursor, and hides plumbing', async () => {
    await open();
    await openThread('bread');
    expect(auto.followed.thread).toEqual({ token: expect.any(Number), id: 'bread', cursor: 'b.7' });
    const talk = within(screen.getByTestId('auto-talk'));
    expect(talk.getByText('When do I start the bread?')).toBeInTheDocument();
    expect(talk.getByTestId('auto-steps').textContent).toBe('Read Recipes/Bread.md');
    expect(talk.getByText('8').tagName).toBe('STRONG');
    expect(screen.getByTestId('auto-title').textContent).toBe('Sourdough timings');
    expect(within(row('bread')).getAllByRole('button')[0].getAttribute('aria-current')).toBe('true');
  });

  it('opens a vault file named in a step or a reply as a page in its own tab', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(within(screen.getByTestId('auto-steps')).getByRole('button', { name: 'Recipes/Bread.md' }));
    await waitFor(() => expect(tabPaths()).toEqual([null, '/Vault/Recipes/Bread.md']));
    expect(auto.api.resolvePage).toHaveBeenCalledWith('Recipes/Bread.md');
    // The same file again goes to the tab that shows it.
    act(() => useTabsStore.getState().activateIndex(0));
    fireEvent.click(await screen.findByRole('link', { name: 'Bread' }));
    await waitFor(() => expect(useTabsStore.getState().tabs.findIndex((tab) => tab.id === useTabsStore.getState().activeId)).toBe(1));
    expect(tabPaths()).toEqual([null, '/Vault/Recipes/Bread.md']);
  });

  it('shows the follow-ups as the service gives them, and sends one on a click as a plain message', async () => {
    await open();
    await openThread('bread');
    const next = within(screen.getByTestId('auto-next'));
    expect(next.getAllByRole('button').map((button) => button.textContent)).toEqual(['Scale it to two loaves', 'Send the times to the club']);
    fireEvent.click(next.getByRole('button', { name: 'Send the times to the club' }));
    await waitFor(() => expect(last('message')).toEqual({ kind: 'message', id: 'bread', text: 'Send the times to the club', cid: expect.stringMatching(/^[0-9a-f]{10}$/) }));
    expect(screen.queryByTestId('auto-next')).toBeNull();
    expect(within(screen.getByTestId('auto-talk')).getByText('Send the times to the club')).toBeInTheDocument();
  });

  it('streams a turn: the message, the steps as one line, the reply as it arrives, then the follow-ups', async () => {
    await open();
    await openThread('bread');
    const talk = within(screen.getByTestId('auto-talk'));
    act(() => auto.thread({ kind: 'turn', items: [user('Sort the seeds', 'a1')], state: 'working', activity: '' }));
    expect(screen.getByTestId('auto-stop')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-next')).toBeNull();
    act(() => auto.thread({ kind: 'activity', text: 'Reading the seed list' }));
    expect(screen.getByTestId('auto-activity').textContent).toBe('Reading the seed list');
    const steps = ['Seeds.md', 'sowing months', 'frost dates', 'A calendar', 'Checked'].map((text, at) => ({ g: at === 0 ? 'read' : 'run', text, path: null as string | null }));
    act(() => auto.thread({ kind: 'add', item: { role: 'steps', steps: steps.slice(0, 1) } }));
    act(() => auto.thread({ kind: 'set', index: 1, item: { role: 'steps', steps } }));
    const live = talk.getAllByTestId('auto-steps').at(-1) as HTMLElement;
    // One line while the turn runs, which opens to every step and closes again.
    expect(live.textContent).toBe('Read 1 file, 4 more steps');
    fireEvent.click(within(live).getByRole('button', { name: 'Read 1 file, 4 more steps' }));
    expect(live.textContent).toBe('Read 1 file, 4 more stepsRead Seeds.mdsowing monthsfrost datesA calendarChecked');
    fireEvent.click(within(live).getByRole('button', { name: 'Read 1 file, 4 more steps' }));
    expect(live.textContent).toBe('Read 1 file, 4 more steps');
    // Stop sits beside the send button, not in the header.
    expect(screen.getByTestId('auto-stop').closest('form')).not.toBeNull();

    act(() => auto.thread({ kind: 'add', item: reply('', true) }));
    act(() => auto.thread({ kind: 'append', text: 'March: **broad' }));
    expect(talk.getByText('broad').tagName).toBe('STRONG');
    act(() => auto.thread({ kind: 'append', text: ' beans**, peas' }));
    expect(talk.getByText('broad beans').tagName).toBe('STRONG');
    act(() => auto.thread({ kind: 'set', index: 2, item: reply('March: **broad beans**, peas.') }));
    act(() => auto.thread({ kind: 'end', outcome: 'done', error: null, next: ['Add the sowing depths'] }));
    expect(screen.queryByTestId('auto-stop')).toBeNull();
    expect(screen.queryByTestId('auto-activity')).toBeNull();
    expect(within(screen.getByTestId('auto-next')).getByRole('button').textContent).toBe('Add the sowing depths');
  });

  it('shows the service’s sentence for a failed turn, and Stopped for a stopped one', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Try', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'end', outcome: 'failed', error: 'The agent stopped answering.', next: [] }));
    expect(screen.getByTestId('auto-failed').textContent).toBe('The agent stopped answering.');
    act(() => auto.thread({ kind: 'turn', items: [user('Again', 'a2')], state: 'working', activity: '' }));
    expect(screen.queryByTestId('auto-failed')).toBeNull();
    act(() => auto.thread({ kind: 'end', outcome: 'stopped', error: null, next: [] }));
    expect(within(screen.getByTestId('auto-talk')).getByText('Stopped')).toBeInTheDocument();
  });

  it('answers a question from its card with an option, and with his own words from the box', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Which bed?', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: ASK }));
    const card = within(screen.getByTestId('auto-question'));
    expect(card.getByText('Which bed gets the tomatoes?').className).toContain('font-semibold');
    expect(card.getByText('Bed 1 should rest.').closest('.auto-md')).not.toBeNull();
    expect(card.getByText('Nearer the tap')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-activity')).toBeNull();
    // The card has no field of its own: the box is the answer field while the question waits.
    expect(card.queryByRole('textbox')).toBeNull();
    expect(box().placeholder).toBe('Your answer');
    fireEvent.click(card.getByRole('button', { name: /Bed 4/ }));
    await waitFor(() => expect(last('answer')).toEqual({ kind: 'answer', id: 'bread', answer: { id: 'q1', answers: { [ASK.kind === 'ask' ? ASK.questions[0].question : '']: 'Bed 4' } } }));
    await waitFor(() => expect(document.activeElement).toBe(box()));

    await type('Neither, use the pots');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q1', answers: { 'Which bed gets the tomatoes? Bed 1 should rest.': 'Neither, use the pots' } }));
    // His words went as the answer: nothing was sent as a message, and nothing waits behind the turn.
    expect(auto.asked('message')).toEqual([]);
    expect(screen.queryByTestId('auto-queue')).toBeNull();
    await waitFor(() => expect(box().value).toBe(''));
    act(() => auto.thread({ kind: 'question', question: null }));
    expect(screen.queryByTestId('auto-question')).toBeNull();
    expect(box().placeholder).toBe('Message Auto');
  });

  it('keeps his words in the box when the answer is refused', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Which bed?', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: ASK }));
    auto.state.failWrites = { kind: 'refused', message: 'That question is no longer open.', code: 'conflict', status: 409 };
    await type('The pots');
    expect((await within(screen.getByTestId('auto-question')).findByRole('alert')).textContent).toBe('That question is no longer open.');
    expect(box().value).toBe('The pots');
    expect(auto.asked('message')).toEqual([]);
  });

  it('picks in a question with several parts, and Send posts the picks once each part has one', async () => {
    await open();
    await openThread('bread');
    const parts: AutoQuestion = {
      id: 'q2', kind: 'ask',
      questions: [
        { question: 'Which bed gets the squash?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 1', description: '' }, { label: 'Bed 2', description: '' }] },
        { question: 'Which go beside it?', header: 'Beside', multiSelect: true, options: [{ label: 'Borage', description: '' }, { label: 'Dill', description: '' }] },
      ],
    };
    act(() => auto.thread({ kind: 'turn', items: [user('Two things', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: parts }));
    const card = within(screen.getByTestId('auto-question'));
    const sendPicks = card.getByRole('button', { name: 'Send' });
    expect(sendPicks).toBeDisabled();
    fireEvent.click(card.getByRole('button', { name: 'Bed 2' }));
    expect(auto.asked('answer')).toEqual([]);
    expect(sendPicks).toBeDisabled();
    fireEvent.click(card.getByRole('button', { name: 'Borage' }));
    fireEvent.click(card.getByRole('button', { name: 'Dill' }));
    expect(card.getByRole('button', { name: 'Dill' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(sendPicks);
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q2', answers: { 'Which bed gets the squash?': 'Bed 2', 'Which go beside it?': ['Borage', 'Dill'] } }));
    // His own words answer the parts he has not picked for.
    act(() => auto.thread({ kind: 'question', question: { ...parts, id: 'q3' } }));
    fireEvent.click(within(screen.getByTestId('auto-question')).getByRole('button', { name: 'Bed 1' }));
    await type('Whatever fits');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'q3', answers: { 'Which bed gets the squash?': 'Bed 1', 'Which go beside it?': 'Whatever fits' } }));
  });

  it('says so when the question has closed', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Which bed?', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: ASK }));
    auto.state.failWrites = { kind: 'refused', message: 'That question is no longer open.', code: 'conflict', status: 409 };
    fireEvent.click(within(screen.getByTestId('auto-question')).getByRole('button', { name: /Bed 3/ }));
    expect((await within(screen.getByTestId('auto-question')).findByRole('alert')).textContent).toBe('That question is no longer open.');
  });

  it('allows a permission request, denies it, or denies it with words from the box', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Tidy', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: PERMISSION }));
    const card = within(screen.getByTestId('auto-permission'));
    expect(card.getByText('Run a command: move three drafts')).toBeInTheDocument();
    expect(card.getByText('mv Notes/drafts/*.md Archive/')).toBeInTheDocument();
    expect(card.getAllByRole('button').map((button) => button.textContent)).toEqual(['Allow', 'Deny']);
    expect(card.queryByRole('textbox')).toBeNull();
    fireEvent.click(card.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'p1', allow: true }));
    fireEvent.click(card.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'p1', allow: false }));
    // Words here are a no with a reason, and the box says so.
    expect(box().placeholder).toBe('Say no, with a reason');
    expect(box().getAttribute('aria-label')).toBe('Why not');
    await type('Use the trash');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'p1', allow: false, message: 'Use the trash' }));
    expect(auto.asked('message')).toEqual([]);
  });

  it('shows a send to allow up front as his phone does, as a card that can only say no', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Tell Robin about the swap', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: GRANT }));
    const card = within(screen.getByTestId('auto-grant'));
    // The title, the exact words, the detail on the lines the service gave it, then the no and where the yes is.
    expect(screen.getByTestId('auto-grant').querySelector('p')?.textContent).toBe('Send this Slack message to Robin?');
    expect(screen.getByTestId('auto-grant-words').textContent).toBe('I will bring the bean seedlings on Saturday.');
    const detail = screen.getByTestId('auto-grant-detail');
    expect(detail.textContent).toBe('the seed swap\n\nThese exact words, once, from this thread.');
    expect(detail.className).toContain('whitespace-pre-line');
    const order = [...screen.getByTestId('auto-grant').querySelectorAll('[data-testid], button')].map((element) => element.getAttribute('data-testid') ?? element.textContent);
    expect(order).toEqual(['auto-grant-words', 'auto-grant-detail', 'No', 'auto-grant-phone']);
    // The title already says who and how: there is no second line that says it again.
    expect(screen.getByTestId('auto-grant').textContent).toBe('Send this Slack message to Robin?I will bring the bean seedlings on Saturday.the seed swap\n\nThese exact words, once, from this thread.NoThe yes is on your phone.');
    // One button, and it is the no. The yes is not this app's to give.
    expect(card.getAllByRole('button').map((button) => button.textContent)).toEqual(['No']);
    expect(screen.getByTestId('auto-grant-phone').textContent).toBe('The yes is on your phone.');
    expect(card.queryByRole('textbox')).toBeNull();
    expect(box().placeholder).toBe('Say no, with a reason');
    fireEvent.click(card.getByRole('button', { name: 'No' }));
    await waitFor(() => expect(last('answer')).toEqual({ kind: 'answer', id: 'bread', answer: { id: 'g1', allow: false } }));
    expect(auto.asked('message')).toEqual([]);
    // Without words there is no box of words, and one with no title still has a card to say no to.
    act(() => auto.thread({ kind: 'question', question: { ...GRANT, id: 'g2', title: '', detail: 'From this thread, once, in the next two hours. You will see what went out.', text: null } }));
    expect(screen.queryByTestId('auto-grant-words')).toBeNull();
    expect(screen.getByTestId('auto-grant').querySelector('p')?.textContent).toBe('Allow a send?');
    expect(within(screen.getByTestId('auto-grant')).getAllByRole('button').map((button) => button.textContent)).toEqual(['No']);
  });

  it('says the plain no when he types while it waits, and then sends his words as a message', async () => {
    await open({ snapshots: { bread: autoSnapshot(BREAD, { items: [user('When do I start the bread?')], live: { items: [user('Tell Robin about the swap', 'a1')], activity: 'Waiting for you', state: 'waiting', question: GRANT } }) } });
    await openThread('bread');
    expect(screen.getByTestId('auto-grant')).toBeInTheDocument();
    await type('Not this week');
    // The service reads only the no, so no words go with it. They follow it as an ordinary message, in that order.
    await waitFor(() => expect(auto.asked('message')).toHaveLength(1));
    expect(auto.asked('answer')).toEqual([{ kind: 'answer', id: 'bread', answer: { id: 'g1', allow: false } }]);
    expect(last('message')).toEqual({ kind: 'message', id: 'bread', text: 'Not this week', cid: expect.any(String) });
    const written = auto.routes().filter((route) => route.kind === 'answer' || route.kind === 'message').map((route) => route.kind);
    expect(written).toEqual(['answer', 'message']);
    expect(box().value).toBe('');
    expect(JSON.stringify(auto.routes())).not.toContain('"sends"');
  });

  it('keeps his words in the box, and sends nothing, when the no is not taken', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Tell Robin about the swap', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: GRANT }));
    auto.state.failWrites = { kind: 'refused', message: 'That question is no longer open.', code: 'conflict', status: 409 };
    await type('Not this week');
    await waitFor(() => expect(within(screen.getByTestId('auto-grant')).getByRole('alert').textContent).toBe('That question is no longer open.'));
    expect(auto.asked('answer')).toEqual([{ kind: 'answer', id: 'bread', answer: { id: 'g1', allow: false } }]);
    expect(auto.asked('message')).toEqual([]);
    expect(box().value).toBe('Not this week');
    expect(screen.queryByTestId('auto-not-sent')).toBeNull();
    // The same when the service cannot be reached at all.
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    await type('Not this week');
    await waitFor(() => expect(auto.asked('answer')).toHaveLength(2));
    expect(auto.asked('message')).toEqual([]);
    expect(box().value).toBe('Not this week');
  });

  it('says the no once when Enter is pressed again while it is on its way', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Tell Robin about the swap', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: GRANT }));
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.change(box(), { target: { value: 'Not this week' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(auto.asked('answer')).toHaveLength(1);
    expect(auto.asked('message')).toEqual([]);
    release();
    await waitFor(() => expect(auto.asked('message')).toHaveLength(1));
    expect(auto.asked('answer')).toHaveLength(1);
    expect(last('message')).toMatchObject({ id: 'bread', text: 'Not this week' });
  });

  it('never posts a yes to a send he is asked to allow, by any key or any path', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Tell Robin about the swap', 'a1')], state: 'working', activity: '' }));
    act(() => auto.thread({ kind: 'question', question: GRANT }));
    const card = screen.getByTestId('auto-grant');
    // No key in the card, on its button or in the box allows it.
    const no = within(card).getByRole('button', { name: 'No' });
    for (const target of [card, no, box()]) {
      for (const key of ['1', '2', '3', 'y', 'a', 'Enter', ' ']) fireEvent.keyDown(target, { key });
      fireEvent.keyDown(target, { key: 'Enter', metaKey: true });
    }
    expect(auto.asked('answer')).toEqual([]);
    // An answer built anywhere in the page is checked where it is posted: only the grant's own no gets through.
    const { answer } = useThreadStore.getState();
    expect(await answer({ id: 'g1', allow: true })).toBe(false);
    expect(await answer({ id: 'g1', allow: true, message: 'Go on' })).toBe(false);
    expect(await answer({ id: 'g1', allow: true, signature: 'abc' } as unknown as AutoAnswer)).toBe(false);
    expect(await answer({ id: 'g1', allow: false, signature: 'abc' } as unknown as AutoAnswer)).toBe(false);
    // A no with words is not posted either: the service would drop the words unread.
    expect(await answer({ id: 'g1', allow: false, message: 'Not this week' })).toBe(false);
    expect(await answer({ id: 'g1', answers: { 'Send it?': 'Yes' } })).toBe(false);
    expect(await answer({ id: 'g1', allow: false, answers: { 'Send it?': 'Yes' } } as unknown as AutoAnswer)).toBe(false);
    // A yes meant for a permission that has since given way to the grant goes nowhere either.
    expect(await answer({ id: 'p1', allow: true })).toBe(false);
    expect(auto.asked('answer')).toEqual([]);
    expect(await answer({ id: 'g1', allow: false })).toBe(true);
    expect(auto.asked('answer').map((route) => route.answer)).toEqual([{ id: 'g1', allow: false }]);
    expect(auto.routes().some((route) => /"allow":true|signature/.test(JSON.stringify(route)))).toBe(false);
  });

  it('shows a waiting entry as a card with Hand to Auto, which starts it', async () => {
    await open();
    await openThread('inspect');
    const card = within(screen.getByTestId('auto-entry'));
    expect(card.getByText('Digest, Friday November 13, item 2')).toBeInTheDocument();
    expect(card.getByText('The committee walks the plots on the 21st.')).toBeInTheDocument();
    expect(card.getByRole('button', { name: '2026-11-13 digest' })).toBeInTheDocument();
    expect(box().placeholder).toBe('Say what to do with it');
    fireEvent.click(screen.getByTestId('auto-hand-over'));
    await waitFor(() => expect(last('start')).toEqual({ kind: 'start', id: 'inspect' }));
    act(() => auto.thread({ kind: 'turn', items: [user(`${ENTRY}\n\nRobin says:\nMove it to the 22nd`)], state: 'working', activity: '' }));
    expect(screen.queryByTestId('auto-hand-over')).toBeNull();
    expect(screen.getByTestId('auto-entry')).toBeInTheDocument();
    expect(screen.getByTestId('auto-message').textContent).toBe('Move it to the 22nd');
  });

  it('shows a send that waits on the phone as one line, with nothing to press', async () => {
    await open({ snapshots: { bread: autoSnapshot(BREAD, { items: [user('Draft it'), reply('Drafted.')], sendWaiting: true, sent: [{ at: 1_794_000_000, to: ['club@example.com'], subject: 'Plot inspection' }] }) } });
    await openThread('bread');
    const line = screen.getByTestId('auto-send-waiting');
    expect(line.textContent).toBe('A send is waiting on your phone.');
    expect(within(line).queryByRole('button')).toBeNull();
    expect(screen.getByTestId('auto-talk').textContent).toContain('Sent to club@example.com: Plot inspection');
    act(() => auto.thread({ kind: 'send', waiting: false, sent: null }));
    expect(screen.queryByTestId('auto-send-waiting')).toBeNull();
    // Nothing in the tab starts or confirms a send.
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(names.filter((name) => /send|confirm/i.test(name))).toEqual(['Send to Auto']);
  });

  it('renames from the title, and picks the model from the header', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(screen.getByTestId('auto-title'));
    const field = screen.getByRole('textbox', { name: 'Thread title' });
    fireEvent.change(field, { target: { value: 'Bread timings' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'bread', title: 'Bread timings' }));
    await waitFor(() => expect(screen.getByTestId('auto-title').textContent).toBe('Bread timings'));

    await userEvent.setup().click(screen.getByTestId('auto-model'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Small' }));
    await waitFor(() => expect(last('model')).toEqual({ kind: 'model', id: 'bread', model: 'small' }));
  });

  it('opens the next thread when the open one is archived, and none when it is archived somewhere else', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(within(row('bread')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByTestId('auto-row-bread')).toBeNull());
    // The row below takes its place in the pane.
    expect(useThreadStore.getState().openId).toBe('inspect');
    expect(row('inspect').querySelector('[aria-current]')).not.toBeNull();
    expect(last('thread')).toEqual({ kind: 'thread', id: 'inspect' });
    // Archived somewhere else, the pane is left with nothing.
    await openThread('inspect');
    act(() => auto.list({ kind: 'thread', thread: { ...INSPECTION, archived: true } }));
    expect(auto.followed.thread).toBeNull();
    expect(screen.queryByTestId('auto-entry')).toBeNull();
    expect(within(screen.getByTestId('auto-thread')).getByText('New thread')).toBeInTheDocument();
  });

  it('says a thread is gone', async () => {
    await open();
    fireEvent.click(within(row('trellis')).getAllByRole('button')[0]);
    expect((await within(screen.getByTestId('auto-talk')).findByRole('alert')).textContent).toBe('No such thread.');
  });

  it('fetches the snapshot again when its stream resets', async () => {
    await open();
    await openThread('bread');
    auto.state.snapshots.bread = autoSnapshot(BREAD, { items: [user('After the restart')], cursor: 'c.1' });
    act(() => auto.thread({ kind: 'reset' }));
    await within(screen.getByTestId('auto-talk')).findByText('After the restart');
    expect(auto.followed.thread?.cursor).toBe('c.1');
  });

  it('follows the thread only while the tab is in view', async () => {
    const view = await open();
    await openThread('bread');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(auto.followed.thread).toBeNull();
    expect(auto.followed.list).not.toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(auto.followed.thread?.id).toBe('bread'));
    view.unmount();
    expect(auto.followed.thread).toBeNull();
  });
});

describe('the box', () => {
  it('sends on Enter, adds a line on Shift+Enter, and never marks a message as a send', async () => {
    await open();
    await openThread('bread');
    await type('First line', '{Shift>}{Enter}{/Shift}');
    expect(auto.asked('message')).toEqual([]);
    await type('send it');
    await waitFor(() => expect(last('message')).toEqual({ kind: 'message', id: 'bread', text: 'send it', cid: expect.any(String) }));
    expect(Object.keys(last('message') ?? {}).sort()).toEqual(['cid', 'id', 'kind', 'text']);
    expect(box().value).toBe('');
    // At rest it shows as his message at once.
    expect(screen.getAllByTestId('auto-message').map((message) => message.textContent)).toEqual(['When do I start the bread?', 'send it']);
  });

  it('shows a message sent while a turn runs above the box, and Stop returns it', async () => {
    await open();
    await openThread('bread');
    act(() => auto.thread({ kind: 'turn', items: [user('Sort the seeds', 'a1')], state: 'working', activity: '' }));
    await type('And add the depths');
    const queue = await screen.findByTestId('auto-queue');
    expect(queue.textContent).toBe('And add the depths');
    const cid = last('message')?.cid ?? '';
    act(() => auto.thread({ kind: 'queue', queue: [{ cid, text: 'And add the depths' }] }));
    expect(screen.getByTestId('auto-queue').querySelectorAll('li')).toHaveLength(1);

    auto.state.snapshots.bread = { ...auto.state.snapshots.bread, queue: [{ cid, text: 'And add the depths' }] };
    fireEvent.click(screen.getByTestId('auto-stop'));
    await waitFor(() => expect(last('stop')).toEqual({ kind: 'stop', id: 'bread' }));
    await waitFor(() => expect(box().value).toBe('And add the depths'));
  });

  it('returns the words of a failed post to the box under Not sent, and sends them again under the same id', async () => {
    await open();
    await openThread('bread');
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    await type('Move it to the 22nd');
    await waitFor(() => expect(box().value).toBe('Move it to the 22nd'));
    expect(screen.getByTestId('auto-not-sent').textContent).toBe('Not sentRetry');
    expect(within(screen.getByTestId('auto-talk')).queryByText('Move it to the 22nd')).toBeNull();
    const first = last('message')?.cid;
    auto.state.failWrites = null;
    // Retry sends the words that are in the box again.
    fireEvent.click(within(screen.getByTestId('auto-not-sent')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(auto.asked('message')).toHaveLength(2));
    expect(last('message')?.cid).toBe(first);
    expect(box().value).toBe('');
    expect(screen.queryByTestId('auto-not-sent')).toBeNull();
  });

  it('says why when the service refuses a message', async () => {
    await open();
    await openThread('bread');
    auto.state.failWrites = { kind: 'refused', message: 'That message is too long.', code: 'bad_request', status: 400 };
    await type('A very long message');
    expect((await screen.findByTestId('auto-not-sent')).textContent).toBe('Not sent: That message is too long.Retry');
    expect(box().value).toBe('A very long message');
  });

  it('leaves the box as it is while the service is out of reach', async () => {
    await open();
    await openThread('bread');
    act(() => auto.stream('list', 'down'));
    await type('Is anyone there?');
    expect(box().value).toBe('Is anyone there?');
    expect(screen.getByTestId('auto-not-sent').textContent).toBe('Not sentRetry');
    expect(auto.asked('message')).toEqual([]);
  });

  it('starts a new thread with the box focused, the model picked, and opens it', async () => {
    await open();
    fireEvent.click(screen.getByTestId('auto-new-thread'));
    expect(document.activeElement).toBe(box());
    await userEvent.setup().click(screen.getByTestId('auto-model'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Large' }));
    await type('Plan the herb bed');
    await waitFor(() => expect(last('create')).toEqual({ kind: 'create', text: 'Plan the herb bed', model: 'large', cid: expect.any(String) }));
    await waitFor(() => expect(auto.followed.thread?.id).toBe('created1'));
    expect(row('created1')).toBeInTheDocument();
    expect(screen.getByTestId('auto-message').textContent).toBe('Plan the herb bed');
    expect(screen.getByTestId('auto-stop')).toBeInTheDocument();
  });

  it('shows the words of a new thread at once, on their way, before the service has made it', async () => {
    await open();
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(screen.getByTestId('auto-new-thread'));
    await type('Plan the herb bed');
    const bubble = screen.getByTestId('auto-message');
    expect(bubble.textContent).toBe('Plan the herb bed');
    expect(bubble.className).toContain('opacity-60');
    expect(box().value).toBe('');
    expect(auto.followed.thread).toBeNull();
    release();
    await waitFor(() => expect(auto.followed.thread?.id).toBe('created1'));
    await waitFor(() => expect(screen.getAllByTestId('auto-message')).toHaveLength(1));
    expect(screen.getByTestId('auto-message').className).not.toContain('opacity-60');
  });

  it('shows what he says to a waiting entry at once, under its card', async () => {
    await open();
    await openThread('inspect');
    let release: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { release = resolve; });
    await type('Move it to the 22nd');
    expect(screen.getByTestId('auto-message').textContent).toBe('Move it to the 22nd');
    expect(screen.getByTestId('auto-message').className).toContain('opacity-60');
    expect(screen.getByTestId('auto-entry')).toBeInTheDocument();
    release();
    await waitFor(() => expect(last('message')).toMatchObject({ kind: 'message', id: 'inspect', text: 'Move it to the 22nd' }));
  });

  it('keeps what is typed per thread', async () => {
    await open();
    await openThread('bread');
    fireEvent.change(box(), { target: { value: 'Half a thought' } });
    await openThread('inspect');
    expect(box().value).toBe('');
    await openThread('bread');
    expect(box().value).toBe('Half a thought');
  });
});

describe('the narrow layout', () => {
  it('hides the list while a thread is open, and its back button shows the list alone', async () => {
    const widths = { current: 600 };
    class Observer {
      constructor(private callback: (entries: Array<{ contentRect: { width: number } }>) => void) {}
      observe() { this.callback([{ contentRect: { width: widths.current } }]); }
      disconnect() { /* nothing to release */ }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    await open();
    expect(screen.getByTestId('auto').getAttribute('data-narrow')).toBe('true');
    expect(screen.queryByTestId('auto-thread')).toBeNull();
    fireEvent.click(within(row('bread')).getAllByRole('button')[0]);
    await screen.findByTestId('auto-thread');
    expect(screen.queryByTestId('auto-list')).toBeNull();
    fireEvent.click(screen.getByTestId('auto-back'));
    expect(screen.getByTestId('auto-list')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-thread')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows both columns when the tab is wide', async () => {
    await open();
    expect(screen.getByTestId('auto').getAttribute('data-narrow')).toBeNull();
    expect(screen.getByTestId('auto-list')).toBeInTheDocument();
    expect(screen.getByTestId('auto-thread')).toBeInTheDocument();
  });
});

describe('what the tab asks the service for', () => {
  it('only the routes it has: never a tick, never the inbox, never a send', async () => {
    await open();
    await openThread('bread');
    fireEvent.click(within(screen.getByTestId('auto-next')).getAllByRole('button')[0]);
    await type('send it');
    await waitFor(() => expect(auto.asked('message')).toHaveLength(2));
    await openThread('inspect');
    fireEvent.click(screen.getByTestId('auto-hand-over'));
    await waitFor(() => expect(auto.asked('start')).toHaveLength(1));
    const allowed = [
      'status', 'check-status', 'threads', 'thread', 'create', 'message', 'stop', 'answer', 'model', 'rename', 'archive', 'move', 'snooze', 'start',
      'desk', 'digest', 'digests', 'digest-resolve', 'digest-note', 'digest-thread',
    ];
    expect(kinds().filter((kind) => !allowed.includes(kind))).toEqual([]);
    expect(JSON.stringify(auto.routes())).not.toMatch(/tick|inbox|sends|confirm/);
  });
});

describe('the sidebar row', () => {
  function renderSidebar() {
    return render(
      <MemoryRouter initialEntries={['/files']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
          <TooltipProvider>
            <ShellProvider>
              <Sync />
              <WorkspaceSidebar />
            </ShellProvider>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  }
  const autoTabs = () => useTabsStore.getState().tabs.filter((tab) => isAutoLocation(tabLocation(tab)));

  it('counts what needs him with no tab open: the threads that wait, the unread ones and the ones back from snooze, snoozed left out', async () => {
    resetTabs();
    install({ threads: [BEDS, BREAD, SEEDS, TRELLIS, INSPECTION, LABELS, autoThread('herbs', { status: 'waiting', unread: true, snoozed: 4_000_000_000 })] });
    renderSidebar();
    const button = await screen.findByRole('button', { name: /^Auto/ });
    // Beds waits, Seeds has an unread reply and Trellis is back from snooze.
    await waitFor(() => expect(button.textContent).toBe('Auto3'));
    expect(kinds()).toEqual(['status', 'threads']);
    // The list's stream is followed with no tab open, so the count stays true. No thread's stream is.
    await waitFor(() => expect(auto.followed.list).not.toBeNull());
    expect(auto.followed.thread).toBeNull();
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, status: 'waiting' } }));
    expect(button.textContent).toBe('Auto4');
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, unread: false } }));
    expect(button.textContent).toBe('Auto3');
    // Opened on another device, Trellis is no longer new.
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null } }));
    expect(button.textContent).toBe('Auto2');
    // A thread that is his move counts as well, and stops counting when Auto takes it back.
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null, yours: 'Read the note and send it to the club' } }));
    expect(button.textContent).toBe('Auto3');
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null, yours: '' } }));
    expect(button.textContent).toBe('Auto2');
    // The digest is not read until a tab opens.
    expect(kinds()).toEqual(['status', 'threads']);
  });

  it('shows no count with nothing waiting, and asks nothing with no address', async () => {
    resetTabs();
    install({ url: null });
    renderSidebar();
    const button = await screen.findByRole('button', { name: /^Auto/ });
    await waitFor(() => expect(auto.api.config).toHaveBeenCalled());
    expect(button.textContent).toBe('Auto');
    expect(kinds()).toEqual([]);
  });

  it('starts the list of a tab opened fresh at its top, and keeps its place for a tab that is only left', async () => {
    install();
    openTabs(['/Vault/Recipes/Bread.md', browseAuto().location], 1);
    renderSidebar();
    await waitFor(() => expect(useAutoStore.getState().tabOpen).toBe(true));
    const place = { top: 1243, height: 4000, atEnd: false };
    keepPlace(LIST_PLACE, place);
    // Another tab in front: the Auto tab is still there, and so is its place.
    act(() => useTabsStore.getState().activate(useTabsStore.getState().tabs[0].id));
    expect(placeOf(LIST_PLACE)).toEqual(place);
    // Closed: the next one opened starts at the top.
    act(() => useTabsStore.getState().close(autoTabs()[0].id));
    expect(useAutoStore.getState().tabOpen).toBe(false);
    expect(placeOf(LIST_PLACE)).toBeNull();
  });

  it('opens one Auto tab beside the page, and goes back to it after that', async () => {
    openTabs(['/Vault/Recipes/Bread.md']);
    install();
    renderSidebar();
    const button = await screen.findByRole('button', { name: /^Auto/ });
    fireEvent.click(button);
    expect(tabPaths()).toEqual(['/Vault/Recipes/Bread.md', null]);
    expect(autoTabs()).toHaveLength(1);
    await waitFor(() => expect(auto.followed.list).not.toBeNull());
    act(() => useTabsStore.getState().activateIndex(0));
    fireEvent.click(button);
    expect(autoTabs()).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe(autoTabs()[0].id);
    // Closing the tab keeps the list's stream, for the sidebar's count.
    act(() => useTabsStore.getState().close(autoTabs()[0].id));
    expect(autoTabs()).toHaveLength(0);
    expect(auto.followed.list).not.toBeNull();
    expect(useAutoStore.getState().tabOpen).toBe(false);
  });

  it('keeps the Auto tab when a page is opened from the sidebar while it is in front', async () => {
    openTabs(['/Vault/Recipes/Bread.md', browseAuto().location]);
    install();
    renderSidebar();
    await screen.findByRole('button', { name: /^Auto/ });
    const { open } = useTabsStore.getState();
    // A page that a tab already shows: that tab comes forward.
    act(() => open(focusFile('/Vault/Recipes/Bread.md').location));
    expect(tabPaths()).toEqual(['/Vault/Recipes/Bread.md', null]);
    expect(useTabsStore.getState().activeId).toBe(useTabsStore.getState().tabs[0].id);
    // A page no tab shows: a new tab beside the Auto tab, which stays what it is.
    act(() => useTabsStore.getState().activateIndex(1));
    act(() => open(focusFile('/Vault/Notes/Ideas.md').location));
    expect(tabPaths()).toEqual(['/Vault/Recipes/Bread.md', null, '/Vault/Notes/Ideas.md']);
    expect(autoTabs()).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe(useTabsStore.getState().tabs[2].id);
    // From any other tab a page still opens in that tab.
    act(() => open(focusFile('/Vault/Notes/Other.md').location));
    expect(tabPaths()).toEqual(['/Vault/Recipes/Bread.md', null, '/Vault/Notes/Other.md']);
  });
});
