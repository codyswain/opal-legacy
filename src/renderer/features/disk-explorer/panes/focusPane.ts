import { EditorView } from '@codemirror/view';
import { selectPaneTab, tabFile, tabLocation, useTabsStore } from '../store/tabsStore';

/*
 * Where the keyboard goes when a pane becomes the active one. Each pane
 * remembers the element that last had the keyboard in it, and each tab where
 * its caret was, so coming back to a pane puts the keyboard where he left
 * it, without scrolling: in a stream of days, focusing the first editor
 * would scroll today's page into view and take his typing.
 */

/** The element that last had the keyboard, per pane. */
const lastFocus = new Map<string, HTMLElement>();
/** Where the caret was, per tab: the page and the selection, for an editor drawn again. */
const carets = new Map<string, { path: string; anchor: number; head: number }>();

const columnOf = (paneId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-pane-column="${CSS.escape(paneId)}"]`);

const EDITOR = '.cm-content[contenteditable="true"]';

/** Remembers where a tab's caret is, when the keyboard is in one of its page's editors. */
function noteCaret(paneId: string, element: Element | null): void {
  if (!(element instanceof HTMLElement) || !element.matches(EDITOR)) return;
  const path = element.closest('[data-live-editor]')?.getAttribute('data-live-editor');
  const tab = selectPaneTab(useTabsStore.getState(), paneId);
  const view = EditorView.findFromDOM(element);
  if (!path || !tab || !view) return;
  const { anchor, head } = view.state.selection.main;
  carets.set(tab.id, { path, anchor, head });
}

/**
 * For the pane column's focusin: this element now has the keyboard in that
 * pane. Only what is on the page card counts; a tab in the row above it is
 * not where he was working.
 */
export function noteFocus(paneId: string, target: EventTarget | null): void {
  if (target instanceof HTMLElement && target.closest('[data-testid="workspace-surface"]')) lastFocus.set(paneId, target);
}

/** For the pane column's focusout: the caret of the editor the keyboard leaves. */
export function noteBlur(paneId: string, target: EventTarget | null): void {
  noteCaret(paneId, target as Element | null);
}

/** The caret of the editor that has the keyboard now, before a command takes it to another pane. */
function noteActiveCaret(): void {
  const active = document.activeElement;
  const paneId = active?.closest('[data-pane-column]')?.getAttribute('data-pane-column');
  if (paneId) noteCaret(paneId, active);
}

/** Forgets what a pane remembered, for tests. */
export function forgetPaneFocus(): void {
  lastFocus.clear();
  carets.clear();
}

/** The tab's editor for the page its caret was in, with that caret put back. */
function editorWithCaret(column: HTMLElement, tabId: string): HTMLElement | null {
  const caret = carets.get(tabId);
  if (!caret) return null;
  const editor = [...column.querySelectorAll<HTMLElement>('[data-live-editor]')]
    .find((element) => element.getAttribute('data-live-editor') === caret.path)
    ?.querySelector<HTMLElement>(EDITOR);
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!editor || !view) return null;
  const length = view.state.doc.length;
  const anchor = Math.min(caret.anchor, length);
  const head = Math.min(caret.head, length);
  const { main } = view.state.selection;
  if (main.anchor !== anchor || main.head !== head) view.dispatch({ selection: { anchor, head } });
  return editor;
}

/**
 * Puts the keyboard in a pane, after the frame that draws it: on the element
 * that last had it there; else, while the pane's page is being drawn, in its
 * editor once it is up, with the tab's caret where it was; else in the first
 * editor, or the page card itself. Never scrolls.
 */
export function focusPaneKeyboard(paneId: string, frames = 60): void {
  window.requestAnimationFrame(() => {
    const state = useTabsStore.getState();
    // Another pane was made active meanwhile: that one's own call puts the keyboard there.
    if (state.activePaneId !== paneId) return;
    const column = columnOf(paneId);
    if (!column) {
      if (frames > 0) focusPaneKeyboard(paneId, frames - 1);
      return;
    }
    if (column.contains(document.activeElement)) return;
    const remembered = lastFocus.get(paneId);
    if (remembered?.isConnected && column.contains(remembered) && !remembered.closest('[inert]')) {
      remembered.focus({ preventScroll: true });
      if (document.activeElement === remembered) return;
    }
    const tab = selectPaneTab(state, paneId);
    const withCaret = tab ? editorWithCaret(column, tab.id) : null;
    if (withCaret) {
      withCaret.focus({ preventScroll: true });
      return;
    }
    // A page is still being read and drawn: its editor comes up in a few frames. The editor the tab's caret was in
    // is waited for while the tab still shows that page, or a stream that holds it.
    const location = tab ? tabLocation(tab) : null;
    const waits = location !== null && location.mode !== 'browse';
    const caret = tab ? carets.get(tab.id) : undefined;
    const caretShown = !!tab && !!caret && (location?.mode === 'stack' || tabFile(tab) === caret.path);
    const editor = column.querySelector<HTMLElement>(EDITOR);
    if (editor && (!caretShown || frames === 0)) {
      editor.focus({ preventScroll: true });
      return;
    }
    if (waits && frames > 0) {
      focusPaneKeyboard(paneId, frames - 1);
      return;
    }
    column.querySelector<HTMLElement>('[data-testid="workspace-surface"]')?.focus({ preventScroll: true });
  });
}

/** Puts the keyboard in the active pane: see focusPaneKeyboard. */
export function focusActivePane(): void {
  focusPaneKeyboard(useTabsStore.getState().activePaneId);
}

/** Split right, or the other pane with two, with the keyboard there. */
export function splitRight(): void {
  noteActiveCaret();
  useTabsStore.getState().splitRight();
  focusActivePane();
}

export function focusOtherPane(): void {
  noteActiveCaret();
  useTabsStore.getState().focusOtherPane();
  focusActivePane();
}

/** Moves a tab (the active pane's open one by default) to the other pane, making one at the right when there is one pane. */
export function moveTabToOtherPane(id?: string): void {
  const { activeId, moveToPane } = useTabsStore.getState();
  const moving = id ?? activeId;
  if (!moving) return;
  noteActiveCaret();
  moveToPane(moving);
  focusActivePane();
}

/** Closes a pane, with the keyboard where it was in the pane that is left. */
export function closePane(paneId: string): void {
  noteActiveCaret();
  useTabsStore.getState().closePane(paneId);
  focusActivePane();
}
