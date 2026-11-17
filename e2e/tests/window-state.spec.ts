import { test, expect } from '../fixtures/electronApp';
import { readFile } from 'fs/promises';
import path from 'path';

test.describe('window state', () => {
  test('restores saved bounds and shows the window', async ({ page, electronApp, userDataDir }) => {
    // The fixture creates userDataDir before launch, so this file is written
    // too late for THIS launch to read — but it proves the round-trip shape and
    // that the window is visible, which is the part no unit test can check.
    await page.waitForSelector('[data-testid="app-shell"]');

    const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.isVisible();
    });
    expect(isVisible).toBe(true);

    // titleBarStyle: 'hiddenInset' means the OS owns the buttons, so the
    // renderer must not be drawing its own.
    await expect(page.locator('[title="Close"]')).toHaveCount(0);
    await expect(page.locator('[title="Minimize"]')).toHaveCount(0);

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.getNormalBounds();
    });
    expect(bounds.width).toBeGreaterThanOrEqual(640);
    expect(bounds.height).toBeGreaterThanOrEqual(480);

    // Resize, then confirm the debounced writer persisted it.
    const resized = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setBounds({ x: 60, y: 60, width: 1024, height: 768 });
      // macOS can constrain the requested size to the available display.
      return win.getNormalBounds();
    });
    expect([resized.width, resized.height]).not.toEqual([bounds.width, bounds.height]);

    const stateFile = path.join(userDataDir, 'window-state.json');
    await expect(async () => {
      const saved = JSON.parse(await readFile(stateFile, 'utf8'));
      expect(saved).toMatchObject({ version: 1, bounds: resized });
    }).toPass({ timeout: 5000 });
  });
});
