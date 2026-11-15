// Disposable Electron acceptance for the Auto tab, against the stand-in
// service in src/tests/fixtures/auto (made-up threads, on 127.0.0.1 only).
// It never contacts any other host and starts no agent.
//
// One run per look (version A and B of the roomy variant), each with its own
// stand-in, temp profile and temp vault: the address form, can't reach with
// Retry, the list, a thread opening with its history, a vault link opening a
// page, a follow-up clicked, a reply streaming in with steps above it, a
// message queued and Stop, a question answered, a permission allowed, a
// question answered from its row, snooze and back, a drag to reorder,
// archive, a new thread, a digest entry handed to Auto, a failed post, a
// send waiting on the phone, signed out, the narrow layout and the empty
// list. Then the mark for the Mac (set from a row's menu, ended by a reply
// from another client, taken off) and the digest as a queue: resolve one
// with Undo, resolve all in a section, a thread that waits, a note written
// and removed, a drafted reply copied, words that start a thread, All, a
// change made on another device, an earlier day, and the three empty
// states. Saves light and dark screenshots of each at 1500 x 933 for people
// to look at; nothing compares them. Run from the repository root after the
// Vite bundles are built (see README.md here):
//
//   node e2e/acceptance/auto-acceptance.mjs [--out dir] [--sides a,b]
//
// Files are named <side>-<theme>-<nn>-<state>.png. The window never takes
// the keyboard: it hides once shown and shows again without being made
// active.
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises';
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

const results = [];
let side = 'a';
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

