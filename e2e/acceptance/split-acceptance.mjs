// Disposable Electron acceptance for split view: two panes side by side,
// each its own row of tabs over its own page card. One run per look
// (version A and B of the roomy variant), each with its own temp profile,
// temp vault and stand-in Auto service (src/tests/fixtures/auto, made-up
// threads, 127.0.0.1 only):
//
// Split Right from the menu command, a page opened from the tree in each
// pane and typed in (each keeps its own text, caret and scroll), the Auto
// tab in one pane with a reply streaming while a page in the other takes
// typing, a tab moved across from its menu and by a drag onto the other
// row, Open to the side, a page already open in the other pane focusing
// that pane, the last tab of a pane closed, the divider dragged and double
// clicked, a restart that brings both panes, their tabs, the active pane and
// the divider back, a session saved in the shape from before panes loading
// as one pane, a drag over the card's right half splitting, and a narrow
// window showing only the active pane. With --main <dir> (a built copy of
// main), one pane is compared pixel for pixel with main's window.
//
//   node e2e/acceptance/split-acceptance.mjs [--out dir] [--sides a,b] [--main dir]
//
// Screenshots, light and dark at 1500 x 933, are for people to look at:
// <side>-<theme>-<nn>-<state>.png. The window never takes the keyboard: it
// hides once shown and shows again without being made active.
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { startStandIn } from '../../src/tests/fixtures/auto/standIn.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const outDir = path.resolve(flag('out', path.join('e2e', 'out', 'split')));
const SIDES = flag('sides', 'a,b').split(',');
const MAIN = flag('main', null);
const WIDTH = 1500;
const HEIGHT = 933;
const BREAD = '5a0000000002';

let side = 'a';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${side}] ${name}${detail ? `: ${detail}` : ''}`);
};
const errors = [];
await mkdir(outDir, { recursive: true });

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const TODAY = iso(new Date());
const YESTERDAY = iso(new Date(Date.now() - 86_400_000));
const paragraphs = (topic, count) =>
  Array.from({ length: count }, (_, index) => `${topic} paragraph ${index + 1}. The beds by the shed get the morning sun, so the seedlings go there first and the trays stay on the bench until the frost has passed.`).join('\n\n');

/** A temp profile and vault with the same made-up pages. */
async function makeProfile({ withAuto = null } = {}) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-split-userdata-'));
  const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-split-vault-'));
  await mkdir(path.join(vaultParent, 'Vault'), { recursive: true });
  const vault = await realpath(path.join(vaultParent, 'Vault'));
  const put = async (relative, text) => {
    await mkdir(path.dirname(path.join(vault, relative)), { recursive: true });
    await writeFile(path.join(vault, relative), text);
  };
  await put('Archive/Journal/Template.md', '---\ndate: {{date:YYYY-MM-DD}}\ntags:\n  - daily\n---\n');
  await put(`Library/daily/${TODAY}.mdo`, `---\ndate: ${TODAY}\ntags:\n  - daily\n---\nWalk the garden beds before the rain.\n`);
  // Yesterday's page is long, so the stream of days scrolls to reach it.
  await put(`Library/daily/${YESTERDAY}.mdo`, `---\ndate: ${YESTERDAY}\ntags:\n  - daily\n---\n${paragraphs('Yesterday', 24)}\n`);
  await put('Garden plan.md', `# Garden plan\n\n${paragraphs('Garden', 30)}\n`);
  await put('Kitchen list.md', `# Kitchen list\n\n${paragraphs('Kitchen', 30)}\n`);
  await put('Reading.md', '# Reading\n\n- The Well-Tempered Garden\n');
  await put('Seeds.md', '# Seeds\n\nBeans, peas, chard.\n');
  await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
  if (side === 'b') await writeFile(path.join(userData, 'variants.json'), JSON.stringify({ version: 1, sides: { roomy: 'b' } }, null, 2));
  if (withAuto) await writeFile(path.join(userData, 'auto.json'), JSON.stringify({ version: 1, url: withAuto }, null, 2));
  return { userData, vault };
}

/** Launches a built app on a temp profile with the window hidden and shown again without being made active. */
async function launch(appDir, userData) {
  const app = await electron.launch({ args: [appDir], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  page.on('pageerror', (error) => errors.push(`[${side}] ${String(error)}`));
  for (let wait = 0; wait < 100 && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await app.evaluate(({ app: electronApp, BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.setContentSize(size.width, size.height);
    electronApp.hide();
  }, { width: WIDTH, height: HEIGHT });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await app.evaluate(({ app: electronApp }) => electronApp.show());
  await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: '.cm-cursorLayer, .cm-cursor { visibility: hidden !important; } input, textarea { caret-color: transparent !important; }' });
  return { app, page };
}

// --- A small PNG reader, for comparing two screenshots pixel for pixel. ---
function decodePng(buffer) {
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const data = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
    } else if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function differingPixels(first, second) {
  const a = decodePng(first);
  const b = decodePng(second);
  if (a.width !== b.width || a.height !== b.height) return { count: -1, size: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
  let count = 0;
  let largest = 0;
  let box = null;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const i = (y * a.width + x) * a.channels;
      const j = (y * b.width + x) * b.channels;
      const delta = Math.max(Math.abs(a.pixels[i] - b.pixels[j]), Math.abs(a.pixels[i + 1] - b.pixels[j + 1]), Math.abs(a.pixels[i + 2] - b.pixels[j + 2]));
      if (delta > 0) {
        count += 1;
        largest = Math.max(largest, delta);
        box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
      }
    }
  }
  return { count, largest, box };
}

async function setTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
  await page.waitForTimeout(200);
}

