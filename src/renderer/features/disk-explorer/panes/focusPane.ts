import { EditorView } from '@codemirror/view';
import { selectPaneTab, tabFile, tabLocation, useTabsStore } from '../store/tabsStore';

/*
 * Where the keyboard goes when a pane becomes the active one. Each pane
 * remembers the element that last had the keyboard in it, and each tab where
 * its caret was, so coming back to a pane puts the keyboard where he left
 * it, without scrolling: in a stream of days, focusing the first editor
 * would scroll today's page into view and take his typing.
 */

/** The element that last had the keyboard, per pane, with the tab and the page it was in then. */
const lastFocus = new Map<string, { element: HTMLElement; tabId: string | null; path: string | null }>();
const pathOf = (element: Element): string | null => element.closest('[data-live-editor]')?.getAttribute('data-live-editor') ?? null;
/** Where the caret was, per tab: the page and the selection, for an editor drawn again. */
const carets = new Map<string, { path: string; anchor: number; head: number; doc: string }>();

const columnOf = (paneId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-pane-column="${CSS.escape(paneId)}"]`);

const EDITOR = '.cm-content[contenteditable="true"]';

/**
 * Puts the keyboard in an element without scrolling. An editor is focused
 * through its view, which also puts the page's selection in place at once:
 * focused as a plain element, a freshly drawn editor has no caret on the
 * page until a frame later, and the first key typed in that frame is lost.
 */
export function focusQuietly(element: HTMLElement): void {
  const view = element.matches(EDITOR) ? EditorView.findFromDOM(element) : null;
  if (view) view.focus();
  else element.focus({ preventScroll: true });
}

/** Remembers where a tab's caret is, when the keyboard is in one of its page's editors. */
function noteCaret(paneId: string, element: Element | null): void {
  if (!(element instanceof HTMLElement) || !element.matches(EDITOR)) return;
  const path = element.closest('[data-live-editor]')?.getAttribute('data-live-editor');
  const tab = selectPaneTab(useTabsStore.getState(), paneId);
  const view = EditorView.findFromDOM(element);
  if (!path || !tab || !view) return;
  const { anchor, head } = view.state.selection.main;
  carets.set(tab.id, { path, anchor, head, doc: view.state.doc.toString() });
}

/**
 * For the pane column's focusin: this element now has the keyboard in that
 * pane. Only what is on the page card counts; a tab in the row above it is
 * not where he was working.
 */
export function noteFocus(paneId: string, target: EventTarget | null): void {
  if (!(target instanceof HTMLElement) || !target.closest('[data-testid="workspace-surface"]')) return;
  const tab = selectPaneTab(useTabsStore.getState(), paneId);
  lastFocus.set(paneId, { element: target, tabId: tab?.id ?? null, path: pathOf(target) });
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

/**
 * The tab's editor for the page its caret was in, with that caret put back.
 * An editor drawn again reads the file, and its text can change once more
 * when the words typed just before reach the disk: until it holds the text
 * the caret was in, it is not ready, and keys typed then would be lost.
 */
function editorWithCaret(column: HTMLElement, tabId: string, last: boolean): HTMLElement | null {
  const caret = carets.get(tabId);
  if (!caret) return null;
  const editor = [...column.querySelectorAll<HTMLElement>('[data-live-editor]')]
    .find((element) => element.getAttribute('data-live-editor') === caret.path)
    ?.querySelector<HTMLElement>(EDITOR);
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!editor || !view) return null;
  if (!last && view.state.doc.toString() !== caret.doc) return null;
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
export function focusPaneKeyboard(paneId: string, frames = 120): void {
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
    const tab = selectPaneTab(state, paneId);
    // Only while it still shows what it showed then: an editor drawn again for another page or tab is not where he was.
    const last = lastFocus.get(paneId);
    const remembered = last?.element;
    if (
      last && remembered?.isConnected && column.contains(remembered) && !remembered.closest('[inert]') &&
      last.tabId === (tab?.id ?? null) && pathOf(remembered) === last.path
    ) {
      focusQuietly(remembered);
      if (document.activeElement === remembered) return;
    }
    const withCaret = tab ? editorWithCaret(column, tab.id, frames === 0) : null;
    if (withCaret) {
      focusQuietly(withCaret);
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
      focusQuietly(editor);
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
