// Repeats the Auto run's "three archives, Cmd+Z three times, twice over" section,
// first with a slow stand-in, then a quick one, and checks the keyboard ends on the first row.
// Build first (see the README), then:
//   node e2e/acceptance/auto-undo-loop.mjs [--side a|b] [--times 20] [--open other|first|none]
// --open names the thread open in the pane meanwhile: the first row (the case that once
// lost the keyboard to the box), another row, or none.
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
const ids = await rowIds();
const [one, two, three, four] = ids;
// The thread open in the pane while the rows are archived.
const opened = openMode === 'first' ? one : openMode === 'other' ? ids[5] : null;
if (opened) {
  await page.getByTestId(`auto-row-${opened}`).locator('[data-auto-row]').click();
  await page.getByTestId('auto-box').waitFor({ timeout: 10_000 });
}

let passed = 0;
const failures = [];
for (let run = 1; run <= times; run += 1) {
  await page.evaluate(() => { window.__focusLog = []; });
  // As in the Auto run: the keyboard on the first row.
  await page.getByTestId(`auto-row-${one}`).locator('[data-auto-row]').focus();
  const rounds = [];
  for (const slow of [700, 0]) {
    service.slow(slow);
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
    // The posts land; the keyboard must stay on the row.
    await until(() => [one, two, three].every((id) => service.thread(id)?.archived === false), 15_000);
    await wait(400);
    rounds.push(await focused());
  }
  service.slow(0);
  const ok = rounds.every((where) => where === one) && [one, two, three].every((id) => service.thread(id)?.archived === false);
  if (ok) passed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} [${side}] run ${run}: ${rounds.join(' / ')}`);
  if (!ok) {
    failures.push(run);
    console.log(`  requests for the first row, in the order handled:\n    ${service.requests.filter((each) => each.path.includes(one)).map((each) => `${each.method} ${each.path.replace(/.*threads\//, '')} ${each.body ? JSON.stringify(each.body) : ''}`).join('\n    ')}`);
    console.log(`  focus log:\n    ${(await page.evaluate(() => window.__focusLog.slice(-25))).join('\n    ')}`);
  }
}
console.log(`\n${passed}/${times} passed [${side}, open ${openMode}]`);
await app.close();
await service.close?.();
process.exit(passed === times ? 0 : 1);