/** One pane with one page, drawn the same way by this build and by main's: the picture to compare. */
async function onePanePicture(appDir, name) {
  const { userData, vault } = await makeProfile();
  const { app, page } = await launch(appDir, userData);
  try {
    await page.getByTestId('markdown-editor').first().waitFor({ timeout: 20_000 });
    await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, path.join(vault, 'Garden plan.md'));
    await page.locator('[data-testid="tab-strip"] [role="tab"]', { hasText: 'Garden plan' }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await page.mouse.move(WIDTH - 330, HEIGHT - 40);
    await page.waitForTimeout(1400);
    const pictures = {};
    // Light again at the end: the first picture can catch a control still fading after launch.
    for (const theme of ['light', 'dark', 'light']) {
      await setTheme(page, theme);
      await page.waitForTimeout(1000);
      pictures[theme] = await page.screenshot({ path: path.join(outDir, `${side}-${theme}-00-${name}.png`) });
    }
    return pictures;
  } finally {
    await app.close().catch(() => undefined);
  }
}

async function tour() {
  const service = await startStandIn({ pace: 40, retryMs: 500 });
  const { userData, vault } = await makeProfile({ withAuto: service.url });
  const abs = (relative) => path.join(vault, relative);
  let { app, page } = await launch(process.cwd(), userData);
  const watchdog = setTimeout(() => {
    console.log('FAIL the run stopped answering after 10 minutes');
    void app.close().finally(() => process.exit(1));
  }, 600_000);

  const wait = (ms) => page.waitForTimeout(ms);
  const until = async (test, timeout = 10_000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await test()) return true;
      await wait(50);
    }
    return false;
  };
  const menu = (id) => app.evaluate(({ BrowserWindow }, commandId) => BrowserWindow.getAllWindows()[0].webContents.send('menu:invoke', commandId), id);
  const columns = () => page.locator('[data-pane-column]');
  const column = (index) => columns().nth(index);
  const columnCount = () => columns().count();
  /** The names on a pane's row of tabs. */
  const tabsOf = (index) => column(index).locator('[data-testid="tab-strip"] [role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.textContent?.trim() ?? ''));
  const pill = (index, name) => column(index).locator('[data-testid="tab-strip"] [role="tab"]', { hasText: name });
  const activeIndex = () => page.evaluate(() => [...document.querySelectorAll('[data-pane-column]')].findIndex((element) => element.getAttribute('data-pane-active') === 'true'));
  /** Which pane holds the keyboard, by position; -1 for none. */
  const keyboardIn = () => page.evaluate(() => [...document.querySelectorAll('[data-pane-column]')].findIndex((element) => element.contains(document.activeElement)));
  const tree = (relative) => page.locator(`[data-tree-path="${abs(relative)}"]`);
  const editorIn = (index) => column(index).locator('.cm-content').first();
  const scrollerIn = (index) => column(index).locator('.cm-scroller').first();
  const disk = (relative) => readFile(abs(relative), 'utf8');
  const leftWidth = () => column(0).evaluate((element) => Math.round(element.getBoundingClientRect().width));
  const rest = async () => {
    // An empty spot in the sidebar, under its tree: nothing there shows a hover.
    await page.mouse.move(200, HEIGHT - 150);
    await wait(900);
  };
  let shotIndex = 0;
  /** A picture of the window as it is, light and dark. */
  const shot = async (name, hover = null) => {
    shotIndex += 1;
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      if (hover) await hover();
      else await rest();
      await page.screenshot({ path: path.join(outDir, `${side}-${theme}-${String(shotIndex).padStart(2, '0')}-${name}.png`) });
    }
    await setTheme(page, 'light');
  };
  const endOfEditor = async (index) => {
    await editorIn(index).click();
    await page.keyboard.press('Meta+ArrowDown');
  };

  try {
    // Launch opens Daily in the one pane.
    await page.getByTestId('markdown-editor').first().waitFor({ timeout: 20_000 });
    check('the app starts with one pane and no divider', (await columnCount()) === 1 && (await page.getByTestId('pane-divider').count()) === 0);
    await tree('Garden plan.md').click();
    await until(async () => (await tabsOf(0)).includes('Garden plan'));
    await editorIn(0).waitFor({ timeout: 10_000 });

    // --- Split Right from the menu command opens an empty pane with the keyboard in it.
    await menu('panes.splitRight');
    await until(async () => (await columnCount()) === 2);
    check('Split Right opens a second pane at the right', (await columnCount()) === 2 && (await tabsOf(1)).length === 0);
    check('the new pane is empty and says so, with a way to close it', (await column(1).getByTestId('no-page-open').count()) === 1 && (await column(1).getByRole('button', { name: 'Close pane' }).count()) === 1);
    check('the keyboard is in the new pane, which is the active one', await until(async () => (await keyboardIn()) === 1 && (await activeIndex()) === 1), `${await keyboardIn()} ${await activeIndex()}`);
    check('the left pane keeps its page', (await tabsOf(0)).join() === 'Daily,Garden plan' || (await tabsOf(0)).includes('Garden plan'), (await tabsOf(0)).join());
    check('the other pane’s open tab is drawn quieter', (await pill(0, 'Garden plan').getAttribute('data-quiet')) === 'true');
    await shot('empty-pane');

    // --- A page from the tree opens in the active pane.
    await tree('Kitchen list.md').click();
    check('a page clicked in the tree opens in the active pane', await until(async () => (await tabsOf(1)).join() === 'Kitchen list'), (await tabsOf(1)).join());
    await editorIn(1).waitFor({ timeout: 10_000 });
    check('the left pane still shows its own page', (await column(0).locator('.cm-content').first().textContent())?.includes('Garden paragraph 1') === true);

    // --- Typing in both: each page keeps its own text, caret and scroll.
    await scrollerIn(0).evaluate((element) => { element.scrollTop = 600; });
    await scrollerIn(1).evaluate((element) => { element.scrollTop = 200; });
    await wait(300);
    const leftLine = column(0).locator('.cm-line', { hasText: 'Garden paragraph 9.' }).first();
    await leftLine.click();
    await page.keyboard.press('End');
    check('a click in the left pane makes it active', (await activeIndex()) === 0);
    await page.keyboard.type(' AAA', { delay: 15 });
    const rightLine = column(1).locator('.cm-line', { hasText: 'Kitchen paragraph 3.' }).first();
    await rightLine.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' BBB', { delay: 15 });
    const leftTopAfter = await scrollerIn(0).evaluate((element) => Math.round(element.scrollTop));
    // Back in the left page, where its caret was: the next words follow the first ones.
    await editorIn(0).evaluate((element) => element.focus());
    await wait(150);
    await page.keyboard.type('CCC', { delay: 15 });
    const saved = await until(async () => {
      const left = await disk('Garden plan.md');
      const right = await disk('Kitchen list.md');
      return left.includes(' AAACCC') && right.includes(' BBB') && !left.includes('BBB') && !right.includes('AAA') && !right.includes('CCC');
    }, 8_000);
    const lines = async (relative) => (await disk(relative)).split('\n').flatMap((line) => [...line.matchAll(/.{0,12}(AAA|BBB|CCC).{0,12}/g)].map((match) => match[0])).join(' / ');
    check('each page takes its own typing and saves it, and the left caret was kept', saved, saved ? '' : `${await lines('Garden plan.md')} | ${await lines('Kitchen list.md')}`);
    check('the left page kept its scroll while the right one was typed in', Math.abs(leftTopAfter - 600) <= 40, String(leftTopAfter));
    check('the right page kept its own scroll', Math.abs((await scrollerIn(1).evaluate((element) => Math.round(element.scrollTop))) - 200) <= 200);
    await shot('two-pages');

    // --- The divider: hover, drag, double click.
    const divider = page.getByTestId('pane-divider');
    const before = await leftWidth();
    const box = await divider.boundingBox();
    await shot('divider-hovered', async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await wait(500);
    });
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await wait(200);
    const dragged = await leftWidth();
    check('dragging the divider resizes the panes', Math.abs(dragged - (before - 60)) <= 4, `${before} -> ${dragged} (divider says ${await divider.getAttribute('aria-valuenow')})`);
    const moved = await divider.boundingBox();
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(80, moved.y + moved.height / 2, { steps: 8 });
    await page.mouse.up();
    const cardWidth = await column(0).getByTestId('workspace-surface').evaluate((element) => Math.round(element.getBoundingClientRect().width));
    const narrowest = await leftWidth();
    check('a pane is never narrower than 360 px', cardWidth >= 360, `card ${cardWidth}, column ${narrowest}`);
    const dividerNow = await page.getByTestId('pane-divider').boundingBox();
    await page.mouse.dblclick(dividerNow.x + dividerNow.width / 2, dividerNow.y + dividerNow.height / 2);
    await wait(200);
    const room = await page.locator('section:has([data-pane-column])').evaluate((element) => Math.round(element.getBoundingClientRect().width));
    check('a double click makes the panes equal', Math.abs((await leftWidth()) - room / 2) <= 2, `${await leftWidth()} of ${room}`);

    // --- The Auto tab in one pane and a page in the other: a reply streams while the page takes typing.
    await column(1).getByTestId('workspace-surface').click({ position: { x: 300, y: 300 } });
    await page.getByTestId(`auto-row-${BREAD}`).locator('[data-auto-row]').click();
    await column(1).getByTestId('auto-talk').waitFor({ timeout: 15_000 });
    check('a thread picked in the sidebar shows in the active pane’s Auto tab', (await pill(1, 'Sourdough timings').count()) === 1 && (await column(0).getByTestId('auto').count()) === 0);
    service.hold('stream');
    const box2 = column(1).getByTestId('auto-box');
    await box2.click();
    await box2.fill('Sort the seed list slowly, by sowing month');
    await box2.press('Enter');
    const talk = column(1).getByTestId('auto-talk');
    await until(async () => ((await talk.textContent()) ?? '').includes('Here is the list by month'), 15_000);
    const lengthBefore = ((await talk.textContent()) ?? '').length;
    service.release('stream');
    await column(0).locator('.cm-line', { hasText: 'Garden paragraph 12.' }).first().click();
    await page.keyboard.press('End');
    check('a click in the page beside the thread makes that pane active', (await activeIndex()) === 0);
    await page.keyboard.type(' typed while the reply streams', { delay: 40 });
    const lengthAfter = ((await talk.textContent()) ?? '').length;
    check('the reply went on streaming while the page took typing', lengthAfter > lengthBefore, `${lengthBefore} -> ${lengthAfter}`);
    check('the typing went to the page, not the thread', await until(async () => (await disk('Garden plan.md')).includes(' typed while the reply streams'), 6_000) && ((await box2.inputValue()) === ''));
    check('the reply finishes in its pane', await until(async () => ((await talk.textContent()) ?? '').includes('sowing depths next'), 20_000));
    await shot('thread-beside-page');
    // Auto's keys follow the pane in front: Cmd+Z from the page is the page's own undo.
    await page.keyboard.press('Meta+z');
    check('Cmd+Z in the page beside the thread undoes the page’s typing, and the thread stays open', await until(async () => !(await disk('Garden plan.md')).includes('typed while the reply streams'), 6_000) && (await pill(1, 'Sourdough timings').count()) === 1);

    // --- A tab moved across from its menu.
    await pill(1, 'Kitchen list').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Move to the other pane/ }).click();
    check('Move to the other pane puts the tab in the other row and makes that pane active', await until(async () => (await tabsOf(0)).includes('Kitchen list') && !(await tabsOf(1)).includes('Kitchen list')) && (await activeIndex()) === 0, `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);

    // --- And back by a drag onto the other row.
    await pill(0, 'Kitchen list').dragTo(column(1).getByTestId('tab-strip'));
    check('a tab dragged onto the other row moves there', await until(async () => (await tabsOf(1)).includes('Kitchen list') && !(await tabsOf(0)).includes('Kitchen list')), `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);

    // --- Open to the side, from a tree row's menu.
    await column(0).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await tree('Reading.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open to the side' }).click();
    check('Open to the side opens the page in the other pane and makes it active', await until(async () => (await tabsOf(1)).includes('Reading')) && (await activeIndex()) === 1, (await tabsOf(1)).join());
    // Option+click does the same.
    await column(1).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await tree('Seeds.md').click({ modifiers: ['Alt'] });
    check('Option+click opens in the other pane', await until(async () => (await tabsOf(0)).includes('Seeds')) && (await activeIndex()) === 0, (await tabsOf(0)).join());

    // --- A page already open in the other pane is not opened twice.
    const allTabs = async () => [...(await tabsOf(0)), ...(await tabsOf(1))];
    const countBefore = (await allTabs()).length;
    await tree('Reading.md').click();
    check('a page open in the other pane focuses that pane’s tab instead of opening again', await until(async () => (await activeIndex()) === 1) && (await allTabs()).length === countBefore && (await pill(1, 'Reading').getAttribute('aria-selected')) === 'true');
    await page.getByTestId(`auto-row-${BREAD}`).locator('[data-auto-row]').click();
    check('the one Auto tab stays one tab in either pane', (await allTabs()).filter((name) => name === 'Sourdough timings').length === 1);

    // --- Restart: both panes, their tabs, the active pane and the divider come back.
    await page.getByTestId('pane-divider').focus();
    for (let step = 0; step < 6; step += 1) await page.keyboard.press('ArrowRight');
    await column(0).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    // The open thread is not kept across a restart (as before panes), so the Auto tab comes back named "New thread".
    const named = async (index) => (await tabsOf(index)).map((name) => (name === 'Sourdough timings' || name === 'New thread' ? 'Auto tab' : name));
    const shape = { left: await named(0), right: await named(1), active: await activeIndex(), width: await leftWidth() };
    clearTimeout(watchdog);
    await app.close();
    ({ app, page } = await launch(process.cwd(), userData));
    await page.getByTestId('markdown-editor').first().waitFor({ timeout: 20_000 });
    await until(async () => (await columnCount()) === 2);
    await wait(800);
    const after = { left: await named(0), right: await named(1), active: await activeIndex(), width: await leftWidth() };
    check('after a restart both panes come back with their tabs, the active pane and the divider', JSON.stringify(after) === JSON.stringify(shape), `${JSON.stringify(shape)} vs ${JSON.stringify(after)}`);

    // --- Closing the last tab of a pane closes the pane.
    while ((await tabsOf(1)).length > 0) {
      const count = (await tabsOf(1)).length;
      await column(1).locator('[data-testid="tab-strip"] [role="tab"]').first().hover();
      await column(1).locator('[data-testid^="tab-close-"]').first().click();
      await until(async () => (await columnCount()) === 1 || (await tabsOf(1)).length < count);
      if ((await columnCount()) === 1) break;
    }
    check('closing the last tab of a pane closes it, and the other takes the width', (await columnCount()) === 1 && (await page.getByTestId('pane-divider').count()) === 0);

    // --- A drag over the card's right half splits there.
    const card = column(0).getByTestId('workspace-surface');
    const cardBox = await card.boundingBox();
    const moving = pill(0, 'Seeds');
    const pillBox = await moving.boundingBox();
    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width * 0.75, cardBox.y + cardBox.height / 2, { steps: 12 });
    await wait(200);
    const zone = await page.getByTestId('pane-drop-zone').count();
    shotIndex += 1;
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      await page.mouse.move(cardBox.x + cardBox.width * 0.75 + (theme === 'dark' ? 4 : 0), cardBox.y + cardBox.height / 2, { steps: 2 });
      await wait(300);
      await page.screenshot({ path: path.join(outDir, `${side}-${theme}-${String(shotIndex).padStart(2, '0')}-drop-zone.png`) });
    }
    await setTheme(page, 'light');
    await page.mouse.up();
    check('a tab dragged over the card’s right half shows the drop zone', zone === 1);
    check('dropped there, it splits and lands in the new pane', await until(async () => (await columnCount()) === 2 && (await tabsOf(1)).join() === 'Seeds'), `${(await tabsOf(0)).join()} | ${await columnCount() > 1 ? (await tabsOf(1)).join() : ''}`);

    // --- A narrow window shows only the active pane; the other comes back when it widens.
    const rightTabs = await tabsOf(1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 800));
    check('a narrow window shows only the active pane, full width', await until(async () => (await columnCount()) === 1) && (await tabsOf(0)).join() === rightTabs.join() && (await page.getByTestId('pane-divider').count()) === 0, (await tabsOf(0)).join());
    shotIndex += 1;
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      await rest();
      await page.screenshot({ path: path.join(outDir, `${side}-${theme}-${String(shotIndex).padStart(2, '0')}-narrow.png`) });
    }
    await setTheme(page, 'light');
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width: WIDTH, height: HEIGHT });
    check('the other pane and its tabs come back once the window widens', await until(async () => (await columnCount()) === 2) && (await tabsOf(1)).join() === rightTabs.join());

    // --- A session saved in the shape from before panes loads as one pane.
    // The address says the open page too, and a reload shows it: point it at the page the old session has open.
    await page.evaluate((file) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(file)}`; }, abs('Reading.md'));
    await wait(400);
    await page.evaluate(({ left, right, date }) => {
      const tab = (file) => ({ history: [{ location: { mode: 'focus', file } }], index: 0 });
      window.localStorage.setItem('opal.tabs.session', JSON.stringify({ version: 1, value: { date, active: 1, tabs: [tab(left), tab(right)] } }));
    }, { left: abs('Garden plan.md'), right: abs('Reading.md'), date: TODAY });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await until(async () => (await columnCount()) >= 1 && (await tabsOf(0)).length > 0, 15_000);
    await wait(600);
    check('a session saved before panes loads as one pane with its tabs', (await columnCount()) === 1 && (await tabsOf(0)).join() === 'Garden plan,Reading' && (await pill(0, 'Reading').getAttribute('aria-selected')) === 'true', (await tabsOf(0)).join());

    // --- A page is never editable in two panes, whatever the way in.
    const daily = abs(`Library/daily/${TODAY}.mdo`);
    /** How many live editors the window has for a file, and where the "Open in the other pane" lines are. */
    const liveFor = (file) => page.evaluate((target) => [...document.querySelectorAll('[data-live-editor]')].filter((element) => element.getAttribute('data-live-editor') === target && element.querySelector('.cm-content')).length, file);
    const lineIn = (index, file) => column(index).locator(`[data-testid="editor-elsewhere"][data-path="${file}"]`);
    const leftCard = () => column(0).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    // Back: the left tab goes Reading, then Kitchen list; the right pane opens Reading; Back in the left would show it twice.
    await pill(0, 'Reading').click();
    await tree('Kitchen list.md').click();
    await until(async () => (await tabsOf(0)).includes('Kitchen list'));
    await menu('panes.splitRight');
    await until(async () => (await columnCount()) === 2);
    await tree('Reading.md').click();
    await until(async () => (await tabsOf(1)).join() === 'Reading');
    await leftCard();
    await menu('history.back');
    check('Back onto a page the other pane shows steps the left tab, and draws the line there', await until(async () => (await lineIn(0, abs('Reading.md')).count()) === 1) && (await activeIndex()) === 0 && (await tabsOf(0)).includes('Reading') && (await liveFor(abs('Reading.md'))) === 1 && (await tabsOf(1)).join() === 'Reading', `${await activeIndex()} ${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);
    // Reopen: Garden plan closed in the left, then opened in the right; reopening it in the left would show it twice.
    await pill(0, 'Garden plan').hover();
    await column(0).locator('[data-testid^="tab-close-"]').first().click();
    await until(async () => !(await tabsOf(0)).includes('Garden plan'));
    await column(1).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await tree('Garden plan.md').click({ modifiers: ['Meta'] });
    await until(async () => (await tabsOf(1)).includes('Garden plan'));
    await leftCard();
    await menu('tabs.reopenClosed');
    check('a closed tab whose page the other pane shows opens again in its own pane, with the line', await until(async () => (await lineIn(0, abs('Garden plan.md')).count()) === 1) && (await activeIndex()) === 0 && (await pill(0, 'Garden plan').getAttribute('aria-selected')) === 'true' && (await liveFor(abs('Garden plan.md'))) === 1, `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);
    // Today's page in the stream at the left, and the same page opened alone at the right.
    await leftCard();
    await page.getByRole('button', { name: 'Daily', exact: true }).first().click();
    await until(async () => (await column(0).locator(`[data-stack-section="${daily}"] [data-live-editor] .cm-content`).count()) === 1, 10_000);
    await column(1).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await page.evaluate((file) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(file)}&alone=1`; }, daily);
    check('today’s page alone beside the stream that shows it gets the line, not a second editor', await until(async () => (await lineIn(1, daily).count()) === 1, 10_000) && (await liveFor(daily)) === 1 && (await lineIn(1, daily).textContent())?.includes('Open in the other pane') === true, `${await liveFor(daily)} live, ${await lineIn(1, daily).count()} lines`);
    // Typing in both: only the one live editor writes the file.
    await column(0).locator(`[data-stack-section="${daily}"] .cm-content`).click();
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.type(' LIVEONE', { delay: 15 });
    await lineIn(1, daily).locator('span').first().click();
    await page.keyboard.type('GHOST', { delay: 15 });
    await wait(1500);
    const onDisk = await readFile(daily, 'utf8');
    check('typed in both panes, the file holds what the one live editor typed and nothing else', onDisk.split('LIVEONE').length === 2 && !onDisk.includes('GHOST'), JSON.stringify(onDisk.slice(-60)));
    await shot('page-in-other-pane');
    // Show it here: the stream keeps its tab, and its section shows the line in turn.
    await lineIn(1, daily).getByRole('button', { name: 'Show it here' }).click();
    check('Show it here brings the editor to this pane with the keyboard in it, and the stream’s section shows the line', await until(async () => (await column(1).locator(`[data-live-editor="${daily}"] .cm-content`).count()) === 1 && (await lineIn(0, daily).count()) === 1 && (await column(1).locator(`[data-live-editor="${daily}"] .cm-content`).evaluate((element) => element.contains(document.activeElement)))) && (await liveFor(daily)) === 1 && (await activeIndex()) === 1);
    await page.keyboard.press('Meta+ArrowDown');
    await page.keyboard.type(' SECOND', { delay: 15 });
    check('typing there saves through the one editor', await until(async () => { const text = await readFile(daily, 'utf8'); return text.split('LIVEONE').length === 2 && text.split('SECOND').length === 2; }, 6_000));
    // Back to one pane for what follows.
    await menu('panes.close');
    await until(async () => (await columnCount()) === 1);
    check('closing the pane lets the page go: the stream draws it again', await until(async () => (await column(0).locator(`[data-stack-section="${daily}"] [data-live-editor] .cm-content`).count()) === 1, 10_000) && (await page.locator('[data-testid="editor-elsewhere"]').count()) === 0);

    // --- Where the keyboard and a click end up.
    const yesterday = abs(`Library/daily/${YESTERDAY}.mdo`);
    const toOnePane = async () => {
      for (let step = 0; step < 3 && (await columnCount()) > 1; step += 1) {
        await menu('panes.close');
        await until(async () => (await columnCount()) === 1, 3_000);
      }
    };
    /** Whether the keyboard is in a page's editor in a pane, by position. */
    const typingIn = (index) => column(index).evaluate((element) => element.contains(document.activeElement) && document.activeElement?.matches('.cm-content') === true);
    /** Whether an element is inside the visible part of the page that scrolls it. */
    const inView = (locator) => locator.evaluate((element) => {
      let scroller = element.parentElement;
      while (scroller && !(['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
      if (!scroller) return false;
      const box = element.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      return scroller.scrollTop > 0 && box.bottom > view.top && box.top < view.bottom;
    });
    const openPage = (index) => column(index).locator('[data-testid="tab-strip"] [role="tab"][aria-selected="true"]').evaluate((tab) => tab.textContent?.trim() ?? '').catch(() => '');

    // The stream of days at the left with the caret in yesterday's page; Focus Other Pane and back, then type.
    await toOnePane();
    await page.getByRole('button', { name: 'Daily', exact: true }).first().click();
    const yesterdaySection = column(0).locator(`[data-stack-section="${yesterday}"]`);
    await yesterdaySection.waitFor({ timeout: 10_000 });
    await yesterdaySection.scrollIntoViewIfNeeded();
    const yesterdayLine = yesterdaySection.locator('.cm-line', { hasText: 'Yesterday paragraph 12.' }).first();
    await yesterdayLine.waitFor({ timeout: 10_000 });
    await menu('panes.splitRight');
    await until(async () => (await columnCount()) === 2);
    await tree('Seeds.md').click();
    await until(async () => (await openPage(1)) === 'Seeds');
    await yesterdayLine.scrollIntoViewIfNeeded();
    await yesterdayLine.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' STREAMA', { delay: 15 });
    const placed = column(0).locator('.cm-line', { hasText: 'STREAMA' }).first();
    await menu('panes.focusOther');
    await until(async () => (await keyboardIn()) === 1, 3_000);
    await menu('panes.focusOther');
    await until(async () => (await keyboardIn()) === 0, 3_000);
    const streamKept = await inView(placed);
    await page.keyboard.type(' STREAMB', { delay: 15 });
    check('back in the stream, the keyboard is in yesterday’s page where it was, and the stream kept its place', streamKept && await until(async () => (await disk(`Library/daily/${YESTERDAY}.mdo`)).includes('STREAMA STREAMB'), 6_000) && !(await disk(`Library/daily/${TODAY}.mdo`)).includes('STREAMB'), `in view ${streamKept}`);
    // Closing the other pane keeps the stream's place, with Reduce Motion on (as this run emulates) and off.
    for (const motion of ['reduce', 'no-preference']) {
      await page.emulateMedia({ reducedMotion: motion });
      if ((await columnCount()) === 1) {
        await menu('panes.splitRight');
        await until(async () => (await columnCount()) === 2);
        await wait(300);
        check(`a split keeps the stream’s place (reduced motion: ${motion})`, await inView(placed));
      }
      if ((await activeIndex()) !== 1) await menu('panes.focusOther');
      await until(async () => (await activeIndex()) === 1, 3_000);
      await menu('panes.close');
      await until(async () => (await columnCount()) === 1);
      await wait(300);
      check(`closing the other pane keeps the stream’s place (reduced motion: ${motion})`, await inView(placed));
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Split Right from a tab's menu: the new pane is the active one, and the next page opens there.
    await tree('Seeds.md').click();
    await until(async () => (await openPage(0)) === 'Seeds');
    await pill(0, 'Seeds').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Split right/ }).click();
    await until(async () => (await columnCount()) === 2);
    await wait(300);
    check('Split right from the tab’s menu leaves the new pane active with the keyboard in it', (await activeIndex()) === 1 && (await keyboardIn()) === 1, `${await activeIndex()} ${await keyboardIn()}`);
    await tree('Garden plan.md').click();
    await tree('Reading.md').click();
    check('the next page from the tree opens in the new pane, and the left keeps its page', await until(async () => (await openPage(1)) === 'Reading') && (await openPage(0)) === 'Seeds', `${await openPage(0)} | ${await openPage(1)}`);

    // Open to the side on what the active pane already shows, when it is all that pane has: the split stays.
    await tree('Reading.md').click({ modifiers: ['Alt'] });
    await wait(400);
    check('Open to the side on the active pane’s only page keeps both panes and only focuses it', (await columnCount()) === 2 && (await tabsOf(1)).join() === 'Reading' && (await activeIndex()) === 1, `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);

    // A page in a tab behind the other pane's open one opens here.
    await leftCard();
    await tree('Kitchen list.md').click({ modifiers: ['Meta'] });
    await until(async () => (await tabsOf(0)).includes('Kitchen list'));
    await pill(0, 'Seeds').click();
    await until(async () => (await openPage(0)) === 'Seeds');
    await column(1).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await tree('Kitchen list.md').click();
    check('a page in a tab behind the other pane’s open one opens in this pane, and the other does not change', await until(async () => (await openPage(1)) === 'Kitchen list') && (await openPage(0)) === 'Seeds' && (await activeIndex()) === 1, `${await openPage(0)} | ${await openPage(1)}`);
    await pill(0, 'Kitchen list').click();
    check('that tab, brought forward, shows the line', await until(async () => (await lineIn(0, abs('Kitchen list.md')).count()) === 1) && (await liveFor(abs('Kitchen list.md'))) === 1);
    await pill(0, 'Seeds').click();

    // Back and Forward act in their own pane: the right tab went Garden plan, Reading, Kitchen list; the left opens Reading.
    await leftCard();
    await tree('Reading.md').click({ modifiers: ['Meta'] });
    await until(async () => (await openPage(0)) === 'Reading');
    await column(1).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await menu('history.back');
    const back1 = await until(async () => (await lineIn(1, abs('Reading.md')).count()) === 1);
    check('Back onto the page the other pane shows steps this pane’s tab and draws the line', back1 && (await activeIndex()) === 1 && (await openPage(0)) === 'Reading' && (await openPage(1)) === 'Reading', `${await openPage(0)} | ${await openPage(1)}`);
    await menu('history.back');
    check('Back again goes past it', await until(async () => (await openPage(1)) === 'Garden plan') && (await activeIndex()) === 1 && (await openPage(0)) === 'Reading', `${await openPage(0)} | ${await openPage(1)}`);
    await menu('history.forward');
    check('Forward comes back to it, with the line', await until(async () => (await lineIn(1, abs('Reading.md')).count()) === 1) && (await openPage(0)) === 'Reading');
    // Reopen Closed Tab: a tab closed at the left whose page the right pane opens since comes back at the left.
    await leftCard();
    await pill(0, 'Kitchen list').hover();
    await pill(0, 'Kitchen list').locator('[data-testid^="tab-close-"]').click();
    await until(async () => !(await tabsOf(0)).includes('Kitchen list'));
    await column(1).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await tree('Kitchen list.md').click();
    await until(async () => (await openPage(1)) === 'Kitchen list');
    await leftCard();
    await menu('tabs.reopenClosed');
    check('Reopen Closed Tab opens it again in its own pane, with the line', await until(async () => (await openPage(0)) === 'Kitchen list') && (await activeIndex()) === 0 && (await lineIn(0, abs('Kitchen list.md')).count()) === 1 && (await liveFor(abs('Kitchen list.md'))) === 1, `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);

    // A narrow window: the one pane shown ends its row with Show the other pane, and Focus Other Pane keeps the caret.
    await pill(0, 'Seeds').click();
    await until(async () => (await openPage(0)) === 'Seeds');
    const seedsLine = column(0).locator('.cm-line', { hasText: 'Beans, peas, chard.' }).first();
    await seedsLine.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' NARROWA', { delay: 15 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 800));
    await until(async () => (await columnCount()) === 1);
    check('a window too narrow for both shows Show the other pane at the end of the row', (await column(0).getByTestId('show-other-pane').count()) === 1);
    await shot('show-other-pane');
    await column(0).getByTestId('show-other-pane').click();
    check('Show the other pane shows it, with the keyboard in its page', await until(async () => (await openPage(0)) !== 'Seeds' && (await typingIn(0)), 3_000), await openPage(0));
    await menu('panes.focusOther');
    const narrowBack = await until(async () => (await openPage(0)) === 'Seeds' && (await typingIn(0)), 3_000);
    await page.keyboard.type(' NARROWB', { delay: 15 });
    check('Focus Other Pane in a narrow window puts the keyboard back in the page, where its caret was', narrowBack && await until(async () => (await disk('Seeds.md')).includes('NARROWA NARROWB'), 6_000), JSON.stringify((await disk('Seeds.md')).slice(-40)));
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width: WIDTH, height: HEIGHT });
    check('wide again, both panes, and no Show the other pane', await until(async () => (await columnCount()) === 2) && (await page.getByTestId('show-other-pane').count()) === 0);

    // Move Tab to Other Pane, then type at once: the words go into the moved page, after its caret.
    await seedsLine.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' MOVEA', { delay: 15 });
    await menu('panes.moveTab');
    await page.keyboard.type(' MOVEB', { delay: 15 });
    check('typed at once after Move Tab to Other Pane, the words go into the moved page after its caret', await until(async () => /MOVEA ?MOVEB/.test(await disk('Seeds.md')), 6_000) && (await openPage(1)) === 'Seeds' && (await activeIndex()) === 1, JSON.stringify((await disk('Seeds.md')).slice(-40)));

    // A thread clicked in the sidebar while a page has the keyboard: the thread's pane is active and the box takes the words.
    const threadIds = await page.locator('[data-testid^="auto-row-"][data-thread-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-thread-id')));
    const otherThread = threadIds.find((id) => id !== BREAD);
    await page.getByTestId(`auto-row-${BREAD}`).locator('[data-auto-row]').click({ modifiers: ['Alt'] });
    await until(async () => (await column(1).getByTestId('auto-talk').count()) === 1 || (await column(0).getByTestId('auto-talk').count()) === 1, 15_000);
    const autoAt = (await column(1).getByTestId('auto-talk').count()) === 1 ? 1 : 0;
    const pageAt = 1 - autoAt;
    const pageFile = (await openPage(pageAt)) === 'Seeds' ? 'Seeds.md' : `${await openPage(pageAt)}.md`;
    await column(pageAt).locator('.cm-line').first().click();
    await page.keyboard.press('End');
    await page.getByTestId(`auto-row-${otherThread}`).locator('[data-auto-row]').click();
    await wait(300);
    await page.keyboard.type('TOTHREAD', { delay: 15 });
    const boxHolds = await column(autoAt).getByTestId('auto-box').inputValue().catch(() => '');
    await wait(800);
    check('after a thread is clicked, its pane is active and the words go into its box, not the page', boxHolds.includes('TOTHREAD') && (await activeIndex()) === autoAt && !(await disk(pageFile)).includes('TOTHREAD'), `box ${JSON.stringify(boxHolds)}, active ${await activeIndex()}, page ${pageFile}`);
    await column(autoAt).getByTestId('auto-box').fill('');

    // Drops: a tab over the other pane's card lands there; an empty pane takes one anywhere on its row.
    const dragTo = async (from, target, x, y) => {
      const box = await from.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const area = await target.boundingBox();
      await page.mouse.move(area.x + area.width * x, area.y + area.height * y, { steps: 12 });
      await wait(200);
      const zone = await target.locator('[data-testid="pane-drop-zone"]').count();
      await page.mouse.up();
      return zone;
    };
    await column(pageAt).getByTestId('workspace-surface').click({ position: { x: 200, y: 200 } });
    await tree('Garden plan.md').click({ modifiers: ['Meta'] });
    await until(async () => (await tabsOf(pageAt)).includes('Garden plan') || (await tabsOf(0)).includes('Garden plan'));
    const gardenAt = (await tabsOf(0)).includes('Garden plan') ? 0 : 1;
    const zoneShown = await dragTo(pill(gardenAt, 'Garden plan'), column(1 - gardenAt).getByTestId('workspace-surface'), 0.3, 0.5);
    check('a tab dragged over the other pane’s card shows the drop zone there', zoneShown === 1);
    check('dropped there, it lands in that pane with the keyboard in its page', await until(async () => (await openPage(1 - gardenAt)) === 'Garden plan' && (await typingIn(1 - gardenAt)), 4_000), `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);
    await toOnePane();
    await tree('Seeds.md').click({ modifiers: ['Meta'] });
    await until(async () => (await tabsOf(0)).includes('Seeds'));
    await menu('panes.splitRight');
    await until(async () => (await columnCount()) === 2 && (await tabsOf(1)).length === 0);
    await dragTo(pill(0, 'Seeds'), column(1).getByTestId('titlebar'), 0.8, 0.5);
    check('an empty pane takes a tab dropped on its row past the New tab button, with the keyboard in the page', await until(async () => (await openPage(1)) === 'Seeds' && (await typingIn(1)), 4_000), `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);
    await menu('panes.close');
    await until(async () => (await columnCount()) === 1);
    await tree('Seeds.md').click({ modifiers: ['Meta'] });
    await until(async () => (await tabsOf(0)).includes('Seeds'));
    await menu('panes.splitRight');
    await until(async () => (await columnCount()) === 2 && (await tabsOf(1)).length === 0);
    await dragTo(pill(0, 'Seeds'), column(1).getByTestId('workspace-surface'), 0.5, 0.6);
    check('an empty pane takes a tab dropped anywhere on its card', await until(async () => (await openPage(1)) === 'Seeds' && (await typingIn(1)), 4_000), `${(await tabsOf(0)).join()} | ${(await tabsOf(1)).join()}`);
    await toOnePane();

    // --- Thread beside a page once more, for the pictures of a split with the thread at the left.
    await page.addStyleTag({ content: '.cm-cursorLayer, .cm-cursor { visibility: hidden !important; } input, textarea { caret-color: transparent !important; }' });
    await page.getByTestId(`auto-row-${BREAD}`).locator('[data-auto-row]').click({ modifiers: ['Alt'] });
    check('Option+click on a thread opens the Auto tab in the other pane', await until(async () => (await columnCount()) === 2 && (await column(1).getByTestId('auto-talk').count()) === 1, 15_000));
    await shot('thread-at-right');

    check('no page error', errors.length === 0, errors.join(' | '));
  } finally {
    clearTimeout(watchdog);
    await app.close().catch(() => undefined);
    await service.close?.();
  }
}

for (const each of SIDES) {
  side = each;
  errors.length = 0;
  await tour();
  if (MAIN) {
    const ours = await onePanePicture(process.cwd(), 'one-pane');
    const theirs = await onePanePicture(path.resolve(MAIN), 'one-pane-main');
    for (const theme of ['light', 'dark']) {
      const diff = differingPixels(ours[theme], theirs[theme]);
      // An icon's edge can be drawn one level lighter or darker from one launch to the next; anything more is a change.
      check(`with one pane the window is pixel for pixel main's (${theme})`, diff.count >= 0 && diff.largest <= 1, diff.count === 0 ? 'identical' : JSON.stringify(diff));
    }
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
