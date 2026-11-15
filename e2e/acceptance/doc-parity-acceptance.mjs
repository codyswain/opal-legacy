// Disposable Electron acceptance for word-processor parity in the editor:
// every row of doc-parity-rows.mjs driven with real key presses in a
// document (.mdo) and in a note (.md), the saved Markdown and the drawn list
// markers checked, and the time from a key press to the painted frame
// measured on a short page, on a long one (a few thousand lines with lists
// and tables) and in a stack of daily pages.
// Own userData and temp vault; the window never takes the keyboard. Run from
// the repository root after the Vite bundles are built: see README.md here.
//
//   node e2e/acceptance/doc-parity-acceptance.mjs [--out dir] [--only B1,N4] [--no-timing] [--shots]
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ROWS } from './doc-parity-rows.mjs';

const PROJECT_ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); return at === -1 ? null : args[at + 1]; };
const outDir = path.resolve(flag('--out') ?? path.join('e2e', 'out', 'doc-parity'));
const only = flag('--only')?.split(',') ?? null;
const timing = !args.includes('--no-timing');
const shots = args.includes('--shots');
const stackOnly = args.includes('--stack-only');

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-parity-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-parity-vault-'));
await mkdir(path.join(vaultParent, 'Vault', 'Notes'), { recursive: true });
await mkdir(path.join(vaultParent, 'Vault', 'Library', 'daily'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
const FILES = { doc: `${vault}/Notes/parity.mdo`, note: `${vault}/Notes/parity.md` };
for (const file of Object.values(FILES)) await writeFile(file, '');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }, null, 2));
await mkdir(outDir, { recursive: true });

/** A long page: sections of paragraphs, nested bullets, numbers, boxes and a table, about 3,000 lines. */
function longPage() {
  const lines = ['# Long page', ''];
  for (let section = 1; section <= 46; section += 1) {
    lines.push(`## Section ${section}`, '');
    for (let paragraph = 0; paragraph < 3; paragraph += 1) {
      lines.push(`Paragraph ${paragraph} of section ${section} has **bold words**, a [link](https://example.com/${section}) and enough plain text to wrap onto a second row in a page of ordinary width.`, '');
    }
    for (let item = 0; item < 6; item += 1) {
      lines.push(`- Bullet ${item} in section ${section}`, `  - Nested ${item}a`, `    - Deep ${item}`, `  - Nested ${item}b`);
    }
    lines.push('');
    for (let item = 1; item <= 15; item += 1) lines.push(`${item}. Step ${item} of section ${section}`);
    lines.push('');
    for (let item = 0; item < 5; item += 1) lines.push(`- [${item % 2 ? 'x' : ' '}] Task ${item} of section ${section}`);
    lines.push('', '| Item | Owner | Cost |', '|---|---|---|');
    for (let row = 0; row < 8; row += 1) lines.push(`| item ${row} | person ${row} | $${row * 3} |`);
    lines.push('');
  }
  lines.push('## Big list', '');
  for (let item = 1; item <= 300; item += 1) lines.push(`${item}. Big list item ${item}`);
  lines.push('', 'The end.', '');
  return lines.join('\n');
}
const LONG = { doc: `${vault}/Notes/long.mdo`, note: `${vault}/Notes/long.md` };
const long = longPage();
for (const file of Object.values(LONG)) await writeFile(file, long);
// A stream of daily pages, to time typing in the newest of a stack.
for (let day = 1; day <= 30; day += 1) {
  const name = `2031-03-${String(day).padStart(2, '0')}.mdo`;
  await writeFile(path.join(vault, 'Library', 'daily', name), `Notes for day ${day}.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n${'A line of text for the day. '.repeat(6)}\n`);
}

