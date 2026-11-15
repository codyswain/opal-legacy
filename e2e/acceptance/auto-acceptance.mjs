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
// list. Saves light and dark screenshots of each at 1500 x 933 for people to
// look at; nothing compares them. Run from the repository root after the
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
  await put('Notes/Ideas.md', '# Ideas\n\nA rain gauge on the shed.\n');
  await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
  if (side === 'b') await writeFile(path.join(userData, 'variants.json'), JSON.stringify({ version: 1, sides: { roomy: 'b' } }, null, 2));

  const service = await startStandIn({ pace: 30, retryMs: 500 });
  const emptyService = await startStandIn({ fixture: 'empty', retryMs: 500 });
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
  let shots = 0;
  /** The state on screen now, in light and in dark. `hover` keeps the pointer where the state needs it. */
  async function shot(name, hover = null) {
    shots += 1;
    // A toast from the step before, such as "Archived", has gone first.
    await until(async () => (await page.locator('[data-sonner-toast]').count()) === 0, 12_000);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      if (hover) await hover();
      else await page.mouse.move(WIDTH - 20, HEIGHT - 12);
      // Scrollbar thumbs fade about a second after the last scroll.
      await wait(1600);
      const file = `${side}-${theme}-${String(shots).padStart(2, '0')}-${name}.png`;
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
    await shot('address-form');

    // --- Can't reach, with Retry.
    service.down();
    await address.press('Enter');
    await page.getByTestId('auto-unreachable').waitFor({ timeout: 15_000 });
    check("an address that does not answer says it can't be reached", ((await page.getByTestId('auto-unreachable').textContent()) ?? '').includes("Can't reach Auto."));
    const stored = JSON.parse(await readFile(path.join(userData, 'auto.json'), 'utf8'));
    check('the address is kept in auto.json in the profile', stored.version === 1 && stored.url === service.url, JSON.stringify(stored));
    await shot('cant-reach');
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

    // --- A thread opens with its history; replies are Markdown, never HTML.
    await row(BREAD).click();
    await talk.locator('table').waitFor({ timeout: 10_000 });
    check('a thread opens with its history: a table, a list and code', (await talk.locator('table tbody tr').count()) === 5 && (await talk.locator('ol > li').count()) === 3 && (await talk.locator('.auto-md-block[data-language="python"]').count()) === 1);
    check('plumbing steps are hidden', (await talk.getByTestId('auto-steps').first().locator('> div').count()) === 2);
    check('the follow-ups show under the last reply', (await page.getByTestId('auto-next').getByRole('button').allTextContents()).join('|') === 'Scale it to two loaves|Put the times in today’s page');
    await talk.evaluate((element) => { element.scrollTop = 0; });
    await shot('thread-long-reply');
    await talk.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await shot('follow-ups');

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
    await shot('streaming');
    await box.fill('And add the sowing depths');
    await box.press('Enter');
    check('a message sent while a turn runs waits above the box', await until(async () => ((await page.getByTestId('auto-queue').textContent().catch(() => '')) ?? '').includes('And add the sowing depths')));
    await shot('queued-stop');
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
    await shot('question');
    await card.getByRole('button', { name: /Bed 4/ }).click();
    check('an option answers the question', await until(async () => ((await talk.textContent()) ?? '').includes('Tomatoes go in Bed 4')));
    await atRest(BREAD);

    // --- A permission request, allowed.
    await say('Tidy the old drafts');
    await page.getByTestId('auto-permission').waitFor({ timeout: 10_000 });
    const permission = page.getByTestId('auto-permission');
    check('a permission request is a card with its title, detail, Allow and Deny', ((await permission.textContent()) ?? '').includes('mv Notes/drafts/2024-*.md Archive/drafts/') && (await permission.getByRole('button', { name: 'Allow' }).count()) === 1 && (await permission.getByRole('textbox', { name: 'Message with the denial' }).count()) === 1);
    await shot('permission');
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
    await shot('snooze-menu', async () => {
      if ((await page.getByTestId('auto-snooze-menu').count()) === 0) await openSnooze();
    });
    if ((await page.getByTestId('auto-snooze-menu').count()) === 0) await openSnooze();
    await page.getByTestId('auto-snooze-menu').getByRole('menuitem', { name: /^Tomorrow/ }).click();
    check('a snoozed thread leaves the list', await until(async () => !(await rowIds()).includes(SEEDS) && service.thread(SEEDS)?.snoozed > Date.now() / 1000));
    await page.getByTestId('auto-snoozed-line').click();
    await page.getByTestId('auto-snoozed').waitFor({ timeout: 5_000 });
    check('the Snoozed line shows them, the first to return first', (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 3);
    await shot('snoozed-open');
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
    await shot('new-thread');
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
    await shot('digest-item');
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
    await shot('signed-out');
    service.signOut(false);
    await page.getByTestId('auto-signed-out').waitFor({ state: 'detached', timeout: 10_000 });

    // --- Out of reach while open: one line, the list stays, and it recovers.
    service.down();
    await page.getByTestId('auto-notice').waitFor({ timeout: 15_000 });
    check('out of reach while open says so above the list', ((await page.getByTestId('auto-notice').textContent()) ?? '').includes("Can't reach Auto.") && (await rowIds()).length > 0);
    await say('Is anyone there?');
    check('Enter leaves the box as it is while out of reach', (await box.inputValue()) === 'Is anyone there?' && ((await page.getByTestId('auto-not-sent').textContent().catch(() => '')) ?? '') === 'Not sent');
    await box.fill('');
    await shot('cant-reach-open');
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
    await shot('narrow-thread');
    await page.getByTestId('auto-back').click();
    check('its back button shows the list alone', await until(async () => (await page.getByTestId('auto-list').count()) === 1 && (await page.getByTestId('auto-thread').count()) === 0));
    await shot('narrow-list');
    await resize(WIDTH, HEIGHT);
    await until(async () => (await auto.getAttribute('data-narrow')) === null);

    // --- What Opal asked the service for, over the whole run.
    const paths = service.requests.map((request) => request.path);
    check('Opal never asked for a digest route', !paths.some((requestPath) => requestPath.includes('digest')));
    check('no request marked a message as a send', !service.requests.some((request) => JSON.stringify(request.body ?? {}).includes('sends')));
    check('every write named the client and carried no Origin', service.requests.filter((request) => request.method === 'POST').every((request) => request.headers['x-auto-client'] === 'opal' && request.headers.origin === undefined && request.headers['content-type'] === 'application/json'));

    // --- The empty list, on a service where every thread is snoozed.
    await page.getByTestId('auto-new-thread').hover();
    await page.getByTestId('auto-settings').click();
    await page.getByRole('menuitem', { name: 'Change address…' }).click();
    await page.getByRole('textbox', { name: 'Address' }).fill(emptyService.url);
    await page.getByRole('textbox', { name: 'Address' }).press('Enter');
    await page.getByTestId('auto-empty').waitFor({ timeout: 15_000 });
    check('with no thread left the list says so, how many are snoozed and when the next returns', /^Nothing left\.2 snoozed\. The next one returns (today|tomorrow) at \d/.test((await page.getByTestId('auto-empty').textContent()) ?? ''), (await page.getByTestId('auto-empty').textContent()) ?? '');
    await shot('empty-list');
    await page.getByTestId('auto-snoozed-line').click();
    check('the Snoozed line still shows them', await until(async () => (await page.getByTestId('auto-snoozed').locator('[data-thread-id]').count()) === 2));
    await shot('empty-list-snoozed-open');
  } catch (error) {
    check('the run finished', false, String(error).split('\n')[0]);
    await page.screenshot({ path: path.join(outDir, `${side}-failure.png`) }).catch(() => undefined);
  } finally {
    clearTimeout(watchdog);
    await app.close().catch(() => undefined);
    await service.close();
    await emptyService.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vaultParent, { recursive: true, force: true });
  }
}

for (side of SIDES) await tour();

const failed = results.filter((result) => !result.ok);
console.log(`${failed.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL'} ${results.length - failed.length} of ${results.length} checks; screenshots in ${outDir}${errors.length > 0 ? `; page errors: ${errors.join(' | ')}` : ''}`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