await mkdir(outDir, { recursive: true });
const errors = [];

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
  await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
  if (side === 'b') await writeFile(path.join(userData, 'variants.json'), JSON.stringify({ version: 1, sides: { roomy: 'b' } }, null, 2));

  const service = await startStandIn({ pace: 30, retryMs: 500 });
  // Every thread snoozed and every digest entry resolved; then a service with no thread and no digest.
  const emptyService = await startStandIn({ fixture: 'empty', digests: 'done', retryMs: 500 });
  const bareService = await startStandIn({ fixture: 'none', digests: 'none', retryMs: 500 });
  const app = await electron.launch({ args: [process.cwd()], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
  const watchdog = setTimeout(() => {
    console.log('FAIL the run stopped answering after 6 minutes');
    void app.close().finally(() => process.exit(1));
  }, 360_000);
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
  // The sidebar's row; its name gains the count of threads that wait.
  const sidebarRow = page.getByTestId('workspace-sidebar').getByRole('button', { name: /^Auto/ });
  const row = (id) => page.getByTestId(`auto-row-${id}`);
  const box = page.getByTestId('auto-box');
  const talk = page.getByTestId('auto-talk');
  const rowIds = () => page.locator('[data-testid="auto-list"] [data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));
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
  };
  /** A write made by another client, as the phone would make it. It goes to the stand-in only. */
  const fromPhone = (path, body) => fetch(`${service.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auto-Client': 'phone' }, body: JSON.stringify(body) });
  const digestRow = page.getByTestId('auto-digest-row');
  const queue = page.getByTestId('auto-queue');
  const entry = (id) => page.getByTestId(`auto-entry-${id}`);
  const entryIds = () => queue.locator('li[data-state]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-testid').replace('auto-entry-', '')));
  /** A button of an entry's row: the row is hovered first, as the buttons show on hover. */
  const act = async (id, name) => {
    await entry(id).hover();
    await entry(id).getByRole('button', { name, exact: true }).click();
  };
  const posts = (path) => service.requests.filter((request) => request.method === 'POST' && request.path === path).map((request) => request.body);
  const toAuto = async () => {
    await sidebarRow.click();
    await auto.waitFor({ timeout: 10_000 });
  };
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
  /** The state on screen now, in light and in dark, under its number. `hover` keeps the pointer where the state needs it. */
  async function shot(number, name, hover = null) {
    // A toast from the step before, such as "Archived", has gone first.
    await until(async () => (await page.locator('[data-sonner-toast]').count()) === 0, 12_000);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      if (hover) await hover();
      else await page.mouse.move(WIDTH - 20, HEIGHT - 12);
      // Scrollbar thumbs fade about a second after the last scroll.
      await wait(1600);
      const file = `${side}-${theme}-${String(number).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      console.log(`SHOT ${file}`);
    }
    await setTheme('light');
  }

  try {
    console.log(`root data-roomy: ${(await page.evaluate(() => document.documentElement.getAttribute('data-roomy'))) ?? '(none)'}`);

    // --- The sidebar row opens one tab, with the address form.
    await sidebarRow.click();
    await page.getByTestId('auto-address-form').waitFor({ timeout: 15_000 });
    check('the Auto row opens a tab with the address form', (await page.getByTestId('tab-auto').count()) === 1);
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
    await page.getByRole('button', { name: 'Retry' }).click();
    await page.getByTestId('auto-list').waitFor({ timeout: 15_000 });
    check('Retry reads the list once the service answers', await until(async () => (await rowIds()).length === 7));

    // --- The list.
    const first = await rowIds();
    check('threads that wait on him come first, then the rest in the service’s order', first.join() === [BEDS, BREAD, SEEDS, COMPOST, TRELLIS, INSPECTION, BARREL].join(), first.join());
    check('a waiting row shows its question and answer buttons', (await row(BEDS).getByRole('button', { name: 'Cedar' }).count()) === 1 && ((await row(BEDS).textContent()) ?? '').includes('Which wood for the frames?'));
    check('an unread row has a dot', (await row(SEEDS).getByRole('img', { name: 'Unread' }).count()) === 1);
    check('a thread back from snooze says Back and when', /Back \d/.test((await row(TRELLIS).textContent()) ?? ''));
    check('a failed row says so', ((await row(COMPOST).textContent()) ?? '').includes('Failed: The turn ended early'));
    check('snoozed threads are behind one line with their count', ((await page.getByTestId('auto-snoozed-line').textContent()) ?? '').replace(/\s+/g, ' ').includes('Snoozed2'));
    check('the sidebar row counts the threads that wait on him', ((await sidebarRow.textContent()) ?? '') === 'Auto1');

    // --- The mark for the Mac: set from a row's menu, first under its own heading, ended by the service.
    const marked = page.getByTestId('auto-group-desk');
    await fromMenu(BEDS, 'Mark for the Mac');
    check('a marked thread is first, under "For the Mac", and still shows its question and buttons', await until(async () => (await rowIds())[0] === BEDS && (await marked.getByRole('heading', { name: 'For the Mac' }).count()) === 1 && (await marked.getByRole('button', { name: 'Cedar' }).count()) === 1 && ((await marked.textContent()) ?? '').includes('Which wood for the frames?')));
    check('the service has the mark, set by Opal', service.thread(BEDS)?.desk?.by === 'opal' && posts(`/api/threads/${BEDS}/desk`).at(-1)?.on === true);
    check('a marked thread that waits still counts in the sidebar', ((await sidebarRow.textContent()) ?? '') === 'Auto1');
    await fromMenu(TRELLIS, 'Mark for the Mac');
    await until(async () => (await marked.locator('[data-thread-id]').count()) === 2);
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
    check('plumbing steps are hidden', (await talk.getByTestId('auto-steps').first().locator('> div').count()) === 2);
    check('the follow-ups show under the last reply', (await page.getByTestId('auto-next').getByRole('button').allTextContents()).join('|') === 'Scale it to two loaves|Put the times in today’s page');
    await talk.evaluate((element) => { element.scrollTop = 0; });
    await shot(3, 'thread-long-reply');
    await talk.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await shot(4, 'follow-ups');

    // --- A vault file named in a reply opens as a page, in its own tab.
    await talk.locator('[data-vault-path="Recipes/Bread.md"]').first().click();
    check('a vault link in a reply opens the page in Opal', await until(async () => (await page.getByTestId(`tab-${path.join(vault, 'Recipes/Bread.md')}`).count()) === 1));
    await sidebarRow.click();
    await talk.waitFor({ timeout: 10_000 });
    check('the Auto row goes back to the one tab', (await page.getByTestId('tab-auto').count()) === 1 && (await page.getByTestId('tab-auto').getAttribute('aria-selected')) === 'true');

    // --- A follow-up, clicked, is sent as his message, and the reply streams in.
    await page.getByTestId('auto-next').getByRole('button', { name: 'Scale it to two loaves' }).click();
    check('a click on a follow-up sends it', await until(() => service.requests.some((request) => request.path === `/api/threads/${BREAD}/messages` && request.body?.text === 'Scale it to two loaves')));
    check('the reply streams in', await until(async () => ((await talk.textContent()) ?? '').includes('Beans and peas go in bed 2')));
    await atRest(BREAD);

    // --- A reply streaming with its steps above it; a message sent meanwhile waits; Stop.
    service.hold('stream');
    await say('Sort the seed list slowly, by sowing month');
    check('a reply shows while it streams, with the steps above it', await until(async () => ((await talk.textContent()) ?? '').includes('Here is the list by month')));
    const steps = talk.getByTestId('auto-steps').last();
    check('steps fold to the last three', (await steps.locator('> div').count()) === 3 && ((await steps.textContent()) ?? '').includes('2 earlier steps'), (await steps.textContent()) ?? '');
    check('Stop shows while a turn runs', (await page.getByTestId('auto-stop').count()) === 1);
    await shot(5, 'streaming');
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
    check('a question is a card: its first sentence, the rest, the options and a field', ((await card.locator('p').first().textContent()) ?? '') === 'Which bed gets the tomatoes this year?' && (await card.getByRole('button', { name: /Bed 4/ }).count()) === 1 && (await card.getByRole('textbox', { name: 'Your own answer' }).count()) === 1);
    await shot(7, 'question');
    await card.getByRole('button', { name: /Bed 4/ }).click();
    check('an option answers the question', await until(async () => ((await talk.textContent()) ?? '').includes('Tomatoes go in Bed 4')));
    await atRest(BREAD);

    // --- A permission request, allowed.
    await say('Tidy the old drafts');
    await page.getByTestId('auto-permission').waitFor({ timeout: 10_000 });
    const permission = page.getByTestId('auto-permission');
    check('a permission request is a card with its title, detail, Allow and Deny', ((await permission.textContent()) ?? '').includes('mv Notes/drafts/2024-*.md Archive/drafts/') && (await permission.getByRole('button', { name: 'Allow' }).count()) === 1 && (await permission.getByRole('textbox', { name: 'Message with the denial' }).count()) === 1);
    await shot(8, 'permission');
    await permission.getByRole('button', { name: 'Allow' }).click();
    check('Allow lets the turn go on', await until(async () => ((await talk.textContent()) ?? '').includes('Three drafts moved to the archive')));
    await atRest(BREAD);

    // --- A question answered from its row.
    await row(BEDS).getByRole('button', { name: 'Cedar' }).click();
    check('a row’s button answers its question', await until(async () => (await row(BEDS).getByRole('button', { name: 'Cedar' }).count()) === 0 && service.thread(BEDS)?.status !== 'waiting'));
    check('the sidebar count goes with it', await until(async () => ((await sidebarRow.textContent()) ?? '') === 'Auto'));
    await atRest(BEDS);

    // --- Snooze, the Snoozed line, and back.
    const openSnooze = async () => {
      await row(SEEDS).hover();
      await page.getByTestId(`auto-snooze-${SEEDS}`).click();
      await page.getByTestId('auto-snooze-menu').waitFor({ timeout: 5_000 });
    };
    await openSnooze();
    check('Snooze offers Later today or Tomorrow, Next week, and a date', (await page.getByTestId('auto-snooze-menu').getByRole('menuitem').allTextContents()).join('|').replace(/Later today[^|]*\|/, '').startsWith('Tomorrow') && (await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: 'Pick a date…' }).count()) === 1);
    await shot(9, 'snooze-menu', async () => {
      if ((await page.getByTestId('auto-snooze-menu').count()) === 0) await openSnooze();
    });
    if ((await page.getByTestId('auto-snooze-menu').count()) === 0) await openSnooze();
    await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: /^Tomorrow/ }).click();
    check('a snoozed thread leaves the list', await until(async () => !(await rowIds()).includes(SEEDS) && service.thread(SEEDS)?.snoozed > Date.now() / 1000));
    await page.getByTestId('auto-snoozed-line').click();
    await page.getByTestId('auto-snoozed').waitFor({ timeout: 5_000 });
    check('the Snoozed line shows them, the first to return first', (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 3);
    await shot(10, 'snoozed-open');
    // Its time passes on the service: it comes back on top and says Back.
    service.wake(SEEDS);
    check('a thread back from snooze is on top and says Back', await until(async () => (await rowIds())[0] === SEEDS && /Back \d/.test((await row(SEEDS).textContent()) ?? '')));
    // Bring back, from the Snoozed line.
    await page.getByTestId('auto-snoozed').locator('[data-thread-id]').first().hover();
    await page.getByTestId('auto-snoozed').getByRole('button', { name: 'Bring back' }).first().click();
    check('Bring back returns one at once', await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 1));
    await page.getByTestId('auto-snoozed-line').click();

    // --- Drag a row to reorder.
    const before = await rowIds();
    await row(COMPOST).dragTo(row(before[0]), { targetPosition: { x: 40, y: 4 } });
    check('a dragged row lands where it was dropped, on the service too', await until(async () => (await rowIds())[0] === COMPOST && service.entries()[0].id === COMPOST), `${before.join()} -> ${(await rowIds()).join()}`);

    // --- Archive.
    await row(BARREL).hover();
    await page.getByTestId(`auto-archive-${BARREL}`).click();
    check('Archive takes a thread out of the list', await until(async () => !(await rowIds()).includes(BARREL) && service.thread(BARREL)?.archived === true));

    // --- A new thread.
    await page.getByTestId('auto-new-thread').click();
    check('New thread opens an empty thread with the box focused', await until(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'auto-box')) && ((await talk.textContent()) ?? '') === '');
    await shot(11, 'new-thread');
    await say('Plan the herb bed by the back door');
    check('the first message starts a thread, on top of the list and open', await until(async () => {
      const [top] = service.entries();
      return top.title.startsWith('Plan the herb bed') && (await rowIds())[0] === top.id && (await row(top.id).locator('[aria-current]').count()) === 1;
    }));
    check('its reply streams in', await until(async () => ((await talk.textContent()) ?? '').includes('Beans and peas go in bed 2')));

    // --- A digest entry nobody has started: its card, and Hand to Auto.
    await row(INSPECTION).click();
    await page.getByTestId('auto-hand-over').waitFor({ timeout: 10_000 });
    check('a waiting entry shows its words as a card and one button', ((await page.getByTestId('auto-entry').textContent()) ?? '').includes('The committee walks the plots on the 21st.') && ((await page.getByTestId('auto-hand-over').textContent()) ?? '') === 'Hand to Auto');
    await shot(12, 'digest-item');
    await page.getByTestId('auto-hand-over').click();
    check('Hand to Auto starts it with its own words', await until(() => service.requests.some((request) => request.path === `/api/threads/${INSPECTION}/start`) && service.thread(INSPECTION)?.waits === false));
    await atRest(INSPECTION);
    check('its reply follows the card', await until(async () => (await page.getByTestId('auto-entry').count()) === 1 && (await page.getByTestId('auto-hand-over').count()) === 0 && ((await talk.textContent()) ?? '').includes('Beans and peas')));

    // --- A send that waits on the phone is one line of text.
    service.sendWaiting(INSPECTION);
    check('a send waiting on the phone is one line, with no control', await until(async () => ((await page.getByTestId('auto-send-waiting').textContent().catch(() => '')) ?? '') === 'A send is waiting on your phone.') && (await page.getByTestId('auto-send-waiting').getByRole('button').count()) === 0);
    service.sendWent(INSPECTION);
    check('a message that went out is one line', await until(async () => ((await talk.textContent()) ?? '').includes('Sent to club@example.com: Plot inspection')));

    // --- A post that fails: the words return to the box under "Not sent".
    service.failWrites('refuse');
    await say('Move the inspection to the 22nd');
    check('a failed post returns its words to the box under Not sent', await until(async () => (await box.inputValue()) === 'Move the inspection to the 22nd' && ((await page.getByTestId('auto-not-sent').textContent().catch(() => '')) ?? '').startsWith('Not sent')));
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
    check('Enter leaves the box as it is while out of reach', (await box.inputValue()) === 'Is anyone there?' && ((await page.getByTestId('auto-not-sent').textContent().catch(() => '')) ?? '') === 'Not sent');
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

    // --- The narrow layout: under 720 px of tab the list hides while a thread is open.
    await resize(1180, HEIGHT);
    check('under 720 px the list hides while a thread is open', await until(async () => (await auto.getAttribute('data-narrow')) === 'true' && (await page.getByTestId('auto-list').count()) === 0 && (await page.getByTestId('auto-thread').count()) === 1));
    await shot(15, 'narrow-thread');
    await page.getByTestId('auto-back').click();
    check('its back button shows the list alone', await until(async () => (await page.getByTestId('auto-list').count()) === 1 && (await page.getByTestId('auto-thread').count()) === 0));
    await shot(16, 'narrow-list');
    await resize(WIDTH, HEIGHT);
    await until(async () => (await auto.getAttribute('data-narrow')) === null);

    // --- The digest as a queue, beside the list where a thread would be.
    const DAY = '2026-11-13';
    const left = () => service.digest()?.left;
    check('the Digest row is under New thread and says how much is left', ((await digestRow.textContent()) ?? '') === 'Digest8 left' && (await page.locator('[data-testid="auto-list"] [data-auto-row]').nth(1).getAttribute('data-testid')) === 'auto-digest-row');
    await digestRow.click();
    await page.getByTestId('auto-queue-pane').waitFor({ timeout: 10_000 });
    check('the queue shows the day written out, Left and All with their counts', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Friday, November 13' && ((await page.getByTestId('auto-queue-left').textContent()) ?? '') === 'Left8' && ((await page.getByTestId('auto-queue-all').textContent()) ?? '') === 'All10'));
    check('Left holds the open entries, in the file’s order, under their sections', (await entryIds()).join() === 'meeting-allotment-committee,item-1,item-3,person-robin-seed-swap,text-plots-3d20bff3,text-yesterday-5c1d2e3f,text-yesterday-a7b8c9d0,draft-1' && (await queue.getByRole('heading').allTextContents()).join() === 'Meetings,Top 3,People,Plots,Yesterday,Drafted replies');
    check('an entry shows its priority, its title and its words, and a table whole', ((await entry('item-3').locator('p').first().textContent()) ?? '') === 'Medium Fix the kitchen tap' && (await entry('text-plots-3d20bff3').locator('table').count()) === 1);
    check('a title the words open with is said once', ((await entry('meeting-allotment-committee').textContent()) ?? '').split('Allotment committee').length === 2 && ((await entry('person-robin-seed-swap').textContent()) ?? '').startsWith('Robin (seed swap): quiet'));
    check('a closed entry is cut to three lines, between two lines', await (async () => {
      const heights = await queue.locator('.auto-clip').evaluateAll((clips) => clips.map((clip) => [clip.clientHeight, parseFloat(getComputedStyle(clip.firstElementChild).lineHeight)]));
      return heights.length === 8 && heights.every(([height, line]) => height <= line * 3 + 0.5) && (await entry('meeting-allotment-committee').locator('.auto-clip').evaluate((clip) => clip.clientHeight === 3 * parseFloat(getComputedStyle(clip.firstElementChild).lineHeight))) && (await entry('text-plots-3d20bff3').locator('.auto-clip').getAttribute('data-cut')) === 'true';
    })());
    check('Resolve all is offered only for a section of reading with more than one entry left', (await queue.locator('section:has(button:text-is("Resolve all"))').evaluateAll((sections) => sections.map((section) => section.getAttribute('aria-label')))).join() === 'Yesterday');
    await shot(20, 'queue-left', () => entry('item-1').hover());

    // Resolve one, then Undo.
    await act('person-robin-seed-swap', 'Resolve');
    check('Resolve takes an entry out of Left', await until(async () => !(await entryIds()).includes('person-robin-seed-swap') && left() === 7 && ((await digestRow.textContent()) ?? '') === 'Digest7 left'));
    await page.locator('[data-sonner-toast] button', { hasText: 'Undo' }).click();
    check('Undo brings it back', await until(async () => (await entryIds()).includes('person-robin-seed-swap') && left() === 8));
    check('both went as one resolve each, for the same entry', JSON.stringify(posts('/api/digest/resolve').slice(-2)) === JSON.stringify([{ date: DAY, id: 'person-robin-seed-swap', resolved: true }, { date: DAY, id: 'person-robin-seed-swap', resolved: false }]));

    // Resolve all in a section.
    await queue.getByRole('region', { name: 'Yesterday' }).getByRole('button', { name: 'Resolve all' }).click();
    check('Resolve all resolves a section’s open entries in one post', await until(async () => left() === 6 && (await queue.getByRole('region', { name: 'Yesterday' }).count()) === 0) && JSON.stringify(posts('/api/digest/resolve').at(-1)) === JSON.stringify({ date: DAY, ids: ['text-yesterday-5c1d2e3f', 'text-yesterday-a7b8c9d0'], resolved: true }));

    // Thread: a thread that waits on top of the list. He stays in the queue.
    await act('meeting-allotment-committee', 'Thread');
    check('Thread makes a thread that waits on top of the list, and he stays in the queue', await until(async () => {
      const [top] = service.entries();
      return top.title === 'Allotment committee' && top.waits === true && (await rowIds())[0] === top.id && !(await entryIds()).includes('meeting-allotment-committee') && (await page.getByTestId('auto-queue-pane').count()) === 1;
    }) && JSON.stringify(posts('/api/digest/thread').at(-1)) === JSON.stringify({ date: DAY, id: 'meeting-allotment-committee', start: false }));

    // A link in an entry's words opens the page; the digest's own file opens too.
    await entry('item-3').locator('[data-vault-path="Projects/Kitchen/Tap.md"]').click();
    check('a vault link in an entry opens the page in Opal', await until(async () => (await page.getByTestId(`tab-${path.join(vault, 'Projects/Kitchen/Tap.md')}`).count()) === 1));
    await toAuto();
    await page.getByRole('button', { name: 'Open the digest' }).click();
    check('Open the digest opens the digest’s file as a page', await until(async () => (await page.getByTestId(`tab-${path.join(vault, 'Library/digests/2026-11-13 digest.md')}`).count()) === 1));
    await toAuto();
    check('the queue is still open beside the list', (await page.getByTestId('auto-queue-pane').count()) === 1 && (await entry('item-3').getAttribute('data-open')) === null);

    // An entry opened in place: a note written and removed, the drafted reply copied.
    await entry('item-1').locator('[data-auto-entry]').click();
    const note = entry('item-1').getByRole('textbox', { name: 'Your note' });
    await note.waitFor({ timeout: 5_000 });
    check('a click opens an entry in place: its note, its drafted reply and a box', ((await entry('item-1').getByTestId('auto-entry-draft').textContent()) ?? '').startsWith('Reply drafted for Garden centre') && (await entry('item-1').getByRole('textbox', { name: 'What to do with it' }).getAttribute('placeholder')) === 'Say what to do with it' && (await note.getAttribute('placeholder')) === 'Add a note');
    await note.fill('Ask about peat-free compost too');
    await entry('item-1').getByRole('button', { name: 'Save the note' }).click();
    check('Save the note keeps his note on the entry', await until(() => service.digest()?.sections[1].entries[0].note === 'Ask about peat-free compost too') && JSON.stringify(posts('/api/digest/note').at(-1)) === JSON.stringify({ date: DAY, id: 'item-1', text: 'Ask about peat-free compost too' }));
    await until(async () => (await entry('item-1').getByRole('button', { name: 'Save the note' }).count()) === 0);
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
    const words = entry('item-1').getByRole('textbox', { name: 'What to do with it' });
    await words.fill('Ask for collection on Saturday');
    await words.press('Enter');
    check('words in the box start a thread with them, and it opens', await until(async () => {
      const [top] = service.entries();
      return top.title === 'Order the seed trays' && (await page.getByTestId('auto-thread').count()) === 1 && ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Order the seed trays' && ((await talk.locator('[data-testid="auto-message"]').first().textContent().catch(() => '')) ?? '') === 'Ask for collection on Saturday';
    }));
    const said = posts('/api/digest/thread').at(-1);
    check('they went as words with a message id, and never as a send', said?.words === 'Ask for collection on Saturday' && /^[0-9a-f]{10}$/.test(said?.cid ?? '') && Object.keys(said ?? {}).sort().join() === 'cid,date,id,words');
    await until(() => service.entries()[0].status === 'idle');

    // All: what became of each entry.
    await digestRow.click();
    await page.getByTestId('auto-queue-all').click();
    check('All shows the day whole, with what became of each entry', await until(async () => (await entryIds()).length === 10 && ((await entry('text-yesterday-88ae3a55').textContent()) ?? '').endsWith('ResolvedReopen') && ((await entry('item-2').textContent()) ?? '').includes('A thread') && (await entry('item-2').getByRole('button', { name: 'Open the thread' }).count()) === 1));
    await shot(22, 'queue-all', () => entry('item-2').hover());
    await act('text-yesterday-5c1d2e3f', 'Reopen');
    check('Reopen opens a resolved entry again', await until(() => service.digest()?.sections[4].entries[1].state === 'open'));
    await act('item-2', 'Open the thread');
    check('Open the thread opens it in the tab', await until(async () => ((await page.getByTestId('auto-title').textContent().catch(() => '')) ?? '') === 'Book the allotment inspection'));

    // A change made on another device: the open day and the row's count are read again.
    await digestRow.click();
    const leftBefore = left();
    await fromPhone('/api/digest/resolve', { date: DAY, id: 'item-3' });
    check('a change made on another device shows without a click', await until(async () => left() === leftBefore - 1 && ((await digestRow.textContent()) ?? '') === `Digest${leftBefore - 1} left` && (await entry('item-3').getAttribute('data-state')) === 'resolved'));

    // An earlier day opens whole; a day with nothing in it says so.
    await page.getByRole('button', { name: 'Earlier day' }).click();
    check('Earlier day steps back, to the day whole', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Thursday, November 12' && (await page.getByTestId('auto-queue-all').getAttribute('aria-pressed')) === 'true' && (await entryIds()).join() === 'item-1,item-2,text-yesterday-1a2b3c4d' && ((await entry('item-2').getByTestId('auto-entry-note').textContent()) ?? '') === 'The stone is in the blue tin'));
    check('the row still counts the latest day', ((await digestRow.textContent()) ?? '') === `Digest${left()} left`);
    await shot(23, 'earlier-day');
    await page.getByRole('button', { name: 'Earlier day' }).click();
    check('a digest with no entries says so', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Wednesday, November 11' && ((await page.getByTestId('auto-queue-empty').textContent()) ?? '') === 'This digest has no entries.' && (await page.getByRole('button', { name: 'Earlier day' }).isDisabled())));
    await page.getByRole('button', { name: 'Later day' }).click();
    await page.getByRole('button', { name: 'Later day' }).click();
    check('Later day steps forward to the latest, on Left', await until(async () => ((await page.getByTestId('auto-queue-day').textContent()) ?? '') === 'Friday, November 13' && (await page.getByTestId('auto-queue-left').getAttribute('aria-pressed')) === 'true' && (await page.getByRole('button', { name: 'Later day' }).isDisabled())));

    // The queue is a pane like a thread: narrow, it hides the list.
    await resize(1180, HEIGHT);
    check('under 720 px the queue hides the list, and its back button returns to it', await until(async () => (await auto.getAttribute('data-narrow')) === 'true' && (await page.getByTestId('auto-list').count()) === 0 && (await page.getByTestId('auto-queue-pane').count()) === 1) && await (async () => {
      await page.getByTestId('auto-back').click();
      return until(async () => (await page.getByTestId('auto-list').count()) === 1 && (await page.getByTestId('auto-queue-pane').count()) === 0);
    })());
    await resize(WIDTH, HEIGHT);
    await until(async () => (await auto.getAttribute('data-narrow')) === null);
    await digestRow.click();

    // --- What Opal asked the service for, over the whole run.
    const paths = service.requests.filter((request) => request.headers['x-auto-client'] !== 'phone').map((request) => request.path);
    check('Opal never ticked a box by number and never asked for the inbox', !paths.some((requestPath) => requestPath.includes('/digest/tick') || requestPath.includes('/digest/inbox')));
    check('Opal asked only for routes it has', paths.every((requestPath) => /^\/api\/(status|status\/check|events(\?last=[\w.]+)?|threads|threads\/[\w-]+(\/(events(\?last=[\w.]+)?|messages|stop|answer|model|rename|archive|move|snooze|start|desk))?|digest(\?date=\d{4}-\d{2}-\d{2})?|digests|digest\/(resolve|note|thread))$/.test(requestPath)), paths.find((requestPath) => !/^\/api\//.test(requestPath)) ?? '');
    check('no request marked a message as a send', !service.requests.some((request) => JSON.stringify(request.body ?? {}).includes('sends')));
    check('every write named the client and carried no Origin', service.requests.filter((request) => request.method === 'POST' && request.headers['x-auto-client'] !== 'phone').every((request) => request.headers['x-auto-client'] === 'opal' && request.headers.origin === undefined && request.headers['content-type'] === 'application/json'));

    // --- The empty list, on a service where every thread is snoozed.
    await page.getByTestId('auto-new-thread').hover();
    await page.getByTestId('auto-settings').click();
    await page.getByRole('menuitem', { name: 'Change address…' }).click();
    await page.getByRole('textbox', { name: 'Address' }).fill(emptyService.url);
    await page.getByRole('textbox', { name: 'Address' }).press('Enter');
    await page.getByTestId('auto-empty').waitFor({ timeout: 15_000 });
    check('with no thread left the list says so, how many are snoozed and when the next returns', /^Nothing left\.2 snoozed\. The next one returns (today|tomorrow) at \d/.test((await page.getByTestId('auto-empty').textContent()) ?? ''), (await page.getByTestId('auto-empty').textContent()) ?? '');
    await shot(17, 'empty-list');
    await page.getByTestId('auto-snoozed-line').click();
    check('the Snoozed line still shows them', await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 2));
    await shot(18, 'empty-list-snoozed-open');

    // --- The empty queue: every entry of the digest resolved.
    check('the Digest row says Done when nothing is left', await until(async () => ((await digestRow.textContent()) ?? '') === 'DigestDone'));
    await digestRow.click();
    await page.getByTestId('auto-queue-empty').waitFor({ timeout: 10_000 });
    check('with nothing left the queue says so and offers the whole day', ((await page.getByTestId('auto-queue-empty').textContent()) ?? '') === 'Nothing left in this digest.Show all 10');
    await shot(24, 'empty-queue');
    await page.getByRole('button', { name: 'Show all 10' }).click();
    check('Show all shows the day whole', await until(async () => (await entryIds()).length === 10 && (await page.getByTestId('auto-queue-all').getAttribute('aria-pressed')) === 'true'));

    // --- No digest at all.
    await page.getByTestId('auto-new-thread').hover();
    await page.getByTestId('auto-settings').click();
    await page.getByRole('menuitem', { name: 'Change address…' }).click();
    await page.getByRole('textbox', { name: 'Address' }).fill(bareService.url);
    await page.getByRole('textbox', { name: 'Address' }).press('Enter');
    check('a service with no digest says so, and the row shows no count', await until(async () => ((await page.getByTestId('auto-queue-empty').textContent().catch(() => '')) ?? '') === 'No digest yet.' && ((await digestRow.textContent()) ?? '') === 'Digest'));
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
console.log(`${failed.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length} of ${results.length} checks; screenshots in ${outDir}${errors.length > 0 ? `; page errors: ${errors.join(' | ')}` : ''}`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
