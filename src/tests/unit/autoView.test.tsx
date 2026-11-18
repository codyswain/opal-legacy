import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoAnswer, AutoItem, AutoQuestion, AutoRoute } from '@/types/auto';
import { useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { AutoScreen } from '@/tests/helpers/autoHarness';
import { LIST_PLACE, forgetPlaces, keepPlace, placeOf } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { HOLD_MS, hold } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { useShellStore } from '@/renderer/features/shell/store/shellStore';
import { forgetViews, useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { browseAuto, focusFile, isAutoLocation, isDigestLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
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
            <AutoScreen />
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
  vi.useRealTimers();
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

  it('can be changed from the Threads heading, and Cancel keeps the old one', async () => {
    await open();
    await userEvent.setup().pointer({ keys: '[MouseRight]', target: screen.getByTestId('sidebar-fold-threads') });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Change Auto address…' }));
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
    // No line of counts in the sidebar: the heading's count and the rows say it. A thread nobody has started says so.
    expect(screen.queryByTestId('auto-summary')).toBeNull();
    expect(screen.getByTestId('auto-count').textContent).toBe('3');
    expect(within(row('inspect')).getByTestId('auto-not-started').textContent).toBe('Not started');
    // The dot before a title, as on the phone: an unread reply, or a thread back from snooze. No other row has one.
    expect(within(row('seeds')).getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    expect(within(row('trellis')).getByRole('img', { name: 'Back from snooze' })).toBeInTheDocument();
    expect(within(row('bread')).queryByRole('img')).toBeNull();
    expect(row('trellis').textContent).toMatch(/Back \d/);
    // Only the rows the heading's count takes in carry a heavier title: a question, something new. A thread nobody
    // has started keeps its second line and a normal title.
    const weight = (id: string) => (within(row(id)).getByText(new RegExp(`^${useAutoStore.getState().threads.find((thread) => thread.id === id)?.title}$`)).className.match(/font-(semibold|sidebar-label)/) ?? [])[1];
    expect(['beds', 'seeds', 'trellis', 'inspect', 'bread'].map(weight)).toEqual(['semibold', 'semibold', 'semibold', 'sidebar-label', 'sidebar-label']);
    expect(screen.getByTestId('auto-count').textContent).toBe(String(['beds', 'seeds', 'trellis'].length));
    // A row is one line, two when the thread needs him: the first words of a reply are left out of the sidebar.
    expect(row('inspect').textContent).not.toContain('The committee walks the plots.');
    expect(row('bread').textContent).not.toContain('Start the starter at 8.');
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Put away1');
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
    expect(screen.getByTestId('auto-count').textContent).toBe('1');
    // Auto takes it back when the thread moves on.
    act(() => auto.list({ kind: 'thread', thread: { ...NOTE, yours: '' } }));
    expect(within(row('note')).queryByTestId('auto-yours')).toBeNull();
    expect(screen.queryByTestId('auto-count')).toBeNull();
  });

  it('draws a thread at work on one line, with how long it has been working in its time', async () => {
    await open({ threads: [BREAD, autoThread('herbs', { title: 'Herb spiral', status: 'working', activity: 'Reading the bed plan' })] });
    expect(within(row('herbs')).queryByText('Reading the bed plan')).toBeNull();
    expect(within(row('herbs')).getAllByRole('button')[0].children.length).toBe(1);
  });

  it('draws two lines only for a thread that needs him: a question, his move, not started, a failure', async () => {
    await open({
      threads: [
        BREAD,
        autoThread('ask', { title: 'Ask', status: 'waiting', ask: { id: 'q', kind: 'ask', text: 'Which bed?', options: ['One'], question: 'Which bed?' } }),
        autoThread('mine', { title: 'Mine', last: 'Drafted.', yours: 'Read it' }),
        autoThread('broke', { title: 'Broke', status: 'failed', error: 'it stopped' }),
      ],
    });
    const lines = (id: string) => within(row(id)).getAllByRole('button')[0].children.length;
    expect(['bread', 'ask', 'mine', 'broke'].map(lines)).toEqual([1, 2, 2, 2]);
    expect(row('ask').textContent).toContain('Which bed?');
    expect(row('mine').textContent).toContain('Your move: Read it');
    expect(row('broke').textContent).toContain('Failed: it stopped');
    // A row with no time gives its title the room: the time's slot holds only the time, and on hover or focus the
    // first line fades out under the actions, as far in as they reach.
    const slot = (id: string) => within(row(id)).getAllByRole('button')[0].querySelector('.tabular-nums') as HTMLElement;
    expect(slot('broke').getAttribute('style')).toBeNull();
    expect(row('broke').querySelector('.auto-row-line')).not.toBeNull();
    expect(row('broke').style.getPropertyValue('--auto-row-hide')).toBe('3rem');
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

  it('opens the snoozed threads from the Put away row, and brings one back', async () => {
    await open();
    fireEvent.click(screen.getByTestId('auto-away-row'));
    const snoozed = within(await screen.findByTestId('auto-snoozed'));
    fireEvent.click(snoozed.getByRole('button', { name: 'Bring back' }));
    await waitFor(() => expect(last('snooze')).toEqual({ kind: 'snooze', id: 'labels', until: null }));
    await waitFor(() => expect(screen.queryByTestId('auto-snoozed')).toBeNull());
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Put away');
    expect(row('labels')).toBeInTheDocument();
  });

  it('says Nothing left when every thread is snoozed, and the Put away page still shows them', async () => {
    await open({ threads: [LABELS, autoThread('herbs', { title: 'Herb spiral', snoozed: 4_000_100_000 })] });
    expect(screen.getByTestId('auto-empty').textContent).toMatch(/^Nothing left\. The next snoozed one returns .+ at \d/);
    // How many are snoozed is said once, on the Put away row.
    expect(screen.getByTestId('auto-empty').textContent).not.toMatch(/2 snoozed/);
    expect(screen.getByTestId('auto-away-row').textContent).toBe('Put away2');
    // The empty new thread says so too.
    expect(screen.getByTestId('auto-nothing-left').textContent).toBe('Nothing left.');
    fireEvent.click(screen.getByTestId('auto-away-row'));
    expect([...(await screen.findByTestId('auto-snoozed')).querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'))).toEqual(['labels', 'herbs']);
  });

  it('says Nothing left with no thread at all', async () => {
    await open({ threads: [] });
    expect(screen.getByTestId('auto-empty').textContent).toBe('Nothing left.');
    expect(screen.queryByTestId('auto-snoozed-line')).toBeNull();
  });

  it('puts no answer buttons on a row: a question is answered in the open thread', async () => {
    await open();
    expect(within(row('beds')).queryByRole('button', { name: 'Larch' })).toBeNull();
    fireEvent.keyDown(within(row('beds')).getAllByRole('button')[0], { key: '2' });
    expect(screen.queryByTestId('auto-said')).toBeNull();
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
    expect(menu.getAllByRole('menuitem')[0].textContent).toBe('Rename');
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['Until a reply…', 'Mark for the MacM', 'ArchiveE']);
    // The keys beside the items are for the eye; an item is still called by its name.
    expect(menu.getByRole('menuitem', { name: 'Mark for the Mac' })).toBeInTheDocument();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    await waitFor(() => expect(screen.queryByTestId('auto-row-bread')).toBeNull());

    await pointer.pointer({ keys: '[MouseRight]', target: within(row('inspect')).getAllByRole('button')[0] });
    menu = within(await screen.findByTestId('auto-row-menu-inspect'));
    expect(menu.getAllByRole('menuitem')[0].textContent).toBe('Rename');
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['Mark for the MacM', 'DoneD', 'ArchiveE']);
    fireEvent.click(menu.getByRole('menuitem', { name: 'Done' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'inspect', archived: true, done: true }));
  });

  it('offers Snooze and Archive on hover, a thread from the digest too (Done is in its menu and on D)', async () => {
    await open();
    expect(within(row('bread')).getAllByRole('button').map((button) => button.getAttribute('aria-label')).filter(Boolean)).toEqual(['Snooze', 'Archive']);
    expect(within(row('inspect')).getAllByRole('button').map((button) => button.getAttribute('aria-label')).filter(Boolean)).toEqual(['Snooze', 'Archive']);
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

  it('ends a folded line in a chevron, for one step that keeps its link and for many that open', async () => {
    await open();
    await openThread('bread');
    const one = screen.getByTestId('auto-steps');
    expect(one.querySelector('[data-testid="auto-steps-chevron"]')).not.toBeNull();
    expect(within(one).getByRole('button', { name: 'Recipes/Bread.md' })).toBeInTheDocument();
    act(() => auto.thread({ kind: 'turn', items: [user('Sort the seeds', 'a1')], state: 'working', activity: '' }));
    const steps = ['Seeds.md', 'sowing months'].map((text) => ({ g: 'run', text, path: null as string | null }));
    act(() => auto.thread({ kind: 'add', item: { role: 'steps', steps } }));
    const many = screen.getAllByTestId('auto-steps').at(-1) as HTMLElement;
    expect(within(many).getByRole('button').querySelector('[data-testid="auto-steps-chevron"]')).not.toBeNull();
  });

  it('holds the box’s controls on a row at its foot: the model at the left, Stop and Send at the right', async () => {
    await open();
    await openThread('bread');
    const foot = screen.getByTestId('auto-box-row');
    expect(foot.closest('form')).toBe(box().closest('form'));
    // The words come first, the row after them.
    expect(box().compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(foot).getByTestId('auto-model')).toBeInTheDocument();
    act(() => auto.thread({ kind: 'turn', items: [user('Sort the seeds', 'a1')], state: 'working', activity: '' }));
    const buttons = within(foot).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('data-testid'))).toEqual(['auto-model', 'auto-stop', 'auto-send']);
  });

  it('draws Send grey with no words and filled once there are words', async () => {
    await open();
    await openThread('bread');
    const send = screen.getByTestId('auto-send');
    expect(send).toBeDisabled();
    expect(send.hasAttribute('data-ready')).toBe(false);
    expect(send.className).toContain('bg-surface-active');
    fireEvent.change(box(), { target: { value: 'Add rye' } });
    expect(send).toBeEnabled();
    expect(send.hasAttribute('data-ready')).toBe(true);
    expect(send.className).toContain('bg-primary');
    fireEvent.change(box(), { target: { value: '   ' } });
    expect(send).toBeDisabled();
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
    await open({ snapshots: { bread: autoSnapshot(BREAD, { items: [user('Draft it'), reply('Drafted.')], sendWaiting: true }) } });
    await openThread('bread');
    const line = screen.getByTestId('auto-send-waiting');
    expect(line.textContent).toBe('A send is waiting on your phone.');
    expect(within(line).queryByRole('button')).toBeNull();
    act(() => auto.thread({ kind: 'send', waiting: false, sent: null }));
    expect(screen.queryByTestId('auto-send-waiting')).toBeNull();
    // Nothing in the tab starts or confirms a send.
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(names.filter((name) => /send|confirm/i.test(name))).toEqual(['Send to Auto']);
  });

  it('shows dated send receipts in the header during a later turn', async () => {
    const sentAt = new Date(2026, 10, 14, 10, 11);
    await open({ snapshots: {
      bread: autoSnapshot(BREAD, {
        items: [user('Draft it'), reply('Drafted.')],
        live: { items: [user('New question')], activity: 'Searching vault…', state: 'working', question: null },
        sent: [{ at: sentAt.getTime() / 1000, to: ['club@example.com'], subject: 'Plot inspection' }],
      }),
      seeds: autoSnapshot(SEEDS),
    } });
    await openThread('bread');
    const talk = within(screen.getByTestId('auto-talk'));
    expect(talk.getByText('Searching vault…')).toBeInTheDocument();
    expect(talk.queryByText(/Plot inspection/)).toBeNull();
    const header = within(screen.getByTestId('auto-thread-header'));
    await userEvent.setup().click(header.getByRole('button', { name: 'Sent messages' }));
    const receipts = within(screen.getByRole('dialog', { name: 'Sent messages' }));
    expect(receipts.queryByRole('button')).toBeNull();
    const oldReceipt = receipts.getByRole('listitem');
    expect(oldReceipt).toHaveTextContent('Sent to club@example.com: Plot inspection');
    expect(within(oldReceipt).getByText(/Nov 14.* at 10:11 am/)).toHaveAttribute('datetime', sentAt.toISOString());

    act(() => auto.thread({ kind: 'send', waiting: false, sent: {
      at: sentAt.getTime() / 1000 + 300, to: ['club@example.com'], subject: 'Updated inspection',
    } }));
    expect(receipts.getAllByRole('listitem')[0]).toHaveTextContent('Updated inspection');
    expect(talk.queryByText(/Updated inspection/)).toBeNull();

    await openThread('seeds');
    expect(screen.queryByRole('dialog', { name: 'Sent messages' })).toBeNull();
    expect(header.queryByRole('button', { name: 'Sent messages' })).toBeNull();
  });

  it('renames from the title’s menu, and picks the model from the box’s foot', async () => {
    await open();
    await openThread('bread');
    await userEvent.setup().click(screen.getByTestId('auto-thread-menu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'Thread title' });
    fireEvent.change(field, { target: { value: 'Bread timings' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    await waitFor(() => expect(last('rename')).toEqual({ kind: 'rename', id: 'bread', title: 'Bread timings' }));
    await waitFor(() => expect(screen.getByTestId('auto-title').textContent).toBe('Bread timings'));

    expect(screen.getByTestId('auto-model').closest('[data-testid="auto-box-row"]')).not.toBeNull();
    expect(screen.getByTestId('auto-thread-header').querySelector('[data-testid="auto-model"]')).toBeNull();
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

describe('the Auto page', () => {
  it('has no list of its own: the list is in the sidebar, the page shows one thing', async () => {
    await open();
    expect(within(screen.getByTestId('auto')).queryByTestId('auto-list')).toBeNull();
    expect(screen.getByTestId('auto').hasAttribute('data-narrow')).toBe(false);
    expect(screen.queryByTestId('auto-back')).toBeNull();
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
      'desk', 'digest', 'digests', 'digest-resolve', 'digest-note', 'digest-thread', 'usage',
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
    const count = () => screen.queryByTestId('auto-count')?.textContent ?? '';
    // Beds waits, Seeds has an unread reply and Trellis is back from snooze.
    await waitFor(() => expect(count()).toBe('3'));
    expect(kinds().filter((kind) => !kind.startsWith('digest') && kind !== 'usage')).toEqual(['status', 'threads']);
    // The list's stream is followed with no tab open, so the count stays true. No thread's stream is.
    await waitFor(() => expect(auto.followed.list).not.toBeNull());
    expect(auto.followed.thread).toBeNull();
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, status: 'waiting' } }));
    expect(count()).toBe('4');
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, unread: false } }));
    expect(count()).toBe('3');
    // Opened on another device, Trellis is no longer new.
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null } }));
    expect(count()).toBe('2');
    // A thread that is his move counts as well, and stops counting when Auto takes it back.
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null, yours: 'Read the note and send it to the club' } }));
    expect(count()).toBe('3');
    act(() => auto.list({ kind: 'thread', thread: { ...TRELLIS, woke: null, yours: '' } }));
    expect(count()).toBe('2');
    // The digest is read with no tab, for the Digest row's count; no thread is.
    expect(kinds()).not.toContain('thread');
    await waitFor(() => expect(useDigestStore.getState().status).not.toBe('unknown'));
  });

  it('shows no count with nothing waiting, and asks nothing with no address', async () => {
    resetTabs();
    install({ url: null });
    renderSidebar();
    // One row, Connect Auto…, which opens the address form.
    const connect = await screen.findByTestId('auto-connect');
    await waitFor(() => expect(auto.api.config).toHaveBeenCalled());
    expect(connect.textContent).toBe('Connect Auto…');
    expect(screen.queryByTestId('auto-count')).toBeNull();
    expect(screen.queryByTestId('auto-new-thread')).toBeNull();
    expect(kinds()).toEqual([]);
    fireEvent.click(connect);
    expect(autoTabs()).toHaveLength(1);
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

  it('opens a thread picked with a page in front in one Auto tab beside the page, and goes back to it after that', async () => {
    openTabs(['/Vault/Recipes/Bread.md']);
    install();
    renderSidebar();
    await screen.findByTestId('auto-row-bread');
    fireEvent.click(within(row('bread')).getAllByRole('button')[0]);
    expect(tabPaths()).toEqual(['/Vault/Recipes/Bread.md', null]);
    expect(autoTabs()).toHaveLength(1);
    expect(useThreadStore.getState().openId).toBe('bread');
    expect(within(row('bread')).getAllByRole('button')[0].getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(auto.followed.list).not.toBeNull());
    // Back on the page, the row is no longer marked; another thread goes to the same tab.
    act(() => useTabsStore.getState().activateIndex(0));
    expect(within(row('bread')).getAllByRole('button')[0].getAttribute('aria-current')).toBeNull();
    fireEvent.click(within(row('seeds')).getAllByRole('button')[0]);
    expect(autoTabs()).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe(autoTabs()[0].id);
    expect(useThreadStore.getState().openId).toBe('seeds');
    expect(tabPaths()).toEqual(['/Vault/Recipes/Bread.md', null]);
    const digestRow = screen.getByTestId('auto-digest-row');
    fireEvent.contextMenu(digestRow);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in new tab' }));
    const digest = useTabsStore.getState().tabs.find((tab) => isDigestLocation(tabLocation(tab)));
    expect(digest?.id).toBe(useTabsStore.getState().activeId);
    expect(digestRow).toHaveAttribute('aria-current', 'true');
    expect(within(row('seeds')).getAllByRole('button')[0]).not.toHaveAttribute('aria-current');
    expect(useThreadStore.getState().openId).toBe('seeds');
    expect(autoTabs()).toHaveLength(1);
    // Returning to the conversation leaves Digest available in its own tab.
    act(() => useTabsStore.getState().activate(autoTabs()[0].id));
    expect(within(row('seeds')).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'true');
    expect(digestRow).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByTestId('auto-new-thread'));
    expect(useThreadStore.getState().openId).toBe(':new');
    // Closing either one leaves the list live until the last Auto surface closes.
    act(() => useTabsStore.getState().close(autoTabs()[0].id));
    expect(useAutoStore.getState().tabOpen).toBe(true);
    act(() => useTabsStore.getState().close(digest.id));
    expect(auto.followed.list).not.toBeNull();
    expect(useAutoStore.getState().tabOpen).toBe(false);
  });

  it('keeps a visible thread subscribed with its draft when Digest opens and closes in the other pane', async () => {
    await open();
    await openThread('bread');
    const followed = auto.followed.thread;
    fireEvent.change(box(), { target: { value: 'Keep the starter cold' } });
    fireEvent.click(screen.getByTestId('auto-digest-row'), { altKey: true });
    expect(await screen.findByTestId('auto-queue-pane')).toBeTruthy();
    expect(useTabsStore.getState().panes).toHaveLength(2);
    expect(box().value).toBe('Keep the starter cold');
    expect(auto.followed.thread).toEqual(followed);

    const digestTab = useTabsStore.getState().activeId!;
    act(() => useTabsStore.getState().close(digestTab));
    expect(screen.queryByTestId('auto-queue-pane')).toBeNull();
    expect(box().value).toBe('Keep the starter cold');
    expect(auto.followed.thread).toEqual(followed);
  });

  it('keeps the Auto tab when a page is opened from the sidebar while it is in front', async () => {
    openTabs(['/Vault/Recipes/Bread.md', browseAuto().location]);
    install();
    renderSidebar();
    await screen.findByTestId('auto-list');
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

describe('the sidebar review, smaller items', () => {
  const listed = () => [...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
  beforeEach(() => useShellStore.setState({ threadsOpen: true, sidebarOpen: true, narrowLayout: false }));

  it('keeps the open thread in its place when it is read, and moves it when another opens', async () => {
    await open();
    expect(listed()).toEqual(['beds', 'seeds', 'trellis', 'bread', 'inspect']);
    fireEvent.click(within(row('seeds')).getAllByRole('button')[0]);
    await waitFor(() => expect(useThreadStore.getState().openId).toBe('seeds'));
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, unread: false } }));
    await waitFor(() => expect(within(row('seeds')).queryByRole('img', { name: 'Unread' })).toBeNull());
    expect(listed()).toEqual(['beds', 'seeds', 'trellis', 'bread', 'inspect']);
    await openThread('bread');
    expect(listed().indexOf('seeds')).toBeGreaterThan(listed().indexOf('trellis'));
  });

  it('shows the Undo line at the foot of the Auto page while the sidebar is not shown', async () => {
    useShellStore.setState({ sidebarOpen: false, narrowLayout: false });
    await open();
    expect(within(screen.getByTestId('auto')).queryByTestId('auto-said')).toBeNull();
    fireEvent.click(screen.getByTestId('auto-archive-bread'));
    await waitFor(() => expect(within(screen.getByTestId('auto')).getByTestId('auto-said')).toBeInTheDocument());
    act(() => useShellStore.setState({ sidebarOpen: true }));
    expect(within(screen.getByTestId('auto')).queryByTestId('auto-said')).toBeNull();
  });

  it('goes from the New thread button to the first row with Down', async () => {
    await open();
    const button = screen.getByTestId('auto-new-thread');
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(':digest');
  });

  it('draws the folded count in the text colour and the headings a step above the labels', async () => {
    await open();
    expect(screen.getByTestId('auto-count').className).toContain('text-foreground-tertiary');
    fireEvent.click(screen.getByRole('button', { name: /^Threads/ }));
    await waitFor(() => expect(screen.getByTestId('auto-count').className).toMatch(/(^| )text-foreground( |$)/));
    expect(screen.getByRole('button', { name: /^Threads/ }).className).toContain('font-medium');
  });

  it('says out of reach once: in the page while the Auto tab is in front', async () => {
    await open();
    act(() => auto.stream('list', 'down'));
    expect(screen.getByTestId('auto-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-out-of-reach')).toBeNull();
  });

  it('keeps the height Threads had at the last close while the list is being read', async () => {
    window.localStorage.setItem('opal.auto.threadsHeight', JSON.stringify({ version: 1, value: 412 }));
    await open();
    const fold = screen.getByTestId('sidebar-threads');
    // Read: the rows decide the height.
    expect(fold.style.height).toBe('');
    // Being read (as at launch, between the address and the list): the kept number holds the place.
    act(() => useAutoStore.setState({ loaded: false }));
    expect(fold.style.height).toBe('412px');
    act(() => useAutoStore.setState({ loaded: true }));
    expect(fold.style.height).toBe('');
  });
  it('keeps the row’s title field open after Rename is picked from its menu with the pointer', async () => {
    await open();
    await openThread('bread');
    box().focus();
    const pointer = userEvent.setup();
    await pointer.pointer({ keys: '[MouseRight]', target: within(row('seeds')).getAllByRole('button')[0] });
    const menu = within(await screen.findByTestId('auto-row-menu-seeds'));
    await pointer.click(menu.getByRole('menuitem', { name: 'Rename' }));
    const field = await within(row('seeds')).findByRole('textbox', { name: 'Thread title' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(row('seeds')).getByRole('textbox', { name: 'Thread title' })).toBe(field);
    expect(document.activeElement).toBe(field);
    // The rename is on the row, not in the header as well.
    expect(screen.getAllByRole('textbox', { name: 'Thread title' })).toHaveLength(1);
  });
});
