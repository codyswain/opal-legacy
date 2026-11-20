// Disposable Electron acceptance for the Auto tab, against the stand-in
// service in src/tests/fixtures/auto (made-up threads, on 127.0.0.1 only).
// It never contacts any other host and starts no agent.
//
// One run per look (version A and B of the roomy variant), each with its own
// stand-in, temp profile and temp vault: the sidebar (Daily, Threads and
// Library, no Recent row), the address form from Connect Auto…, can't reach
// with Retry, the list in Threads, a thread opening with its history, a vault link opening a
// page, the thread picked in the sidebar with that page in front, the tab's
// name, a follow-up clicked, a reply streaming in with steps above it, a
// message queued and Stop, a question answered, a permission allowed, a
// waiting row with no answer buttons, snooze and back, a drag to reorder,
// archive, a new thread, a digest entry handed to Auto, a failed post, a
// send waiting on the phone, signed out, a narrow window, the sidebar hidden
// with the clearing loop and Cmd+Z, the headings folded and kept across a
// reload, and the empty list. Then the mark for the Mac (set from a row's menu, ended by a reply
// from another client, taken off) and the digest as a queue: resolve one
// with Undo, resolve all in a section, a thread that waits, a note written
// and removed, a drafted reply copied, words that start a thread, All, a
// change made on another device, an earlier day, and the three empty
// states. Then what makes it a tab to work in: the open thread's own
// actions with Undo at the foot of the sidebar, the box as the answer field,
// his place kept across threads and tabs, a thread opened out of reach that
// loads by itself, a slow network, the sidebar's count with no Auto tab
// open, a pass with the keyboard alone, and the page laid out at 1700 x
// 1000 with the right sidebar shown and hidden. Then what is his: a send he
// is asked to allow, refused from its card and with typed words; a "Your
// move" row; an unread thread lifted under the questions; three archives taken back one by one
// with Cmd+Z while their posts are still on the way; Cmd+Z from an empty
// box; the last entry of the queue opened and in view; and a long message
// typed at the end of a thread. Then what is put away: the one Put away
// row at the foot of Threads and its page in the Auto tab, the archive read
// when the page opens and a thread brought back from it four ways, a thread waiting on a reply (what was
// heard, the reply, "Until a reply" from the snooze menu, nobody replying),
// the digest archived from its queue and its own row and brought back, a click on a row's icon that leaves the caret in a page, pinned pages shown in full, how long a thread has been
// working, words before a digest thread, what Undo leaves behind, words
// begun before a card arrived, the queue's own keys, and a new day's digest
// that no event announced, read when the window comes back to the front. Then the
// plan usage ring in each box and its popover. Then links to pages in a
// reply, with the vault a checkout of a temp bare remote and a second clone
// that pushes: a page only the remote has opens after one fast-forward, a
// turn's end brings the next page before any click, a page no remote has
// says so at the link, a local change in another file stays, and a long path
// shows as a name inside the column. Then sub-agents: the mode picked in
// the box, a turn that fans out to two agents as threads under their parent,
// each opened from its step line and stopped from its own header, the ring
// while they work, and the family archived and brought back together. Saves light and
// dark screenshots of each at 1500 x 933 for people to look at; nothing
// compares them. Run from the repository root after the Vite bundles are built (see
// README.md here):
//
//   node e2e/acceptance/auto-acceptance.mjs [--out dir] [--sides a,b]
//
// Files are named <side>-<theme>-<nn>-<state>.png. The window never takes
// the keyboard: it hides once shown and shows again without being made
// active.
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
const outDir = path.resolve(flag('out', path.join('e2e', 'out', 'auto')));
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

    // --- The sidebar: Daily, Threads and Library, with no Recent or Auto row.
    const sidebar = page.getByTestId('workspace-sidebar');
    check('the Recent and Auto rows are gone from the sidebar', (await sidebar.getByRole('button', { name: /^Recent/ }).count()) === 0 && (await sidebar.getByRole('button', { name: /^Auto/ }).count()) === 0 && (await sidebar.getByRole('button', { name: /^Daily/ }).count()) === 1);
    check('Threads sits above Library', await page.evaluate(() => {
      const top = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? -1;
      return top('sidebar-threads') >= 0 && top('sidebar-library') > top('sidebar-threads');
    }));
    // --- With no address, Threads offers Connect Auto…, which opens one tab with the address form.
    await connectRow.click();
    await page.getByTestId('auto-address-form').waitFor({ timeout: 15_000 });
    check('Connect Auto… opens a tab with the address form', (await page.getByTestId('tab-auto').count()) === 1);
    const address = page.getByRole('textbox', { name: 'Address' });
    await address.fill('http://host.example/agent');
    await address.press('Enter');
    check('an http address that is not on this Mac is refused', await until(async () => ((await page.getByRole('alert').first().textContent().catch(() => '')) ?? '').includes('https://')));
    await address.fill(service.url);
    await shot(1, 'address-form');

    // --- Can't reach, with Retry.
    service.down();
    await address.press('Enter');
    await page.getByTestId('auto-unreachable').waitFor({ timeout: 15_000 });
    check("an address that does not answer says it can't be reached", ((await page.getByTestId('auto-unreachable').textContent()) ?? '').includes("Can't reach Auto."));
    const stored = JSON.parse(await readFile(path.join(userData, 'auto.json'), 'utf8'));
    check('the address is kept in auto.json in the profile', stored.version === 1 && stored.url === service.url, JSON.stringify(stored));
    await shot(2, 'cant-reach');
    service.down(false);
    check('out of reach it is said once: with the Auto tab in front, by the tab, with Retry, and not again in Threads', (await page.getByTestId('auto-out-of-reach').count()) === 0 && (await auto.getByRole('button', { name: 'Retry' }).count()) === 1);
    await auto.getByRole('button', { name: 'Retry' }).click();
    await page.getByTestId('auto-list').waitFor({ timeout: 15_000 });
    check('Retry reads the list once the service answers', await until(async () => (await rowIds()).length === 7));

    // --- The list.
    const first = await rowIds();
    check('threads that wait on him come first, then what is new to him, then the rest in the service’s order', first.join() === [BEDS, SEEDS, TRELLIS, BREAD, COMPOST, INSPECTION, BARREL].join(), first.join());
    check('an unread thread and one back from snooze are lifted under the questions', (await groupIds('needs')).join() === BEDS && (await groupIds('fresh')).join() === [SEEDS, TRELLIS].join() && (await groupIds('rest'))[0] === BREAD);
    check('no line of counts: the Threads heading carries the one count', (await page.getByTestId('auto-summary').count()) === 0 && (await headingCount()) === '3', await headingCount());
    check('a row with nothing for him is one line', (await row(BREAD).locator('[data-auto-row] > span').count()) === 1, String(await row(BREAD).locator('[data-auto-row] > span').count()));
    check('a row that needs him has a second line', (await row(BEDS).locator('[data-auto-row] > span').count()) === 2 && (await row(INSPECTION).locator('[data-auto-row] > span').count()) === 2);
    check('a thread nobody has started says Not started', ((await row(INSPECTION).getByTestId('auto-not-started').textContent().catch(() => '')) ?? '') === 'Not started');
    // The icons that show on hover have their room kept, so the title is cut at the same place either way.
    const titleWidth = () => row(BREAD).locator('[data-auto-row] .truncate').first().evaluate((element) => Math.round(element.getBoundingClientRect().width * 10) / 10);
    const widthAtRest = await titleWidth();
    await row(BREAD).hover();
    await wait(150);
    check('hovering a row leaves its title as wide as it was', (await titleWidth()) === widthAtRest && (await row(BREAD).evaluate((element) => {
      const title = element.querySelector('[data-auto-row] .truncate')?.getBoundingClientRect();
      const icons = [...element.querySelectorAll('button[data-testid^="auto-snooze-"], button[data-testid^="auto-archive-"]')].map((button) => button.getBoundingClientRect());
      const line = element.querySelector('.auto-row-line');
      // The icons sit at the row's end, over the time or the end of the title, which fades out under them.
      return !!title && !!line && icons.length === 2 && getComputedStyle(line).maskImage.includes('gradient');
    })), `${widthAtRest} -> ${await titleWidth()}`);
    check('a row with no time gives its title the room: the time’s slot is no wider than the time', await row(INSPECTION).evaluate((element) => {
      const slot = element.querySelector('[data-auto-row] .tabular-nums');
      return !!slot && slot.getBoundingClientRect().width < 1;
    }));
    await page.mouse.move(WIDTH - 20, HEIGHT - 12);
    await shot(43, 'list-his');
    check('a waiting row shows its question, with no answer buttons', (await row(BEDS).getByRole('button', { name: 'Cedar' }).count()) === 0 && ((await row(BEDS).textContent()) ?? '').includes('Which wood for the frames?'));
    check('an unread row has a dot', (await row(SEEDS).getByRole('img', { name: 'Unread' }).count()) === 1);
    check('a thread back from snooze says Back and when', /Back \d/.test((await row(TRELLIS).textContent()) ?? ''));
    check('a failed row says so', ((await row(COMPOST).textContent()) ?? '').includes('Failed: The turn ended early'));
    check('what is put away is one quiet row, Put away, at the foot of Threads and outside its scrolling part, counting what is snoozed or waiting and never the archive', (await awaySays()) === 'Put away3' && await page.evaluate(() => {
      const away = document.querySelector('[data-testid="auto-away-row"]');
      const rows = document.querySelector('[data-testid="auto-list-rows"]');
      const threads = document.querySelector('[data-testid="sidebar-threads"]')?.getBoundingClientRect();
      if (!away || !rows || !threads || rows.contains(away)) return false;
      const box = away.getBoundingClientRect();
      return box.top >= rows.getBoundingClientRect().bottom - 1 && box.bottom <= threads.bottom + 1;
    }), await awaySays());
    check('no put-away rows sit in the sidebar, and nothing of the archive has been read', (await page.locator('[data-testid="workspace-sidebar"] :is([data-testid="auto-waiting"], [data-testid="auto-snoozed"], [data-testid="auto-archived"], [data-testid$="-line"][data-testid^="auto-"])').count()) === 0 && archivedReads().length === 0);
    await row(BREAD).locator('[data-auto-row]').focus();
    await key('End');
    check('the Put away row is the last stop of the list’s arrow keys', (await focused()) === ':away', await focused());
    await key('ArrowUp');
    check('and Up from it goes back into the list', (await rowIds()).includes(await focused()), await focused());
    await page.evaluate(() => document.activeElement?.blur());
    check('the Threads heading counts the threads that wait on him, the ones with an unread reply and the ones back from snooze', (await sidebarSays(needsHim())) && needsHim() === 3, await headingCount());

    // --- The mark for the Mac: set from a row's menu, first under its own heading, ended by the service.
    const marked = page.getByTestId('auto-group-desk');
    await fromMenu(BEDS, 'Mark for the Mac');
    check('a marked thread is first, under "For the Mac", and still shows its question', await until(async () => (await rowIds())[0] === BEDS && (await marked.getByRole('heading', { name: 'For the Mac' }).count()) === 1 && ((await marked.textContent()) ?? '').includes('Which wood for the frames?')));
    check('the service has the mark, set by Opal', service.thread(BEDS)?.desk?.by === 'opal' && posts(`/api/threads/${BEDS}/desk`).at(-1)?.on === true);
    check('a marked thread that waits still counts in the sidebar', (await sidebarSays(needsHim())) && needsHim() === 3, await headingCount());
    await fromMenu(TRELLIS, 'Mark for the Mac');
    await until(async () => (await marked.locator('[data-thread-id]').count()) === 2);
    check('both marked rows are under the heading', (await marked.locator('[data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')))).sort().join() === [BEDS, TRELLIS].sort().join());
    await shot(19, 'for-the-mac');
    await fromPhone(`/api/threads/${TRELLIS}/messages`, { text: 'Picked up on the phone', cid: 'p1' });
    check('a reply from another device ends the mark', await until(async () => service.thread(TRELLIS)?.desk === null && (await marked.locator('[data-thread-id]').count()) === 1));
    await atRest(TRELLIS);
    await fromMenu(BEDS, 'Take off the Mac mark');
    check('taking the mark off puts the thread back with the others', await until(async () => (await marked.count()) === 0 && service.thread(BEDS)?.desk === null && (await rowIds())[0] === BEDS));

    // --- A thread opens with its history; replies are Markdown, never HTML.
    await row(BREAD).click();
    await talk.locator('table').waitFor({ timeout: 10_000 });
    check('a thread opens with its history: a table, a list and code', (await talk.locator('table tbody tr').count()) === 5 && (await talk.locator('ol > li').count()) === 3 && (await talk.locator('.auto-md-block[data-language="python"]').count()) === 1);
    const firstSteps = talk.getByTestId('auto-steps').first();
    check('what Auto did is one line, and plumbing steps are left out', ((await firstSteps.textContent()) ?? '') === 'Read 1 file, 1 more step');
    await firstSteps.getByRole('button').first().click();
    check('the line opens to every step', await until(async () => ((await firstSteps.textContent()) ?? '').includes('Work the times back from 7 pm') && (await firstSteps.locator('.truncate').count()) === 3));
    await firstSteps.getByRole('button').first().click();
    check('the header, the thread and the box are one column', (await oneColumn('auto-thread')) && new Set(await threadEdges()).size === 1, (await threadEdges()).join());
    check('the open thread has its own actions in the header', (await page.getByTestId('auto-snooze-open').count()) === 1 && (await page.getByTestId('auto-archive-open').count()) === 1 && (await page.getByTestId('auto-thread-menu').count()) === 1);
    check('the follow-ups show under the last reply', (await page.getByTestId('auto-next').getByRole('button').allTextContents()).join('|') === 'Scale it to two loaves|Put the times in today’s page');
    // The Claude app's proportions (spec 2026-11-15): measured from the page, not by eye.
    const look = await page.evaluate(() => {
      const thread = document.querySelector('[data-testid="auto-thread"]');
      const md = thread.querySelector('.auto-md');
      const css = getComputedStyle(md);
      const column = md.getBoundingClientRect().left;
      const ol = thread.querySelector('.auto-md > ol');
      const item = ol.querySelector(':scope > li');
      const nested = ol.querySelector('ul');
      const dot = getComputedStyle(nested.querySelector(':scope > li'), '::before');
      const ps = [...md.querySelectorAll(':scope > p')];
      const gap = (a, b) => Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);
      const items = [...ol.querySelectorAll(':scope > li')];
      const form = thread.querySelector('form');
      const foot = form.querySelector('[data-testid="auto-box-row"]');
      const field = form.querySelector('[data-testid="auto-box"]');
      const header = thread.querySelector('header');
      const hs = getComputedStyle(header);
      return {
        size: css.fontSize, line: css.lineHeight, ink: css.color,
        textIndent: Math.round(item.getBoundingClientRect().left - column),
        bulletIndent: Math.round(nested.getBoundingClientRect().left + parseFloat(dot.left) + parseFloat(getComputedStyle(nested).paddingLeft) - nested.getBoundingClientRect().left),
        nestedText: Math.round(nested.querySelector(':scope > li').getBoundingClientRect().left - nested.getBoundingClientRect().left),
        paragraphGap: ps.length > 1 ? parseFloat(getComputedStyle(ps[1]).marginTop) : null, itemGap: gap(items[0], items[1]),
        radius: getComputedStyle(form).borderTopLeftRadius, shadow: getComputedStyle(form).boxShadow !== 'none',
        footAfterField: !!(field.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING) && foot.getBoundingClientRect().top >= field.getBoundingClientRect().bottom,
        footHolds: [...foot.querySelectorAll('button')].map((button) => button.getAttribute('data-testid')).join(','),
        modelLeft: foot.querySelector('[data-testid="auto-model"]').getBoundingClientRect().left - form.getBoundingClientRect().left < 20,
        sendRight: form.getBoundingClientRect().right - foot.querySelector('[data-testid="auto-send"]').getBoundingClientRect().right < 20,
        boxWidth: Math.round(form.getBoundingClientRect().width), columnWidth: Math.round(md.getBoundingClientRect().width),
        hairline: hs.borderBottomWidth === '1px' && hs.borderBottomColor !== 'rgba(0, 0, 0, 0)' && Math.round(header.getBoundingClientRect().width) === Math.round(thread.getBoundingClientRect().width),
        modelInHeader: header.querySelector('[data-testid="auto-model"]') !== null,
        // One-line thread rows, top to top.
        rowPitch: (() => {
          const tops = [...document.querySelectorAll('[data-thread-id] [data-auto-row]')].filter((button) => button.children.length === 1 || !button.children[1]?.textContent).map((button) => button.getBoundingClientRect());
          for (let at = 1; at < tops.length; at += 1) if (Math.abs(tops[at].top - tops[at - 1].bottom) < 8) return Math.round(tops[at].top - tops[at - 1].top);
          return null;
        })(),
      };
    });
    check('a reply is 14 px on a 21 px line', look.size === '14px' && look.line === '21px', `${look.size}/${look.line}`);
    check('a numbered item’s text starts 34 px in', look.textIndent === 34, String(look.textIndent));
    check('a bullet is 13 px in and its text 34 px in', look.bulletIndent === 13 && look.nestedText === 34, `${look.bulletIndent}/${look.nestedText}`);
    check('one list item follows the last by 4 px, a paragraph by 11 px', look.itemGap === 4 && Math.round(look.paragraphGap) === 11, `${look.itemGap}/${look.paragraphGap}`);
    check(`one-line thread rows sit ${side === 'b' ? 32 : 30} px apart`, look.rowPitch === (side === 'b' ? 32 : 30), String(look.rowPitch));
    check('the box has 16 px corners, a shadow, and is as wide as the text', look.radius === '16px' && look.shadow && Math.abs(look.boxWidth - look.columnWidth) <= 1, `${look.radius} ${look.boxWidth}/${look.columnWidth}`);
    check('the box’s controls sit on a row at its foot: the model at the left, then the mode, the usage ring beside them, Send at the right', look.footAfterField && look.footHolds === 'auto-model,auto-mode,auto-usage-ring,auto-send' && look.modelLeft && look.sendRight && !look.modelInHeader, look.footHolds);
    check('a hairline runs under the header, the width of the pane', look.hairline);
    check('the title’s words end in a chevron that opens the thread’s menu', (await page.getByTestId('auto-thread-menu').locator('[data-testid="auto-title-chevron"]').count()) === 1 && (await textOf('auto-title')) === 'Sourdough timings');
    await talk.evaluate((element) => { element.scrollTop = 0; });
    await shot(3, 'thread-long-reply');
    await talk.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await shot(4, 'follow-ups');

    // --- A vault file named in a reply opens as a page, in its own tab.
    await talk.locator('[data-vault-path="Recipes/Bread.md"]').first().click();
    const breadTab = page.getByTestId(`tab-${path.join(vault, 'Recipes/Bread.md')}`);
    check('a vault link in a reply opens the page in Opal', await until(async () => (await breadTab.count()) === 1 && (await breadTab.getAttribute('aria-selected')) === 'true'));
    // A click on a row's icon leaves the keyboard where it was: the caret stays in the page, and words typed go there.
    const pageText = page.locator('.cm-content:visible').first();
    await pageText.waitFor({ timeout: 10_000 });
    await pageText.click();
    await key('Meta+ArrowDown');
    const archivedBefore = service.entries().filter((thread) => !thread.archived).map((thread) => thread.id);
    await row(BARREL).hover();
    await page.getByTestId(`auto-archive-${BARREL}`).click();
    await until(() => service.thread(BARREL)?.archived === true);
    await page.keyboard.type(' me too');
    check('after a click on a row’s Archive icon the caret is still in the page: the words typed after it go there and act on no thread', await until(async () => ((await pageText.textContent()) ?? '').includes('me too')) && (await page.evaluate(() => !!document.activeElement?.closest('.cm-content'))) && archivedBefore.filter((id) => service.thread(id)?.archived).join() === BARREL && service.entries().every((thread) => !thread.desk), `${await focused()} | ${archivedBefore.filter((id) => service.thread(id)?.archived).join()} archived`);
    for (let at = 0; at < ' me too'.length; at += 1) await key('Backspace');
    await said.getByRole('button', { name: 'Undo' }).click();
    await until(() => service.thread(BARREL)?.archived === false);
    // With the page in front, a thread picked in the sidebar shows in the one Auto tab, and the page keeps its tab.
    check('with the page in front no thread row is marked as open', (await row(BREAD).locator('[data-auto-row]').getAttribute('aria-current')) === null);
    await row(BREAD).locator('[data-auto-row]').click();
    await talk.waitFor({ timeout: 10_000 });
    check('a thread picked in the sidebar with a page in front goes to the one Auto tab and keeps the page', (await page.getByTestId('tab-auto').count()) === 1 && (await page.getByTestId('tab-auto').getAttribute('aria-selected')) === 'true' && (await breadTab.count()) === 1 && (await page.getByTestId('auto-thread').count()) === 1);
    check('the open thread’s row is marked', (await row(BREAD).locator('[data-auto-row]').getAttribute('aria-current')) === 'true');
    check('the Auto tab is named after the thread it shows', (await tabName()) === 'Sourdough timings', await tabName());

    // --- A follow-up, clicked, is sent as his message, and the reply streams in.
    await page.getByTestId('auto-next').getByRole('button', { name: 'Scale it to two loaves' }).click();
    check('a click on a follow-up sends it', await until(() => service.requests.some((request) => request.path === `/api/threads/${BREAD}/messages` && request.body?.text === 'Scale it to two loaves')));
    check('the reply streams in', await until(async () => ((await talk.textContent()) ?? '').includes('Beans and peas go in bed 2')));
    await atRest(BREAD);
    const turns = await talk.evaluate((element) => {
      const rows = [...element.querySelectorAll('[data-row]')];
      const his = rows.filter((row) => row.querySelector('[data-testid="auto-message"]'));
      const second = his[1];
      const before = rows[rows.indexOf(second) - 1];
      const after = rows[rows.indexOf(second) + 1];
      return { turn: Math.round(second.getBoundingClientRect().top - before.getBoundingClientRect().bottom), within: Math.round(after.getBoundingClientRect().top - second.getBoundingClientRect().bottom) };
    });
    check('the next turn starts 32 px below the last reply, and his message sits 16 px above what follows it', turns.turn === 32 && turns.within === 16, JSON.stringify(turns));

    // --- A reply streaming with its steps above it; a message sent meanwhile waits; Stop.
    service.hold('stream');
    await say('Sort the seed list slowly, by sowing month');
    check('a reply shows while it streams, with the steps above it', await until(async () => ((await talk.textContent()) ?? '').includes('Here is the list by month')));
    const steps = talk.getByTestId('auto-steps').last();
    check('while a turn runs its steps are one line too', ((await steps.getByRole('button').first().textContent()) ?? '') === 'Read 1 file, searched, searched the web, 2 more steps', (await steps.textContent()) ?? '');
    check('Stop sits beside the send button, not in the header', (await page.locator('[data-testid="auto-thread"] form [data-testid="auto-stop"]').count()) === 1 && (await page.locator('[data-testid="auto-thread"] header [data-testid="auto-stop"]').count()) === 0);
    check('Stop shows while a turn runs', (await page.getByTestId('auto-stop').count()) === 1);
    await shot(5, 'streaming');
    // How long it has been working, in the row's time slot, in the phone's words.
    check('a thread that has just begun to work says "now" where its time was', await until(async () => (await rowTime(BREAD)) === 'now', 3_000), await rowTime(BREAD));
    service.age(BREAD, 12 * 60 + 40);
    check('twelve minutes in it says "12 min"', await until(async () => (await rowTime(BREAD)) === '12 min', 3_000), await rowTime(BREAD));
    service.age(BREAD, 53 * 60);
    check('past the hour it says the hours and the minutes left over: "1 h 5 min"', await until(async () => (await rowTime(BREAD)) === '1 h 5 min', 3_000), await rowTime(BREAD));
    check('the time sits in the row’s time slot, on the title’s line, in the quiet colour', await row(BREAD).evaluate((element) => {
      const time = element.querySelector('[data-auto-row] .tabular-nums');
      const title = element.querySelector('[data-auto-row] .truncate');
      if (!time || !title) return false;
      const [slot, words] = [time.getBoundingClientRect(), title.getBoundingClientRect()];
      return slot.left >= words.right - 1 && Math.abs(slot.top + slot.height / 2 - (words.top + words.height / 2)) < 4 && time.scrollWidth <= time.clientWidth + 1;
    }));
    await shot(67, 'working-time');
    await box.fill('And add the sowing depths');
    await box.press('Enter');
    check('a message sent while a turn runs waits above the box', await until(async () => ((await page.getByTestId('auto-queue').textContent().catch(() => '')) ?? '').includes('And add the sowing depths')));
    await shot(6, 'queued-stop');
    await page.getByTestId('auto-stop').click();
    check('Stop ends the turn', await until(async () => (await page.getByTestId('auto-stop').count()) === 0 && ((await talk.textContent()) ?? '').includes('Stopped')));
    check('the queued message returns to the box', await until(async () => (await box.inputValue()) === 'And add the sowing depths'));
    service.release('stream');
    await box.fill('');

    // --- A question, answered.
    await say('Which bed gets the tomatoes?');
    await page.getByTestId('auto-question').waitFor({ timeout: 10_000 });
    const card = page.getByTestId('auto-question');
    check('a question is a card: its first sentence, the rest and the options, with no field of its own', ((await card.locator('p').first().textContent()) ?? '') === 'Which bed gets the tomatoes this year?' && (await card.getByRole('button', { name: /Bed 4/ }).count()) === 1 && (await card.getByRole('textbox').count()) === 0);
    check('while a question waits the box is the answer field', (await box.getAttribute('placeholder')) === 'Your answer' && (await focused()) === 'auto-box');
    check('no option is filled in', await card.evaluate((element) => {
      const options = [...element.querySelectorAll('button')];
      const page = getComputedStyle(element).backgroundColor;
      return options.length === 2 && options.every((option) => getComputedStyle(option).backgroundColor === getComputedStyle(options[0]).backgroundColor && getComputedStyle(option).backgroundColor !== 'rgb(0, 0, 0)') && page !== 'rgb(0, 0, 0)';
    }));
    // From the box a digit is typed, so the numbers beside the options show only while the card has the keyboard.
    const optionKeys = () => card.getByTestId('auto-option-key').evaluateAll((keys) => keys.map((element) => `${element.textContent}:${getComputedStyle(element).visibility}`).join());
    check('the options’ numbers are hidden while the caret is in the box', (await optionKeys()) === '1:hidden,2:hidden', await optionKeys());
    await shot(7, 'question');
    await card.getByRole('button', { name: /Bed 3/ }).focus();
    check('and show once the card has the keyboard, which is when a number picks', await until(async () => (await optionKeys()) === '1:visible,2:visible'), await optionKeys());
    await shot(72, 'question-keys', () => card.getByRole('button', { name: /Bed 3/ }).focus());
    await box.focus();
    await box.fill('Bed 2, by the wall');
    await box.press('Enter');
    check('words typed in the box answer the question, and are not queued behind it', await until(async () => ((await talk.textContent()) ?? '').includes('Tomatoes go in Bed 2, by the wall')) && posts(`/api/threads/${BREAD}/answer`).at(-1)?.answers?.[Object.keys(posts(`/api/threads/${BREAD}/answer`).at(-1)?.answers ?? {})[0]] === 'Bed 2, by the wall' && !posts(`/api/threads/${BREAD}/messages`).some((body) => body.text === 'Bed 2, by the wall'));
    await atRest(BREAD);
    check('the box is a message box again', (await box.getAttribute('placeholder')) === 'Message Auto' && (await box.inputValue()) === '');
    // Keys 1 to 3 pick an option while the keyboard is in the card; in the box a number is typed.
    await say('Which bed gets the tomatoes, again?');
    await card.waitFor({ timeout: 10_000 });
    await key('2');
    check('a number typed in the box is a number, not a pick', (await box.inputValue()) === '2' && posts(`/api/threads/${BREAD}/answer`).length === 1);
    await box.fill('');
    await card.getByRole('button', { name: /Bed 3/ }).focus();
    await key('3');
    await key('2');
    check('2 picks the second option of the open card, and the keyboard goes back to the box', await until(async () => ((await talk.textContent()) ?? '').includes('Tomatoes go in Bed 4')) && (await focused()) === 'auto-box' && Object.values(posts(`/api/threads/${BREAD}/answer`).at(-1)?.answers ?? {})[0] === 'Bed 4');
    await atRest(BREAD);

    // --- Words begun before a card arrived stay a message.
    await box.click();
    await box.fill('Also add the oven temperature to the');
    await fromPhone(`/api/threads/${BREAD}/messages`, { text: 'Which bed, asked from the phone?', cid: 'p8' });
    await card.waitFor({ timeout: 10_000 });
    check('a question that arrives while he is typing leaves the box a message box, with his words in it', (await box.getAttribute('placeholder')) === 'Message Auto' && (await box.inputValue()) === 'Also add the oven temperature to the', (await box.getAttribute('placeholder')) ?? '');
    await shot(69, 'words-before-card');
    const answersSoFar = posts(`/api/threads/${BREAD}/answer`).length;
    await box.pressSequentially(' note');
    await box.press('Enter');
    check('Enter sends those words as a message, which waits behind the turn, and answers nothing', await until(async () => posts(`/api/threads/${BREAD}/messages`).some((body) => body.text === 'Also add the oven temperature to the note') && ((await page.getByTestId('auto-queue').textContent().catch(() => '')) ?? '').includes('Also add the oven temperature to the note')) && posts(`/api/threads/${BREAD}/answer`).length === answersSoFar && service.thread(BREAD)?.status === 'waiting');
    check('emptied once, the box is the card’s answer field', await until(async () => (await box.inputValue()) === '' && (await box.getAttribute('placeholder')) === 'Your answer'), (await box.getAttribute('placeholder')) ?? '');
    await box.fill('Bed 1, by the gate');
    await box.press('Enter');
    check('words typed into the empty box answer the card, as before', await until(() => posts(`/api/threads/${BREAD}/answer`).length === answersSoFar + 1 && Object.values(posts(`/api/threads/${BREAD}/answer`).at(-1)?.answers ?? {})[0] === 'Bed 1, by the gate') && !posts(`/api/threads/${BREAD}/messages`).some((body) => body.text === 'Bed 1, by the gate'));
    check('the message he began first gets its own turn after the answer', await until(async () => {
      const messages = await talk.getByTestId('auto-message').allTextContents();
      return messages.at(-1) === 'Also add the oven temperature to the note' && service.thread(BREAD)?.status === 'idle' && !service.thread(BREAD)?.live;
    }, 15_000));
    await atRest(BREAD);

    // --- A question in two parts: clicks pick, and Send posts the picks once each part has one.
    await say('Ask me two things about the squash');
    await card.waitFor({ timeout: 10_000 });
    check('with several parts Send waits for a pick in each', (await card.getByTestId('auto-send-picks').isDisabled()));
    await card.getByRole('button', { name: 'Bed 2' }).click();
    await card.getByRole('button', { name: 'Borage' }).click();
    await card.getByRole('button', { name: 'Dill' }).click();
    await shot(27, 'question-parts');
    await card.getByTestId('auto-send-picks').click();
    check('Send posts the picks together, and the keyboard goes back to the box', await until(async () => ((await talk.textContent()) ?? '').includes('Squash: Bed 2. Beside it: Borage and Dill.')) && (await focused()) === 'auto-box');
    await atRest(BREAD);

    // --- Words typed after every part has its pick: the picks go as the answer, and the words follow as a message.
    await say('Ask me two things about the squash, once more');
    await card.waitFor({ timeout: 10_000 });
    await card.getByRole('button', { name: 'Bed 1' }).click();
    await card.getByRole('button', { name: 'Nasturtiums' }).click();
    await box.click();
    await box.fill('And leave room for the path');
    await shot(70, 'parts-then-words');
    const writesBefore = service.requests.length;
    await box.press('Enter');
    check('the picks go as the answer, with none of his words in it', await until(() => {
      const body = posts(`/api/threads/${BREAD}/answer`).at(-1);
      return JSON.stringify(Object.values(body?.answers ?? {})) === JSON.stringify(['Bed 1', ['Nasturtiums']]);
    }), JSON.stringify(posts(`/api/threads/${BREAD}/answer`).at(-1)));
    check('and his words follow as an ordinary message, after the answer', await until(() => {
      const writes = service.requests.slice(writesBefore).filter((request) => request.method === 'POST' && (request.path === `/api/threads/${BREAD}/answer` || request.path === `/api/threads/${BREAD}/messages`));
      return writes.length === 2 && writes[0].path.endsWith('/answer') && writes[1].path.endsWith('/messages') && writes[1].body.text === 'And leave room for the path' && Object.keys(writes[1].body).sort().join() === 'cid,text';
    }) && (await box.inputValue()) === '');
    check('both show in the thread: the turn’s reply to the picks, then his message with a reply of its own', await until(async () => {
      const text = (await talk.textContent()) ?? '';
      const messages = await talk.getByTestId('auto-message').allTextContents();
      return text.includes('Squash: Bed 1. Beside it: Nasturtiums.') && messages.at(-1) === 'And leave room for the path' && text.lastIndexOf('Beans and peas go in bed 2') > text.lastIndexOf('And leave room for the path');
    }, 15_000), ((await talk.textContent()) ?? '').slice(-200));
    await atRest(BREAD);

    // --- A permission request, allowed.
    await say('Tidy the old drafts');
    await page.getByTestId('auto-permission').waitFor({ timeout: 10_000 });
    const permission = page.getByTestId('auto-permission');
    check('a permission request is a card with its title, its detail, Allow and Deny, and no field', ((await permission.textContent()) ?? '').includes('mv Notes/drafts/2024-*.md Archive/drafts/') && (await permission.getByRole('button', { name: 'Allow' }).count()) === 1 && (await permission.getByRole('button', { name: 'Deny' }).count()) === 1 && (await permission.getByRole('textbox').count()) === 0);
    check('under a permission card the box says what words there do: Say no, with a reason', (await box.getAttribute('placeholder')) === 'Say no, with a reason', (await box.getAttribute('placeholder')) ?? '');
    await shot(8, 'permission');
    await permission.getByRole('button', { name: 'Allow' }).click();
    check('Allow lets the turn go on', await until(async () => ((await talk.textContent()) ?? '').includes('Three drafts moved to the archive')));
    await atRest(BREAD);
    // Words in the box deny it, and go back as the reason.
    await say('Tidy the old drafts again');
    await permission.waitFor({ timeout: 10_000 });
    await box.fill('Keep them one more year');
    await box.press('Enter');
    check('words typed under a permission request deny it with that reason', await until(async () => ((await talk.textContent()) ?? '').includes('Left them where they are. You said: Keep them one more year')) && JSON.stringify(posts(`/api/threads/${BREAD}/answer`).at(-1)).includes('"allow":false'));
    await atRest(BREAD);

    // --- A send he is asked to allow up front: a card that can only say no, drawn as his phone draws it.
    await say('Send Robin a word about the swap');
    const grant = page.getByTestId('auto-grant');
    await grant.waitFor({ timeout: 10_000 });
    const GRANT_TITLE = 'Send this Slack message to Robin?';
    check('a send to allow is a card: the service’s title, the exact words, its detail, and one button, No', ((await grant.locator('p').first().textContent()) ?? '') === GRANT_TITLE && ((await page.getByTestId('auto-grant-words').textContent()) ?? '') === 'I will bring the bean seedlings on Saturday.' && (await grant.getByRole('button').allTextContents()).join() === 'No' && (await grant.getByRole('textbox').count()) === 0);
    check('the card says who and how once, in its title: no second line repeats it', (await page.getByTestId('auto-grant-to').count()) === 0 && ((await grant.textContent()) ?? '').split('Robin').length === 2, (await grant.textContent()) ?? '');
    const detailLines = await page.getByTestId('auto-grant-detail').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const tops = [...new Set([...range.getClientRects()].filter((box) => box.width > 0).map((box) => Math.round(box.top)))];
      return { text: element.textContent ?? '', lines: tops.length, height: Math.round(element.getBoundingClientRect().height), line: parseFloat(getComputedStyle(element).lineHeight) };
    });
    check('the detail keeps the service’s lines: what it is about, a gap, and how it would go', detailLines.text === 'the seed swap\n\nThese exact words, once, from this thread.' && detailLines.lines === 2 && detailLines.height >= detailLines.line * 2.5, JSON.stringify(detailLines));
    check('the parts come in the phone’s order: title, words, detail, then No and where the yes is', await grant.evaluate((element) => {
      const top = (selector) => element.querySelector(selector)?.getBoundingClientRect().top ?? -1;
      const order = [top('p'), top('[data-testid="auto-grant-words"]'), top('[data-testid="auto-grant-detail"]'), top('button'), top('[data-testid="auto-grant-phone"]')];
      return order.every((value) => value >= 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3] && Math.abs(order[3] - order[4]) < 24;
    }));
    check('one line says the yes is on his phone, and the box takes a reason', ((await page.getByTestId('auto-grant-phone').textContent()) ?? '') === 'The yes is on your phone.' && (await box.getAttribute('placeholder')) === 'Say no, with a reason');
    check('its row waits on him with the title as its line, and it counts in the sidebar', await until(async () => ((await row(BREAD).textContent()) ?? '').includes(GRANT_TITLE) && (await groupIds('needs')).includes(BREAD) && (await sidebarSays(needsHim()))) && (await row(BREAD).getByRole('button', { name: /allow|yes/i }).count()) === 0);
    await shot(44, 'grant');
    // No key says yes: Enter and the numbers do nothing in the card or in the empty box.
    await grant.getByRole('button', { name: 'No' }).focus();
    for (const pressed of ['1', '2', '3', 'y']) await key(pressed);
    await box.focus();
    await key('Enter');
    await key('Meta+Enter');
    check('no key allows it', posts(`/api/threads/${BREAD}/answer`).filter((body) => 'allow' in body && body.allow !== false).length === 1 && service.thread(BREAD)?.status === 'waiting');
    await grant.getByRole('button', { name: 'No' }).click();
    check('No refuses it, and nothing is sent', await until(async () => ((await talk.textContent()) ?? '').includes('Nothing was sent.')) && JSON.stringify(posts(`/api/threads/${BREAD}/answer`).at(-1)) === JSON.stringify({ id: posts(`/api/threads/${BREAD}/answer`).at(-1)?.id, allow: false }));
    await atRest(BREAD);
    check('once answered it folds to its title and Not allowed', ((await talk.textContent()) ?? '').includes(`${GRANT_TITLE} Not allowed`) || ((await talk.textContent()) ?? '').includes(`${GRANT_TITLE}Not allowed`), ((await talk.textContent()) ?? '').slice(-160));
    // Words typed while it waits. The service reads only the no, so the no goes alone and his words follow as a message.
    await say('Send Robin the same word again');
    await grant.waitFor({ timeout: 10_000 });
    const wordsSent = () => posts(`/api/threads/${BREAD}/messages`).filter((body) => body.text === 'Not this week').length;
    const answersBefore = posts(`/api/threads/${BREAD}/answer`).length;
    // If the no is not taken, the words stay in the box and nothing is sent.
    service.failWrites('refuse');
    await box.fill('Not this week');
    await box.press('Enter');
    check('if the no is not taken his words stay in the box and nothing is sent', await until(async () => ((await grant.getByRole('alert').textContent().catch(() => '')) ?? '').includes('The stand-in refuses writes for now.')) && (await box.inputValue()) === 'Not this week' && wordsSent() === 0 && service.thread(BREAD)?.status === 'waiting' && (await page.getByTestId('auto-not-sent').count()) === 0);
    service.failWrites(false);
    await box.press('Enter');
    check('typed words say the plain no first, and then go to the thread as his message', await until(() => wordsSent() === 1) && (await box.inputValue()) === '' && await (async () => {
      const writes = service.requests.filter((request) => request.method === 'POST' && (request.path === `/api/threads/${BREAD}/answer` || request.path === `/api/threads/${BREAD}/messages`));
      const no = writes.at(-2);
      const words = writes.at(-1);
      return !!no && !!words && no.path.endsWith('/answer') && JSON.stringify(no.body) === JSON.stringify({ id: no.body.id, allow: false }) && words.path.endsWith('/messages') && words.body.text === 'Not this week' && Object.keys(words.body).sort().join() === 'cid,text';
    })(), JSON.stringify(posts(`/api/threads/${BREAD}/answer`).at(-1)));
    check('no answer to a send carried words, a yes or a signature', posts(`/api/threads/${BREAD}/answer`).slice(answersBefore).every((body) => body.allow === false && Object.keys(body).sort().join() === 'allow,id'), JSON.stringify(posts(`/api/threads/${BREAD}/answer`).slice(answersBefore)));
    await atRest(BREAD);
    check('the turn hears the no, and his words are in the thread with an answer of their own', await until(async () => {
      const text = (await talk.textContent()) ?? '';
      const messages = await talk.getByTestId('auto-message').allTextContents();
      return text.includes('Nothing was sent.') && messages.at(-1) === 'Not this week' && text.lastIndexOf('Beans and peas go in bed 2') > text.lastIndexOf('Not this week');
    }), ((await talk.textContent()) ?? '').slice(-200));
    check('Opal never tried to allow a send', service.unsigned.length === 0);

    // --- A move that is his: words on the row, never a button, and it counts.
    await say('Write a note for the club');
    await atRest(BREAD);
    check('a thread whose next move is his says "Your move" on its row', await until(async () => ((await row(BREAD).getByTestId('auto-yours').textContent().catch(() => '')) ?? '') === 'Your move: Read the note and send it to the club') && (await row(BREAD).getByRole('button', { name: /move|send/i }).count()) === 1);
    check('it counts in the Threads heading, and is not a follow-up button', await until(async () => sidebarSays(needsHim())) && (await page.getByTestId('auto-next').getByRole('button').allTextContents()).join('|') === 'Make it shorter', await headingCount());
    await page.getByTestId('auto-new-thread').click();
    await shot(45, 'your-move');
    await row(BREAD).click();
    await say('Thanks, that will do');
    await atRest(BREAD);
    check('the line goes when the thread moves on', await until(async () => (await row(BREAD).getByTestId('auto-yours').count()) === 0));

    // --- A question waits on its row as words only: it is answered in the thread.
    const bedsHeight = () => row(BEDS).evaluate((element) => Math.round(element.getBoundingClientRect().height));
    const heightBefore = await bedsHeight();
    check('a waiting row has no answer buttons, open or not', (await row(BEDS).getByRole('button', { name: /Cedar|Larch/ }).count()) === 0);
    await row(BEDS).locator('[data-auto-row]').click();
    await until(async () => (await row(BEDS).locator('[aria-current]').count()) === 1);
    check('a waiting row keeps its height while it is open, so the rows under it stay put', (await bedsHeight()) === heightBefore, `${heightBefore} -> ${await bedsHeight()}`);
    await card.waitFor({ timeout: 10_000 });
    await card.getByRole('button', { name: /Cedar/ }).click();
    check('the open thread’s card answers it', await until(async () => service.thread(BEDS)?.status !== 'waiting' && Object.values(posts(`/api/threads/${BEDS}/answer`).at(-1)?.answers ?? {})[0] === 'Cedar', 10_000), JSON.stringify(posts(`/api/threads/${BEDS}/answer`).at(-1)));
    await row(BREAD).click();
    await until(async () => (await row(BREAD).locator('[aria-current]').count()) === 1);
    check('the sidebar count follows: what waits, what is unread and what is his move', await until(async () => sidebarSays(needsHim())));
    await atRest(BEDS);
    check('its reply, not yet read, lifts it under the questions', await until(async () => (await groupIds('fresh')).includes(BEDS)));

    // --- Snooze, the Snoozed line, and back.
    const openSnooze = async () => {
      await row(SEEDS).hover();
      await page.getByTestId(`auto-snooze-${SEEDS}`).click();
      await page.getByTestId('auto-snooze-menu').waitFor({ timeout: 5_000 });
    };
    await openSnooze();
    // On a Sunday "Next week" is tomorrow morning, so the menu shows that time once, as Tomorrow.
    const offered = await page.getByTestId('auto-snooze-menu').getByRole('menuitem').allTextContents();
    check('Snooze offers the phone’s choices in the order of their times: Tomorrow and Next week at 9:00 am, a time of his own, and until a reply', offered.every((label) => /^(Later today|Tonight|Tomorrow|This weekend|Next week|Pick a time…|Until a reply…)/.test(label)) && offered.some((label) => /^Tomorrow.*9:00 am$/.test(label)) && (new Date().getDay() === 0 || offered.some((label) => /^Next week.*9:00 am$/.test(label))) && offered.at(-2) === 'Pick a time…' && offered.at(-1) === 'Until a reply…' && offered.filter((label) => label.startsWith('Tonight')).every((label) => /7:00 pm$/.test(label)), offered.join('|'));
    await shot(9, 'snooze-menu', async () => {
      if ((await page.getByTestId('auto-snooze-menu').count()) === 0) await openSnooze();
    });
    if ((await page.getByTestId('auto-snooze-menu').count()) === 0) await openSnooze();
    const orderBefore = service.entries().map((thread) => thread.id);
    const rowsBefore = await rowIds();
    const seedsSatAbove = orderBefore[orderBefore.indexOf(SEEDS) + 1];
    await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: /^Tomorrow/ }).click();
    check('a snoozed thread leaves the list', await until(async () => !(await rowIds()).includes(SEEDS) && service.thread(SEEDS)?.snoozed > Date.now() / 1000));
    check('the foot of the list says what the snooze did in the phone’s words, and offers Undo', await until(async () => (await saidText()) === 'Snoozed until tomorrow 9:00 am.Undo'), await saidText());
    // At the sidebar's width the sentence may take two lines, never cut.
    check('the sentence is whole in the line', await said.evaluate((element) => {
      const what = element.querySelector('[data-testid="auto-said-what"]');
      return !!what && what.scrollWidth <= what.clientWidth + 1 && what.getBoundingClientRect().height < 44 && what.textContent === 'Snoozed until tomorrow 9:00 am.';
    }));
    await shot(25, 'undo-snooze');
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo brings a snoozed thread back', await until(async () => (await rowIds()).includes(SEEDS) && service.thread(SEEDS)?.snoozed === null));
    // The service brings a thread back on top of his order. The undo moves it to where it sat, and the row never jumps.
    let seedsSteady = true;
    for (let sample = 0; sample < 30; sample += 1) {
      seedsSteady = seedsSteady && (await rowIds()).join() === rowsBefore.join();
      await wait(50);
    }
    check('undone, the thread is back where it sat, and its row does not jump while the posts land', seedsSteady, `${rowsBefore.join()} -> ${(await rowIds()).join()}`);
    check('the service has his order as it was: the undo posted a move before the thread it sat above', await until(() => service.entries().map((thread) => thread.id).join() === orderBefore.join()) && JSON.stringify(posts(`/api/threads/${SEEDS}/move`).at(-1)) === JSON.stringify({ before: seedsSatAbove }), JSON.stringify(posts(`/api/threads/${SEEDS}/move`).at(-1)));
    await shot(60, 'undo-snooze-place');
    // A day and a time of his own: the dialog names the thread and starts tomorrow at 9:00 am. Today can be picked.
    await openSnooze();
    await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: 'Pick a time…' }).click();
    const picker = page.getByTestId('auto-snooze-date');
    await picker.waitFor({ timeout: 5_000 });
    check('the date dialog names the thread and shows a time, 9:00 am to start with', ((await picker.getByTestId('auto-snooze-name').textContent()) ?? '') === 'Seed order for spring' && (await picker.getByLabel('Time').inputValue()) === '09:00');
    await shot(26, 'snooze-time');
    const clock = new Date();
    const todayIso = `${clock.getFullYear()}-${String(clock.getMonth() + 1).padStart(2, '0')}-${String(clock.getDate()).padStart(2, '0')}`;
    // Late today, unless the run is in the day's last minutes: then tomorrow afternoon stands in.
    const lateToday = clock.getHours() < 23 || clock.getMinutes() < 50;
    if (lateToday) {
      await picker.getByLabel('Date').fill(todayIso);
      await picker.getByLabel('Time').fill('00:00');
      await picker.getByRole('button', { name: 'Snooze' }).click();
      check('a time that has passed is refused in words', await until(async () => ((await picker.getByRole('alert').textContent().catch(() => '')) ?? '') === 'Choose a time from now on, within a year.') && service.thread(SEEDS)?.snoozed === null);
    }
    await picker.getByLabel('Time').fill(lateToday ? '23:59' : '14:30');
    await picker.getByRole('button', { name: 'Snooze' }).click();
    check('a time later today snoozes the thread until then', await until(() => {
      const until = service.thread(SEEDS)?.snoozed;
      const at = typeof until === 'number' ? new Date(until * 1000) : null;
      return !!at && (lateToday ? at.getDate() === clock.getDate() && at.getHours() === 23 && at.getMinutes() === 59 : at.getHours() === 14 && at.getMinutes() === 30);
    }));
    check('the line gives the time alone for today', !lateToday || (await saidText()) === 'Snoozed until 11:59 pm.Undo', await saidText());
    // --- The Put away page: one click from the sidebar's row, the three groups in the Auto tab.
    const readsBefore = archivedReads().length;
    await awayRow.click();
    await awayPage.waitFor({ timeout: 5_000 });
    check('a click on Put away opens its page in the Auto tab, named Put away, with the row marked', await until(async () => (await tabName()) === 'Put away' && (await awayRow.getAttribute('aria-current')) === 'true'), await tabName());
    check('the page has its groups under plain headings: Waiting on a reply, Snoozed, Archived', await until(async () => (await awayPage.locator('h2').allTextContents()).join() === 'Waiting on a reply,Snoozed,Archived'), (await awayPage.locator('h2').allTextContents()).join());
    check('the archive is read when the page opens', await until(() => archivedReads().length === readsBefore + 1), archivedReads().join());
    check('the Snoozed group shows them, the first to return first', (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 3);
    check('a snoozed row says when it returns', /^Returns /.test((await page.getByTestId('auto-snoozed').getByTestId('auto-returns').first().textContent()) ?? ''), (await page.getByTestId('auto-snoozed').getByTestId('auto-returns').first().textContent()) ?? '');
    check('the page rows share one column with the header', await oneColumn('auto-away-page'));
    await page.getByTestId('auto-snoozed').locator('[data-thread-id]').first().hover();
    check('a snoozed row offers another time and the words Bring back', (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').first().getByRole('button', { name: 'Bring back', exact: true }).count()) === 1 && (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').first().getByRole('button', { name: 'Snooze', exact: true }).count()) === 1);
    await shot(10, 'snoozed-open');
    // Its time passes on the service: it comes back under the questions and says Back.
    service.wake(SEEDS);
    check('a thread back from snooze is lifted under the questions and says Back', await until(async () => (await groupIds('fresh')).includes(SEEDS) && /Back \d/.test((await row(SEEDS).textContent()) ?? '')));
    // Bring back, by the pointer: the keyboard stays where it was. S on a snoozed row opens the menu that holds it.
    await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 2);
    const napping = await page.getByTestId('auto-snoozed').locator('[data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));
    const hadUntil = service.thread(napping[0])?.snoozed;
    await page.getByTestId('auto-snoozed').locator('[data-thread-id]').first().hover();
    const keyboardWas = await focused();
    await page.getByTestId('auto-snoozed').getByRole('button', { name: 'Bring back', exact: true }).first().click();
    check('Bring back returns one at once, the keyboard stays where it was, and the line says so', await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 1 && (await focused()) === keyboardWas && (await saidText()) === 'Back in the list.Undo'), `${keyboardWas} -> ${await focused()} | ${await saidText()}`);
    // Bringing back can be undone: the thread is put away again, to the time it had.
    await key('Meta+z');
    check('Cmd+Z puts it away again as it was', await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 2 && service.thread(napping[0])?.snoozed === hadUntil), `${hadUntil} -> ${service.thread(napping[0])?.snoozed}`);
    await page.getByTestId('auto-snoozed').locator(`[data-thread-id="${napping[0]}"]`).hover();
    await page.getByTestId(`auto-back-${napping[0]}`).click();
    await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 1);
    await awayButton(napping[1]).focus();
    await key('s');
    await page.getByTestId('auto-snooze-menu').waitFor({ timeout: 5_000 });
    check('S on a snoozed row opens its menu, which starts with Bring back', ((await page.getByTestId('auto-snooze-menu').getByRole('menuitem').first().textContent()) ?? '') === 'Bring back');
    await key('Escape');
    await until(async () => (await page.getByTestId('auto-snooze-menu').count()) === 0);
    // Keys on the page: Up and Down, j and k move; Escape puts the keyboard on the sidebar's Put away row.
    await awayButton(napping[1]).focus();
    await key('ArrowUp');
    const above = await focused();
    await key('j');
    check('Up and j move between the page’s rows', above === GLASS && (await focused()) === napping[1], `${above} | ${await focused()}`);
    await key('Escape');
    check('Escape puts the keyboard on the sidebar’s Put away row', await until(async () => (await focused()) === ':away'), await focused());
    await key('Enter');
    check('Enter on it keeps the page, with the keyboard back on the row it left', await until(async () => (await awayPage.count()) === 1 && (await focused()) === napping[1]), await focused());
    await hideLine();

    // --- Drag a row to reorder.
    const before = await groupIds('rest');
    const placeOn = (id) => service.entries().findIndex((thread) => thread.id === id);
    await row(COMPOST).dragTo(row(before[0]), { targetPosition: { x: 40, y: 4 } });
    check('a dragged row lands where it was dropped among the rest, on the service too', await until(async () => (await groupIds('rest'))[0] === COMPOST && placeOn(COMPOST) + 1 === placeOn(before[0])), `${before.join()} -> ${(await groupIds('rest')).join()}`);

    // --- Archive.
    const barrelAt = (await rowIds()).indexOf(BARREL);
    await row(BARREL).hover();
    await page.getByTestId(`auto-archive-${BARREL}`).click();
    check('Archive takes a thread out of the list', await until(async () => !(await rowIds()).includes(BARREL) && service.thread(BARREL)?.archived === true));
    check('the foot of the list names what was archived, with Undo, and nothing shows in the corner', await until(async () => /^Archived: Rain barrelUndo(\d more)?$/.test(await saidText())) && (await page.locator('[data-sonner-toast]').count()) === 0, await saidText());
    check('the line sits at the foot of the sidebar, under Library and inside its edges', await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="auto-said"]')?.getBoundingClientRect();
      const sidebar = document.querySelector('[data-testid="workspace-sidebar"]')?.getBoundingClientRect();
      const library = document.querySelector('[data-testid="sidebar-library"]')?.getBoundingClientRect();
      return !!bar && !!sidebar && !!library && bar.left >= sidebar.left && bar.right <= sidebar.right && bar.top >= library.bottom - 1 && bar.bottom <= sidebar.bottom;
    }));
    await shot(28, 'undo-archive');
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo puts it back where it was', await until(async () => (await rowIds()).indexOf(BARREL) === barrelAt && service.thread(BARREL)?.archived === false));
    // Rename, from a row's menu: the thread opens and the row's title is the field.
    await fromMenu(BARREL, 'Rename');
    const rowTitle = page.getByRole('textbox', { name: 'Thread title' });
    await rowTitle.waitFor({ timeout: 5_000 });
    await rowTitle.fill('Rain barrel, by the shed');
    await rowTitle.press('Enter');
    check('Rename from a row’s menu renames the thread, and its Enter leaves no line in the box', await until(async () => service.thread(BARREL)?.title === 'Rain barrel, by the shed' && ((await row(BARREL).textContent()) ?? '').includes('Rain barrel, by the shed')) && (await wait(150), (await box.inputValue()) === ''), JSON.stringify(await box.inputValue()));

    // --- Undo of an archive sets the Mac mark again, and the keyboard goes to the row.
    await fromMenu(BARREL, 'Mark for the Mac');
    await until(async () => service.thread(BARREL)?.desk?.by === 'opal' && (await marked.locator(`[data-thread-id="${BARREL}"]`).count()) === 1);
    await row(BARREL).locator('[data-auto-row]').focus();
    await key('e');
    check('archiving a marked thread ends its mark at the service', await until(() => service.thread(BARREL)?.archived === true && service.thread(BARREL)?.desk === null));
    await key('Meta+z');
    check('Undo puts it back under "For the Mac" at once, with the keyboard on its row', await until(async () => (await marked.locator(`[data-thread-id="${BARREL}"]`).count()) === 1 && (await focused()) === BARREL, 3_000), await focused());
    check('and the service has the mark again: the undo set it', await until(() => service.thread(BARREL)?.archived === false && service.thread(BARREL)?.desk?.by === 'opal') && posts(`/api/threads/${BARREL}/desk`).at(-1)?.on === true);
    let markSteady = true;
    for (let sample = 0; sample < 20; sample += 1) {
      markSteady = markSteady && (await marked.locator(`[data-thread-id="${BARREL}"]`).count()) === 1;
      await wait(50);
    }
    check('the row never leaves its group while the posts land', markSteady);
    await shot(61, 'undo-archive-marked');
    await fromMenu(BARREL, 'Take off the Mac mark');
    await until(async () => service.thread(BARREL)?.desk === null && (await marked.count()) === 0);

    // --- The archive, on the Put away page: read each time the page opens, newest first, a few and then all.
    await showLine('archived');
    check('opened, the page reads the newest ten, newest archived first', await until(async () => (await archivedIds()).length === 10 && (await archivedIds())[0] === FENCE && (await archivedIds())[1] === FEEDER) && archivedReads().at(-1) === '/api/threads?archived=1&limit=10', archivedReads().join());
    check('each row says its last line and when it was archived, as the phone does', ((await row(FENCE).textContent()) ?? '').includes('Two coats of the dark green cover the north side.') && (await lineOf(FENCE, 'auto-archived-when')) === 'Archived yesterday.' && /^Archived [A-Z][a-z]{2}\.$/.test(await lineOf(FEEDER, 'auto-archived-when')), `${await lineOf(FENCE, 'auto-archived-when')} | ${await lineOf(FEEDER, 'auto-archived-when')}`);
    check('the Put away row still counts only what is snoozed or waiting, and Show all says how many are archived', /^Put away[1-9]$/.test(await awaySays()) && (await textOf('auto-archived-all')) === 'Show all 12', `${await awaySays()} | ${await textOf('auto-archived-all')}`);
    await row(FENCE).hover();
    check('an archived row offers only the way back, in words', (await awayButtons(FENCE)).join() === 'Bring back', (await awayButtons(FENCE)).join());
    await shot(62, 'archived-open');
    await page.getByTestId('auto-archived-all').click();
    check('Show all reads every one', await until(async () => (await archivedIds()).length === 12 && (await page.getByTestId('auto-archived-all').count()) === 0) && archivedReads().at(-1) === '/api/threads?archived=1', archivedReads().join());
    check('no archived thread’s history was read to list them', !service.requests.some((request) => request.method === 'GET' && /^\/api\/threads\/5b/.test(request.path)));
    // A thread opened from the page keeps the sidebar's row marked, and the row goes back to the page where he left it.
    await awayScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await wait(200);
    const lastArchived = (await archivedIds()).at(-1);
    const pageTop = await awayScroll.evaluate((element) => element.scrollTop);
    await awayButton(lastArchived).click();
    check('a row on the page opens its thread to read, with the sidebar’s Put away row still marked', await until(async () => (await awayPage.count()) === 0 && (await page.getByTestId('auto-away').count()) === 1 && (await awayRow.getAttribute('aria-current')) === 'true'));
    await awayRow.click();
    check('a click on the marked row returns to the page, with its place kept', await until(async () => (await awayPage.count()) === 1 && (await archivedIds()).length === 12 && Math.abs((await awayScroll.evaluate((element) => element.scrollTop)) - pageTop) < 2), `${pageTop} -> ${await awayScroll.evaluate((element) => element.scrollTop).catch(() => -1)}`);
    await awayScroll.evaluate((element) => { element.scrollTop = 0; });
    // Read one. The service serves an archived thread like any other.
    await awayButton(FENCE).click();
    check('an archived thread opens in the pane to read, with Bring back in its header in place of Archive', await until(async () => (await textOf('auto-title')) === 'Fence paint' && ((await talk.textContent()) ?? '').includes('Two coats of the dark green cover the north side.')) && (await page.getByTestId('auto-restore-open').getAttribute('aria-label')) === 'Bring back' && (await page.locator('[data-testid="auto-archive-open"], [data-testid="auto-snooze-open"], [data-testid="auto-thread-menu"]').count()) === 0);
    check('above the box it says Archived, with the same way back', (await textOf('auto-away-lead')) === 'Archived' && (await textOf('auto-bring-back')) === 'Bring back' && (await awayRow.getAttribute('aria-current')) === 'true', await textOf('auto-away'));
    await shot(63, 'archived-thread');
    await page.getByTestId('auto-restore-open').click();
    check('Bring back puts it in the list at once and tells the service, and the line says so with Undo', await until(async () => (await listedIds()).includes(FENCE) && !(await archivedIds()).includes(FENCE) && service.thread(FENCE)?.archived === false && (await saidText()) === 'Back in the list.Undo') && JSON.stringify(posts(`/api/threads/${FENCE}/archive`).at(-1)) === '{"archived":false}', await saidText());
    check('it sits where the service’s order puts it', await until(async () => {
      const rest = await groupIds('rest');
      return rest.includes(FENCE) && rest.join() === service.entries().map((thread) => thread.id).filter((id) => rest.includes(id)).join();
    }, 3_000), (await groupIds('rest')).join());
    check('its header has Archive again, and nothing above the box', await until(async () => (await page.getByTestId('auto-archive-open').count()) === 1 && (await page.getByTestId('auto-away').count()) === 0) && (await textOf('auto-title')) === 'Fence paint');
    await shot(64, 'undo-bring-back');
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo archives it again, and it is still open to read under the marked Put away row', await until(async () => service.thread(FENCE)?.archived === true && !(await listedIds()).includes(FENCE) && (await textOf('auto-away-lead')) === 'Archived' && (await awayRow.getAttribute('aria-current')) === 'true'));
    await awayRow.click();
    check('and it is back on top of the archive', await until(async () => (await archivedIds())[0] === FENCE), (await archivedIds()).join());
    // By a key: E on an archived row brings it back with the keyboard on the next row of the page.
    const afterFeeder = (await archivedIds())[(await archivedIds()).indexOf(FEEDER) + 1];
    await awayButton(FEEDER).focus();
    await key('e');
    check('E on an archived row brings it back, with the keyboard on the next row of the page', await until(async () => service.thread(FEEDER)?.archived === false && (await listedIds()).includes(FEEDER) && (await focused()) === afterFeeder), `${afterFeeder} | ${await focused()}`);
    await key('Meta+z');
    check('Cmd+Z puts it back in the archive and leaves the keyboard on a row, not in the box', await until(async () => service.thread(FEEDER)?.archived === true && (await archivedIds()).includes(FEEDER) && !(await listedIds()).includes(FEEDER) && (await keyboardOnRow())), await focused());
    await awayButton(FENCE).click();
    await until(async () => (await textOf('auto-title')) === 'Fence paint');
    // The palette: an archived thread by its title, and the one verb for the open one.
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('fence');
    check('the palette finds an archived thread by its title, and says it is archived', await until(async () => (await textOf(`palette-command-auto.thread.${FENCE}`)) === 'Fence paintArchived Auto thread'), await textOf(`palette-command-auto.thread.${FENCE}`));
    await shot(65, 'palette-archived', null, ['light', 'dark'], false);
    await key('Escape');
    await until(async () => (await page.getByTestId('command-palette').count()) === 0);
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('>bring');
    check('with an archived thread open the palette offers Bring back thread, and none of the other thread actions', await until(async () => (await textOf('palette-command-auto.bringBackThread')).startsWith('Bring back thread')) && (await page.locator('[data-testid="palette-command-auto.archiveThread"], [data-testid="palette-command-auto.restoreThread"]').count()) === 0);
    await page.getByTestId('palette-command-auto.bringBackThread').click();
    check('which brings it back', await until(async () => service.thread(FENCE)?.archived === false && (await listedIds()).includes(FENCE)));
    // Put away again, so the list is as it was.
    await page.getByTestId('auto-archive-open').click();
    await until(async () => service.thread(FENCE)?.archived === true && !(await listedIds()).includes(FENCE));
    await listRowsPane.evaluate((element) => { element.scrollTop = 0; });

    // --- Waiting on a reply: its group on the page, the open thread, what was heard, and the reply. From the palette.
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('go to put away');
    await page.getByTestId('palette-command-auto.goToAway').waitFor({ timeout: 5_000 });
    await key('Enter');
    check('the palette’s Go to Put away opens the page', await until(async () => (await awayPage.count()) === 1 && (await page.getByTestId('auto-waiting').count()) === 1));
    check('a waiting row says who it waits on and until when, then what for, where, and what was last heard', new RegExp(`^Waiting on Sam until ${WHEN}$`).test(await lineOf(GLASS, 'auto-wait-line')) && (await lineOf(GLASS, 'auto-wait-detail')) === 'The quote for the greenhouse glass. In Gmail. Last heard: I will measure the frames on Monday.', `${await lineOf(GLASS, 'auto-wait-line')} | ${await lineOf(GLASS, 'auto-wait-detail')}`);
    await row(GLASS).hover();
    check('it offers another time and the words Bring back', (await awayButtons(GLASS)).join() === 'Snooze,Bring back', (await awayButtons(GLASS)).join());
    await row(GLASS).locator('[data-thread-id]').click({ button: 'right' });
    check('and its menu holds Archive too', await until(async () => (await page.getByRole('menuitem', { name: /^Archive/ }).count()) >= 1));
    await key('Escape');
    await until(async () => (await page.getByRole('menu').count()) === 0);
    await shot(54, 'waiting-open');
    await awayButton(GLASS).click();
    await page.getByTestId('auto-away').waitFor({ timeout: 10_000 });
    check('opened, it says above the box who he waits on, what for, where and what was heard, with Bring back', new RegExp(`^Waiting on Sam until ${WHEN}$`).test(await textOf('auto-away-lead')) && (await textOf('auto-away-detail')) === 'The quote for the greenhouse glass. In Gmail. Last heard: I will measure the frames on Monday. Open the conversation' && (await textOf('auto-bring-back')) === 'Bring back', `${await textOf('auto-away-lead')} | ${await textOf('auto-away-detail')}`);
    check('the conversation is one link, to the web address the service gave and nowhere else', (await page.getByTestId('auto-away').locator('a').count()) === 1 && (await page.getByTestId('auto-away-link').getAttribute('href')) === 'https://mail.example/mail/u/0/#all/18c2f0a1b2c3d4e5');
    check('his words for the wait show as his message, as the service writes them', (await talk.getByTestId('auto-message').allTextContents()).includes('Wait for a reply: until Sam sends the quote for the glass'));
    check('the strip, the thread and the box are one column', await oneColumn('auto-thread'));
    await shot(55, 'waiting-thread');
    service.heard(GLASS, 'Sam: The supplier is closed until Thursday.');
    check('what the other side wrote, when it is not the answer, shows above the box without a click', await until(async () => (await textOf('auto-away-detail')).includes('Last heard: The supplier is closed until Thursday.')), await textOf('auto-away-detail'));
    // The reply arrives while he reads another thread.
    await row(BREAD).click();
    await until(async () => (await textOf('auto-title')) === 'Sourdough timings');
    service.reply(GLASS, 'Sam: 4 mm toughened, 86 for the lot.');
    await atRest(GLASS);
    check('the reply brings it back under the questions, and its row says who replied and what they said', await until(async () => (await groupIds('fresh')).includes(GLASS) && (await lineOf(GLASS, 'auto-wait-back')) === 'Sam replied: 4 mm toughened, 86 for the lot.'), `${(await groupIds('fresh')).join()} | ${await lineOf(GLASS, 'auto-wait-back')}`);
    check('it counts in the sidebar, as a thread back from snooze does', await until(async () => sidebarSays(needsHim())));
    await listRowsPane.evaluate((element) => { element.scrollTop = 0; });
    await shot(56, 'wait-met');
    await row(GLASS).locator('[data-auto-row]').click();
    check('in the thread the service’s quiet note says who replied, then Auto says what, and nothing is above the box', await until(async () => {
      const text = (await talk.textContent()) ?? '';
      return text.includes('Sam replied') && text.includes('4 mm toughened, 86 for the lot.') && text.lastIndexOf('Sam replied in') > text.indexOf('Wait for a reply:');
    }) && (await page.getByTestId('auto-away').count()) === 0);
    check('once opened its row says its last line again', await until(async () => (await row(GLASS).getByTestId('auto-wait-back').count()) === 0));

    // --- Snooze until a reply, from the menu: who he waits on and when the wait gives up.
    await page.getByTestId('auto-new-thread').click();
    await say('Ask Robin when the seed swap is');
    await until(() => (service.entries()[0]?.title ?? '').startsWith('Ask Robin'));
    const swap = service.entries()[0].id;
    await atRest(swap);
    await row(BREAD).click();
    await until(async () => (await textOf('auto-title')) === 'Sourdough timings');
    await row(swap).hover();
    await page.getByTestId(`auto-snooze-${swap}`).click();
    await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: 'Until a reply…' }).click();
    const replyDialog = page.getByTestId('auto-snooze-reply');
    await replyDialog.waitFor({ timeout: 5_000 });
    check('Until a reply opens a small dialog that names the thread, with the caret in its field', ((await replyDialog.getByTestId('auto-snooze-name').textContent()) ?? '').startsWith('Ask Robin') && await until(async () => (await focused()) === 'auto-wait-say', 3_000) && (await replyDialog.getByTestId('auto-wait-say').getAttribute('placeholder')) === 'Say who you are waiting on', await focused());
    const gives = await replyDialog.getByTestId('auto-wait-gives').evaluate((select) => ({ options: [...select.options].map((option) => option.textContent), picked: select.options[select.selectedIndex].textContent }));
    check('it offers the phone’s give-up times, each with the day it means, and starts at two working days', gives.options.length === 4 && /^Next working day, .*5:00 pm$/.test(gives.options[0]) && /^Two working days, .*5:00 pm$/.test(gives.options[1]) && /^A week, .*5:00 pm$/.test(gives.options[2]) && gives.options[3] === 'Pick a time…' && gives.picked === gives.options[1], JSON.stringify(gives));
    check('there is nothing to wait for until he says who', (await replyDialog.getByRole('button', { name: 'Wait' }).isDisabled()) && ((await replyDialog.textContent()) ?? '').includes('It comes back when they reply.'));
    await shot(57, 'until-a-reply', null, ['light', 'dark'], false);
    await replyDialog.getByTestId('auto-wait-say').fill('Robin, about the seed swap');
    await key('Enter');
    check('Wait posts one snooze: his words, and two working days on at 5:00 pm', await until(() => {
      const body = posts(`/api/threads/${swap}/snooze`).at(-1);
      const at = body ? new Date(body.until * 1000) : null;
      return !!at && Object.keys(body).sort().join() === 'until,wait' && JSON.stringify(body.wait) === '{"say":"Robin, about the seed swap"}' && at.getHours() === 17 && at.getMinutes() === 0 && ![0, 6].includes(at.getDay());
    }) && posts(`/api/threads/${swap}/snooze`).length === 1, JSON.stringify(posts(`/api/threads/${swap}/snooze`)));
    check('the thread leaves the list, and the line says so in the phone’s words', await until(async () => !(await listedIds()).includes(swap) && new RegExp(`^Waiting on (a reply|Robin) until ${WHEN}\\.Undo$`).test(await saidText())), await saidText());
    check('once Auto has named the conversation the line says who he waits on, with the same Undo', await until(async () => new RegExp(`^Waiting on Robin until ${WHEN}\\.Undo$`).test(await saidText()), 15_000) && (await page.getByTestId('auto-said-more').count()) === 0, await saidText());
    await atRest(swap);
    await showLine('waiting');
    check('its row says who Auto found, what for and where', new RegExp(`^Waiting on Robin until ${WHEN}$`).test(await lineOf(swap, 'auto-wait-line')) && (await lineOf(swap, 'auto-wait-detail')) === 'An answer about the seed swap. In Slack.', `${await lineOf(swap, 'auto-wait-line')} | ${await lineOf(swap, 'auto-wait-detail')}`);
    check('his words are in the thread as his message, as the service writes them', (service.thread(swap)?.items ?? []).some((item) => item.role === 'user' && item.text === 'Wait for a reply: Robin, about the seed swap'));
    await shot(58, 'undo-wait');
    // Nobody replies by the time he gave.
    service.expire(swap);
    await atRest(swap);
    check('when nobody has replied by then it comes back saying so', await until(async () => (await groupIds('fresh')).includes(swap) && (await lineOf(swap, 'auto-wait-back')) === 'No reply from Robin.'), await lineOf(swap, 'auto-wait-back'));
    await listRowsPane.evaluate((element) => { element.scrollTop = 0; });
    await shot(59, 'wait-expired');
    await row(swap).locator('[data-auto-row]').click();
    check('the thread has the service’s note of when it gave up', await until(async () => /No reply by [A-Z][a-z]{2} 5:00 pm/.test((await talk.textContent()) ?? '')), ((await talk.textContent()) ?? '').slice(-160));
    // Put away for good, so the list is as it was. The Waiting line, with nothing behind it, has gone.
    await page.getByTestId('auto-archive-open').click();
    await until(() => service.thread(swap)?.archived === true);
    await listRowsPane.evaluate((element) => { element.scrollTop = 0; });

    // --- A new thread.
    /** The row of the pane that is open: a thread's id, or the name of New thread or Digest. */
    // New thread is the button beside the Threads heading, pressed while the empty thread shows.
    const openRow = () => page.evaluate(() => document.querySelector('[data-testid="auto-list"] [aria-current]')?.getAttribute('data-row-id') ?? (document.querySelector('[data-testid="auto-new-thread"][aria-pressed="true"]') ? ':new' : ''));
    await page.getByTestId('auto-new-thread').click();
    check('New thread opens an empty thread with the box focused', await until(async () => (await openRow()) === ':new' && (await focused()) === 'auto-box') && ((await talk.textContent()) ?? '') === '', `${await openRow()} ${await focused()}`);
    await shot(11, 'new-thread');
    check('the empty thread is still the one open when he comes to type', (await openRow()) === ':new', await openRow());
    await say('Plan the herb bed by the back door');
    check('the first message starts a thread, at the top of his order and open', await until(async () => {
      const [top] = service.entries();
      return top.title.startsWith('Plan the herb bed') && (await groupIds('rest'))[0] === top.id && (await row(top.id).locator('[aria-current]').count()) === 1;
    }), `${service.entries()[0]?.title} | open ${await openRow()}`);
    check('its reply streams in', await until(async () => ((await talk.textContent()) ?? '').includes('Beans and peas go in bed 2')));

    // --- Done, undone: the entry it resolved is open again.
    const entryState = (id) => service.digest()?.sections.flatMap((section) => section.entries).find((each) => each.id === id)?.state;
    const resolvesBefore = posts('/api/digest/resolve').length;
    check('before Done the entry the inspection thread came from is not resolved', entryState('item-2') === 'thread', String(entryState('item-2')));
    await fromMenu(INSPECTION, 'Done');
    check('Done archives the thread and resolves its entry, and the line names it', await until(async () => service.thread(INSPECTION)?.archived === true && entryState('item-2') === 'resolved' && (await saidText()) === 'Done: Book the allotment inspectionUndo'), await saidText());
    await shot(68, 'undo-done');
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo brings the thread back', await until(async () => service.thread(INSPECTION)?.archived === false && (await listedIds()).includes(INSPECTION)));
    check('and opens its entry again: the undo also took the resolve back', await until(async () => entryState('item-2') === 'thread') && JSON.stringify(posts('/api/digest/resolve').slice(resolvesBefore)) === JSON.stringify([{ date: '2026-11-13', id: 'item-2', resolved: false }]), JSON.stringify(posts('/api/digest/resolve').slice(resolvesBefore)));

    // --- A digest entry nobody has started: its card, and Hand to Auto.
    await row(INSPECTION).click();
    await page.getByTestId('auto-hand-over').waitFor({ timeout: 10_000 });
    check('a waiting entry shows its words as a card and one button', ((await page.getByTestId('auto-entry').textContent()) ?? '').includes('The committee walks the plots on the 21st.') && ((await page.getByTestId('auto-hand-over').textContent()) ?? '') === 'Hand to Auto');
    await shot(12, 'digest-item');
    await page.getByTestId('auto-hand-over').click();
    check('Hand to Auto starts it with its own words', await until(() => service.requests.some((request) => request.path === `/api/threads/${INSPECTION}/start`) && service.thread(INSPECTION)?.waits === false));
    check('after Hand to Auto the keyboard is in the box', await until(async () => (await focused()) === 'auto-box', 2_000), await focused());
    await atRest(INSPECTION);
    check('its reply follows the card', await until(async () => (await page.getByTestId('auto-entry').count()) === 1 && (await page.getByTestId('auto-hand-over').count()) === 0 && ((await talk.textContent()) ?? '').includes('Beans and peas')));

    // --- A send that waits on the phone is one line of text.
    service.sendWaiting(INSPECTION);
    check('a send waiting on the phone is one line, with no control', await until(async () => ((await page.getByTestId('auto-send-waiting').textContent().catch(() => '')) ?? '') === 'A send is waiting on your phone.') && (await page.getByTestId('auto-send-waiting').getByRole('button').count()) === 0);
    service.sendWent(INSPECTION);
    await page.getByRole('button', { name: 'Sent messages' }).click();
    const receipts = page.getByRole('dialog', { name: 'Sent messages' });
    check('a message that went out has a dated receipt in the header', await until(async () =>
      ((await receipts.textContent()) ?? '').includes('Sent to club@example.com: Plot inspection') &&
      (await receipts.locator('time[datetime]').count()) === 1 &&
      !((await talk.textContent()) ?? '').includes('Sent to club@example.com: Plot inspection')));
    await page.keyboard.press('Escape');

    // --- A post that fails: the words return to the box under "Not sent".
    service.failWrites('refuse');
    await say('Move the inspection to the 22nd');
    check('a failed post returns its words to the box under Not sent, with Retry', await until(async () => (await box.inputValue()) === 'Move the inspection to the 22nd' && ((await page.getByTestId('auto-not-sent').textContent().catch(() => '')) ?? '').startsWith('Not sent')) && (await page.getByTestId('auto-not-sent').getByRole('button', { name: 'Retry' }).count()) === 1);
    service.failWrites(false);
    await page.getByTestId('auto-not-sent').getByRole('button', { name: 'Retry' }).click();
    check('Retry sends the same words again', await until(async () => (await box.inputValue()) === '' && posts(`/api/threads/${INSPECTION}/messages`).filter((body) => body.text === 'Move the inspection to the 22nd').length === 2 && new Set(posts(`/api/threads/${INSPECTION}/messages`).filter((body) => body.text === 'Move the inspection to the 22nd').map((body) => body.cid)).size === 1));
    await atRest(INSPECTION);
    service.failWrites(false);
    await box.fill('');

    // --- Signed out: the service's own sign-in line.
    service.signOut();
    await page.getByTestId('auto-signed-out').waitFor({ timeout: 10_000 });
    check('signed out shows the service’s own sign-in line', ((await page.getByTestId('auto-signed-out').textContent()) ?? '').includes('auto-login --on desk-mac'));
    await shot(13, 'signed-out');
    service.signOut(false);
    await page.getByTestId('auto-signed-out').waitFor({ state: 'detached', timeout: 10_000 });

    // --- Out of reach while open: one line, the list stays, and it recovers.
    service.down();
    await page.getByTestId('auto-notice').waitFor({ timeout: 15_000 });
    check('out of reach while open says so above the list', ((await page.getByTestId('auto-notice').textContent()) ?? '').includes("Can't reach Auto.") && (await rowIds()).length > 0);
    await say('Is anyone there?');
    check('Enter leaves the box as it is while out of reach', (await box.inputValue()) === 'Is anyone there?' && ((await page.getByTestId('auto-not-sent').textContent().catch(() => '')) ?? '').startsWith('Not sent'));
    await box.fill('');
    await shot(14, 'cant-reach-open');
    service.down(false);
    await page.getByTestId('auto-notice').getByRole('button', { name: 'Retry' }).click();
    check('it carries on once the service answers again', await until(async () => (await page.getByTestId('auto-notice').count()) === 0));

    // --- A restart of the service: the streams reset and the page reads everything again.
    service.restart();
    await wait(1_500);
    await row(BREAD).click();
    await say('One more thing about the beds');
    check('after the service restarts, the thread still streams', await until(async () => ((await talk.textContent()) ?? '').includes('One more thing about the beds') && service.thread(BREAD)?.status === 'idle' && ((await talk.locator('[data-testid="auto-message"]').last().textContent()) ?? '') === 'One more thing about the beds', 15_000));

    // --- A narrow window: the sidebar is an overlay, the thread fills the tab, and a row picked there closes it.
    const shell = page.getByTestId('app-shell');
    await resize(NARROW, HEIGHT);
    check('in a narrow window the thread fills the tab, with no list beside it and no narrow layout of its own', await until(async () => (await shell.getAttribute('data-layout')) === 'narrow' && (await page.getByTestId('auto-list').count()) === 0 && (await page.getByTestId('auto-thread').count()) === 1 && (await auto.getAttribute('data-narrow')) === null));
    await shot(15, 'narrow-thread');
    await page.getByRole('button', { name: 'Show sidebar' }).first().click();
    await page.getByTestId('auto-list').waitFor({ timeout: 5_000 });
    await shot(16, 'narrow-sidebar');
    // The Digest row, so that no thread the slow-network checks need unseen is opened here.
    await digestRow.click();
    check('a row picked in the overlay shows in the tab, and the overlay closes', await until(async () => (await page.getByTestId('auto-list').count()) === 0 && (await page.getByTestId('auto-queue-pane').count()) === 1));
    await resize(WIDTH, HEIGHT);
    await until(async () => (await shell.getAttribute('data-layout')) === 'wide');

    // --- The open thread's own actions: Archive, Snooze and "…" in its header.
    await row(COMPOST).click();
    await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Compost bin');
    const shownBefore = await rowIds();
    const below = shownBefore[shownBefore.indexOf(COMPOST) + 1];
    await page.getByTestId('auto-archive-open').click();
    check('archiving the open thread opens the one below it, with the caret in its box', await until(async () => service.thread(COMPOST)?.archived === true && (await row(below).locator('[aria-current]').count()) === 1 && (await focused()) === 'auto-box'), `${below} ${await focused()}`);
    // The caret is in the next thread's box, which is empty: Cmd+Z there takes the archive back.
    await key('Meta+z');
    check('Cmd+Z from the empty box brings it back and opens it again', await until(async () => service.thread(COMPOST)?.archived === false && (await row(COMPOST).locator('[aria-current]').count()) === 1 && (await said.count()) === 0), await focused());
    // With words in the box, Cmd+Z is the box's own.
    await page.getByTestId('auto-archive-open').click();
    await until(async () => service.thread(COMPOST)?.archived === true && (await focused()) === 'auto-box');
    await page.keyboard.type('half a thought');
    await key('Meta+z');
    await wait(400);
    check('with words in the box Cmd+Z is the box’s own undo, and the thread stays archived', service.thread(COMPOST)?.archived === true && !(await rowIds()).includes(COMPOST) && (await said.count()) === 1);
    await box.fill('');
    await key('Meta+z');
    check('emptied, the same key takes the archive back', await until(async () => service.thread(COMPOST)?.archived === false && (await row(COMPOST).locator('[aria-current]').count()) === 1));
    await page.getByTestId('auto-snooze-open').click();
    await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: /^Tomorrow/ }).click();
    check('snoozing the open thread opens the next one', await until(async () => service.thread(COMPOST)?.snoozed > 0 && !(await rowIds()).includes(COMPOST) && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') !== 'Compost bin'));
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo brings a snoozed thread back and opens it', await until(async () => service.thread(COMPOST)?.snoozed === null && (await row(COMPOST).locator('[aria-current]').count()) === 1));
    const openMenu = async () => {
      if ((await page.getByRole('menuitem', { name: 'Rename' }).count()) === 0) await page.getByTestId('auto-thread-menu').click();
      await page.getByRole('menuitem', { name: 'Rename' }).waitFor({ timeout: 5_000 });
    };
    /** A choice from the open thread's "…" menu, once the menu before it has closed. */
    const fromThreadMenu = async (name) => {
      await openMenu();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await until(async () => (await page.getByRole('menu').count()) === 0);
    };
    await fromThreadMenu('Mark for the Mac');
    check('the "…" menu marks the open thread for the Mac', await until(() => service.thread(COMPOST)?.desk?.by === 'opal'));
    await openMenu();
    await shot(30, 'thread-menu', openMenu);
    await fromThreadMenu('Take off the Mac mark');
    await until(() => service.thread(COMPOST)?.desk === null);
    await fromThreadMenu('Rename');
    const titleField = page.getByRole('textbox', { name: 'Thread title' });
    await titleField.waitFor({ timeout: 5_000 });
    await titleField.fill('Compost bin, north corner');
    await titleField.press('Enter');
    check('Rename from the menu renames, and the keyboard returns to the box, which stays empty', await until(async () => service.thread(COMPOST)?.title === 'Compost bin, north corner' && (await focused()) === 'auto-box') && (await wait(150), (await box.inputValue()) === ''), JSON.stringify(await box.inputValue()));

    // --- His place is kept: a thread comes back where he left it, from another thread and from a page.
    await row(BREAD).click();
    await talk.locator('table').first().waitFor({ timeout: 10_000 });
    await talk.evaluate((element) => { element.scrollTop = 120; });
    await wait(200);
    await row(COMPOST).click();
    await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '').startsWith('Compost bin'));
    await row(BREAD).click();
    check('a thread comes back where he left it', await until(async () => Math.abs((await talk.evaluate((element) => element.scrollTop)) - 120) < 4), String(await talk.evaluate((element) => element.scrollTop)));
    // A sidebar click while the Auto tab is in front goes to the tab that shows that page: the Auto tab stays what it is.
    const tabCount = () => page.locator('[data-testid="tab-strip"] [role="tab"]').count();
    const tabsBefore = await tabCount();
    await page.getByTestId('workspace-sidebar').getByRole('button', { name: 'Note', exact: true }).click();
    check('a sidebar click on Daily leaves the Auto tab alone and goes to the tab that shows it', await until(async () => (await page.getByTestId('tab-auto').count()) === 1 && (await page.getByTestId('tab-auto').getAttribute('aria-selected')) === 'false' && (await page.getByTestId('auto').count()) === 0) && (await tabCount()) === tabsBefore, `${tabsBefore} -> ${await tabCount()}`);
    await toAuto();
    check('coming back to the tab finds the thread where he left it', await until(async () => Math.abs((await talk.evaluate((element) => element.scrollTop)) - 120) < 4), String(await talk.evaluate((element) => element.scrollTop)));

    // Text that arrives while he is scrolled up: his place stays, and "Jump to the end" shows.
    await fromPhone(`/api/threads/${BREAD}/messages`, { text: 'A short one from the phone', cid: 'p2' });
    check('text that arrives while he is scrolled up leaves his place and offers Jump to the end', await until(async () => (await page.getByTestId('auto-jump').count()) === 1) && Math.abs((await talk.evaluate((element) => element.scrollTop)) - 120) < 4);
    await atRest(BREAD);
    await shot(31, 'jump-to-end');
    await page.getByTestId('auto-jump').click();
    check('Jump to the end goes there', await until(async () => (await page.getByTestId('auto-jump').count()) === 0 && (await talk.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)) < 4));
    await box.click();
    await key('PageUp');
    check('PageUp in the box scrolls the thread', await until(async () => (await talk.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)) > 100));
    await key('PageDown');
    await key('PageDown');

    // A long message typed at the end of a thread: the box grows, and the end of the reply stays in view.
    await talk.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await wait(200);
    const paneBefore = await talk.evaluate((element) => element.clientHeight);
    await box.click();
    await box.fill(Array.from({ length: 14 }, (_unused, line) => `Line ${line + 1} of a long message about the beds`).join('\n'));
    check('the box grows with a long message, and the thread stays at its end', await until(async () => (await talk.evaluate((element) => element.clientHeight)) < paneBefore - 100 && (await talk.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)) < 4) && (await page.getByTestId('auto-jump').count()) === 0, String(await talk.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)));
    await shot(50, 'long-message');
    await box.fill('');
    check('emptied, the box is one line again and the thread is still at its end', await until(async () => (await talk.evaluate((element) => element.clientHeight)) === paneBefore && (await talk.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)) < 4));

    // A follow-up can be changed first.
    await talk.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.getByTestId('auto-next').getByRole('button', { name: 'Draft the shopping list' }).click({ modifiers: ['Alt'] });
    check('Option-click puts a follow-up in the box to change first, and sends nothing', await until(async () => (await box.inputValue()) === 'Draft the shopping list' && (await focused()) === 'auto-box') && !posts(`/api/threads/${BREAD}/messages`).some((body) => body.text === 'Draft the shopping list'));
    await box.fill('');

    // --- A reply he has not read, taller than the pane, opens at its start.
    await row(COMPOST).click();
    // The keyboard is on the row that is about to move.
    await row(TRELLIS).locator('[data-auto-row]').focus();
    await fromPhone(`/api/threads/${TRELLIS}/messages`, { text: 'Send the timings table again', cid: 'p3' });
    await until(() => service.thread(TRELLIS)?.status === 'idle' && service.thread(TRELLIS)?.unread === true);
    check('a reply nobody has opened counts in the sidebar', await until(async () => sidebarSays(needsHim())) && needsHim() > 0);
    check('a thread with an unread reply is lifted under the questions, newest first', await until(async () => (await groupIds('fresh'))[0] === TRELLIS && !(await groupIds('rest')).includes(TRELLIS)), (await groupIds('fresh')).join());
    check('the keyboard stays with a row that moves to another group', (await focused()) === TRELLIS, await focused());
    await page.evaluate(() => document.activeElement?.blur());
    await shot(46, 'unread-lifted');
    const trellisTop = () => row(TRELLIS).evaluate((element) => Math.round(element.getBoundingClientRect().top));
    const trellisWas = await trellisTop();
    await row(TRELLIS).click();
    await until(async () => (await row(TRELLIS).getByRole('img', { name: 'Unread' }).count()) === 0 && service.thread(TRELLIS)?.unread === false);
    await wait(300);
    check('read, the open thread keeps its place under the pointer while it is open', (await groupIds('fresh')).includes(TRELLIS) && (await trellisTop()) === trellisWas, `${trellisWas} -> ${await trellisTop()}`);
    check('an unread reply taller than the pane opens at its start', await until(() => page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="auto-talk"]');
      const anchor = scroller?.querySelector('[data-anchor]');
      if (!scroller || !anchor) return false;
      const gap = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      return gap >= 0 && gap < 24 && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 100;
    })));
    await shot(32, 'unread-from-start');
    await row(COMPOST).click();
    check('once another thread opens it goes to its place in his order', await until(async () => (await groupIds('rest')).includes(TRELLIS) && !(await groupIds('fresh')).includes(TRELLIS)));
    await row(TRELLIS).click();
    await until(async () => (await row(TRELLIS).locator('[data-auto-row]').getAttribute('aria-current')) === 'true' && (await talk.count()) === 1);

    // --- A table and a line of code wider than the column fade at the edge they are cut at.
    await say('Show the whole year, wide');
    await until(async () => ((await talk.textContent()) ?? '').includes('That is everything.'));
    await atRest(TRELLIS);
    check('a wide table and a long code line fade at the cut edge', (await talk.locator('.auto-md-table').last().getAttribute('data-fade')) === 'end' && (await talk.locator('.auto-md-block pre').last().getAttribute('data-fade')) === 'end');
    await talk.locator('.auto-md-table').last().evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    check('scrolled to its end, the other edge fades', await until(async () => (await talk.locator('.auto-md-table').last().getAttribute('data-fade')) === 'start'));
    await talk.locator('.auto-md-table').last().evaluate((element) => { element.scrollLeft = 0; });
    await shot(33, 'wide-table');

    // --- A thread opened while Auto is out of reach loads by itself once Auto answers.
    // One he has not opened yet, so there is nothing kept of it to show: a snoozed thread whose time has just come.
    service.wake(HERBS);
    await until(async () => (await rowIds()).includes(HERBS));
    service.down();
    await page.getByTestId('auto-notice').waitFor({ timeout: 15_000 });
    await row(HERBS).click();
    check('a thread opened out of reach keeps its title from the list', await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Herb spiral' && ((await talk.textContent()) ?? '').includes("Can't reach Auto.")));
    await shot(34, 'thread-out-of-reach');
    service.down(false);
    check('it loads by itself once Auto answers again', await until(async () => ((await talk.textContent()) ?? '').includes('Thyme at the top'), 30_000));
    await until(async () => (await page.getByTestId('auto-notice').count()) === 0, 15_000);

    // --- On a slow network a thread seen before shows at once, and Loading shows only after a moment.
    service.slow(900);
    await row(BREAD).click();
    check('a thread seen before shows at once while the fresh one loads', ((await page.getByTestId('auto-title').textContent()) ?? '') === 'Sourdough timings' && ((await talk.textContent()) ?? '').includes('What to check') && !((await talk.textContent()) ?? '').includes('Loading'));
    await wait(1_200);
    await row(SEEDS).click();
    const early = await page.evaluate((id) => ({
      marked: document.querySelector(`[data-testid="auto-row-${id}"] [aria-current]`) !== null,
      text: document.querySelector('[data-testid="auto-talk"]')?.textContent ?? '',
      inert: document.querySelector('[data-testid="auto-talk"] > .auto-column')?.getAttribute('aria-hidden') === 'true',
    }), SEEDS);
    check('a thread never seen marks its row at once, and the pane keeps what it held for the first moment', early.marked && early.text.includes('What to check') && early.inert && !early.text.includes('Loading'), JSON.stringify({ ...early, text: early.text.slice(0, 40) }));
    check('past 300 ms the pane is the new thread’s: its title, and Loading', await until(async () => ((await talk.textContent()) ?? '') === 'Loading…' && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Seed order for spring', 900));
    await until(async () => ((await talk.textContent()) ?? '').includes('Twelve packets'));
    // A new thread shows his words at once, on their way, before the service has made it.
    service.slow(7_000);
    await page.getByTestId('auto-new-thread').click();
    await box.fill('Count the bean poles in the shed');
    await box.press('Enter');
    check('the first message of a new thread shows at once, before the service has the thread', await until(async () => ((await talk.getByTestId('auto-message').first().textContent().catch(() => '')) ?? '') === 'Count the bean poles in the shed', 600) && (await box.inputValue()) === '' && !service.entries().some((thread) => thread.title.startsWith('Count the bean poles')));
    await shot(51, 'new-thread-pending', null, ['light', 'dark'], false);
    service.slow(900);
    check('the thread opens once the service has it, with his words said once', await until(async () => service.entries().some((thread) => thread.title.startsWith('Count the bean poles')) && (await talk.getByTestId('auto-message').count()) === 1 && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '').startsWith('Count the bean poles'), 15_000));
    const poles = service.entries().find((thread) => thread.title.startsWith('Count the bean poles'))?.id ?? '';
    await atRest(poles);
    // A row leaves at once, before the service has answered.
    const herb = service.entries().find((thread) => thread.title.startsWith('Plan the herb bed'))?.id ?? '';
    await row(herb).hover();
    await page.getByTestId(`auto-archive-${herb}`).click();
    check('an archived row leaves at once with Undo on offer, before the service answers', !(await rowIds()).includes(herb) && /^Archived: Plan the herb bed.*Undo$/.test(await saidText()) && service.thread(herb)?.archived !== true, await saidText());
    await until(() => service.thread(herb)?.archived === true);
    service.slow(0);
    // If the service refuses, the row comes back with its sentence, and there is nothing to undo.
    service.failWrites('refuse');
    await row(SEEDS).hover();
    await page.getByTestId(`auto-archive-${SEEDS}`).click();
    check('a refused archive brings the row back with the service’s sentence', await until(async () => (await rowIds()).includes(SEEDS) && ((await said.textContent().catch(() => '')) ?? '').includes('The stand-in refuses writes for now.') && (await said.getByRole('button').count()) === 0));
    check('a refusal says why first and whole, then a shortened name', await said.evaluate((element) => {
      const reason = element.querySelector('[data-testid="auto-said-reason"]');
      const about = element.querySelector('[data-testid="auto-said-about"]');
      if (!reason || !about) return false;
      const [why, name] = [reason.getBoundingClientRect(), about.getBoundingClientRect()];
      const before = why.top < name.top - 2 || (Math.abs(why.top - name.top) <= 2 && why.left < name.left);
      return reason.textContent === 'The stand-in refuses writes for now.' && reason.scrollWidth <= reason.clientWidth + 1 && before && name.width <= 12 * 16 + 1;
    }), await saidText());
    await shot(73, 'refusal', null, ['light', 'dark'], false);
    service.failWrites(false);

    // --- The sidebar hidden: the clearing loop still works from the Auto tab, and Cmd+Z takes an action back.
    await row(BREAD).click();
    await until(async () => (await tabName()) === 'Sourdough timings');
    await page.getByRole('button', { name: 'Hide sidebar' }).first().click();
    await until(async () => (await page.getByTestId('workspace-sidebar').count()) === 0);
    check('with the sidebar hidden the thread, its header and its box are one column', (await oneColumn('auto-thread')) && new Set((await threadEdges()).slice(1)).size === 1, (await threadEdges()).join());
    await page.getByTestId('auto-archive-open').click();
    check('with the sidebar hidden, Archive opens the next thread, and the tab takes its name', await until(async () => service.thread(BREAD)?.archived === true && (await page.getByTestId('auto-thread').count()) === 1 && !['', 'Sourdough timings'].includes(await tabName()) && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === (await tabName())), await tabName());
    const nextName = await tabName();
    check('with the sidebar hidden the Undo line shows at the foot of the Auto page', await until(async () => /^Archived: Sourdough timings/.test(((await auto.getByTestId('auto-said').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')) && (await auto.getByTestId('auto-said').getByRole('button', { name: 'Undo' }).count()) === 1), await saidText());
    await shot(35, 'sidebar-hidden', null, ['light', 'dark'], false);
    await page.evaluate(() => document.activeElement?.blur());
    await key('Meta+z');
    check('Cmd+Z takes the archive back with the sidebar hidden', await until(() => service.thread(BREAD)?.archived === false), String(service.thread(BREAD)?.archived));
    check('and the thread comes back open, with the tab named after it', await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Sourdough timings' && (await tabName()) === 'Sourdough timings'), `${nextName} -> ${await tabName()}`);
    await page.getByRole('button', { name: 'Show sidebar' }).first().click();
    await page.getByTestId('auto-list').waitFor({ timeout: 5_000 });
    check('the box is one line when empty', await until(async () => (await box.count()) === 1 && (await box.evaluate((element) => element.getBoundingClientRect().height)) < 40), String(await box.evaluate((element) => element.getBoundingClientRect().height).catch(() => -1)));
    await row(BREAD).click();
    // Wide: Escape in the box puts the keyboard on the open thread's row, and stops nothing.
    await box.click();
    await key('Escape');
    check('Escape in the box puts the keyboard on the open thread’s row', await until(async () => (await focused()) === BREAD));

    // --- The digest as a queue, beside the list where a thread would be.
    const DAY = '2026-11-13';
    const left = () => service.digest()?.left;
    check('the Digest row is the first row of Threads and says how much is left', (await digestSays()) === 'Digest8 left' && (await page.locator('[data-testid="auto-list"] [data-auto-row]').first().getAttribute('data-testid')) === 'auto-digest-row');
    check('the Digest row is one line', (await digestRow.evaluate((element) => Math.round(element.getBoundingClientRect().height))) <= 32);
    await digestRow.click();
    check('the Digest tab shows the queue beside the named thread tab', await until(async () =>
      (await page.getByTestId('tab-label-digest').textContent()) === 'Digest' &&
      (await page.getByTestId('tab-digest').getAttribute('aria-selected')) === 'true' &&
      (await tabName()) === 'Sourdough timings'));
    await page.getByTestId('auto-queue-pane').waitFor({ timeout: 10_000 });
    check('the queue shows the day written out, Left and All with their counts', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Friday, November 13' && ((await page.getByTestId('auto-queue-left').textContent()) ?? '') === 'Left8' && ((await page.getByTestId('auto-queue-all').textContent()) ?? '') === 'All10'));
    check('Left holds the open entries, in the file’s order, under their sections', (await entryIds()).join() === 'meeting-allotment-committee,item-1,item-3,person-robin-seed-swap,text-plots-3d20bff3,text-yesterday-5c1d2e3f,text-yesterday-a7b8c9d0,draft-1' && (await queue.getByRole('heading').allTextContents()).join() === 'Meetings,Top 3,People,Plots,Yesterday,Drafted replies');
    check('a closed entry is its title line, with its priority, and its words as plain text', ((await entry('item-3').locator('p').first().textContent()) ?? '') === 'Medium Fix the kitchen tap' && ((await entry('item-3').getByTestId('auto-entry-words').textContent()) ?? '').startsWith('The hot side drips.') && (await queue.locator('table').count()) === 0);
    check('a title the words open with is said once', ((await entry('meeting-allotment-committee').textContent()) ?? '').split('Allotment committee').length === 2 && ((await entry('meeting-allotment-committee').locator('p').first().textContent()) ?? '') === 'Allotment committee' && ((await entry('person-robin-seed-swap').textContent()) ?? '').startsWith('Robin (seed swap)quiet since'));
    const rightEdges = () => page.evaluate(() => {
      const words = (element) => {
        if (!element) return -1;
        const range = document.createRange();
        range.selectNodeContents(element);
        return Math.round(range.getBoundingClientRect().right);
      };
      const all = [...document.querySelectorAll('[data-testid="auto-queue"] button')].find((button) => button.textContent === 'Resolve all');
      return [words(document.querySelector('[data-testid="auto-entry-time"]')), words(all)];
    });
    check('a meeting’s time ends at the right edge that Resolve all ends at', ((await entry('meeting-allotment-committee').getByTestId('auto-entry-time').textContent()) ?? '') === '10:00' && Math.abs((await rightEdges())[0] - (await rightEdges())[1]) <= 1, (await rightEdges()).join());
    const arrows = () => page.evaluate(() => {
      const box = (name) => document.querySelector(`[data-testid="auto-queue-pane"] button[aria-label="${name}"]`)?.getBoundingClientRect();
      const column = document.querySelector('[data-testid="auto-queue-pane"] header .auto-column')?.getBoundingClientRect();
      const [earlier, later, menu] = [box('Earlier day'), box('Later day'), box('Digest menu')];
      // The day's menu ends the header; the arrows sit just before it.
      return earlier && later && menu && column ? { earlier: Math.round(earlier.left), later: Math.round(later.left), menu: Math.round(menu.left - later.right), gap: Math.round(column.right - menu.right), back: Math.round(document.querySelector('[data-testid="auto-back"]')?.getBoundingClientRect().right ?? -1) } : null;
    });
    const arrowsLatest = await arrows();
    check('the day arrows and the day’s menu sit together at the right of the queue’s header', !!arrowsLatest && arrowsLatest.later > arrowsLatest.earlier && arrowsLatest.later - arrowsLatest.earlier < 40 && arrowsLatest.menu >= 0 && arrowsLatest.menu < 12 && arrowsLatest.gap >= 0 && arrowsLatest.gap <= 26, JSON.stringify(arrowsLatest));
    check('under a title the words are at most two quiet lines at the smaller size', await (async () => {
      const rows = await queue.getByTestId('auto-entry-words').evaluateAll((words) => words.map((element) => {
        const style = getComputedStyle(element);
        return { lines: Math.round(element.clientHeight / parseFloat(style.lineHeight)), size: parseFloat(style.fontSize), titled: element.previousElementSibling !== null };
      }));
      const reply = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-reply-size')) * 16);
      return rows.length === 8 && rows.filter((each) => each.titled).every((each) => each.lines <= 2 && each.size < reply) && rows.filter((each) => !each.titled).every((each) => each.lines <= 3);
    })());
    check('the queue’s header, its labels and its entries share the column’s edges', (await oneColumn('auto-queue-pane')) && await page.evaluate(() => {
      const left = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().left ?? -1);
      const words = document.querySelector('[data-testid="auto-queue"] [data-auto-entry] p');
      return new Set([left('[data-testid="auto-queue-day"]'), left('[data-testid="auto-queue"] h2'), Math.round(words?.getBoundingClientRect().left ?? -2)]).size === 1;
    }));
    check('the queue opens with the keyboard on its first entry', (await focused()) === 'meeting-allotment-committee');
    check('Resolve all is offered only for a section of reading with more than one entry left', (await queue.locator('section:has(button:text-is("Resolve all"))').evaluateAll((sections) => sections.map((section) => section.getAttribute('aria-label')))).join() === 'Yesterday');
    // Resolve and Thread have a column of their own at the row's right: they never sit on the words.
    await entry('person-robin-seed-swap').hover();
    check('the actions sit in their own column, clear of the words', await entry('person-robin-seed-swap').evaluate((row) => {
      const words = row.querySelector('[data-auto-entry]')?.getBoundingClientRect();
      const buttons = [...row.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
      return !!words && buttons.length === 2 && buttons.every((button) => button.left >= words.right - 0.5 && button.width > 0);
    }));
    await entry('person-robin-seed-swap').locator('[data-auto-entry]').click();
    await entry('person-robin-seed-swap').locator('[data-auto-entry]').click();
    await page.mouse.move(WIDTH - 20, HEIGHT - 12);
    check('they are not left up by a click once the pointer has gone', await until(async () => (await entry('person-robin-seed-swap').locator('button').first().evaluate((button) => getComputedStyle(button.parentElement).opacity)) === '0'));
    await shot(20, 'queue-left', () => entry('item-1').hover());

    // The last entry opens in view, its box included, in a pane too short to hold it where it was.
    await resize(WIDTH, 640);
    await wait(400);
    await entry('draft-1').locator('[data-auto-entry]').click();
    const lastInView = () => page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="auto-queue"]');
      const item = document.querySelector('[data-testid="auto-entry-draft-1"]');
      const field = item?.querySelector('[data-testid="auto-entry-box"]');
      if (!scroller || !item || !field) return null;
      const pane = scroller.getBoundingClientRect();
      return { scrolled: Math.round(scroller.scrollTop), under: Math.round(item.getBoundingClientRect().bottom - pane.bottom), box: Math.round(field.getBoundingClientRect().bottom - pane.bottom) };
    });
    check('the last entry opens whole and in view, with its box', await until(async () => {
      const at = await lastInView();
      return !!at && at.scrolled > 0 && at.under <= 1 && at.box <= 1;
    }, 3_000), JSON.stringify(await lastInView()));
    await shot(49, 'last-entry-open');
    await entry('draft-1').locator('[data-auto-entry]').click({ position: { x: 8, y: 8 } });
    await resize(WIDTH, HEIGHT);
    await wait(400);
    await queue.evaluate((element) => { element.scrollTop = 0; });

    // Resolve one, then Undo.
    await act('person-robin-seed-swap', 'Resolve');
    check('Resolve takes an entry out of Left', await until(async () => !(await entryIds()).includes('person-robin-seed-swap') && left() === 7 && (await digestSays()) === 'Digest7 left'));
    check('the foot of the list says what was resolved, name first', await until(async () => /^Robin \(seed swap\), resolvedUndo(\d more)?$/.test(await saidText())), await saidText());
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo brings it back', await until(async () => (await entryIds()).includes('person-robin-seed-swap') && left() === 8));
    check('both went as one resolve each, for the same entry', JSON.stringify(posts('/api/digest/resolve').slice(-2)) === JSON.stringify([{ date: DAY, id: 'person-robin-seed-swap', resolved: true }, { date: DAY, id: 'person-robin-seed-swap', resolved: false }]));

    // Resolve all in a section.
    await queue.getByRole('region', { name: 'Yesterday' }).getByRole('button', { name: 'Resolve all' }).click();
    check('Resolve all resolves a section’s open entries in one post', await until(async () => left() === 6 && (await queue.getByRole('region', { name: 'Yesterday' }).count()) === 0) && JSON.stringify(posts('/api/digest/resolve').at(-1)) === JSON.stringify({ date: DAY, ids: ['text-yesterday-5c1d2e3f', 'text-yesterday-a7b8c9d0'], resolved: true }));

    // Thread: a thread starts with his words. The button opens the entry with the caret in its box, and makes nothing yet.
    const committee = entry('meeting-allotment-committee');
    const threadsAsked = posts('/api/digest/thread').length;
    await act('meeting-allotment-committee', 'Thread');
    check('Thread opens the entry with the caret in its box, and makes no thread', await until(async () => (await committee.getAttribute('data-open')) === 'true' && (await focused()) === 'auto-entry-box', 3_000) && posts('/api/digest/thread').length === threadsAsked && (await committee.getByTestId('auto-entry-box').getAttribute('placeholder')) === 'Say what you want done', await focused());
    check('while the box is empty a quiet button offers a thread without words', ((await committee.getByTestId('auto-entry-wordless').textContent()) ?? '') === 'Make it without words');
    await shot(71, 'thread-words-first', null, ['light', 'dark'], false);
    await key('Enter');
    await key('Escape');
    check('Enter on no words makes nothing, and neither does stepping out', await until(async () => (await focused()) === 'meeting-allotment-committee') && posts('/api/digest/thread').length === threadsAsked && !service.entries().some((thread) => thread.title === 'Allotment committee') && (await entryIds()).includes('meeting-allotment-committee'));
    await key('t');
    check('T on the row goes to the same box', await until(async () => (await focused()) === 'auto-entry-box', 3_000), await focused());
    await page.keyboard.type('x');
    check('the way without words leaves once he has words', await until(async () => (await committee.getByTestId('auto-entry-wordless').count()) === 0));
    await key('Backspace');
    // Without words: the one-step thread, which waits on top of the list. He stays in the queue.
    await committee.getByTestId('auto-entry-wordless').click();
    check('Make it without words says what it made, with Open and Undo, and that there is more to undo', await until(async () => /^Allotment committee, made a threadOpenUndo\d more$/.test(await saidText())), await saidText());
    await shot(29, 'undo-thread');
    await said.getByRole('button', { name: 'Undo' }).click();
    check('Undo archives the waiting thread, and its entry is open again', await until(async () => (await entryIds()).includes('meeting-allotment-committee') && !service.entries().some((thread) => thread.title === 'Allotment committee') && left() === 6));
    await act('meeting-allotment-committee', 'Thread');
    await committee.getByTestId('auto-entry-wordless').click();
    check('a thread without words waits on top of the list, not started, and he stays in the queue', await until(async () => {
      const [top] = service.entries();
      return top.title === 'Allotment committee' && top.waits === true && (await groupIds('rest'))[0] === top.id && ((await row(top.id).getByTestId('auto-not-started').textContent().catch(() => '')) ?? '') === 'Not started' && !(await entryIds()).includes('meeting-allotment-committee') && (await page.getByTestId('auto-queue-pane').count()) === 1;
    }) && JSON.stringify(posts('/api/digest/thread').at(-1)) === JSON.stringify({ date: DAY, id: 'meeting-allotment-committee', start: false }));

    // A link in an entry's words opens the page; the digest's own file opens too.
    await entry('item-3').locator('[data-auto-entry]').click();
    await entry('item-3').locator('[data-vault-path="Projects/Kitchen/Tap.md"]').click();
    check('a vault link in an entry opens the page in Opal', await until(async () => (await page.getByTestId(`tab-${path.join(vault, 'Projects/Kitchen/Tap.md')}`).count()) === 1));
    // The queue has a tab of its own: the page opened from it goes in front, and the Digest tab brings the queue back.
    const toDigest = async () => {
      if ((await page.getByTestId('tab-digest').count()) === 1) await page.getByTestId('tab-digest').click();
      else await digestRow.click();
      await page.getByTestId('auto-queue-pane').waitFor({ timeout: 10_000 });
    };
    await toDigest();
    await page.getByRole('button', { name: 'Open the digest' }).click();
    check('Open the digest opens the digest’s file as a page', await until(async () => (await page.getByTestId(`tab-${path.join(vault, 'Library/digests/2026-11-13 digest.md')}`).count()) === 1));
    await toDigest();
    check('the queue is still open beside the list, with the entry he had open', (await page.getByTestId('auto-queue-pane').count()) === 1 && (await entry('item-3').getAttribute('data-open')) === 'true');
    await entry('item-3').locator('[data-auto-entry]').click({ position: { x: 8, y: 8 } });

    // An entry opened in place: a note written and removed, the drafted reply copied.
    await entry('item-1').locator('[data-auto-entry]').click();
    const note = entry('item-1').getByRole('textbox', { name: 'Your note' });
    await note.waitFor({ timeout: 5_000 });
    check('a click opens an entry in place: its note, its drafted reply and a box', ((await entry('item-1').getByTestId('auto-entry-draft').textContent()) ?? '').startsWith('Reply drafted for Garden centre') && (await entry('item-1').getByTestId('auto-entry-box').getAttribute('placeholder')) === 'Say what you want done' && (await note.getAttribute('placeholder')) === 'Add a note');
    await note.fill('Ask about peat-free compost too');
    await entry('item-1').getByRole('button', { name: 'Save the note' }).click();
    check('Save the note keeps his note on the entry', await until(() => service.digest()?.sections[1].entries[0].note === 'Ask about peat-free compost too') && JSON.stringify(posts('/api/digest/note').at(-1)) === JSON.stringify({ date: DAY, id: 'item-1', text: 'Ask about peat-free compost too' }));
    await until(async () => (await entry('item-1').getByRole('button', { name: 'Save the note' }).count()) === 0);
    check('after a click on Save the note the keyboard is on the entry', await until(async () => (await focused()) === 'item-1'), await focused());
    await shot(21, 'entry-open');
    await entry('item-1').getByRole('button', { name: 'Copy', exact: true }).click();
    check('Copy puts the drafted reply on the clipboard, and nothing else happens', (await page.evaluate(() => window.__copied)) === 'Two trays of 40 cells, please.\n\nI can collect them on Saturday morning.' && (await entry('item-1').getByTestId('auto-entry-draft').getByRole('button').count()) === 1);
    await note.fill('');
    await entry('item-1').getByRole('button', { name: 'Remove the note' }).click();
    check('Remove the note takes it off', await until(() => service.digest()?.sections[1].entries[0].note === ''));
    check('one entry is open at a time', await (async () => {
      await entry('item-3').locator('[data-auto-entry]').click();
      const one = (await queue.locator('li[data-open]').count()) === 1 && (await entry('item-3').getAttribute('data-open')) !== null;
      await entry('item-1').locator('[data-auto-entry]').click();
      return one && (await queue.locator('li[data-open]').count()) === 1;
    })());

    // Words in the box start a thread with the entry and open it.
    const words = entry('item-1').getByTestId('auto-entry-box');
    await words.fill('Ask for collection on Saturday');
    service.slow(1_500);
    await words.press('Enter');
    check('his words show on their way the moment Enter is taken', await until(async () => ((await entry('item-1').getByTestId('auto-entry-pending').textContent().catch(() => '')) ?? '') === 'Ask for collection on Saturday', 600) && (await words.inputValue()) === '');
    service.slow(0);
    check('words in the box start a thread with them, and it opens', await until(async () => {
      const [top] = service.entries();
      return top.title === 'Order the seed trays' && (await page.getByTestId('auto-thread').count()) === 1 && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Order the seed trays' && ((await talk.locator('[data-testid="auto-message"]').first().textContent().catch(() => '')) ?? '') === 'Ask for collection on Saturday';
    }));
    const saidWords = posts('/api/digest/thread').at(-1);
    check('they went as words with a message id, and never as a send', saidWords?.words === 'Ask for collection on Saturday' && /^[0-9a-f]{10}$/.test(saidWords?.cid ?? '') && Object.keys(saidWords ?? {}).sort().join() === 'cid,date,id,words');
    await until(() => service.entries()[0].status === 'idle');

    // All: what became of each entry.
    await digestRow.click();
    await page.getByTestId('auto-queue-all').click();
    check('All shows the day whole, with what became of each entry', await until(async () => (await entryIds()).length === 10 && ((await entry('text-yesterday-88ae3a55').textContent()) ?? '').endsWith('ResolvedReopen') && ((await entry('item-2').textContent()) ?? '').includes(service.thread(INSPECTION)?.last ?? '\u0000') && (await entry('item-2').getByRole('button', { name: 'Open the thread' }).count()) === 0));
    check('an entry whose thread nobody has started says Not started under its words, which are not said again', await entry('meeting-allotment-committee').evaluate((element) => {
      const words = (element.querySelector('[data-testid="auto-entry-words"]')?.textContent ?? '').slice(0, 24);
      return element.querySelector('[data-testid="auto-not-started"]')?.textContent === 'Not started' && words.length > 0 && (element.textContent ?? '').split(words).length === 2;
    }), (await entry('meeting-allotment-committee').textContent()) ?? '');
    await shot(22, 'queue-all', () => entry('item-2').hover());
    await act('text-yesterday-5c1d2e3f', 'Reopen');
    check('Reopen opens a resolved entry again', await until(() => service.digest()?.sections[4].entries[1].state === 'open'));
    await entry('item-2').locator('[data-auto-entry]').click();
    check('an entry that became a thread opens that thread', await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Book the allotment inspection'));

    // A change made on another device: the open day and the row's count are read again.
    await digestRow.click();
    const leftBefore = left();
    await fromPhone('/api/digest/resolve', { date: DAY, id: 'item-3' });
    check('a change made on another device shows without a click', await until(async () => left() === leftBefore - 1 && (await digestSays()) === `Digest${leftBefore - 1} left` && (await entry('item-3').getAttribute('data-state')) === 'resolved'));

    // An earlier day opens whole; a day with nothing in it says so.
    await page.getByRole('button', { name: 'Earlier day' }).click();
    check('Earlier day steps back, to the day whole', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Thursday, November 12' && (await page.getByTestId('auto-queue-all').getAttribute('aria-pressed')) === 'true' && (await entryIds()).join() === 'item-1,item-2,text-yesterday-1a2b3c4d' && ((await entry('item-2').getByTestId('auto-entry-note').textContent()) ?? '') === 'The stone is in the blue tin'));
    check('the row still counts the latest day', (await digestSays()) === `Digest${left()} left`);
    check('the arrows stay where they were when the day’s name changes', JSON.stringify(await arrows()) === JSON.stringify(arrowsLatest), `${JSON.stringify(arrowsLatest)} -> ${JSON.stringify(await arrows())}`);
    await shot(23, 'earlier-day');
    await page.getByRole('button', { name: 'Earlier day' }).click();
    check('a digest with no entries says so', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Wednesday, November 11' && ((await page.getByTestId('auto-queue-empty').textContent()) ?? '') === 'This digest has no entries.' && (await page.getByRole('button', { name: 'Earlier day' }).isDisabled())));
    check('at the first day the keyboard moves to the arrow that still goes somewhere', await until(async () => (await focused()) === 'Later day'), await focused());
    await key('Enter');
    await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Thursday, November 12');
    await key('Enter');
    check('Later day steps forward to the latest, on Left, and the keyboard moves to Earlier day', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Friday, November 13' && (await page.getByTestId('auto-queue-left').getAttribute('aria-pressed')) === 'true' && (await page.getByRole('button', { name: 'Later day' }).isDisabled()) && (await focused()) === 'Earlier day'), await focused());

    // --- Archive the digest: off the list until the next one, readable from the archive and by stepping days.
    const leftBeforeArchive = left();
    await page.getByTestId('auto-digest-menu').click();
    check('the queue’s menu holds one thing: Archive the digest', await until(async () => (await page.getByRole('menuitem').allTextContents()).join() === 'Archive the digest'), (await page.getByRole('menuitem').allTextContents()).join());
    await page.getByRole('menuitem', { name: 'Archive the digest' }).click();
    check('archived, the Digest row leaves the list at once and the service has it', await until(async () => (await digestRow.count()) === 0 && service.digest()?.archived === true) && JSON.stringify(posts('/api/digest/archive').at(-1)) === JSON.stringify({ date: DAY, archived: true }), JSON.stringify(posts('/api/digest/archive').at(-1)));
    check('the line says so, with Undo', (await saidText()) === 'Digest archived. It is off the list.Undo', await saidText());
    check('the queue stays open to read, and says Archived at its foot with the way back', (await page.getByTestId('auto-queue-pane').count()) === 1 && (await textOf('auto-queue-archived')) === 'ArchivedIt is off the list until the next digest.Bring back' && (await textOf('auto-queue-day')) === 'Friday, November 13' && (await entryIds()).length > 0, await textOf('auto-queue-archived'));
    check('nothing in it changed', left() === leftBeforeArchive && (await oneColumn('auto-queue-pane')));
    // The keyboard is back on the menu's button; the picture is of the pane without its tooltip.
    await page.evaluate(() => document.activeElement?.blur());
    await shot(66, 'undo-digest-archive');
    await page.getByTestId('auto-digest-menu').click();
    check('archived, its menu offers the one verb: Bring back', await until(async () => (await page.getByRole('menuitem').allTextContents()).join() === 'Bring back'));
    await key('Escape');
    await until(async () => (await page.getByRole('menu').count()) === 0);
    // In the archive, first.
    await showLine('archived');
    const archivedDigest = page.getByTestId(`auto-archived-digest-${DAY}`);
    check('an archived digest is listed first under Archived, by its day', await until(async () => (await page.getByTestId('auto-archived').locator('[data-away-row]').first().getAttribute('data-row-id')) === `:digest:${DAY}` && ((await archivedDigest.textContent()) ?? '').startsWith('DigestFriday, November 13')), (await archivedDigest.textContent().catch(() => '')) ?? '');
    await shot(74, 'archived-digest');
    // Readable from its row in the archive, and by stepping days.
    await archivedDigest.locator('[data-away-row]').click();
    check('its row in the archive opens that day in the queue, with Put away still marked', await until(async () => (await textOf('auto-queue-day')) === 'Friday, November 13' && (await page.getByTestId('auto-queue-archived').count()) === 1 && (await awayRow.getAttribute('aria-current')) === 'true'));
    await page.getByRole('button', { name: 'Earlier day' }).click();
    await until(async () => (await textOf('auto-queue-day')) === 'Thursday, November 12');
    check('an earlier day that is not archived has no such line at its foot', (await page.getByTestId('auto-queue-archived').count()) === 0);
    await page.getByRole('button', { name: 'Later day' }).click();
    await until(async () => (await textOf('auto-queue-day')) === 'Friday, November 13');
    await page.getByTestId('auto-digest-back').click();
    check('Bring back puts the Digest row back, tells the service, and the line says so', await until(async () => (await digestRow.count()) === 1 && service.digest()?.archived === false && (await saidText()) === 'Back in the list.Undo' && (await page.getByTestId('auto-queue-archived').count()) === 0) && JSON.stringify(posts('/api/digest/archive').at(-1)) === JSON.stringify({ date: DAY, archived: false }), await saidText());
    // From another device, and back from its row in the archive.
    await fromPhone('/api/digest/archive', { date: DAY, archived: true });
    check('an archive made on another device takes the row away without a click', await until(async () => (await digestRow.count()) === 0 && (await page.getByTestId('auto-queue-archived').count()) === 1));
    await showLine('archived');
    await until(async () => (await archivedDigest.count()) === 1);
    await archivedDigest.hover();
    await page.getByTestId(`auto-restore-digest-${DAY}`).click();
    check('Bring back on its row in the archive returns it', await until(async () => (await digestRow.count()) === 1 && service.digest()?.archived === false && (await archivedDigest.count()) === 0));
    await hideLine();
    await listRowsPane.evaluate((element) => { element.scrollTop = 0; });
    // From the Digest row itself: a right-click menu, and E with the keyboard on it.
    await digestRow.click({ button: 'right' });
    const digestMenu = await until(async () => (await page.getByTestId('auto-digest-menu-row').count()) === 1) ? await page.getByTestId('auto-digest-menu-row').getByRole('menuitem').allTextContents() : [];
    check('the Digest row offers a new tab, a split, archiving, and the digest file', digestMenu[0] === 'Open in new tab' && digestMenu[1] === 'Open to the side' && digestMenu[2]?.startsWith('Archive the digest') && digestMenu[3] === 'Open the digest', digestMenu.join(' | '));
    await page.getByTestId('auto-digest-menu-row').getByRole('menuitem', { name: /^Archive the digest/ }).click();
    check('which archives it, with Undo', await until(async () => (await digestRow.count()) === 0 && service.digest()?.archived === true && (await saidText()).startsWith('Digest archived. It is off the list.Undo')), await saidText());
    await said.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await digestRow.count()) === 1 && service.digest()?.archived === false);
    await digestRow.focus();
    await key('e');
    check('E on the Digest row archives it, with Undo, and the keyboard goes to the next row', await until(async () => (await digestRow.count()) === 0 && service.digest()?.archived === true && (await saidText()).startsWith('Digest archived. It is off the list.Undo') && (await rowIds())[0] === (await focused())), `${await focused()} | ${await saidText()}`);
    await said.getByRole('button', { name: 'Undo' }).click();
    check('and Undo brings it back', await until(async () => (await digestRow.count()) === 1 && service.digest()?.archived === false));
    await digestRow.click();
    await page.getByTestId('auto-queue-left').click();
    await until(async () => (await page.getByTestId('auto-queue-left').getAttribute('aria-pressed')) === 'true');

    // The queue is a pane like a thread: in a narrow window it fills the tab, with the sidebar an overlay.
    await resize(NARROW, HEIGHT);
    await until(async () => (await page.getByTestId('app-shell').getAttribute('data-layout')) === 'narrow' && (await page.getByTestId('auto-queue-pane').count()) === 1);
    const arrowsNarrow = await arrows();
    check('in a narrow window the day arrows and the menu stay together at the right of the queue’s header, with no back button', !!arrowsNarrow && arrowsNarrow.later > arrowsNarrow.earlier && arrowsNarrow.menu >= 0 && arrowsNarrow.menu < 12 && arrowsNarrow.gap >= 0 && arrowsNarrow.gap <= 26 && (await page.getByTestId('auto-back').count()) === 0, JSON.stringify(arrowsNarrow));
    // The keyboard is on Earlier day from the step before; the picture is of the header without its tooltip.
    await page.evaluate(() => document.activeElement?.blur());
    await shot(53, 'narrow-queue');
    check('in a narrow window the queue shows with no list beside it', (await page.getByTestId('auto-list').count()) === 0 && (await page.getByTestId('auto-queue-pane').count()) === 1);
    await resize(WIDTH, HEIGHT);
    await until(async () => (await page.getByTestId('app-shell').getAttribute('data-layout')) === 'wide');
    await digestRow.click();

    // --- Away from the tab: with no Auto tab open the list's stream still keeps the sidebar's count true.
    // The thread that will ask is read first, so its question is one more for the count.
    await row(BEDS).click();
    await until(() => service.thread(BEDS)?.unread === false);
    await digestRow.click();
    for (const name of ['auto', 'digest']) {
      await page.getByTestId(`tab-${name}`).hover();
      await page.getByTestId(`tab-close-${name}`).click();
      await until(async () => (await page.getByTestId(`tab-${name}`).count()) === 0);
    }
    await until(async () => sidebarSays(needsHim()));
    const countBefore = needsHim();
    await fromPhone(`/api/threads/${BEDS}/messages`, { text: 'Which bed gets the leeks?', cid: 'p4' });
    check('with no Auto tab open the sidebar still counts a thread that starts to wait', await until(async () => service.thread(BEDS)?.status === 'waiting' && needsHim() === countBefore + 1 && (await sidebarSays(countBefore + 1))), `${countBefore} -> ${needsHim()}, ${await headingCount()}`);
    check('no thread’s stream is open while no tab is, so the phone’s pings are not held back', !service.entries().some((thread) => (service.thread(thread.id)?.clients.size ?? 0) > 0));

    // --- With the keyboard alone: the tab from the palette, two entries cleared, two threads archived, a turn stopped.
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('>open auto digest');
    await page.getByTestId('palette-command-auto.openDigest').waitFor({ timeout: 5_000 });
    await key('Enter');
    await auto.waitFor({ timeout: 10_000 });
    const queued = await until(async () => (await entryIds()).length >= 4) ? await entryIds() : [];
    check('the palette opens the tab, with the keyboard on the queue’s first entry', await until(async () => queued.length >= 4 && (await focused()) === queued[0]), `${queued.join()} ${await focused()}`);
    const stateOf = (id) => service.digest()?.sections.flatMap((section) => section.entries).find((each) => each.id === id)?.state;
    // The queue's own keys: [ and ] step a day, A switches between Left and All.
    await key('[');
    check('[ steps to the earlier day, with the keyboard on its first entry', await until(async () => (await textOf('auto-queue-day')) === 'Thursday, November 12' && (await focused()) === 'item-1'), `${await textOf('auto-queue-day')} ${await focused()}`);
    await key(']');
    check('] steps to the later day, with the keyboard on its first entry', await until(async () => (await textOf('auto-queue-day')) === 'Friday, November 13' && (await focused()) === queued[0]), `${await textOf('auto-queue-day')} ${await focused()}`);
    await key('a');
    check('A switches to All', await until(async () => (await page.getByTestId('auto-queue-all').getAttribute('aria-pressed')) === 'true' && (await entryIds()).length === 10));
    await key('a');
    check('and A again to Left, with the keyboard still on the entry', await until(async () => (await page.getByTestId('auto-queue-left').getAttribute('aria-pressed')) === 'true' && (await focused()) === queued[0]), await focused());
    await key('e');
    check('E resolves the entry and the keyboard moves to the next', await until(async () => stateOf(queued[0]) === 'resolved' && (await focused()) === queued[1]), await focused());
    // The second one on a slow service: it is taken back before its post has landed, and stays back while both land.
    service.slow(600);
    await key('e');
    check('a second E clears the next one at once', await until(async () => !(await entryIds()).includes(queued[1]) && (await focused()) === queued[2], 2_000) && stateOf(queued[1]) === 'open', await focused());
    await key('Meta+z');
    let entrySteady = await until(async () => (await entryIds()).includes(queued[1]) && (await focused()) === queued[1], 2_000);
    for (let sample = 0; sample < 40; sample += 1) {
      entrySteady = entrySteady && (await entryIds()).includes(queued[1]) && !(await entryIds()).includes(queued[0]);
      await wait(50);
    }
    check('Cmd+Z brings it back at once, under the keyboard, and it does not leave again while the posts land', entrySteady, await focused());
    check('the service heard the resolve and then its undoing', await until(() => stateOf(queued[1]) === 'open' && JSON.stringify(posts('/api/digest/resolve').slice(-2).map((body) => [body.id ?? body.ids?.[0], body.resolved])) === JSON.stringify([[queued[1], true], [queued[1], false]]), 10_000), JSON.stringify(posts('/api/digest/resolve').slice(-2)));
    service.slow(0);
    await key('e');
    await until(async () => stateOf(queued[1]) === 'resolved' && (await focused()) === queued[2]);
    await key('j');
    await key('k');
    check('J and K move between entries as the arrows do', (await focused()) === queued[2]);
    await key('n');
    check('N opens an entry with the caret in its note', await until(async () => (await focused()) === 'Your note' && (await entry(queued[2]).getAttribute('data-open')) === 'true'));
    await page.keyboard.type('Bring the trowel');
    await key('Meta+Enter');
    check('Cmd+Enter saves the note', await until(() => posts('/api/digest/note').at(-1)?.text === 'Bring the trowel' && posts('/api/digest/note').at(-1)?.id === queued[2]));
    await key('Escape');
    check('Escape in a field goes back to the entry’s row', await until(async () => (await focused()) === queued[2]));
    await shot(36, 'queue-keys');
    await key('Escape');
    check('Escape on the row closes the entry', await until(async () => (await entry(queued[2]).getAttribute('data-open')) === null && (await focused()) === queued[2]));
    await key('t');
    check('T opens the entry with the caret in its box, for what he wants done, and makes nothing yet', await until(async () => (await focused()) === 'auto-entry-box') && stateOf(queued[2]) === 'open', await focused());
    await key('Tab');
    check('Tab from the empty box reaches the usage ring first', await until(async () => (await focused()) === 'auto-usage-ring'), await focused());
    await key('Tab');
    check('and the next Tab reaches Make it without words', await until(async () => (await focused()) === 'auto-entry-wordless'), await focused());
    await key('Enter');
    check('which makes a thread of the entry that waits on top of the list, and the keyboard moves on', await until(async () => stateOf(queued[2]) === 'thread' && (await focused()) === queued[3]), await focused());
    check('the line says what was made, with Open', /, made a threadOpenUndo/.test(await saidText()), await saidText());
    await key('Escape');
    check('Escape from the queue puts the keyboard on the Digest row', await until(async () => (await focused()) === ':digest'));

    // The list: one arrow sequence through Digest and every row. New thread is the button beside the heading.
    await key('ArrowDown');
    const [one, two, three, four] = await rowIds();
    check('Down from the Digest row is the first thread', (await focused()) === one && one === BEDS, `${await focused()} ${one}`);
    // O opens what the last action made, while its line still offers it.
    const made = service.entries()[0];
    await key('o');
    check('O opens the thread the last action made, and its line goes', await until(async () => (await row(made.id).locator('[aria-current]').count()) === 1 && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === made.title && !/made a thread/.test(await saidText())), `${made.title} | ${await saidText()}`);
    await key('Escape');
    await until(async () => (await focused()) === made.id);
    await key('Home');
    await key('ArrowDown');
    check('Home is the Digest row, and Down the first thread', await until(async () => (await focused()) === one, 2_000), await focused());

    // Three archives, taken back one by one with Cmd+Z while the service is slow: the first is undone before its post has landed.
    service.slow(700);
    await key('e');
    await until(async () => (await focused()) === two, 2_000);
    await key('e');
    await until(async () => (await focused()) === three, 2_000);
    await key('e');
    await until(async () => (await focused()) === four, 2_000);
    const inFlight = [one, two, three].filter((id) => service.thread(id)?.archived !== true).length;
    check('three rows leave at once, and the line offers the newest and says how many more', !(await rowIds()).some((id) => [one, two, three].includes(id)) && /^Archived: .+Undo\d more$/.test(await saidText()) && Number((await page.getByTestId('auto-said-more').textContent())?.replace(/\D/g, '')) >= 2, await saidText());
    const landed = service.thread(three)?.archived === true;
    await key('Meta+z');
    check('Cmd+Z brings the newest back at once, while its post is still on the way', await until(async () => (await rowIds()).includes(three) && (await focused()) === three, 2_000) && !landed && inFlight > 0, `${inFlight} of 3 still on the way`);
    await key('Meta+z');
    await until(async () => (await focused()) === two, 2_000);
    await key('Meta+z');
    check('two more bring back the other two, newest first, each under the keyboard', await until(async () => (await focused()) === one, 2_000) && (await rowIds()).slice(0, 4).join() === [one, two, three, four].join(), (await rowIds()).slice(0, 4).join());
    // The service's own word of each archive arrives after he has taken it back. No row leaves a second time, and the open thread stays open.
    const openBefore = await page.evaluate(() => document.querySelector('[data-testid="auto-list"] [aria-current]')?.getAttribute('data-row-id') ?? '');
    let steady = true;
    for (let sample = 0; sample < 50; sample += 1) {
      const rows = await rowIds();
      const openNow = await page.evaluate(() => document.querySelector('[data-testid="auto-list"] [aria-current]')?.getAttribute('data-row-id') ?? '');
      steady = steady && rows.slice(0, 4).join() === [one, two, three, four].join() && openNow === openBefore;
      await wait(50);
    }
    check('while the posts land no row leaves a second time, and the open thread stays open', steady && openBefore !== '', `${openBefore} | ${(await rowIds()).slice(0, 4).join()}`);
    check('the service has all three again: each archived, then brought back, in that order', await until(() => [one, two, three].every((id) => service.thread(id)?.archived === false && JSON.stringify(posts(`/api/threads/${id}/archive`).slice(-2).map((body) => body.archived)) === '[true,false]'), 15_000), [one, two, three].map((id) => JSON.stringify(posts(`/api/threads/${id}/archive`).slice(-2).map((body) => body.archived))).join());
    check('none of the three is on offer any more', !/Archived/.test(await saidText()), await saidText());
    service.slow(0);
    // The same three again, for the picture of the line with more behind it.
    for (const next of [two, three, four]) {
      await key('e');
      await until(async () => (await focused()) === next, 2_000);
    }
    await shot(47, 'undo-stack');
    for (const back of [three, two, one]) {
      await key('Meta+z');
      await until(async () => (await focused()) === back && service.thread(back)?.archived === false, 5_000);
    }
    check('all three are back after the second round', [one, two, three].every((id) => service.thread(id)?.archived === false) && (await focused()) === one, await focused());

    await key('ArrowDown');
    await key('s');
    await page.getByTestId('auto-snooze-menu').waitFor({ timeout: 5_000 });
    await key('ArrowDown');
    await key('Enter');
    check('S opens the snooze menu, and a pick snoozes with the keyboard moving on', await until(async () => service.thread(two)?.snoozed > 0 && (await focused()) === three), await focused());
    await key('m');
    check('M marks the thread for the Mac, and the keyboard goes with the row', await until(async () => service.thread(three)?.desk?.by === 'opal' && (await focused()) === three), await focused());
    await key('m');
    await until(async () => service.thread(three)?.desk === null && (await focused()) === three);
    // A row of his own order moves; the ones lifted to the top do not.
    const [mover] = await groupIds('rest');
    await key('Home');
    for (let presses = 0; presses < 16 && (await focused()) !== mover; presses += 1) await key('ArrowDown');
    const placeOf = (id) => service.entries().findIndex((thread) => thread.id === id);
    const placeBefore = placeOf(mover);
    await key('Alt+ArrowDown');
    check('Option+Down moves the row one place down, as a drag would', await until(async () => placeOf(mover) > placeBefore && (await groupIds('rest'))[1] === mover && (await focused()) === mover), `${placeBefore} -> ${placeOf(mover)}`);
    await key('Alt+ArrowUp');
    await until(async () => placeOf(mover) === placeBefore && (await focused()) === mover);
    await key('Shift+F10');
    check('Shift+F10 opens the row’s menu, with the keys beside its items', await until(async () => (await page.getByTestId(`auto-row-menu-${mover}`).count()) === 1) && ((await page.getByTestId(`auto-row-menu-${mover}`).getByRole('menuitem', { name: /^Archive/ }).textContent()) ?? '') === 'ArchiveE' && (await page.getByTestId(`auto-row-menu-${mover}`).getByRole('menuitem', { name: 'Rename' }).count()) === 1);
    await shot(37, 'row-menu-keys', async () => {
      if ((await page.getByTestId(`auto-row-menu-${mover}`).count()) === 0) await key('Shift+F10');
    });
    await key('Escape');
    check('Escape closes it and the keyboard is back on the row', await until(async () => (await page.getByTestId(`auto-row-menu-${mover}`).count()) === 0 && (await focused()) === mover), await focused());
    await key('Home');
    check('Home is the Digest row', (await focused()) === ':digest', await focused());
    await newThread.focus();
    await key('Enter');
    check('Enter opens it with the caret in the box, which is empty', await until(async () => (await focused()) === 'auto-box') && (await box.inputValue()) === '');
    service.hold('stream');
    await page.keyboard.type('Sort the seed list slowly again');
    await key('Enter');
    await page.getByTestId('auto-stop').waitFor({ timeout: 10_000 });
    const running = service.entries()[0].id;
    await key('Meta+.');
    check('Cmd+. stops the running turn, and the keyboard stays in the box', await until(async () => (await page.getByTestId('auto-stop').count()) === 0 && service.thread(running)?.status !== 'working' && (await focused()) === 'auto-box'), `${service.thread(running)?.status} ${await focused()}`);
    service.release('stream');
    await key('Escape');
    check('Escape leaves the box for the thread’s row', await until(async () => (await focused()) === running), await focused());
    check('every step of that went by key: no pointer moved a thing', true);

    // --- The palette: a new thread, the digest, the open thread's actions, and threads by their titles.
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await key('Escape');
    check('Escape in the palette gives the keyboard back to the row it was opened from', await until(async () => (await page.getByTestId('command-palette').count()) === 0 && (await focused()) === running), await focused());
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('sourdough');
    check('the palette finds a thread by its title', await until(async () => ((await page.getByTestId(`palette-command-auto.thread.${BREAD}`).textContent().catch(() => '')) ?? '') === 'Sourdough timingsAuto thread'));
    await shot(38, 'palette-thread');
    await page.getByTestId(`palette-command-auto.thread.${BREAD}`).click();
    check('and opens it', await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Sourdough timings'));
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('>thread');
    check('the palette has the open thread’s actions and a new thread', await until(async () => (await page.getByTestId('palette-command-auto.archiveThread').count()) === 1 && (await page.getByTestId('palette-command-auto.snoozeThread').count()) === 1 && (await page.getByTestId('palette-command-auto.markThread').count()) === 1 && ((await page.getByTestId('palette-command-auto.newThread').textContent()) ?? '') === 'New Auto thread'));
    check('Rename thread is there too, and Stop is not while nothing runs', (await page.getByTestId('palette-command-auto.renameThread').count()) === 1 && (await page.getByTestId('palette-command-auto.stopThread').count()) === 0);
    await page.getByTestId('palette-command-auto.markThread').click();
    check('Mark thread for the Mac, from the palette', await until(() => service.thread(BREAD)?.desk?.by === 'opal'));
    await fromMenu(BREAD, 'Take off the Mac mark');
    await until(() => service.thread(BREAD)?.desk === null);
    await row(BREAD).click();
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('>rename thread');
    await page.getByTestId('palette-command-auto.renameThread').click();
    check('Rename thread, from the palette, opens the title as a field with the keyboard in it', await until(async () => (await focused()) === 'Thread title', 3_000), await focused());
    await key('Escape');
    check('Escape leaves the title as it was', await until(async () => (await textOf('auto-title')) === 'Sourdough timings' && service.thread(BREAD)?.title === 'Sourdough timings'));
    service.hold('stream');
    await say('Sort the seed list slowly, a third time');
    await page.getByTestId('auto-stop').waitFor({ timeout: 10_000 });
    await key('Meta+k');
    await page.getByTestId('command-palette').waitFor({ timeout: 5_000 });
    await page.keyboard.type('>stop');
    check('while a turn runs the palette has Stop', await until(async () => (await textOf('palette-command-auto.stopThread')).startsWith('Stop')), await textOf('palette-command-auto.stopThread'));
    await page.getByTestId('palette-command-auto.stopThread').click();
    check('which stops the turn', await until(async () => (await page.getByTestId('auto-stop').count()) === 0 && service.thread(BREAD)?.status !== 'working'), String(service.thread(BREAD)?.status));
    service.release('stream');
    await box.fill('');
    // Tab into the list lands on the open thread's row, not on the row the keyboard last walked to.
    const tabStops = () => page.locator('[data-testid="auto-list"] [data-auto-row][tabindex="0"]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-row-id')).join());
    await box.click();
    await key('Escape');
    await until(async () => (await focused()) === BREAD);
    await key('ArrowDown');
    const walkedTo = await focused();
    check('while the keyboard walks the list its Tab stop goes with it', walkedTo !== BREAD && (await tabStops()) === walkedTo, `${walkedTo} | ${await tabStops()}`);
    await box.click();
    check('once the keyboard has left the list, its one Tab stop is the open thread’s row', await until(async () => (await tabStops()) === BREAD, 3_000), await tabStops());
    // From New thread beside the Threads heading, Tab goes into the list, and Shift+Tab from the row after it comes back.
    await newThread.focus();
    await key('Tab');
    const tabIn = await focused();
    check('Tab from New thread into the list lands on that row', tabIn === BREAD, tabIn);
    await key('Shift+Tab');
    check('and Shift+Tab goes back to New thread', (await focused()) === ':new', await focused());

    // --- One reading column at every width: 1512 and 1700 wide, with the right sidebar shown and hidden.
    const rightSidebar = async (shown) => {
      if (((await page.getByTestId('day-sidebar').count()) === 1) !== shown) await page.getByRole('button', { name: /right sidebar/i }).first().click();
      await until(async () => ((await page.getByTestId('day-sidebar').count()) === 1) === shown);
      await wait(300);
    };
    const queueEdges = () => page.evaluate(() => {
      const left = (selector) => Math.round(document.querySelector(selector)?.getBoundingClientRect().left ?? -1);
      const words = document.querySelector('[data-testid="auto-queue"] [data-auto-entry] p');
      return [left('[data-testid="auto-queue-day"]'), left('[data-testid="auto-queue"] h2'), Math.round(words?.getBoundingClientRect().left ?? -2)];
    });
    for (const [width, height] of [[1512, 944], [1700, 1000]]) {
      await page.setViewportSize({ width, height });
      await wait(500);
      for (const shown of [true, false]) {
        const where = `at ${width} wide with the right sidebar ${shown ? 'shown' : 'hidden'}`;
        await rightSidebar(shown);
        await row(BREAD).click();
        await talk.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        check(`${where}, the title, the text and the box share their edges`, (await oneColumn('auto-thread')) && new Set(await threadEdges()).size === 1 && (await page.evaluate(() => (document.querySelector('[data-testid="auto-thread"] form')?.getBoundingClientRect().width ?? 9999))) <= 672.5, (await threadEdges()).join());
        if (width === 1700) await shot(shown ? 39 : 40, shown ? 'wide-thread' : 'wide-thread-no-right-sidebar');
        await digestRow.click();
        await page.getByTestId('auto-queue-all').click();
        check(`${where}, the queue’s day, labels and entries share their edges`, (await oneColumn('auto-queue-pane')) && new Set(await queueEdges()).size === 1, (await queueEdges()).join());
        if (width === 1700) await shot(shown ? 42 : 41, shown ? 'wide-queue' : 'wide-queue-no-right-sidebar');
        await page.getByTestId('auto-queue-left').click();
      }
      await rightSidebar(true);
    }
    // --- Threads when it scrolls: up to 70% of the room it shares with Library, all of it when Library is folded.
    const listRows = page.getByTestId('auto-list-rows');
    // The right edges of a row and of the Digest row's count, before Threads overflows and after.
    const rowEnds = () => page.evaluate(() => {
      const right = (selector) => Math.round((document.querySelector(selector)?.getBoundingClientRect().right ?? -1) * 10) / 10;
      return `${right('[data-testid="auto-list-rows"] [data-thread-id]')} ${right('[data-testid="auto-digest-left"]')}`;
    });
    await hideLine();
    // Tall enough that the rows fit in both looks, then short enough that they scroll.
    await page.setViewportSize({ width: WIDTH, height: 1100 });
    await wait(400);
    await listRows.evaluate((element) => { element.scrollTop = 0; });
    const edgesAtRest = await rowEnds();
    const restOverflow = await listRows.evaluate((element) => element.scrollHeight - element.clientHeight);
    await page.setViewportSize({ width: WIDTH, height: 520 });
    await wait(400);
    check('nothing moves sideways when Threads starts to scroll: a row and the Digest count keep their right edges', restOverflow <= 0 && (await listRows.evaluate((element) => element.scrollHeight - element.clientHeight)) > 0 && (await rowEnds()) === edgesAtRest, `${restOverflow}: ${edgesAtRest} -> ${await rowEnds()}`);
    check('a cut edge fades: the bottom while more is below', (await listRows.getAttribute('data-fade-y')) === 'bottom', String(await listRows.getAttribute('data-fade-y')));
    // The Put away row stays in view under the part that scrolls, whatever the list's length.
    check('the Put away row stays in view under the scrolling rows', await page.evaluate(() => {
      const away = document.querySelector('[data-testid="auto-away-row"]')?.getBoundingClientRect();
      const rows = document.querySelector('[data-testid="auto-list-rows"]')?.getBoundingClientRect();
      const threads = document.querySelector('[data-testid="sidebar-threads"]')?.getBoundingClientRect();
      return !!away && !!rows && !!threads && away.height > 0 && away.top >= rows.bottom - 1 && away.bottom <= threads.bottom + 1;
    }));
    await listRows.evaluate((element) => { element.scrollTop = 40; });
    check('scrolled, the top edge fades too', await until(async () => ['top', 'both'].includes(await listRows.getAttribute('data-fade-y'))), String(await listRows.getAttribute('data-fade-y')));
    const heights = () => page.evaluate(() => {
      const height = (id) => Math.round(document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().height ?? -1);
      const rows = document.querySelector('[data-testid="auto-list-rows"]');
      return { threads: height('sidebar-threads'), column: Math.round(document.querySelector('[data-testid="sidebar-threads"]')?.parentElement?.getBoundingClientRect().height ?? -1), overflow: rows ? rows.scrollHeight - rows.clientHeight : -1 };
    });
    await listRows.evaluate((element) => { element.scrollTop = 0; });
    await wait(200);
    const withLibrary = await heights();
    check('with Library open, Threads is at most 70% of the room it shares with Library and its rows scroll inside it', withLibrary.threads <= withLibrary.column * 0.7 + 1 && withLibrary.overflow > 60, JSON.stringify(withLibrary));
    const sameWidth = () => page.evaluate(() => {
      const digest = document.querySelector('[data-testid="auto-digest-row"]')?.getBoundingClientRect();
      const first = document.querySelector('[data-testid="auto-list-rows"] [data-thread-id]')?.getBoundingClientRect();
      return !!digest && !!first && Math.abs(digest.left - first.left) < 1 && Math.abs(digest.right - first.right) < 1;
    });
    check('the thread rows are as wide as the Digest row', await sameWidth());
    await listRows.evaluate((element) => { element.scrollTop = 60; });
    await shot(52, 'list-scrolled');
    await listRows.evaluate((element) => { element.scrollTop = 60; });
    await wait(200);
    await page.getByTestId('workspace-sidebar').getByRole('button', { name: 'Note', exact: true }).click();
    await until(async () => (await page.getByTestId('auto').count()) === 0);
    await toAuto();
    check('the list keeps its place while the tab is left and come back to', await until(async () => Math.abs((await listRows.evaluate((element) => element.scrollTop)) - 60) < 2, 3_000), String(await listRows.evaluate((element) => element.scrollTop)));

    // --- The headings fold: a click, Enter, Space, Left and Right, and the fold is kept across a reload.
    const libraryHeading = page.getByTestId('sidebar-fold-library');
    const expanded = async (heading) => (await heading.getAttribute('aria-expanded')) === 'true';
    await libraryHeading.click();
    const withoutLibrary = await heights();
    check('a click folds Library: its tree and pinned pages go, and Threads may take the whole sidebar', !(await expanded(libraryHeading)) && (await page.getByTestId('sidebar-library').locator('[role="tree"], [data-testid="pinned-section"]').count()) === 0 && withoutLibrary.threads > withLibrary.column * 0.7 + 1, JSON.stringify(withoutLibrary));
    await shot(80, 'library-folded');
    await threadsHeading.focus();
    await key('ArrowLeft');
    check('Left folds Threads', await until(async () => !(await expanded(threadsHeading)) && (await page.getByTestId('auto-list').count()) === 0));
    await key('ArrowRight');
    check('Right opens it', await until(async () => (await expanded(threadsHeading)) && (await page.getByTestId('auto-list').count()) === 1));
    await key('Enter');
    check('Enter folds it', await until(async () => !(await expanded(threadsHeading))));
    await key('Space');
    check('Space opens it', await until(async () => await expanded(threadsHeading)));
    await key('Enter');
    await shot(81, 'both-folded');
    check('folded, Threads keeps its count and its New thread button', (await headingCount()) !== '' && (await newThread.count()) === 1, await headingCount());
    await page.reload();
    await page.getByTestId('workspace-sidebar').waitFor({ timeout: 15_000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addStyleTag({ content: 'input, textarea { caret-color: transparent !important; }' });
    check('both folds are kept across a reload', await until(async () => (await threadsHeading.count()) === 1 && !(await expanded(threadsHeading)) && !(await expanded(libraryHeading))));
    await threadsHeading.click();
    await libraryHeading.click();
    check('and both open again', await until(async () => (await expanded(threadsHeading)) && (await expanded(libraryHeading)) && (await page.getByTestId('auto-list').count()) === 1));
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await wait(400);

    // --- Thirteen threads and a short tree: Threads takes what it needs, and the put-away lines are in view.
    // At 1100 px of window, a common laptop height: thirteen threads need more than 70% of 933 px's room.
    await page.setViewportSize({ width: WIDTH, height: 1100 });
    for (let made = 0; (await listedIds()).length < 13 && made < 13; made += 1) {
      const before = (await listedIds()).length;
      await fromPhone('/api/threads', { text: `Extra thread ${made + 1} for the height check`, cid: `h${made}` });
      await until(async () => (await listedIds()).length > before, 5_000);
    }
    await until(() => service.entries().every((thread) => thread.status !== 'working'), 15_000);
    await listRows.evaluate((element) => { element.scrollTop = 0; });
    await wait(300);
    const thirteen = await heights();
    const awayInView = () => page.evaluate(() => {
      const away = document.querySelector('[data-testid="auto-away-row"]')?.getBoundingClientRect();
      const threads = document.querySelector('[data-testid="sidebar-threads"]')?.getBoundingClientRect();
      return !!away && !!threads && away.height > 0 && away.top >= threads.top && away.bottom <= threads.bottom + 1 && away.bottom <= window.innerHeight;
    });
    check('with thirteen threads and a short tree the Put away row is in view, and Threads takes no more than it needs', (await listedIds()).length >= 13 && (await awayInView()) && thirteen.overflow <= 0, `${(await listedIds()).length} threads, ${JSON.stringify(thirteen)}`);
    await shot(82, 'thirteen-threads');
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await wait(400);
    check(`at ${HEIGHT} px the thirteen threads scroll and the Put away row is still in view`, (await awayInView()) && (await heights()).overflow > 0, JSON.stringify(await heights()));
    await page.setViewportSize({ width: WIDTH, height: 1100 });
    await wait(400);
    // A long tree: Threads stops at 70% and Library keeps the rest, at least 30%.
    await Promise.all(Array.from({ length: 60 }, (_, at) => writeFile(path.join(vault, `Long page ${String(at + 1).padStart(2, '0')}.md`), `# Long page ${at + 1}\n`)));
    await until(async () => (await page.getByRole('treeitem', { name: /Long page 60/ }).count()) === 1, 15_000);
    await wait(300);
    const longTree = await page.evaluate(() => {
      const height = (id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().height ?? -1;
      return { threads: height('sidebar-threads'), library: height('sidebar-library'), column: document.querySelector('[data-testid="sidebar-threads"]')?.parentElement?.getBoundingClientRect().height ?? -1 };
    });
    check('with a long tree, Threads stops at 70% and Library keeps at least 30%', longTree.threads <= longTree.column * 0.7 + 1 && longTree.library >= longTree.column * 0.3 - 1, JSON.stringify(longTree));
    // Three pinned pages show in full, right under Library, and the tree's cut edges fade.
    for (const name of ['Long page 01', 'Long page 02', 'Long page 03']) {
      // The tree draws only the rows near its view: scroll down to the page until its row is drawn.
      const pageRow = page.getByRole('treeitem', { name: new RegExp(name) });
      for (let step = 0; step < 40 && (await pageRow.count()) === 0; step += 1) {
        await page.locator('[data-testid="sidebar-library"] .sidebar-tree-scroll').first().evaluate((element) => { element.scrollTop += element.clientHeight / 2; });
        await wait(50);
      }
      await pageRow.first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
      await until(async () => (await page.getByRole('menu').count()) === 0);
    }
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await wait(400);
    const pins = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="pinned-section"]');
      const library = document.querySelector('[data-testid="sidebar-library"]')?.getBoundingClientRect();
      const rows = [...document.querySelectorAll('[data-testid="pinned-section"] [data-testid^="pinned-"]')].filter((element) => element.getAttribute('data-testid') !== 'pinned-menu').map((element) => element.getBoundingClientRect());
      const label = [...(section?.querySelectorAll('*') ?? [])].find((element) => element.textContent === 'Pinned');
      return {
        rows: rows.length,
        full: !!library && rows.every((box) => box.height > 0 && box.top >= library.top && box.bottom <= library.bottom + 1),
        inner: section ? section.scrollHeight - section.clientHeight : -1,
        label: label ? getComputedStyle(label).position === 'absolute' && label.getBoundingClientRect().width <= 1 : true,
      };
    });
    check('three pinned pages show in full, with no scroller of their own, and no visible Pinned label', pins.rows === 3 && pins.full && pins.inner <= 1 && pins.label, JSON.stringify(pins));
    const tree = page.locator('[data-testid="sidebar-library"] .sidebar-tree-scroll').first();
    check('the tree’s cut edge fades at the bottom', ['bottom', 'both'].includes((await tree.getAttribute('data-fade-y')) ?? ''), String(await tree.getAttribute('data-fade-y')));
    // Scrolled down to the files at the root, where no folder is stuck at the top: the top edge fades too.
    await tree.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight - 60; });
    check('and at the top once it is scrolled', await until(async () => ['top', 'both'].includes((await tree.getAttribute('data-fade-y')) ?? '')), String(await tree.getAttribute('data-fade-y')));
    await tree.evaluate((element) => { element.scrollTop = 0; });
    check('the tree keeps room for at least two rows above Settings', await page.evaluate(() => {
      const view = document.querySelector('[data-testid="sidebar-library"] .sidebar-tree-scroll')?.getBoundingClientRect();
      const row = document.querySelector('[data-testid="sidebar-library"] [role="treeitem"]')?.getBoundingClientRect();
      return !!view && !!row && view.height >= row.height * 2 - 1;
    }));
    await shot(83, 'pinned-long-tree');

    // --- A new day's digest that no event announced: read again when the window comes back to the front.
    const NEW_DAY = '2026-11-14';
    await digestRow.click();
    await until(async () => (await textOf('auto-queue-day')) === 'Friday, November 13');
    const rowBefore = await digestSays();
    service.addDigest(NEW_DAY, [
      { title: 'Top 3', entries: [
        { id: 'item-1', kind: 'item', title: 'Stake the beans', n: 1, checked: false, priority: '', note: '', draft: null, md: 'Before the wind on Sunday.' },
        { id: 'item-2', kind: 'item', title: 'Net the peas', n: 2, checked: false, priority: '', note: '', draft: null, md: 'The pigeons found them.' },
      ] },
    ]);
    await wait(1_500);
    check('a digest written with no event leaves the row and the queue as they were', (await digestSays()) === rowBefore && (await textOf('auto-queue-day')) === 'Friday, November 13', await digestSays());
    const digestReads = () => service.requests.filter((request) => request.method === 'GET' && request.path === '/api/digest').length;
    const latestReadsBefore = digestReads();
    // The last read made six minutes old by moving the page's clock on, then the window's return to the front.
    await page.evaluate(() => {
      const real = Date.now.bind(Date);
      window.__realNow = real;
      Date.now = () => real() + 6 * 60_000;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    check('back in front with the last read old, the Digest row counts the new day without a relaunch', await until(async () => (await digestSays()) === 'Digest2 left'), await digestSays());
    check('and the queue shows the new day', await until(async () => (await textOf('auto-queue-day')) === 'Saturday, November 14' && (await entryIds()).join() === 'item-1,item-2'), `${await textOf('auto-queue-day')} ${(await entryIds()).join()}`);
    check('the latest digest was read once more', digestReads() === latestReadsBefore + 1, `${digestReads() - latestReadsBefore}`);
    await page.evaluate(() => {
      Date.now = window.__realNow;
    });

    // --- The plan usage ring in the foot row of every box, and its popover.
    const ringIn = (scope) => page.locator(`[data-testid="${scope}"] [data-testid="auto-usage-ring"]`);
    const ringPopover = page.getByTestId('auto-usage-popover');
    const threadRing = ringIn('auto-thread');
    const fillOf = async (ring) => (await ring.getAttribute('data-fill').catch(() => null)) ?? '';
    /** The foot row of the open thread's box: its height, and where the model and Send sit. */
    const boxRow = () => page.evaluate(() => {
      const rowElement = document.querySelector('[data-testid="auto-thread"] [data-testid="auto-box-row"]');
      const rect = (element) => (element ? element.getBoundingClientRect() : null);
      const row = rect(rowElement);
      const model = rect(rowElement?.querySelector('[data-testid="auto-model"]'));
      const send = rect(rowElement?.querySelector('[data-testid="auto-send"]'));
      return row ? { height: row.height, top: row.top, modelLeft: model?.left ?? -1, sendRight: send?.right ?? -1 } : null;
    });
    await row(BREAD).locator('[data-auto-row]').click();
    await box.waitFor({ timeout: 10_000 });
    check('the ring shows in an open thread’s box, filled to the fullest limit', await until(async () => (await threadRing.count()) === 1 && (await fillOf(threadRing)) === '0.73'), await fillOf(threadRing));
    check('it sits right after the model, at the left of the row', await page.evaluate(() => {
      const ring = document.querySelector('[data-testid="auto-thread"] [data-testid="auto-usage-ring"]');
      return ring?.previousElementSibling?.getAttribute('data-testid') === 'auto-model';
    }));
    const withRing = await boxRow();
    await shot(90, 'usage-ring');
    service.setUsage({ limits: [{ key: 'seven_day', label: 'Weekly, all models', used: 0.2 }, { key: 'seven_day_large', label: 'Weekly, Large', used: 0.6 }] });
    check('setUsage moves the ring without a reload', await until(async () => (await fillOf(threadRing)) === '0.6'), await fillOf(threadRing));
    service.setUsage({ limits: [{ key: 'seven_day', label: 'Weekly, all models', used: 0.45 }, { key: 'seven_day_large', label: 'Weekly, Large', used: 0.73 }] });
    await until(async () => (await fillOf(threadRing)) === '0.73');

    // Opened by a click: 360 wide, its left edge on the ring button's, two rows.
    const draftBefore = await box.inputValue();
    const listBefore = (await rowIds()).join();
    await threadRing.click();
    await ringPopover.waitFor({ timeout: 5_000 });
    const measure = () => page.evaluate(() => {
      const ring = document.querySelector('[data-testid="auto-thread"] [data-testid="auto-usage-ring"]').getBoundingClientRect();
      const pop = document.querySelector('[data-testid="auto-usage-popover"]').getBoundingClientRect();
      return { width: pop.width, leftGap: Math.abs(pop.left - ring.left), above: pop.bottom <= ring.top, inside: pop.left >= 0 && pop.right <= window.innerWidth };
    });
    // The popover is placed a frame after it mounts: measure once it has settled.
    let geometry = await measure();
    await until(async () => (geometry = await measure()).leftGap <= 2, 3_000);
    check('a click opens the popover above the ring, 360 wide, its left edge on the ring’s and inside the window', Math.abs(geometry.width - 360) < 0.6 && geometry.leftGap <= 2 && geometry.above && geometry.inside, JSON.stringify(geometry));
    const rowsText = () => ringPopover.getByTestId('auto-usage-row').evaluateAll((rows) => rows.map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()));
    check('the popover heads with the plan and has a row per limit, in the order sent', ((await ringPopover.textContent()) ?? '').startsWith('Plan usage limits · Pro') && (await rowsText()).length === 2 && /^Weekly · all models\s?Resets .+45%$/.test((await rowsText())[0]) && /^Weekly · Large\s?Resets .+73%$/.test((await rowsText())[1]), (await rowsText()).join(' | '));
    check('opening it moves nothing and sends nothing', (await box.inputValue()) === draftBefore && (await rowIds()).join() === listBefore && !service.requests.slice(-5).some((request) => request.method === 'POST'));
    await shot(91, 'usage-popover', null, ['light', 'dark'], false);
    await key('Escape');
    check('Escape closes it and the caret is back in the box', await until(async () => (await ringPopover.count()) === 0 && (await focused()) === 'auto-box', 3_000), await focused());
    // By the keyboard: Enter, and Space.
    await threadRing.focus();
    await key('Enter');
    check('Enter on the ring opens it', await until(async () => (await ringPopover.count()) === 1, 3_000));
    await key('Escape');
    await until(async () => (await ringPopover.count()) === 0);
    await threadRing.focus();
    await key('Space');
    check('Space on the ring opens it', await until(async () => (await ringPopover.count()) === 1, 3_000));
    await page.mouse.click(WIDTH / 2, 120);
    check('a click outside closes it', await until(async () => (await ringPopover.count()) === 0, 3_000));

    // A weekly limit that resets a week from now, to the second: at 360 wide its label, its reset words and its percent all show whole.
    service.setUsage({ limits: [
      { key: 'seven_day', label: 'Weekly, all models', used: 0.45, resets_at: Math.floor(Date.now() / 1000) + 7 * 86400 },
      { key: 'seven_day_large', label: 'Weekly, Large', used: 0.73 },
    ] });
    await until(async () => (await fillOf(threadRing)) === '0.73');
    await threadRing.click();
    await ringPopover.waitFor({ timeout: 5_000 });
    const weekOut = await until(async () => /^Weekly · all models\s?Resets [A-Za-z]{3} \d{1,2}:\d{2} [ap]m\s?45%$/.test((await rowsText())[0] ?? ''), 3_000);
    const whole = await ringPopover.getByTestId('auto-usage-row').first().evaluate((row) => {
      const part = (id) => {
        const element = row.querySelector(`[data-testid="${id}"]`);
        return element ? { text: element.textContent, scroll: element.scrollWidth, client: element.clientWidth } : null;
      };
      return { width: Math.round(row.closest('[data-testid="auto-usage-popover"]').getBoundingClientRect().width), label: part('auto-usage-label'), when: part('auto-usage-when'), percent: part('auto-usage-percent') };
    });
    const shown = (part) => part && part.scroll <= part.client;
    check('at 360 wide a weekly limit a week out shows its whole label, its whole reset words and its percent', weekOut && whole.width === 360 && shown(whole.label) && shown(whole.when) && shown(whole.percent) && whole.label.text === 'Weekly · all models', JSON.stringify(whole));
    await key('Escape');
    await until(async () => (await ringPopover.count()) === 0);

    // A limit past its reset time is left out until the service drops it; alone, it leaves no ring.
    const nowSeconds = Math.floor(Date.now() / 1000);
    service.setUsage({ limits: [
      { key: 'seven_day', label: 'Weekly, all models', used: 0.95, resets_at: nowSeconds - 60 },
      { key: 'seven_day_large', label: 'Weekly, Large', used: 0.73 },
    ] });
    check('a limit past its reset time leaves the ring: it fills to the other limit', await until(async () => (await fillOf(threadRing)) === '0.73' && (await threadRing.getAttribute('aria-label')) === 'Plan usage, Weekly · Large 73% used'), await threadRing.getAttribute('aria-label'));
    await threadRing.click();
    await ringPopover.waitFor({ timeout: 5_000 });
    const pastRows = await rowsText();
    check('and the popover leaves it out: one row, the other limit', pastRows.length === 1 && /^Weekly · Large\s?Resets .+73%$/.test(pastRows[0] ?? ''), pastRows.join(' | '));
    await key('Escape');
    await until(async () => (await ringPopover.count()) === 0);
    service.setUsage({ limits: [{ key: 'seven_day', label: 'Weekly, all models', used: 0.95, resets_at: nowSeconds - 60 }] });
    check('when it was the only limit there is no ring at all', await until(async () => (await threadRing.count()) === 0));
    service.setUsage({ limits: [{ key: 'seven_day', label: 'Weekly, all models', used: 0.45 }, { key: 'seven_day_large', label: 'Weekly, Large', used: 0.73 }] });
    check('and it comes back with a limit in its window', await until(async () => (await fillOf(threadRing)) === '0.73'), await fillOf(threadRing));

    // A column 360 wide still holds the model, the ring and Send on one row. The
    // column's own padding is added, so the box itself is 360 wide.
    const narrow = await page.evaluate(async () => {
      const rowElement = [...document.querySelectorAll('[data-testid="auto-thread"] [data-testid="auto-box-row"]')].find((element) => element.offsetParent !== null && element.closest('[aria-hidden="true"]') === null);
      const column = rowElement?.closest('form')?.closest('.auto-column');
      if (!rowElement || !column) return { width: 0, column: !!column };
      column.style.maxWidth = 'calc(360px + 3rem)';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const form = rowElement.closest('form').getBoundingClientRect();
      const mid = (id) => {
        const rect = rowElement.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return rect ? { y: rect.top + rect.height / 2, left: rect.left, right: rect.right } : null;
      };
      const result = { width: form.width, model: mid('auto-model'), ring: mid('auto-usage-ring'), send: mid('auto-send'), formRight: form.right };
      column.style.maxWidth = '';
      return result;
    });
    check('in a column 360 wide the model, the ring and Send share one row', Math.abs(narrow.width - 360) < 1 && narrow.model && narrow.ring && narrow.send && Math.abs(narrow.model.y - narrow.ring.y) < 1 && Math.abs(narrow.send.y - narrow.ring.y) < 1 && narrow.model.right <= narrow.ring.left && narrow.ring.right < narrow.send.left && narrow.send.right <= narrow.formRight, JSON.stringify(narrow));

    // The new thread's box, and a digest entry's box.
    await newThread.click();
    check('the ring shows in the new thread’s box', await until(async () => (await threadRing.count()) === 1));
    await shot(93, 'usage-new-thread');
    await digestRow.click();
    await page.getByTestId('auto-queue').waitFor({ timeout: 10_000 });
    const firstEntry = (await entryIds())[0];
    await entry(firstEntry).locator('[data-auto-entry]').click();
    const entryRing = entry(firstEntry).getByTestId('auto-usage-ring');
    check('the ring shows in a digest entry’s box, at the left of its row', await until(async () => (await entryRing.count()) === 1) && await entry(firstEntry).getByTestId('auto-box-row').evaluate((element) => element.firstElementChild?.getAttribute('data-testid') === 'auto-usage-ring'));
    await shot(94, 'usage-entry-box');
    await entryRing.click();
    await ringPopover.waitFor({ timeout: 5_000 });
    await key('Escape');
    check('closed from an entry, the caret goes back to that entry’s box', await until(async () => (await ringPopover.count()) === 0 && (await focused()) === 'auto-entry-box', 3_000), await focused());

    // An older service without the route: no ring, and the row as it was.
    await row(BREAD).locator('[data-auto-row]').click();
    await box.waitFor({ timeout: 10_000 });
    service.setUsage({ missing: true });
    check('a service that answers 404 shows no ring', await until(async () => (await threadRing.count()) === 0));
    const without = await boxRow();
    check('without the ring the box’s row measures as with it: same height and the same model and Send', without && withRing && without.height === withRing.height && without.modelLeft === withRing.modelLeft && without.sendRight === withRing.sendRight, `${JSON.stringify(without)} ${JSON.stringify(withRing)}`);
    check('a 404 marks nothing out of reach and says nothing', (await page.getByTestId('auto-unreachable').count()) === 0 && (await page.getByTestId('auto-out-of-reach').count()) === 0);
    service.setUsage({ missing: false });
    check('the ring comes back once the route answers', await until(async () => (await threadRing.count()) === 1));

    // Out of reach: the ring goes, and comes back when the service does.
    service.down();
    check('with the service down the ring goes', await until(async () => (await threadRing.count()) === 0, 15_000));
    service.down(false);
    check('and comes back when it returns', await until(async () => (await threadRing.count()) === 1 && (await fillOf(threadRing)) === '0.73', 40_000));

    // --- Renaming a thread: a double-click on a row's title, on the open thread's title, and Rename first in the row's menu.
    await row(BREAD).locator('[data-auto-row]').click();
    await box.waitFor({ timeout: 10_000 });
    const renamePosts = () => service.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/rename') && request.headers['x-auto-client'] !== 'phone').map((request) => ({ path: request.path, title: request.body?.title }));
    const renamesBefore = renamePosts().length;
    const renamed = (await listedIds()).find((id) => id !== BREAD && service.thread(id) && !service.thread(id).snoozed && service.thread(id).status !== 'waiting');
    const renamedTitle = service.thread(renamed)?.title ?? '';
    /** The row's box, where its title's words start, and the middle of their line: the field must keep all three. */
    const rowGeometry = (id) => page.evaluate((thread) => {
      const rowElement = document.querySelector(`[data-testid="auto-row-${thread}"]`);
      const words = document.querySelector(`[data-testid="auto-row-title-field-${thread}"]`) ?? document.querySelector(`[data-testid="auto-row-title-${thread}"]`);
      if (!rowElement || !words) return null;
      const box = rowElement.getBoundingClientRect();
      const text = words.getBoundingClientRect();
      const style = getComputedStyle(words);
      return {
        top: box.top, left: box.left, width: box.width, height: box.height,
        wordsLeft: Math.round((text.left + parseFloat(style.paddingLeft || '0') + parseFloat(style.borderLeftWidth || '0')) * 10) / 10,
        middle: Math.round((text.top + text.height / 2) * 10) / 10,
      };
    }, id);
    const sameGeometry = (a, b) => !!a && !!b && ['top', 'left', 'width', 'height'].every((part) => Math.abs(a[part] - b[part]) < 0.5) && Math.abs(a.wordsLeft - b.wordsLeft) < 0.5 && Math.abs(a.middle - b.middle) < 0.6;
    const fieldFocused = (id) => page.evaluate((thread) => document.activeElement?.getAttribute('data-testid') === `auto-row-title-field-${thread}`, id);
    check('a thread to rename that is not the open one', !!renamed && renamed !== BREAD, String(renamed));
    const beforeRename = await rowGeometry(renamed);
    await page.getByTestId(`auto-row-title-${renamed}`).dblclick();
    check('a double-click with the mouse turns the row’s title into a field with the caret in it', await until(() => fieldFocused(renamed), 3_000), await focused());
    check('the field holds the whole title, selected', await page.getByTestId(`auto-row-title-field-${renamed}`).evaluate((field) => field.selectionStart === 0 && field.selectionEnd === field.value.length && field.value.length > 0));
    const loaded = await until(async () => (await textOf('auto-title')) === renamedTitle && (await box.count()) === 1);
    await wait(400);
    check('the thread opened behind it, and the caret stayed in the field while it loaded', loaded && (await fieldFocused(renamed)), await focused());
    const duringRename = await rowGeometry(renamed);
    check('the row measures the same with its title as a field: its box, the words’ left edge and their line', sameGeometry(beforeRename, duringRename), `${JSON.stringify(beforeRename)} ${JSON.stringify(duringRename)}`);
    await shot(95, 'rename-row', null, ['light', 'dark'], false);
    check('the field kept the caret through the pictures', await fieldFocused(renamed), await focused());
    await page.keyboard.type('see');
    check('typed letters are the title’s: nothing snoozed, archived or marked', (await page.getByTestId(`auto-row-title-field-${renamed}`).inputValue()) === 'see' && (await page.getByTestId('auto-snooze-menu').count()) === 0 && !service.thread(renamed)?.snoozed && !service.thread(renamed)?.archived && !service.thread(renamed)?.desk);
    await key('Enter');
    check('Enter renames it, the row shows the new title, and the keyboard is on the row', await until(async () => service.thread(renamed)?.title === 'see' && (await textOf(`auto-row-title-${renamed}`)) === 'see' && (await focused()) === renamed), `${service.thread(renamed)?.title} ${await focused()}`);
    check('the row measures as before the rename', sameGeometry(beforeRename, await rowGeometry(renamed)), JSON.stringify(await rowGeometry(renamed)));
    await page.getByTestId(`auto-row-title-${renamed}`).dblclick();
    await until(() => fieldFocused(renamed), 3_000);
    await page.keyboard.type('nope');
    await key('Escape');
    check('Escape leaves the title as it was, posts nothing, and puts the keyboard on the row', await until(async () => (await focused()) === renamed) && (await textOf(`auto-row-title-${renamed}`)) === 'see' && renamePosts().length === renamesBefore + 1, `${await focused()} ${renamePosts().length - renamesBefore}`);
    await page.getByTestId('auto-title').dblclick();
    const headerField = page.getByTestId('auto-thread-header').getByRole('textbox', { name: 'Thread title' });
    check('a double-click on the open thread’s title makes it the field, with no menu open', await until(async () => (await headerField.count()) === 1 && (await focused()) === 'Thread title', 3_000) && (await page.getByRole('menu').count()) === 0, await focused());
    await wait(500);
    check('and no menu opens after it either', (await page.getByRole('menu').count()) === 0 && (await headerField.count()) === 1);
    await shot(96, 'rename-header', null, ['light', 'dark'], false);
    await page.keyboard.type(renamedTitle);
    await key('Enter');
    check('Enter in the header renames it back', await until(async () => service.thread(renamed)?.title === renamedTitle && (await focused()) === 'auto-box'), await focused());
    await row(renamed).locator('[data-auto-row]').click({ button: 'right' });
    const firstItem = page.getByRole('menuitem').first();
    check('Rename is the first item of the row’s menu', ((await firstItem.textContent()) ?? '') === 'Rename', (await firstItem.textContent()) ?? '');
    await firstItem.click();
    check('and turns the row’s title into the field, with the caret in it', await until(() => fieldFocused(renamed), 3_000), await focused());
    await key('Escape');
    await until(async () => (await focused()) === renamed);
    check('the stand-in received exactly the renames made', JSON.stringify(renamePosts().slice(renamesBefore)) === JSON.stringify([{ path: `/api/threads/${renamed}/rename`, title: 'see' }, { path: `/api/threads/${renamed}/rename`, title: renamedTitle }]), JSON.stringify(renamePosts().slice(renamesBefore)));

    // --- An entry that matches a thread he has: "Continues: <thread>", and one click adds the entry there.
    const OLD_DAY = '2026-11-12';
    const SNOOZED_MATCH = '5a0000000007';
    const PLAIN_MATCH = '5a0000000009';
    const continuesLines = () => queue.locator('[data-testid="auto-entry-continues"]').evaluateAll((lines) => lines.map((line) => line.closest('li')?.getAttribute('data-testid')?.replace('auto-entry-', '')));
    /** An entry's box, and where its title line and words sit inside it. */
    /** `height` is the entry's own words; the row around it keeps a least height for its actions, which `outer` measures. */
    const entryGeometry = (id) => entry(id).evaluate((item) => {
      const box = item.getBoundingClientRect();
      const own = item.querySelector('[data-auto-entry]')?.getBoundingClientRect();
      const title = item.querySelector('[data-auto-entry] p')?.getBoundingClientRect();
      const words = item.querySelector('[data-testid="auto-entry-words"]')?.getBoundingClientRect();
      const line = item.querySelector('[data-testid="auto-entry-continues"]')?.getBoundingClientRect();
      return { height: own?.height ?? 0, outer: box.height, width: box.width, title: title ? [title.top - box.top, title.left - box.left, title.height] : null, words: words ? [words.top - box.top, words.left - box.left, words.height] : null, line: line ? line.height + parseFloat(getComputedStyle(item.querySelector('[data-testid="auto-entry-continues"]')).marginTop) : 0 };
    });
    const leftCount = async () => Number(((await textOf('auto-queue-left')) ?? '').replace(/\D+/g, ''));
    /** The last message he sent a thread, from what the stand-in holds. */
    const lastSaid = (id) => {
      const thread = service.thread(id);
      const said = [...(thread?.items ?? []), ...(thread?.live?.items ?? [])].filter((item) => item.role === 'user');
      return said.at(-1)?.text ?? '';
    };
    // The default matches, on the second day back. The snoozed one is put away again first, for a run that brought it back.
    if (!service.thread(SNOOZED_MATCH)?.snoozed) await fromPhone(`/api/threads/${SNOOZED_MATCH}/snooze`, { until: Math.floor(Date.now() / 1000) + 86400 });
    service.setContinues('item-2', null);
    service.setContinues('text-yesterday-1a2b3c4d', null);
    await digestRow.click();
    await queue.waitFor({ timeout: 10_000 });
    for (let step = 0; step < 4 && (await textOf('auto-queue-day')) !== 'Thursday, November 12'; step += 1) {
      await page.getByRole('button', { name: 'Earlier day' }).click();
      await until(async () => (await textOf('auto-queue-day')) !== '', 2_000);
      await wait(300);
    }
    check('the queue steps back to the day with the matches', (await textOf('auto-queue-day')) === 'Thursday, November 12', await textOf('auto-queue-day'));
    await until(async () => (await continuesLines()).length === 0);
    const withoutMatch = { 'item-1': await entryGeometry('item-1'), 'item-2': await entryGeometry('item-2'), 'text-yesterday-1a2b3c4d': await entryGeometry('text-yesterday-1a2b3c4d') };
    service.setContinues('item-2', SNOOZED_MATCH);
    service.setContinues('text-yesterday-1a2b3c4d', PLAIN_MATCH);
    check('the line shows on the two matching entries and on no other', await until(async () => (await continuesLines()).join() === 'item-2,text-yesterday-1a2b3c4d'), (await continuesLines()).join());
    const snoozedTitle = service.thread(SNOOZED_MATCH)?.title ?? '';
    const plainTitle = service.thread(PLAIN_MATCH)?.title ?? '';
    check('it names the thread, and says when it is snoozed', (await textOf('auto-entry-item-2').catch(() => '')).includes(`Continues: ${snoozedTitle} (snoozed)`) && ((await entry('text-yesterday-1a2b3c4d').getByTestId('auto-entry-continues').textContent()) ?? '') === `Continues: ${plainTitle}`, `${snoozedTitle} | ${plainTitle}`);
    const withMatch = { 'item-1': await entryGeometry('item-1'), 'item-2': await entryGeometry('item-2'), 'text-yesterday-1a2b3c4d': await entryGeometry('text-yesterday-1a2b3c4d') };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('a row without a match measures as before', same(withoutMatch['item-1'], withMatch['item-1']), `${JSON.stringify(withoutMatch['item-1'])} ${JSON.stringify(withMatch['item-1'])}`);
    check('a matching row keeps its title and words where they were, and grows by the line alone', ['item-2', 'text-yesterday-1a2b3c4d'].every((id) => same(withoutMatch[id].title, withMatch[id].title) && same(withoutMatch[id].words, withMatch[id].words) && Math.abs(withMatch[id].height - withoutMatch[id].height - withMatch[id].line) < 0.6), JSON.stringify([withoutMatch, withMatch]));
    await shot(97, 'continues-row', () => entry('text-yesterday-1a2b3c4d').hover());
    check('the row’s act that makes a thread reads Add to it', await (async () => {
      await entry('text-yesterday-1a2b3c4d').hover();
      return (await entry('text-yesterday-1a2b3c4d').getByRole('button', { name: 'Add to it', exact: true }).count()) === 1 && (await entry('text-yesterday-1a2b3c4d').getByRole('button', { name: 'Thread', exact: true }).count()) === 0;
    })());
    const continuesBefore = posts('/api/digest/continue').length;
    const leftBeforeAdd = await leftCount();
    await act('text-yesterday-1a2b3c4d', 'Add to it');
    check('Add to it from the row posts once, with the day, the entry and the thread', await until(() => posts('/api/digest/continue').length === continuesBefore + 1) && (() => {
      const body = posts('/api/digest/continue').at(-1);
      return body.date === OLD_DAY && body.id === 'text-yesterday-1a2b3c4d' && body.thread === PLAIN_MATCH && body.words === undefined && typeof body.cid === 'string';
    })(), JSON.stringify(posts('/api/digest/continue').at(-1)));
    check('the queue’s count goes down by one, and the line is gone', await until(async () => (await leftCount()) === leftBeforeAdd - 1 && !(await continuesLines()).includes('text-yesterday-1a2b3c4d')), `${leftBeforeAdd} -> ${await leftCount()}`);
    check('the thread has the entry as its last message', await until(() => lastSaid(PLAIN_MATCH).startsWith('Digest, Thursday November 12') && lastSaid(PLAIN_MATCH).includes('Four rows of carrots')), lastSaid(PLAIN_MATCH).slice(0, 80));
    check('the line at the sidebar’s foot says what it was added to, with no Undo', await until(async () => (await saidText()).startsWith(`Added to ${plainTitle}`)) && (await said.getByRole('button', { name: 'Undo' }).count()) === 0, await saidText());

    // From the open entry, with his words, into the snoozed thread.
    await entry('item-2').locator('[data-auto-entry]').click();
    const entryBox = entry('item-2').getByTestId('auto-entry-box');
    await entryBox.waitFor({ timeout: 5_000 });
    check('the open entry says the line in full above its box, with Add to it and New thread instead', ((await entry('item-2').getByTestId('auto-entry-continues-open').textContent()) ?? '') === `Continues: ${snoozedTitle} (snoozed)` && (await entry('item-2').getByTestId('auto-send').getAttribute('aria-label')) === 'Add to it' && (await entry('item-2').getByTestId('auto-send').getAttribute('data-ready')) === 'true' && ((await entry('item-2').getByTestId('auto-entry-new-thread').textContent()) ?? '') === 'New thread instead');
    await shot(98, 'continues-open');
    await entryBox.fill('Bring the stone too');
    service.slow(1_200);
    const continuesBeforeOpen = posts('/api/digest/continue').length;
    await entry('item-2').getByTestId('auto-send').click();
    await entry('item-2').getByTestId('auto-send').click({ timeout: 500 }).catch(() => undefined);
    await entryBox.press('Enter', { timeout: 500 }).catch(() => undefined);
    await wait(2_000);
    service.slow(0);
    check('a second click while the first is out sends nothing more', posts('/api/digest/continue').length === continuesBeforeOpen + 1, String(posts('/api/digest/continue').length - continuesBeforeOpen));
    check('his words arrive with the entry, and the snoozed thread is back', await until(() => posts('/api/digest/continue').at(-1)?.words === 'Bring the stone too' && lastSaid(SNOOZED_MATCH).includes('Bring the stone too') && lastSaid(SNOOZED_MATCH).includes('Sharpen the secateurs') && !service.thread(SNOOZED_MATCH)?.snoozed), `${lastSaid(SNOOZED_MATCH).slice(-60)} ${service.thread(SNOOZED_MATCH)?.snoozed}`);

    // On the latest day: a match that has gone by the time of the click, and a new thread after all.
    service.setContinues('item-1', PLAIN_MATCH, NEW_DAY);
    service.setContinues('item-2', PLAIN_MATCH, NEW_DAY);
    for (let step = 0; step < 4 && (await textOf('auto-queue-day')) !== 'Saturday, November 14'; step += 1) {
      await page.getByRole('button', { name: 'Later day' }).click();
      await wait(300);
    }
    check('both entries of the latest day show their line', await until(async () => (await textOf('auto-queue-day')) === 'Saturday, November 14' && (await continuesLines()).join() === 'item-1,item-2'), (await continuesLines()).join());
    service.setContinues('item-1', null, NEW_DAY, { silent: true });
    const noMatchBefore = posts('/api/digest/continue').length;
    await act('item-1', 'Add to it');
    check('a match gone before the click: the 409 leaves the entry open, the line gone and the sentence shown', await until(async () => (await entryIds()).includes('item-1') && (await entry('item-1').getAttribute('data-state')) === 'open' && (await entry('item-1').getByTestId('auto-entry-continues').count()) === 0 && (await saidText()).startsWith('That thread no longer matches.')) && posts('/api/digest/continue').length === noMatchBefore + 1, await saidText());
    await entry('item-2').locator('[data-auto-entry]').click();
    await entry('item-2').getByTestId('auto-entry-new-thread').click();
    check('New thread instead still makes a new thread, and the line is gone after', await until(async () => JSON.stringify(posts('/api/digest/thread').at(-1)) === JSON.stringify({ date: NEW_DAY, id: 'item-2', start: false }) && service.entries().some((thread) => thread.title === 'Net the peas') && service.digest(NEW_DAY)?.sections[0].entries.find((each) => each.id === 'item-2')?.continues === null && !(await continuesLines()).includes('item-2')) && posts('/api/digest/continue').length === noMatchBefore + 1, JSON.stringify(posts('/api/digest/thread').at(-1)));

    // --- Links to pages in a reply. The vault is a checkout of a temp remote, and Elsewhere a clone that pushes.
    const IDEAS_HERE = '# Ideas\n\nA rain gauge on the shed, and a second one by the gate.\n';
    await writeFile(path.join(vault, 'Notes/Ideas.md'), IDEAS_HERE);
    const pushPage = async (relative, text) => {
      await mkdir(path.dirname(path.join(elsewhere, relative)), { recursive: true });
      await writeFile(path.join(elsewhere, relative), text);
      git(elsewhere, 'add', '-A');
      git(elsewhere, 'commit', '-q', '-m', `Add ${relative}`);
      git(elsewhere, 'push', '-q', 'origin', 'main');
    };
    const inVault = (relative) => stat(path.join(vault, relative)).then(() => true, () => false);
    const fastForwards = () => git(vault, 'reflog', '--format=%gs').split('\n').filter((line) => line.includes('Fast-forward')).length;
    const pageLinkAt = (relative) => talk.locator(`[data-vault-path="${relative}"]`).last();
    const missingLine = (relative) => pageLinkAt(relative).locator('xpath=..').getByTestId('auto-page-missing');
    const MISSING = 'This file is not on this Mac yet.';
    // The foot of the sidebar may still hold the last section's line; a link puts nothing of its own there.
    const footQuiet = async () => !/not on this Mac|Could not find|could not open|first-page|never-written/i.test(await saidText());
    await toAuto();
    await newThread.click();
    await say('Write the new pages');
    check('a reply names pages, with each link to a page drawn as one', await until(async () => (await pageLinkAt('Library/notes/first-page.md').count()) === 1 && (await pageLinkAt(LONG_PAGE).count()) === 1, 15_000));
    const pagesThread = await openRow();
    await atRest(pagesThread);
    const endedAt = Date.now();
    check('a page only the remote will have is not in the tree yet', !(await inVault('Library/notes/first-page.md')));
    // The run the turn's end asked for has gone by, and the ten seconds after it.
    await wait(Math.max(0, endedAt + 11_000 - Date.now()));
    const forwardsBefore = fastForwards();
    await pushPage('Library/notes/first-page.md', '# Planting plan for spring\n\nBeans first.\n');
    await pageLinkAt('Library/notes/first-page.md').click();
    const firstTab = page.getByTestId(`tab-${path.join(vault, 'Library/notes/first-page.md')}`);
    check('a click on a page only the remote has opens it after one fast-forward', await until(async () => (await firstTab.count()) === 1 && (await firstTab.getAttribute('aria-selected')) === 'true', 20_000) && (await inVault('Library/notes/first-page.md')) && git(vault, 'rev-parse', 'HEAD') === git(elsewhere, 'rev-parse', 'HEAD') && fastForwards() === forwardsBefore + 1, `${fastForwards() - forwardsBefore} fast-forwards`);
    check('and said nothing at the foot of the sidebar', await footQuiet(), await saidText());
    await toAuto();
    check('after the update the link shows the page’s heading', await until(async () => ((await pageLinkAt('Library/notes/first-page.md').textContent()) ?? '') === 'Planting plan for spring', 5_000), (await pageLinkAt('Library/notes/first-page.md').textContent()) ?? '');

    // A page no remote has: the working mark while the folder is brought up to date (it waits out the ten seconds), then the line at the link.
    await pageLinkAt('Library/notes/never-written.md').click();
    check('a link to a missing page shows the working mark in place of its icon', await until(async () => (await pageLinkAt('Library/notes/never-written.md').getAttribute('data-working')) === 'true' && (await pageLinkAt('Library/notes/never-written.md').locator('.auto-spin').count()) === 1, 3_000));
    await shot(100, 'page-link-working', () => pageLinkAt('Library/notes/never-written.md').hover(), ['light', 'dark'], false);
    check('a page that no remote has shows the line at the link', await until(async () => ((await missingLine('Library/notes/never-written.md').textContent()) ?? '') === MISSING, 20_000), (await missingLine('Library/notes/never-written.md').textContent()) ?? '');
    check('the line is a status a screen reader announces, and there is no line at the foot of the sidebar', (await missingLine('Library/notes/never-written.md').getAttribute('role')) === 'status' && (await footQuiet()), await saidText());
    await shot(101, 'page-link-missing', null, ['light'], false);
    await page.mouse.click(WIDTH - 40, 40);
    check('the next click anywhere takes the line away', await until(async () => ((await missingLine('Library/notes/never-written.md').textContent()) ?? '') === '', 2_000));
    await pageLinkAt('Library/notes/never-written.md').click();
    await until(async () => ((await missingLine('Library/notes/never-written.md').textContent()) ?? '') === MISSING, 20_000);
    await shot(101, 'page-link-missing', null, ['dark'], false);
    check('and it goes on its own after a few seconds', await until(async () => ((await missingLine('Library/notes/never-written.md').textContent()) ?? '') === '', 8_000));

    // A turn's end brings the next page before any click.
    await wait(10_500);
    const forwardsBeforeEnd = fastForwards();
    await pushPage('Library/notes/second-page.md', '# Second page\n');
    await say('Thanks, that is all');
    await atRest(pagesThread);
    check('a reply’s turn ends and the second new page is in the tree before any click', await until(() => inVault('Library/notes/second-page.md'), 25_000) && fastForwards() === forwardsBeforeEnd + 1, `${fastForwards() - forwardsBeforeEnd} fast-forwards`);
    check('a local change in another file is still there after all of it', (await readFile(path.join(vault, 'Notes/Ideas.md'), 'utf8')) === IDEAS_HERE && git(vault, 'status', '--porcelain', '--', 'Notes/Ideas.md') === 'M Notes/Ideas.md', git(vault, 'status', '--porcelain', '--', 'Notes/Ideas.md'));

    // The look: a path shows as a name with the icon, cut inside the column, with the path on hover.
    const longLink = pageLinkAt(LONG_PAGE);
    await longLink.scrollIntoViewIfNeeded();
    const linkLook = await longLink.evaluate((link) => {
      const words = link.querySelector('.auto-page-words');
      const column = link.closest('.auto-column') ?? link.closest('.auto-md');
      const box = link.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(link).lineHeight);
      return {
        text: words?.textContent ?? '',
        title: link.getAttribute('title'),
        icon: !!link.querySelector('svg.auto-page-icon'),
        cut: !!words && words.scrollWidth > words.clientWidth,
        ellipsis: words ? getComputedStyle(words).textOverflow : '',
        inside: !!column && box.right <= column.getBoundingClientRect().right + 0.5 && box.left >= column.getBoundingClientRect().left - 0.5,
        oneLine: box.height <= line * 1.2,
        colour: getComputedStyle(words ?? link).color === getComputedStyle(link.closest('p') ?? link).color,
        // The full stop written right after the link, and whether its box sits on the link's line.
        stop: (() => {
          const after = link.closest('.auto-vault-link')?.nextSibling;
          if (!after || after.nodeType !== Node.TEXT_NODE || !after.textContent?.startsWith('.')) return 'none';
          const range = document.createRange();
          range.setStart(after, 0);
          range.setEnd(after, 1);
          const mark = range.getBoundingClientRect();
          return Math.abs((mark.top + mark.bottom) / 2 - (box.top + box.bottom) / 2) < line / 2 && mark.right <= (column?.getBoundingClientRect().right ?? Infinity) + 0.5 ? 'same line' : `own line (${Math.round(mark.top)} against ${Math.round(box.top)})`;
        })(),
      };
    });
    check('a link written as a long path shows as a name with the icon, inside the column, on one line, with the path on hover', linkLook.text === LONG_PAGE.split('/').pop().replace(/\.md$/, '') && linkLook.icon && linkLook.cut && linkLook.ellipsis === 'ellipsis' && linkLook.inside && linkLook.oneLine && linkLook.colour && linkLook.title === LONG_PAGE, JSON.stringify(linkLook));
    check('the full stop right after a long link stays on the link’s line', linkLook.stop === 'same line', linkLook.stop);
    check('a link with words of its own keeps them, with the icon', ((await pageLinkAt('Projects/Garden/Seeds.md').textContent()) ?? '') === 'the seed plan' && (await pageLinkAt('Projects/Garden/Seeds.md').locator('svg.auto-page-icon').count()) === 1, (await pageLinkAt('Projects/Garden/Seeds.md').textContent()) ?? '');
    check('a bare wiki link shows the page’s name, then its heading once the page is here', await until(async () => ((await pageLinkAt('Library/notes/second-page').textContent()) ?? '') === 'Second page', 5_000), (await pageLinkAt('Library/notes/second-page').textContent()) ?? '');
    await shot(99, 'page-links', () => longLink.hover());

    // --- What Opal asked the service for, over the whole run.
    const paths = service.requests.filter((request) => request.headers['x-auto-client'] !== 'phone').map((request) => request.path);
    check('Opal never ticked a box by number and never asked for the inbox', !paths.some((requestPath) => requestPath.includes('/digest/tick') || requestPath.includes('/digest/inbox')));
    const KNOWN = /^\/api\/(status|status\/check|events(\?last=[\w.]+)?|threads|threads\?archived=1(&limit=\d+)?|threads\/[\w-]+(\/(events(\?last=[\w.]+)?|messages|stop|answer|model|rename|archive|move|snooze|start|desk))?|digest(\?date=\d{4}-\d{2}-\d{2})?|digests|digest\/(resolve|note|thread|continue|archive)|usage)$/;
    check('Opal asked only for routes it has', paths.every((requestPath) => KNOWN.test(requestPath)), paths.find((requestPath) => !KNOWN.test(requestPath)) ?? '');
    check('every snooze carried a time or null, and a wait carried only his words', posts('/api/threads/').length === 0 && service.requests.filter((request) => request.method === 'POST' && /\/snooze$/.test(request.path) && request.headers['x-auto-client'] !== 'phone').every((request) => Object.keys(request.body).every((field) => field === 'until' || field === 'wait') && (request.body.wait === undefined || JSON.stringify(Object.keys(request.body.wait)) === '["say"]')));
    check('no request marked a message as a send', !service.requests.some((request) => JSON.stringify(request.body ?? {}).includes('sends')));
    check('nothing in the run tried to allow a send: every answer to one was a no', service.unsigned.length === 0);
    check('every write named the client and carried no Origin', service.requests.filter((request) => request.method === 'POST' && request.headers['x-auto-client'] !== 'phone').every((request) => request.headers['x-auto-client'] === 'opal' && request.headers.origin === undefined && request.headers['content-type'] === 'application/json'));

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

    // --- The empty list, on a service where every thread is snoozed.
    await threadsHeading.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change Auto address…' }).click();
    await page.getByRole('textbox', { name: 'Address' }).fill(emptyService.url);
    await page.getByRole('textbox', { name: 'Address' }).press('Enter');
    await page.getByTestId('auto-empty').waitFor({ timeout: 15_000 });
    check('with no thread left the list says so and when the next snoozed one returns, and how many are snoozed is said once', /^Nothing left\. ?The next snoozed one returns (today|tomorrow) at \d/.test((await page.getByTestId('auto-empty').textContent()) ?? '') && !/2 snoozed/.test((await page.getByTestId('auto-empty').textContent()) ?? '') && (await awaySays()) === 'Put away2' && (await page.getByTestId('auto-summary').count()) === 0, (await page.getByTestId('auto-empty').textContent()) ?? '');
    await shot(17, 'empty-list');
    await newThread.click();
    check('the empty new thread says Nothing left. when the list is empty', await until(async () => (await textOf('auto-nothing-left')) === 'Nothing left.'), await textOf('auto-nothing-left'));
    await showLine('snoozed');
    check('the Put away page still shows them', await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 2));
    check('with nothing waiting on a reply there is no group for it', (await page.getByTestId('auto-waiting').count()) === 0);
    check('an archive with nothing in it says so', await until(async () => (await textOf('auto-archived-empty')) === 'Nothing is archived.'), await textOf('auto-archived-empty'));
    await shot(18, 'empty-list-snoozed-open');
    await hideLine();

    // --- The empty queue: every entry of the digest resolved.
    check('the Digest row says Done when nothing is left', await until(async () => (await digestSays()) === 'DigestDone'));
    await digestRow.click();
    await page.getByTestId('auto-queue-empty').waitFor({ timeout: 10_000 });
    check('with nothing left the queue says so, offers the whole day, and offers to archive the digest', ((await page.getByTestId('auto-queue-empty').textContent()) ?? '') === 'Nothing left in this digest.Show all 10Archive the digest');
    await shot(24, 'empty-queue');
    await page.getByTestId('auto-digest-archive-done').click();
    check('Archive the digest, once nothing is left, takes the Digest row off the list', await until(async () => (await digestRow.count()) === 0 && emptyService.digest()?.archived === true && (await page.getByTestId('auto-digest-archive-done').count()) === 0 && (await page.getByTestId('auto-queue-archived').count()) === 1));
    await said.getByRole('button', { name: 'Undo' }).click();
    check('and Undo puts it back', await until(async () => (await digestRow.count()) === 1 && emptyService.digest()?.archived === false));
    await page.getByRole('button', { name: 'Show all 10' }).click();
    check('Show all shows the day whole', await until(async () => (await entryIds()).length === 10 && (await page.getByTestId('auto-queue-all').getAttribute('aria-pressed')) === 'true'));

    // --- No digest at all.
    await threadsHeading.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change Auto address…' }).click();
    await page.getByRole('textbox', { name: 'Address' }).fill(bareService.url);
    await page.getByRole('textbox', { name: 'Address' }).press('Enter');
    check('a service with no digest says so, and the row shows no count', await until(async () => ((await page.getByTestId('auto-queue-empty').textContent().catch(() => '')) ?? '') === 'No digest yet.' && (await digestSays()) === 'Digest'));
    check('neither of the other services was asked to tick or to fill the inbox', ![...emptyService.requests, ...bareService.requests].some((request) => request.path.includes('/digest/tick') || request.path.includes('/digest/inbox')));
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
