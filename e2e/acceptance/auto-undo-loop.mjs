// Repeats the Auto run's "three archives, Cmd+Z three times, twice over" section,
// first with a slow stand-in, then a quick one, and checks the keyboard ends on the first row.
// Build first (see the README), then:
//   node e2e/acceptance/auto-undo-loop.mjs [--side a|b] [--times 20] [--open other|first|second|none] [--lag ms]
// --open names the thread open in the pane meanwhile: the first row (the case that once
// lost the keyboard to the box), the second (as in the Auto run, where it is the thread
// O opened), another row, or none. --lag 400 makes the list stream's events trail the
// answers by that many ms, as when the Mac is busy.
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, realpath, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { startStandIn } from '../../src/tests/fixtures/auto/standIn.mjs';

const repo = process.cwd();
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const side = flag('side', 'a');
const times = Number(flag('times', '20'));
const openMode = flag('open', 'other');
// The list stream's events trail the answers by this many ms, as on a busy Mac.
const lag = Number(flag('lag', '0'));

const userData = await mkdtemp(path.join(os.tmpdir(), 'opal-undo-userdata-'));
const vaultParent = await mkdtemp(path.join(os.tmpdir(), 'opal-undo-vault-'));
await mkdir(path.join(vaultParent, 'Vault'), { recursive: true });
const vault = await realpath(path.join(vaultParent, 'Vault'));
await mkdir(path.join(vault, 'Archive/Journal'), { recursive: true });
await writeFile(path.join(vault, 'Archive/Journal/Template.md'), '---\ntags:\n  - daily\n---\n');
await writeFile(path.join(vault, 'Notes.md'), '# Notes\n');
await writeFile(path.join(userData, 'disk-roots.json'), JSON.stringify({ version: 1, roots: [vault] }));
if (side === 'b') await writeFile(path.join(userData, 'variants.json'), JSON.stringify({ version: 1, sides: { roomy: 'b' } }));
const service = await startStandIn({ pace: 30, retryMs: 500 });
service.lagList(lag);
await writeFile(path.join(userData, 'auto.json'), JSON.stringify({ version: 1, url: service.url }));

const app = await electron.launch({ args: [repo], env: { ...process.env, OPAL_TEST_USER_DATA_DIR: userData } });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
page.on('crash', () => console.log('the renderer crashed'));
page.on('close', () => console.log('the page closed'));
app.process().on('exit', (code, signal) => console.log(`the app exited: ${code} ${signal}`));
page.on('console', (message) => {
  if (message.type() === 'error') console.log(`console: ${message.text().slice(0, 200)}`);
});
for (let w = 0; w < 100 && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)); w += 1) await new Promise((r) => setTimeout(r, 100));
await app.evaluate(({ app: electronApp, BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1500, 933);
  electronApp.hide();
});
await new Promise((r) => setTimeout(r, 300));
await app.evaluate(({ app: electronApp }) => electronApp.show());
await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true });
// Every focus change, with where it went, for the report on a failure.
await page.evaluate(() => {
  window.__focusLog = [];
  document.addEventListener('focusin', (event) => {
    const element = event.target;
    window.__focusLog.push(`${Math.round(performance.now())} ${element.getAttribute('data-row-id') ?? element.getAttribute('data-testid') ?? element.tagName}`);
    if (window.__focusLog.length > 60) window.__focusLog.shift();
  }, true);
  document.addEventListener('focusout', (event) => {
    const element = event.target;
    window.__focusLog.push(`${Math.round(performance.now())} out ${element.getAttribute('data-row-id') ?? element.getAttribute('data-testid') ?? element.tagName} connected=${element.isConnected} to=${event.relatedTarget?.getAttribute?.('data-testid') ?? event.relatedTarget?.tagName ?? 'none'}`);
  }, true);
  document.addEventListener('keydown', (event) => {
    window.__focusLog.push(`${Math.round(performance.now())} key ${event.metaKey ? 'Cmd+' : ''}${event.key}`);
  }, true);
});

const wait = (ms) => page.waitForTimeout(ms);
const until = async (test, timeout = 5_000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await test()) return true;
    await wait(30);
  }
  return false;
};
const key = (name) => page.keyboard.press(name);
const focused = () => page.evaluate(() => {
  const element = document.activeElement;
  return element?.getAttribute('data-row-id') ?? element?.getAttribute('data-entry-id') ?? element?.getAttribute('data-testid') ?? element?.getAttribute('aria-label') ?? element?.tagName ?? '';
});
const rowIds = () => page.locator('[data-testid="auto-list"] [data-thread-id]').evaluateAll((rows) => rows.map((element) => element.getAttribute('data-thread-id')));

await page.locator('[data-testid="auto-list"] [data-thread-id]').first().waitFor({ timeout: 20_000 });
// Unread and woken threads are lifted until they are read, and then go back into his order. Each of the
// first rows is read once, so the rows keep their order through the runs, as in the Auto run by then.
for (const id of (await rowIds()).slice(0, 6)) {
  await page.getByTestId(`auto-row-${id}`).locator('[data-auto-row]').click();
  await page.getByTestId('auto-box').waitFor({ timeout: 10_000 });
  await until(async () => (await page.getByTestId('auto-title').textContent().catch(() => '')) !== '', 5_000);
}
await page.getByTestId('auto-new-thread').click();
let settled = '';
for (let look = 0; look < 40; look += 1) {
  await wait(250);
  const now = (await rowIds()).join();
  if (now === settled) break;
  settled = now;
}
const ids = await rowIds();
const [one, two, three, four] = ids;
// The thread open in the pane while the rows are archived.
const opened = openMode === 'first' ? one : openMode === 'second' ? two : openMode === 'other' ? ids[5] : null;
if (opened) {
  await page.getByTestId(`auto-row-${opened}`).locator('[data-auto-row]').click();
  await page.getByTestId('auto-box').waitFor({ timeout: 10_000 });
}

