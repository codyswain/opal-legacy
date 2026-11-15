import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AutoItem, AutoQuestion, AutoRoute } from '@/types/auto';
import { AutoView, useAutoStore, useAutoSync } from '@/renderer/features/auto';
import { forgetPlaces } from '@/renderer/features/auto/model/places';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
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
    expect(ids).toEqual(['beds', 'bread', 'seeds', 'trellis', 'inspect']);
    expect(within(row('beds')).getByText('Which wood for the frames?')).toBeInTheDocument();
    expect(within(row('seeds')).getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    expect(row('trellis').textContent).toMatch(/Back \d/);
    expect(row('inspect').textContent).toContain('The committee walks the plots.');
    expect(screen.getByTestId('auto-snoozed-line').textContent).toBe('Snoozed1');
    expect(screen.queryByTestId('auto-row-labels')).toBeNull();
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
    expect(screen.getByTestId('auto-empty').textContent).toMatch(/^Nothing left\.2 snoozed\. The next one returns .+ at \d/);
    fireEvent.click(screen.getByTestId('auto-snoozed-line'));
    expect([...screen.getByTestId('auto-snoozed').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'))).toEqual(['labels', 'herbs']);
  });

  it('says Nothing left with no thread at all', async () => {
    await open({ threads: [] });
    expect(screen.getByTestId('auto-empty').textContent).toBe('Nothing left.');
    expect(screen.queryByTestId('auto-snoozed-line')).toBeNull();
  });

  it('answers a waiting row from its buttons', async () => {
    await open();
    fireEvent.click(within(row('beds')).getByRole('button', { name: 'Larch' }));
    await waitFor(() => expect(last('answer')).toEqual({ kind: 'answer', id: 'beds', answer: { id: 'q0', answers: { 'Which wood for the frames?': 'Larch' } } }));
  });

  it('follows the list stream: a changed entry, a new one on top, an archived one gone, a new order', async () => {
    await open();
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, title: 'Bread timings' } }));
    expect(within(row('bread')).getByText('Bread timings')).toBeInTheDocument();
    act(() => auto.list({ kind: 'thread', thread: autoThread('new1', { title: 'From the phone' }) }));
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, archived: true } }));
    act(() => auto.list({ kind: 'order', ids: ['trellis', 'bread', 'beds', 'inspect', 'labels'] }));
    const ids = [...screen.getByTestId('auto-list').querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id'));
    expect(ids).toEqual(['beds', 'new1', 'trellis', 'bread', 'inspect']);
  });

  it('snoozes from the row’s clock, with the times each choice means', async () => {
    await open();
    await userEvent.setup().click(screen.getByTestId('auto-snooze-bread'));
    const menu = within(await screen.findByTestId('auto-snooze-menu'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent?.replace(/\d.*$/, '').replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ?$/, '')).filter((label) => label !== 'Later today')).toEqual(['Tomorrow', 'Next week', 'Pick a time…']);
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
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['Pick a time…', 'Mark for the MacM', 'ArchiveE']);
    // The keys beside the items are for the eye; an item is still called by its name.
    expect(menu.getByRole('menuitem', { name: 'Mark for the Mac' })).toBeInTheDocument();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(last('archive')).toEqual({ kind: 'archive', id: 'bread', archived: true }));
    await waitFor(() => expect(screen.queryByTestId('auto-row-bread')).toBeNull());

    await pointer.pointer({ keys: '[MouseRight]', target: within(row('inspect')).getAllByRole('button')[0] });
    menu = within(await screen.findByTestId('auto-row-menu-inspect'));
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent).slice(-3)).toEqual(['Mark for the MacM', 'DoneD', 'ArchiveE']);
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
    fireEvent.dragStart(row('trellis'), { dataTransfer });
    // The pointer is above the middle of the first row of the group.
    vi.spyOn(row('bread'), 'getBoundingClientRect').mockReturnValue({ top: 100, height: 40, left: 0, width: 300, right: 300, bottom: 140, x: 0, y: 100, toJSON: () => ({}) });
    const over = createEvent.dragOver(row('bread'), { dataTransfer });
    Object.defineProperty(over, 'clientY', { value: 105 });
    fireEvent(row('bread'), over);
    expect(row('bread').getAttribute('data-drop')).toBe('above');
    fireEvent.drop(row('bread'), { dataTransfer });
    await waitFor(() => expect(last('move')).toEqual({ kind: 'move', id: 'trellis', before: 'bread' }));
    expect(within(row('beds')).getAllByRole('button')[0].closest('[draggable]')).toBeNull();
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
    expect(box().placeholder).toBe('Your answer');
    await type('Use the trash');
    await waitFor(() => expect(last('answer')?.answer).toEqual({ id: 'p1', allow: false, message: 'Use the trash' }));
    expect(auto.asked('message')).toEqual([]);
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
    expect(useThreadStore.getState().openId).toBe('seeds');
    expect(row('seeds').querySelector('[aria-current]')).not.toBeNull();
    expect(last('thread')).toEqual({ kind: 'thread', id: 'seeds' });
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

  it('counts what needs him with no tab open: the threads that wait and the unread ones, snoozed left out', async () => {
    resetTabs();
    install({ threads: [BEDS, BREAD, SEEDS, TRELLIS, INSPECTION, LABELS, autoThread('herbs', { status: 'waiting', unread: true, snoozed: 4_000_000_000 })] });
    renderSidebar();
    const button = await screen.findByRole('button', { name: /^Auto/ });
    // Beds waits and Seeds has an unread reply.
    await waitFor(() => expect(button.textContent).toBe('Auto2'));
    expect(kinds()).toEqual(['status', 'threads']);
    // The list's stream is followed with no tab open, so the count stays true. No thread's stream is.
    await waitFor(() => expect(auto.followed.list).not.toBeNull());
    expect(auto.followed.thread).toBeNull();
    act(() => auto.list({ kind: 'thread', thread: { ...BREAD, status: 'waiting' } }));
    expect(button.textContent).toBe('Auto3');
    act(() => auto.list({ kind: 'thread', thread: { ...SEEDS, unread: false } }));
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
