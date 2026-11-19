// Disposable Electron acceptance for sub-agents in the Auto tab, against the
// stand-in service in src/tests/fixtures/auto (made-up threads, on 127.0.0.1
// only). It never contacts any other host and starts no agent. The full tour
// is auto-acceptance.mjs; this one connects and walks only the sub-agent part:
// the mode picked in the box, a turn that fans out to two agents as threads
// under their parent, each opened from its step line and stopped from its own
// header, the ring while they work, and the family archived and brought back
// together. Run from the repository root after the Vite bundles are built:
//
//   node e2e/acceptance/auto-agents-acceptance.mjs [--out dir] [--sides a,b]

import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { startStandIn } from '../../src/tests/fixtures/auto/standIn.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const outDir = path.resolve(flag('out', path.join('e2e', 'out', 'auto-agents')));
const SIDES = flag('sides', 'a,b').split(',');
const WIDTH = 1500;
const HEIGHT = 933;
/** Under the shell's medium breakpoint: the sidebar becomes an overlay. */
const NARROW = 760;

const results = [];
let side = 'a';
const began = Date.now();
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${side}] ${name}${detail ? `: ${detail}` : ''}`);
};

const BREAD = '5a0000000002';
const BEDS = '5a0000000001';
const SEEDS = '5a0000000003';
const COMPOST = '5a0000000004';
const TRELLIS = '5a0000000005';
const INSPECTION = '5a0000000006';
const BARREL = '5a0000000009';
const HERBS = '5a0000000008';
const GLASS = '5a000000000a';
const FENCE = '5b0000000001';
const FEEDER = '5b0000000002';

await mkdir(outDir, { recursive: true });
const errors = [];

/*
 * Git here runs only on temp repos on this Mac: the vault is a checkout of a
 * bare remote in the temp folder, and a second clone pushes to it. Neither
 * the person's nor the system's git settings are read, by this script or by
 * the app.
 */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};
const git = (cwd, ...gitArgs) => execFileSync('git', gitArgs, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' }).trim();
const LONG_PAGE = 'Library/notes/A very long page name about the north beds, the rain gauge on the shed and the compost bins by the fence.md';

async function tour() {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-auto-userdata-'));
  const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-auto-vault-'));
  await mkdir(path.join(vaultParent, 'Vault'), { recursive: true });
  const vault = await realpath(path.join(vaultParent, 'Vault'));
  const put = async (relative, text) => {
    await mkdir(path.dirname(path.join(vault, relative)), { recursive: true });
    await writeFile(path.join(vault, relative), text);
  };
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await put('Archive/Journal/Template.md', '---\ndate: {{date:YYYY-MM-DD}}\ntags:\n  - daily\n---\n');
  await put(`Library/daily/${iso}.mdo`, `---\ndate: ${iso}\ntags:\n  - daily\n---\nWalk the garden beds before the rain.\n`);
  await put('Library/digests/2026-11-13 digest.md', '# Digest\n\n2. [ ] **Book the allotment inspection**\n');
  await put('Recipes/Bread.md', '# Bread\n\nFlour, water, salt, time.\n');
  await put('Projects/Garden/Beds.md', '# Beds\n\nFour raised beds.\n');
  await put('Projects/Garden/Seeds.md', '# Seeds\n\nBeans, peas, chard.\n');
  await put('Projects/Kitchen/Pantry.md', '# Pantry\n\nStrong white flour, 3 kg.\n');
  await put('Projects/Kitchen/Tap.md', '# Tap\n\nThe hot side drips.\n');
  await put('Notes/Ideas.md', '# Ideas\n\nA rain gauge on the shed.\n');
  await put(LONG_PAGE, 'No heading here, so its link shows the file name.\n');
  // The vault is a checkout of a temp remote; Elsewhere is a second clone that pushes, as another machine would.
  const remote = path.join(vaultParent, 'remote.git');
  const elsewhere = path.join(vaultParent, 'Elsewhere');
  git(vaultParent, 'init', '-q', '--bare', '-b', 'main', remote);
  git(vault, 'init', '-q', '-b', 'main');
  git(vault, 'add', '-A');
  git(vault, 'commit', '-q', '-m', 'The vault');
  git(vault, 'remote', 'add', 'origin', remote);
  git(vault, 'push', '-q', '-u', 'origin', 'main');
  git(vaultParent, 'clone', '-q', remote, elsewhere);
  await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
  if (side === 'b') await writeFile(path.join(userData, 'variants.json'), JSON.stringify({ version: 1, sides: { roomy: 'b' } }, null, 2));

  const service = await startStandIn({ pace: 30, retryMs: 500 });
  // Every thread snoozed and every digest entry resolved; then a service with no thread and no digest.
  const emptyService = await startStandIn({ fixture: 'empty', digests: 'done', retryMs: 500 });
  const bareService = await startStandIn({ fixture: 'none', digests: 'none', retryMs: 500 });
  const app = await electron.launch({ args: [process.cwd()], env: { ...process.env, ...GIT_ENV, OPAL_TEST_USER_DATA_DIR: userData } });
  const watchdog = setTimeout(() => {
    console.log('FAIL the run stopped answering after 35 minutes');
    void app.close().finally(() => process.exit(1));
  }, 2_100_000);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.on('pageerror', (error) => errors.push(`[${side}] ${String(error)}`));

  // The window never keeps the keyboard (as in daily-mdo-acceptance.mjs).
  for (let wait = 0; wait < 100 && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const resize = (width, height) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    electronApp.hide();
  });
  await resize(WIDTH, HEIGHT);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await app.evaluate(({ app: electronApp }) => electronApp.show());
  await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: 'input, textarea { caret-color: transparent !important; }' });
  // Copy writes here, never to this Mac's clipboard, which is its owner's.
  await page.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text) => { window.__copied = text; } });
  });

  const wait = (ms) => page.waitForTimeout(ms);
  const auto = page.getByTestId('auto');
  // The sidebar's Threads: its heading, with the count of threads that wait on him, and the row that connects Auto.
  const threadsHeading = page.getByTestId('sidebar-fold-threads');
  const connectRow = page.getByTestId('auto-connect');
  const newThread = page.getByTestId('auto-new-thread');
  const headingCount = async () => ((await page.getByTestId('auto-count').textContent().catch(() => '')) ?? '');
  const row = (id) => page.getByTestId(`auto-row-${id}`);
  const box = page.getByTestId('auto-box');
  const talk = page.getByTestId('auto-talk');
  const rowIds = () => page.locator('[data-testid="auto-list"] [data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));
  /** The rows of one group of the list: `needs` (waiting on him), `fresh` (new to him) or `rest` (his order). */
  const groupIds = (group) => page.locator(`[data-testid="auto-group-${group}"] [data-thread-id]`).evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));
  const say = async (text) => {
    await box.click();
    await box.fill(text);
    await box.press('Enter');
  };
  /** Waits for something to be true on the page or in the stand-in. */
  const until = async (test, timeout = 10_000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await test()) return true;
      await wait(50);
    }
    return false;
  };
  const atRest = (id) => until(() => service.thread(id)?.status === 'idle' && !service.thread(id)?.live);
  /** A choice from a row's right-click menu. */
  const fromMenu = async (id, name) => {
    await row(id).locator('[data-auto-row]').click({ button: 'right' });
    await page.getByRole('menuitem', { name, exact: true }).click();
    await until(async () => (await page.getByRole('menu').count()) === 0);
  };
  /** A write made by another client, as the phone would make it. It goes to the stand-in only. */
  const fromPhone = (path, body) => fetch(`${service.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auto-Client': 'phone' }, body: JSON.stringify(body) });
  const digestRow = page.getByTestId('auto-digest-row');
  /** The Digest row's first line: its name and how much is left. */
  const digestSays = () => digestRow.evaluate((element) => element.textContent ?? '');
  /** The line at the foot of the list that says what the last action did. */
  const said = page.getByTestId('auto-said');
  /** What holds the keyboard: a row's or an entry's id, a test id, or the tag. */
  const focused = () => page.evaluate(() => {
    const element = document.activeElement;
    return element?.getAttribute('data-row-id') ?? element?.getAttribute('data-entry-id') ?? element?.getAttribute('data-testid') ?? element?.getAttribute('aria-label') ?? element?.tagName ?? '';
  });
  const key = (name) => page.keyboard.press(name);
  /** How many threads need him, as the service has it: waiting, unread, back from snooze or his move, and not snoozed. */
  const needsHim = () => service.entries().filter((thread) => !thread.snoozed && (thread.status === 'waiting' || thread.unread || thread.woke || (thread.yours && thread.status === 'idle' && !thread.waits))).length;
  /** What the line at the foot of the list says, as one string. */
  const saidText = async () => ((await said.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  const sidebarSays = async (count) => (await headingCount()) === (count > 0 ? String(count) : '');
  /** Whether a pane's header, its scrolling part and what is under it hold one column: the same left and right edges. */
  const oneColumn = (pane) => page.evaluate((id) => {
    const columns = [...document.querySelectorAll(`[data-testid="${id}"] .auto-column`)].map((column) => column.getBoundingClientRect()).filter((box) => box.width > 0);
    const [first] = columns;
    return columns.length >= 2 && columns.every((box) => Math.abs(box.left - first.left) < 0.6 && Math.abs(box.right - first.right) < 0.6);
  }, pane);
  /** The left edge of the title's words, of the first words of the thread and of the box's border: one edge. */
  const threadEdges = () => page.evaluate(() => {
    const left = (element) => (element ? Math.round(element.getBoundingClientRect().left) : -1);
    const title = document.querySelector('[data-testid="auto-thread"] h1');
    const titleLeft = title ? Math.round(title.getBoundingClientRect().left + parseFloat(getComputedStyle(title.firstElementChild ?? title).paddingLeft || '0')) : -1;
    return [titleLeft, left(document.querySelector('[data-testid="auto-talk"] .auto-column > div')), left(document.querySelector('[data-testid="auto-thread"] form'))];
  });
  const queue = page.getByTestId('auto-queue');
  const entry = (id) => page.getByTestId(`auto-entry-${id}`);
  const entryIds = () => queue.locator('li[data-state]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-testid').replace('auto-entry-', '')));
  /** A button of an entry's row: the row is hovered first, as the buttons show on hover. */
  const act = async (id, name) => {
    await entry(id).hover();
    await entry(id).getByRole('button', { name, exact: true }).click();
  };
  const posts = (path) => service.requests.filter((request) => request.method === 'POST' && request.path === path).map((request) => request.body);
  /** The threads in the list proper, without what is put away behind the lines at its foot. */
  const listedIds = () => page.locator('[data-testid^="auto-group-"] [data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));
  const textOf = async (id) => ((await page.getByTestId(id).textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  /** One line of a row, by its test id: who it waits on, what for, when it was archived. */
  const lineOf = async (id, part) => ((await row(id).getByTestId(part).textContent().catch(() => '')) ?? '');
  /** A row's time slot, read whether or not the row's icons are over it. */
  const rowTime = async (id) => ((await row(id).locator('[data-auto-row] .tabular-nums').first().textContent().catch(() => '')) ?? '');
  /** The one quiet row at the foot of Threads, and the page it opens in the Auto tab. */
  const awayRow = page.getByTestId('auto-away-row');
  const awayPage = page.getByTestId('auto-away-page');
  const awayScroll = page.getByTestId('auto-away-scroll');
  const awaySays = () => textOf('auto-away-row');
  const listRowsPane = page.getByTestId('auto-list-rows');
  const archivedIds = () => page.getByTestId('auto-archived').locator('[data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));
  /** A row's own button on the Put away page. */
  const awayButton = (id) => row(id).locator('[data-away-row]');
  /** The buttons a row on the Put away page offers beside its own: their labels, or their words. */
  const awayButtons = (id) => row(id).getByRole('button').evaluateAll((buttons) => buttons.filter((button) => !button.hasAttribute('data-away-row')).map((button) => button.getAttribute('aria-label') ?? (button.textContent ?? '').trim()));
  /** Whether a row of the list or of the page holds the keyboard. */
  const keyboardOnRow = () => page.evaluate(() => !!document.activeElement?.hasAttribute('data-row-id'));
  /** The Put away page, opened from the sidebar's row if it is not showing, with one of its groups drawn. */
  const showLine = async (name) => {
    if ((await awayPage.count()) === 0) await awayRow.click();
    await awayPage.waitFor({ timeout: 10_000 });
    await page.getByTestId(`auto-${name}`).waitFor({ timeout: 10_000 });
  };
  /** Leaves the Put away page for an empty new thread, if the page shows. */
  const hideLine = async () => {
    if ((await awayPage.count()) === 1) await newThread.click();
    await until(async () => (await awayPage.count()) === 0);
  };
  const archivedReads = () => service.requests.filter((request) => request.method === 'GET' && request.path.startsWith('/api/threads?archived=1')).map((request) => request.path);
  /** A time as the lines say it, seen from today: the clock, "tomorrow" and the clock, a weekday, or a date. */
  const WHEN = '(?:tomorrow |[A-Z][a-z]{2} |[A-Z][a-z]{2} \\d{1,2} )?\\d{1,2}:\\d{2} [ap]m';
  /** The Auto tab in front: its pill if it is open, else the sidebar's New thread button opens it. */
  const toAuto = async () => {
    if ((await page.getByTestId('tab-auto').count()) === 1) await page.getByTestId('tab-auto').click();
    else await newThread.click();
    await auto.waitFor({ timeout: 10_000 });
  };
  /** The name the Auto tab's pill shows. */
  const tabName = async () => ((await page.getByTestId('tab-label-auto').textContent().catch(() => '')) ?? '').trim();
  async function setTheme(theme) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.evaluate((resolved) => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(resolved);
      root.style.colorScheme = resolved;
    }, theme);
    await wait(150);
  }
  /**
   * The state on screen now, in light and in dark, under its number. `hover` keeps the pointer where the state
   * needs it. `themes` is for a state too short-lived for both: it is made again for the other one.
   */
  async function shot(number, name, hover = null, themes = ['light', 'dark'], settle = !name.includes('undo')) {
    // The line from the step before, such as "archived", has gone first, unless it is what the picture is of
    // or the state will not last that long. An action stays on offer for half a minute.
    const asked = Date.now();
    if (settle) await until(async () => (await said.count()) === 0, 33_000);
    const waited = Math.round((Date.now() - asked) / 1000);
    for (const theme of themes) {
      await setTheme(theme);
      if (hover) await hover();
      else await page.mouse.move(WIDTH - 20, HEIGHT - 12);
      // Scrollbar thumbs fade about a second after the last scroll.
      await wait(1600);
      const file = `${side}-${theme}-${String(number).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      console.log(`SHOT ${file}${waited > 1 && theme === themes[0] ? ` (after ${waited} s for the line to go)` : ''}`);
    }
    await setTheme('light');
  }

  try {
    console.log(`root data-roomy: ${(await page.evaluate(() => document.documentElement.getAttribute('data-roomy'))) ?? '(none)'}`);

    // --- Connect to the stand-in.
    await connectRow.click();
    await page.getByTestId('auto-address-form').waitFor({ timeout: 15_000 });
    await page.getByRole('textbox', { name: 'Address' }).fill(service.url);
    await page.getByRole('textbox', { name: 'Address' }).press('Enter');
    await page.getByTestId('auto-list').waitFor({ timeout: 15_000 });
    check('the list is read', await until(async () => (await rowIds()).length === 7));

    // --- Sub-agents: a mode picked in the box, a turn that fans out to two agents, each a thread under its parent,
    // opened from the step that started it, with a ring while it works, stopped from its own header, and the way back.
    await newThread.click();
    await box.waitFor({ timeout: 10_000 });
    const modeButton = () => page.locator('[data-testid="auto-thread"] [data-testid="auto-mode"]');
    const agentsButton = () => page.locator('[data-testid="auto-thread"] [data-testid="auto-agents"]');
    check('a new thread offers the mode in the box’s foot, Solo by default, with no agents picker', await until(async () => (await modeButton().count()) === 1) && ((await modeButton().textContent()) ?? '').trim() === 'Solo' && (await agentsButton().count()) === 0, (await modeButton().textContent()) ?? '');
    await modeButton().click();
    await page.getByRole('menuitemradio', { name: 'Orchestrate' }).click();
    check('Orchestrate brings the agents picker beside it, on Any model', await until(async () => (await agentsButton().count()) === 1 && ((await agentsButton().textContent()) ?? '').trim() === 'Agents: Any model'), (await agentsButton().textContent()) ?? '');
    await agentsButton().click();
    await page.getByRole('menuitemradio', { name: 'Small' }).click();
    check('the agents’ model is picked', await until(async () => ((await agentsButton().textContent()) ?? '').trim() === 'Agents: Small'));
    await shot(100, 'agents-mode-picked');
    service.hold('agents-started');
    service.hold('agent-hold');   // the second agent keeps searching until the run lets it go
    await say('Fan out the research on the beds');
    const parentId = await (async () => { await until(() => service.entries().some((thread) => thread.title.startsWith('Fan out'))); return service.entries().find((thread) => thread.title.startsWith('Fan out'))?.id; })();
    check('the new thread starts in Orchestrate with Small for its agents', !!parentId && JSON.stringify(posts('/api/threads').at(-1)).includes('"mode":"orchestrate","agentsModel":"small"') && service.thread(parentId)?.mode === 'orchestrate', JSON.stringify(posts('/api/threads').at(-1)));
    const children = () => service.entries().filter((thread) => thread.parent === parentId);
    check('the turn starts two agents, each a thread under the parent on its own model', await until(() => children().length === 2) && children().map((thread) => `${thread.title}/${thread.model}`).sort().join() === 'Frost dates/large,Soil types/small', children().map((thread) => thread.title).join());
    const soilId = children().find((thread) => thread.title === 'Soil types')?.id;
    const frostId = children().find((thread) => thread.title === 'Frost dates')?.id;
    check('the sidebar nests both under the parent, one step in, the parent first', await until(async () => { const ids = await listedIds(); const under = [ids[ids.indexOf(parentId) + 1], ids[ids.indexOf(parentId) + 2]].sort().join(); return under === [soilId, frostId].sort().join(); }) && (await row(soilId).getAttribute('data-nested')) === 'true' && (await row(parentId).getAttribute('data-nested')) === null, (await listedIds()).join());
    check('a ring turns on the parent and on each agent while they work', await until(async () => (await row(parentId).getByTestId(`auto-row-working-${parentId}`).count()) === 1 && (await row(frostId).getByTestId(`auto-row-working-${frostId}`).count()) === 1));
    // Two steps fold to one line, "Started 2 agents", which opens to a line per agent.
    const stepsFold = page.locator('[data-testid="auto-thread"] [data-testid="auto-steps"] button[aria-expanded]');
    check('the parent’s steps fold to one line that says it started two agents', await until(async () => (await stepsFold.count()) === 1 && ((await stepsFold.textContent()) ?? '').trim() === 'Started 2 agents'), (await stepsFold.textContent().catch(() => '')) ?? '');
    await stepsFold.click();
    check('open, it shows a step line per agent that reads as a sentence', await until(async () => (await page.getByTestId('auto-step-agent').count()) === 2) && (await page.getByTestId('auto-step-agent').allTextContents()).join('|') === 'Started Soil types on Small|Started Frost dates on Large', (await page.getByTestId('auto-step-agent').allTextContents()).join('|'));
    await shot(101, 'agents-working');
    service.release('agents-started');
    check('the parent waits for the first agent, says so on its row, and answers once it is done', await until(async () => (await textOf(`auto-row-${parentId}`)).includes('Waiting for agent Soil types') || service.thread(parentId)?.status === 'idle') && await until(() => service.thread(parentId)?.status === 'idle' && service.thread(soilId)?.status === 'idle', 15_000) && (service.thread(parentId)?.last ?? '').startsWith('Two agents are working'), service.thread(parentId)?.last);
    check('a finished agent is never unread for him: its parent read it', service.thread(soilId)?.unread === false && (await row(soilId).locator('[aria-label="Unread"]').count()) === 0);
    // The turn's end draws the steps folded again.
    if ((await stepsFold.getAttribute('aria-expanded')) !== 'true') await stepsFold.click();
    await page.getByTestId('auto-step-agent').first().click();
    check('the step that started an agent opens that agent’s thread, with the way back in its header', await until(async () => (await textOf('auto-title')) === 'Soil types') && (await textOf('auto-parent-link')) === 'Agent of Fan out the research on the beds', await textOf('auto-title'));
    check('the agent’s thread holds its brief and its reply', ((await talk.textContent()) ?? '').includes('Read the soil notes for each bed') && ((await talk.textContent()) ?? '').includes('Lime bed 1 in the autumn.'));
    await shot(102, 'agent-thread');
    await page.getByTestId('auto-parent-link').click();
    check('Agent of leads back to the parent', await until(async () => (await textOf('auto-title')) === 'Fan out the research on the beds'));
    // The second agent is still searching: it is stopped from its own thread, as any thread is.
    await row(frostId).locator('[data-auto-row]').click();
    await page.getByTestId('auto-stop').waitFor({ timeout: 10_000 });
    await page.getByTestId('auto-stop').click();
    check('an agent is stopped from its own thread, and its ring goes', await until(() => service.thread(frostId)?.status === 'stopped') && await until(async () => (await row(frostId).getByTestId(`auto-row-working-${frostId}`).count()) === 0));
    service.release('agent-hold');
    check('a child never drags on its own, while its parent still does', (await row(frostId).getAttribute('draggable')) === null && (await row(parentId).getAttribute('draggable')) === 'true');
    await fromMenu(parentId, 'Archive');
    check('archiving the parent takes its agents with it', await until(async () => !(await listedIds()).includes(parentId) && !(await listedIds()).includes(soilId) && !(await listedIds()).includes(frostId)), (await listedIds()).join());
    await said.getByRole('button', { name: 'Undo' }).click();
    check('and Undo brings the family back, nested as before', await until(async () => { const ids = await listedIds(); const under = [ids[ids.indexOf(parentId) + 1], ids[ids.indexOf(parentId) + 2]].sort().join(); return ids.includes(parentId) && under === [soilId, frostId].sort().join(); }), (await listedIds()).join());
    await shot(103, 'agents-done');


    check('no request marked a message as a send', !service.requests.some((request) => JSON.stringify(request.body ?? {}).includes('sends')));
    check('every write named the client and carried no Origin', service.requests.filter((request) => request.method === 'POST' && request.headers['x-auto-client'] !== 'phone').every((request) => request.headers['x-auto-client'] === 'opal' && request.headers.origin === undefined && request.headers['content-type'] === 'application/json'));
  } catch (error) {
    check('the run finished', false, String(error).split('\n')[0]);
    await page.screenshot({ path: path.join(outDir, `${side}-failure.png`) }).catch(() => undefined);
  } finally {
    clearTimeout(watchdog);
    await app.close().catch(() => undefined);
    await service.close();
    await emptyService.close();
    await bareService.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vaultParent, { recursive: true, force: true });
  }
}

for (side of SIDES) await tour();

const failed = results.filter((result) => !result.ok);
console.log(`${failed.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length} of ${results.length} checks in ${Math.round((Date.now() - began) / 60_000)} min; screenshots in ${outDir}${errors.length > 0 ? `; page errors: ${errors.join(' | ')}` : ''}`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