// When the open row changes and when a row leaves or joins the list, by the wall clock, for the report on a failure.
await page.evaluate(() => {
  window.__rowLog = [];
  let rows = '';
  let open = '';
  new MutationObserver(() => {
    const list = document.querySelector('[data-testid="auto-list"]');
    if (!list) return;
    const now = [...list.querySelectorAll('[data-thread-id]')].map((element) => element.getAttribute('data-thread-id')).join(' ');
    const current = list.querySelector('[aria-current]')?.getAttribute('data-row-id') ?? '';
    if (now !== rows) window.__rowLog.push(`${Date.now()} rows ${now.split(' ').slice(0, 4).join(' ')}`);
    if (current !== open) window.__rowLog.push(`${Date.now()} open ${current || '(none)'}`);
    rows = now;
    open = current;
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current'] });
});

let passed = 0;
const failures = [];
for (let run = 1; run <= times; run += 1) {
  // Each run starts with that thread open, whatever an earlier run left.
  if (opened && (await page.evaluate(() => document.querySelector('[data-testid="auto-list"] [aria-current]')?.getAttribute('data-row-id') ?? '')) !== opened) {
    await page.getByTestId(`auto-row-${opened}`).locator('[data-auto-row]').click();
    await page.getByTestId('auto-box').waitFor({ timeout: 10_000 });
    // The box takes the keyboard once the thread is up; the row below takes it back from there.
    await wait(500);
  }
  await page.evaluate(() => { window.__focusLog = []; window.__rowLog = []; });
  const startedAt = Date.now();
  // As in the Auto run: the keyboard on the first row.
  await page.getByTestId(`auto-row-${one}`).locator('[data-auto-row]').focus();
  const rounds = [];
  const opens = [];
  for (const slow of [700, 0]) {
    service.slow(slow);
    const roundAt = Date.now();
    await key('e');
    await until(async () => (await focused()) === two, 2_000);
    await key('e');
    await until(async () => (await focused()) === three, 2_000);
    await key('e');
    await until(async () => (await focused()) === four, 2_000);
    for (const back of [three, two, one]) {
      await key('Meta+z');
      await until(async () => (await focused()) === back && service.thread(back)?.archived === false, 5_000);
    }
    // The posts land, as the Auto run waits for them: each archive, then its undoing. The keyboard must stay on the row.
    await until(() => [one, two, three].every((id) => service.thread(id)?.archived === false && JSON.stringify(service.requests.filter((each) => each.at >= roundAt && each.path.endsWith(`${id}/archive`)).map((each) => each.body.archived)) === '[true,false]'), 15_000);
    await wait(400);
    rounds.push(await focused());
    // The thread open before the round is open again after it, not a new thread.
    opens.push(await page.evaluate(() => document.querySelector('[data-testid="auto-list"] [aria-current]')?.getAttribute('data-row-id') ?? ''));
  }
  service.slow(0);
  const ok = rounds.every((where) => where === one) && (!opened || opens.every((id) => id === opened)) && [one, two, three].every((id) => service.thread(id)?.archived === false);
  if (ok) passed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${side}] run ${run}: ${rounds.join(' / ')}${opened ? ` | open ${opens.join(' / ')}` : ''}`);
  if (!ok) {
    failures.push(run);
    console.log(`  rows now: ${(await rowIds()).join(' ')}`);
    console.log(`  the pane: ${await page.evaluate(() => [...document.querySelectorAll('[data-testid^="auto-"]')].map((element) => element.getAttribute('data-testid')).filter((id) => !id.startsWith('auto-row')).slice(0, 20).join(' '))}`);
    await page.screenshot({ path: path.join(os.tmpdir(), `opal-undo-loop-${side}-${run}.png`) });
    console.log(`  requests for ${opened ?? one}, in the order handled:\n    ${service.requests.filter((each) => each.path.includes(opened ?? one)).map((each) => `${each.method} ${each.path.replace(/.*threads\//, '')} ${each.body ? JSON.stringify(each.body) : ''}`).join('\n    ')}`);
    // One timeline of the stand-in's requests and list events for the three rows, and what the page showed.
    const short = (id) => id.slice(-2);
    const watched = [one, two, three];
    const timeline = [
      ...service.requests.filter((each) => each.at >= startedAt && watched.some((id) => each.path.includes(id))).map((each) => [each.at, `service handled (arrived ${each.arrived - startedAt}) ${each.method} ${each.path.replace(/.*threads\//, '')} ${each.body ? JSON.stringify(each.body) : ''}`]),
      ...service.listEvents().filter((each) => each.at >= startedAt && each.kind === 'thread' && watched.includes(each.data.id)).map((each) => [each.at, `list event ${each.n} ${short(each.data.id)} archived=${each.data.archived}`]),
      ...(await page.evaluate(() => window.__rowLog)).map((line) => [Number(line.split(' ')[0]), `page ${line.split(' ').slice(1).join(' ')}`]),
    ].sort((left, right) => left[0] - right[0]);
    console.log(`  timeline for ${watched.join(' ')}:\n    ${timeline.map(([at, what]) => `${at - startedAt} ${what}`).join('\n    ')}`);
    console.log(`  focus log:\n    ${(await page.evaluate(() => window.__focusLog.slice(-25))).join('\n    ')}`);
  }
}
console.log(`\n${passed}/${times} passed [${side}, open ${openMode}]`);
await app.close();
await service.close?.();
process.exit(passed === times ? 0 : 1);