const app = await electron.launch({ args: [PROJECT_ROOT], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const guard = setTimeout(() => { console.log('FAIL the run took more than 15 minutes'); void app.close().finally(() => process.exit(1)); }, 900_000);
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

// The window never keeps the keyboard: once it shows, the app hides and
// shows again without being made active. The page still acts focused and
// keeps drawing frames while other windows cover it.
for (let wait = 0; wait < 100 && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); wait += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await app.evaluate(({ app: electronApp, BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
  electronApp.hide();
});
await new Promise((resolve) => setTimeout(resolve, 300));
await app.evaluate(({ app: electronApp }) => electronApp.show());
await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
await page.emulateMedia({ reducedMotion: 'reduce' });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 800));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function open(file, waitFor = null) {
  await page.evaluate((target) => { window.location.hash = `#/files?mode=focus&file=${encodeURIComponent(target)}`; }, file);
  await page.waitForFunction((target) => {
    const content = document.querySelector('.cm-content');
    return Boolean(content?.cmTile?.root?.view) && document.querySelector('[data-testid="markdown-editor"]') !== null && (!target || content.textContent.includes(target));
  }, waitFor, { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/** Sets the page's text and selection from marked text, as one edit that is not typing. */
const setPage = (marked) => page.evaluate((text) => {
  const view = document.querySelector('.cm-content').cmTile.root.view;
  let anchor = 0;
  let head = 0;
  const from = text.indexOf('«');
  if (from !== -1) {
    text = text.replace('«', '');
    head = text.indexOf('»');
    text = text.replace('»', '');
    anchor = from;
  } else {
    anchor = head = Math.max(0, text.indexOf('‸'));
    text = text.replace('‸', '');
  }
  view.focus();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
  view.dispatch({ selection: { anchor, head }, userEvent: 'select' });
}, marked);

/** The page's text with the caret or selection marked, and what it draws. */
const readPage = () => page.evaluate(() => {
  const view = document.querySelector('.cm-content').cmTile.root.view;
  const { main } = view.state.selection;
  const doc = view.state.doc.toString();
  const marks = main.empty ? [[main.head, '‸']] : [[main.from, main.anchor === main.from ? '«' : '»'], [main.to, main.anchor === main.to ? '«' : '»']];
  let text = doc;
  for (const [at, mark] of [...marks].reverse()) text = text.slice(0, at) + mark + text.slice(at);
  // A backward selection reads the same as a forward one here.
  if (!main.empty) text = text.replace('»', '\u0000').replace('«', '»').replace('\u0000', '«').replace(/»([\s\S]*)«/, '«$1»');
  const numeral = (marker) => {
    const number = marker.querySelector('.cm-md-number');
    if (!number) return '';
    const before = getComputedStyle(number, '::before').content;
    return number.textContent || (before && before !== 'none' ? before.replace(/^"|"$/g, '') : '');
  };
  const markers = [...view.contentDOM.querySelectorAll('.cm-md-list-marker')].map((marker) => {
    const line = marker.closest('.cm-line');
    const level = line?.style.getPropertyValue('--list-level') || marker.dataset.level || marker.dataset.depth || '0';
    return `${marker.dataset.kind}:${numeral(marker)}:${level}`;
  });
  const shown = [...view.contentDOM.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '');
  return { text, markers, shown, linkBox: document.querySelector('input[aria-label="Link"]') !== null, links: view.contentDOM.querySelectorAll('.cm-md-link').length };
});

/** A clipboard event with its own data, dispatched on the page's text. Returns what a copy or cut wrote. */
const clipboardEvent = (type, data = null) => page.evaluate(({ type: kind, data: given }) => {
  const view = document.querySelector('.cm-content').cmTile.root.view;
  const transfer = new DataTransfer();
  if (given) for (const [format, value] of Object.entries(given)) transfer.setData(format, value);
  const event = new ClipboardEvent(kind, { clipboardData: transfer, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return { 'text/plain': transfer.getData('text/plain'), 'text/html': transfer.getData('text/html') };
}, { type, data });

let held = null;
async function press(key) {
  if (key.startsWith('t:')) return page.keyboard.type(key.slice(2), { delay: 12 });
  if (key.startsWith('wait:')) return page.waitForTimeout(Number(key.slice(5)));
  if (key === 'copy' || key === 'cut') { held = await clipboardEvent(key); return undefined; }
  if (key === 'paste') return clipboardEvent('paste', Object.fromEntries(Object.entries(held ?? {}).filter(([, value]) => value)));
  if (key.startsWith('paste:')) return clipboardEvent('paste', { 'text/plain': key.slice(6) });
  if (key.startsWith('pasteHtml:')) {
    const [html, plain] = key.slice(10).split('||');
    return clipboardEvent('paste', { 'text/html': html, 'text/plain': plain });
  }
  if (key.startsWith('pastePlain:')) {
    // Paste and Match Style reads the clipboard itself: its read is stubbed, so the system clipboard is never touched.
    await page.evaluate((text) => { Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: async () => text }); }, key.slice(11));
    // The menu owns the shortcut, and a key press sent to the page never reaches the menu.
    await app.evaluate(({ Menu }) => {
      const find = (items) => items.flatMap((item) => [item, ...(item.submenu ? find(item.submenu.items) : [])]);
      find(Menu.getApplicationMenu().items).find((entry) => entry.label === 'Paste and Match Style').click();
    });
    return page.waitForTimeout(300);
  }
  if (key.startsWith('caret:')) {
    return page.evaluate((where) => {
      const view = document.querySelector('.cm-content').cmTile.root.view;
      view.dispatch({ selection: { anchor: where === 'end' ? view.state.doc.length : Number(where) }, userEvent: 'select' });
    }, key.slice(6));
  }
  await page.keyboard.press(key);
  return page.waitForTimeout(25);
}

async function runRow(row, mode) {
  await setPage(row.start);
  await page.waitForTimeout(60);
  for (const key of row.keys) await press(key);
  await page.waitForTimeout(120);
  const got = await readPage();
  // A difference kept on purpose is checked as it is, and reported apart.
  const differs = row.opal !== undefined;
  const wanted = differs ? [row.opal] : [row.expect, ...(row.alt ?? [])];
  const problems = [];
  if (!wanted.includes(got.text)) problems.push(`file ${JSON.stringify(got.text)}, wanted ${JSON.stringify(wanted[0])}`);
  if (!differs && row.shows && JSON.stringify(got.markers) !== JSON.stringify(row.shows)) problems.push(`drawn ${JSON.stringify(got.markers)}, wanted ${JSON.stringify(row.shows)}`);
  if (!differs && row.shows && got.shown.some((line) => /^\s*(?:[-*+]|\d+[.)])\s/.test(line))) problems.push(`a marker shows as text: ${JSON.stringify(got.shown)}`);
  if (row.linkBox && !got.linkBox) problems.push('no link box');
  if (row.linkShown && got.links === 0) problems.push('no link drawn');
  if (row.linkBox) await page.keyboard.press('Escape');
  return { id: row.id, area: row.area, does: row.does, mode, ok: problems.length === 0, same: !differs, why: row.why ?? '', got: got.text, markers: got.markers, detail: problems.join('; ') };
}

// ---- Timing: a key press to the frame that shows it.
const installRecorder = () => page.evaluate(() => {
  if (window.opalLatency) return;
  const samples = [];
  let work = 0;
  const wrap = (view) => {
    if (view.opalWrapped) return;
    view.opalWrapped = true;
    const inner = view.dispatch.bind(view);
    view.dispatch = (...specs) => {
      const start = performance.now();
      try { return inner(...specs); } finally { work += performance.now() - start; }
    };
  };
  window.addEventListener('keydown', (event) => {
    if (['Shift', 'Meta', 'Alt', 'Control'].includes(event.key)) return;
    const content = document.activeElement?.closest?.('.cm-content') ?? document.querySelector('.cm-content');
    const view = content?.cmTile?.root?.view;
    if (!view) return;
    wrap(view);
    const before = view.state;
    const start = performance.now();
    const workBefore = work;
    let frames = 0;
    const tick = () => {
      frames += 1;
      if (view.state === before && frames < 8) { requestAnimationFrame(tick); return; }
      const channel = new MessageChannel();
      channel.port1.onmessage = () => samples.push({ key: event.key, frame: performance.now() - start, work: work - workBefore, changed: view.state !== before, frames });
      channel.port2.postMessage(0);
    };
    requestAnimationFrame(tick);
  }, true);
  window.opalLatency = { take: () => samples.splice(0) };
});
const takeSamples = () => page.evaluate(() => window.opalLatency.take());
const quantile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : NaN; };
const round = (value) => Math.round(value * 10) / 10;

async function timeKeys(label, prepare, keys, count) {
  await prepare();
  await page.waitForTimeout(300);
  await installRecorder();
  await takeSamples();
  for (let index = 0; index < count; index += 1) {
    for (const key of keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(45);
    }
  }
  await page.waitForTimeout(200);
  const samples = (await takeSamples()).filter((sample) => sample.changed);
  const frame = samples.map((sample) => sample.frame);
  const work = samples.map((sample) => sample.work);
  const row = { label, n: samples.length, frameP50: round(quantile(frame, 0.5)), frameP95: round(quantile(frame, 0.95)), frameMax: round(Math.max(...frame)), workP50: round(quantile(work, 0.5)), workP95: round(quantile(work, 0.95)), workMax: round(Math.max(...work)) };
  console.log(`time ${label}: n ${row.n}, to frame p50 ${row.frameP50} ms, p95 ${row.frameP95} ms, max ${row.frameMax} ms; editor work p50 ${row.workP50} ms, p95 ${row.workP95} ms, max ${row.workMax} ms`);
  return row;
}

const caretAfter = (needle) => () => page.evaluate((find) => {
  const view = document.activeElement?.closest?.('.cm-content')?.cmTile?.root?.view ?? document.querySelector('.cm-content').cmTile.root.view;
  const at = view.state.doc.toString().indexOf(find) + find.length;
  view.focus();
  view.dispatch({ selection: { anchor: at }, scrollIntoView: true, userEvent: 'select' });
}, needle);

async function scrollRun(label) {
  const run = await page.evaluate(() => new Promise((resolve) => {
    const scroller = [...document.querySelectorAll('.cm-scroller, .opal-stack-scroll')].find((element) => element.scrollHeight > element.clientHeight + 200) ?? document.querySelector('.cm-scroller');
    scroller.scrollTop = 0;
    const frames = [];
    let last = performance.now();
    let count = 0;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      count += 1;
      scroller.scrollTop += 60;
      if (count >= 400 || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) { resolve({ frames: frames.slice(2), end: scroller.scrollTop }); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const row = { label, n: run.frames.length, p50: round(quantile(run.frames, 0.5)), p95: round(quantile(run.frames, 0.95)), max: round(Math.max(...run.frames)), slow: run.frames.filter((frame) => frame > 25).length };
  console.log(`scroll ${label}: ${row.n} frames at 60 px a frame, p50 ${row.p50} ms, p95 ${row.p95} ms, max ${row.max} ms, ${row.slow} over 25 ms`);
  return row;
}

async function setTheme(theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.evaluate((resolved) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }, theme);
  await page.waitForTimeout(250);
}

const rowResults = [];
const timings = [];
const scrolls = [];
try {
  for (const mode of ['doc', 'note']) {
    await open(FILES[mode]);
    for (const row of ROWS) {
      if (only && !only.includes(row.id)) continue;
      if (row.modes && !row.modes.includes(mode)) continue;
      const result = await runRow(row, mode);
      rowResults.push(result);
      check(`${mode} ${row.id} ${row.does}${result.same ? '' : ' (differs on purpose)'}`, result.ok, result.detail);
    }
    await setPage('‸');
  }

  if (shots) {
    const SAMPLE = ['A list, as typed:', '', '- Bullets at the first level', '  - The second level', '    - The third level', '      - The fourth level', '- Back at the first', '', '1. Numbered steps', '2. The second step', '   1. A step inside it', '   2. Another', '      1. And one deeper', '3. The third step', '', '- [ ] A box to tick', '- [x] A box already ticked', '', 'Then a paragraph after the lists.‸'].join('\n');
    for (const mode of ['doc', 'note']) {
      await open(FILES[mode]);
      await setPage(SAMPLE);
      for (const theme of ['light', 'dark']) {
        await setTheme(theme);
        await page.screenshot({ path: path.join(outDir, `lists-${mode}-${theme}.png`) });
      }
      await setTheme('light');
      await setPage('‸');
    }
  }

  if (timing) {
    for (const mode of stackOnly ? [] : ['doc', 'note']) {
      await open(FILES[mode]);
      await setPage('A short page.\n\n- one\n- two‸\n');
      timings.push(await timeKeys(`${mode}, short page, a letter in a list item`, caretAfter('- two'), ['x'], 40));
      timings.push(await timeKeys(`${mode}, short page, Enter then a letter in a list`, caretAfter('- one'), ['Enter', 'y'], 20));
      timings.push(await timeKeys(`${mode}, short page, Tab then Shift+Tab on an item`, caretAfter('- two'), ['Tab', 'Shift+Tab'], 20));
      await open(LONG[mode], 'Long page');
      await page.waitForTimeout(1500);
      timings.push(await timeKeys(`${mode}, long page, a letter in a paragraph`, caretAfter('Paragraph 1 of section 23 has'), ['x'], 40));
      timings.push(await timeKeys(`${mode}, long page, a letter in a nested bullet`, caretAfter('Nested 3a'), ['x'], 40));
      timings.push(await timeKeys(`${mode}, long page, Enter then a letter in a 15-item numbered list`, caretAfter('Step 3 of section 23'), ['Enter', 'y'], 15));
      timings.push(await timeKeys(`${mode}, long page, Enter then a letter at the top of a 300-item numbered list`, caretAfter('Big list item 2'), ['Enter', 'y'], 12));
      timings.push(await timeKeys(`${mode}, long page, Tab then Shift+Tab on a bullet`, caretAfter('Bullet 4 in section 23'), ['Tab', 'Shift+Tab'], 15));
      timings.push(await timeKeys(`${mode}, long page, a letter on the line under a table`, caretAfter('## Section 24\n\nParagraph 0 of section 24'), ['x'], 30));
      scrolls.push(await scrollRun(`${mode}, long page`));
    }
    // The stream of daily pages: the newest page of a stack.
    await page.evaluate((target) => { window.location.hash = `#/files?mode=stack&kind=daily&file=${encodeURIComponent(target)}`; }, `${vault}/Library/daily/2031-03-30.mdo`);
    const stacked = await page.waitForFunction(() => document.querySelectorAll('.cm-content').length > 1, null, { timeout: 15_000 }).then(() => true, () => false);
    if (stacked) {
      await page.waitForTimeout(1200);
      const inStack = () => page.evaluate(() => {
        const view = [...document.querySelectorAll('.cm-content')].map((content) => content.cmTile?.root?.view).find((each) => each && each.state.doc.toString().includes('- two'));
        const at = view.state.doc.toString().indexOf('- two') + 5;
        view.focus();
        view.dispatch({ selection: { anchor: at }, scrollIntoView: true, userEvent: 'select' });
      });
      timings.push(await timeKeys('stack of 30 daily pages, a letter in a list item', inStack, ['x'], 40));
      timings.push(await timeKeys('stack of 30 daily pages, Enter then a letter in a list', inStack, ['Enter', 'y'], 15));
    } else {
      console.log('time stack of daily pages: the stream did not open, not measured');
    }
  }
} catch (error) {
  check('runs', false, String(error?.stack ?? error));
} finally {
  clearTimeout(guard);
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(vaultParent, { recursive: true, force: true });
}

if (errors.length > 0) check('no page errors', false, [...new Set(errors)].slice(0, 5).join(' | '));
await writeFile(path.join(outDir, 'results.json'), JSON.stringify({ rows: rowResults, timings, scrolls }, null, 2));
const failed = results.filter((result) => !result.ok).length;
const same = rowResults.filter((row) => row.ok && row.same).length;
const kept = rowResults.filter((row) => row.ok && !row.same).length;
if (rowResults.length > 0) console.log(`rows: ${same} as a word processor, ${kept} different on purpose, ${rowResults.length - same - kept} failing, of ${rowResults.length}`);
console.log(`${failed === 0 ? 'PASS' : 'FAIL'} ${results.length - failed} of ${results.length} checks; results in ${path.join(outDir, 'results.json')}`);
process.exit(failed === 0 ? 0 : 1);
