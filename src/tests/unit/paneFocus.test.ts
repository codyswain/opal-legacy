import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { focusActivePane, focusOtherPane, forgetPaneFocus, noteFocus } from '@/renderer/features/disk-explorer/panes/focusPane';
import { giveBack } from '@/renderer/features/auto/components/focus';
import { openTabs, resetTabs } from '@/tests/helpers/tabs';

const state = () => useTabsStore.getState();
const frames = async (count = 3) => {
  for (let frame = 0; frame < count; frame += 1) await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
};

/** Two pane columns as the shell draws them, each a card with editors in it. */
function drawPanes(editors: [number, number]): HTMLElement[][] {
  document.body.innerHTML = '';
  return state().panes.map((pane, index) => {
    const column = document.createElement('div');
    column.setAttribute('data-pane-column', pane.id);
    const card = document.createElement('main');
    card.setAttribute('data-testid', 'workspace-surface');
    card.tabIndex = -1;
    column.append(card);
    document.body.append(column);
    return Array.from({ length: editors[index] }, () => {
      const editor = document.createElement('div');
      editor.className = 'cm-content';
      editor.setAttribute('contenteditable', 'true');
      editor.tabIndex = 0;
      card.append(editor);
      return editor;
    });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetTabs();
  forgetPaneFocus();
  openTabs(['/V/a.md']);
  state().open(fileLocation('/V/b.md'), { side: true });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('coming back to a pane', () => {
  it('puts the keyboard back on the element that last had it there, not the first editor', async () => {
    // The left pane is a stream of days: today first, yesterday below. The caret was in yesterday's page.
    const [[today, yesterday], [right]] = drawPanes([2, 1]);
    state().focusPane(state().panes[0].id);
    yesterday.focus();
    noteFocus(state().panes[0].id, yesterday);
    focusOtherPane();
    await frames();
    expect(document.activeElement).toBe(right);
    noteFocus(state().panes[1].id, right);
    focusOtherPane();
    await frames();
    expect(document.activeElement).toBe(yesterday);
    expect(document.activeElement).not.toBe(today);
  });

  it('falls back to the first editor once the element it remembers is gone', async () => {
    const [[first, second]] = drawPanes([2, 1]);
    noteFocus(state().panes[0].id, second);
    second.remove();
    state().focusPane(state().panes[0].id);
    focusActivePane();
    await frames();
    expect(document.activeElement).toBe(first);
  });

  it('never remembers a tab in the row above the card', async () => {
    const [[editor]] = drawPanes([1, 1]);
    const pill = document.createElement('button');
    document.querySelector(`[data-pane-column="${state().panes[0].id}"]`)?.prepend(pill);
    noteFocus(state().panes[0].id, pill);
    state().focusPane(state().panes[0].id);
    focusActivePane();
    await frames();
    expect(document.activeElement).toBe(editor);
  });
});

describe('a click that shows something in the other pane', () => {
  it('does not give the keyboard back to a page in a pane that is no longer active', () => {
    const [[page]] = drawPanes([1, 1]);
    state().focusPane(state().panes[0].id);
    page.focus();
    const row = document.createElement('button');
    document.body.append(row);
    // The press on a sidebar row remembers the page's editor as where the keyboard was.
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    row.focus();
    // The click showed a thread in the right pane: the keyboard stays out of the left page.
    state().focusPane(state().panes[1].id);
    giveBack();
    expect(document.activeElement).toBe(row);
    // A click that changes no pane (a row's icon) still gives it back.
    state().focusPane(state().panes[0].id);
    giveBack();
    expect(document.activeElement).toBe(page);
  });
});
