import { history, historyKeymap, defaultKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { search, searchKeymap } from '@codemirror/search';
import { ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type Line, type StateCommand } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { isDocFile } from '@/common/fileKind';
import { isDailyLog, isLogPage, readOnlyActivityLog, readOnlyLogPage } from './activityLog';
import { blockGuards } from './blockGuards';
import { callouts } from './callouts';
import { guardedLineMoves } from './firstLine';
import { codeBlocks } from './codeBlocks';
import { docModeExtensions } from './docMode';
import { indentInQuote, toggleMarker } from './formatCommands';
import { keepsRows } from './listEdges';
import { nestListItems, withTaskBox } from './listKeys';
import { listNumbers, prefixEnd } from './listNumbers';
import { fileObjects } from './fileWidgets';
import { fileInserts } from './imageInsert';
import { docMode, linkMarkStyle, livePreview } from './livePreview';
import { mathSyntax } from './math';
import { math } from './mathWidget';
import { pageProperties } from './pageProperties';
import { tableKeys } from './tableKeys';
import { findBar } from './visibleSearch';
import { pageContext, wikiLinkSyntax, wikiLinks, type OpenNote } from './wikiLinks';

/** The edits that turn `current` into `next`, as small as a character diff finds them. */
export function textChanges(current: string, next: string): ChangeSpec[] {
  return diff(current, next, { timeout: 100 }).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: next.slice(change.fromB, change.toB),
  }));
}

/**
 * Brings the editor to `text` the way a collaborator's edit would arrive: only
 * the changed ranges move, so the cursor and scroll stay put. It passes the
 * read-only log guard. Undo never takes the change back, unless `undoable`:
 * then the change is one undo step of its own, as for an edit a comment's run
 * made, which the person may want to take back.
 */
export function replaceText(view: EditorView, text: string, options: { undoable?: boolean } = {}): void {
  const current = view.state.doc.toString();
  if (current === text) return;
  view.dispatch({
    changes: textChanges(current, text),
    annotations: options.undoable
      ? [Transaction.remote.of(true), isolateHistory.of('full')]
      : [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
  });
}

// Enter on an empty item always moves it out a level. By default an empty
// second item instead gets a blank line above it, which makes a tight list loose.
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

/**
 * `tr` with the spaces taken off each line it leaves holding only spaces.
 * The indent before a caret stays when `keepIndent` says so for the line.
 */
function withoutSpaceLines(tr: Transaction, keepIndent: (line: Line) => boolean = () => true): Transaction {
  const { newDoc, newSelection } = tr;
  const cuts = new Map<number, ChangeSpec>();
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let at = fromB; at <= toB;) {
      const line = newDoc.lineAt(at);
      at = line.to + 1;
      if (!/^[ \t]+$/.test(line.text)) continue;
      const caret = newSelection.ranges.find((range) => range.head >= line.from && range.head <= line.to);
      const from = caret && keepIndent(line) ? caret.head : line.from;
      if (from < line.to) cuts.set(line.number, { from, to: line.to });
    }
  });
  if (cuts.size === 0) return tr;
  const cut = ChangeSet.of([...cuts.values()], newDoc.length);
  return tr.startState.update({ changes: tr.changes.compose(cut), selection: newSelection.map(cut), scrollIntoView: true, userEvent: tr.annotation(Transaction.userEvent) });
}

// A list item's line: any indent and quote marks, then a bullet or a number.
const ITEM_LINE = /^[\s>]*(?:[-+*]|\d+[.)])(?:[ \t]|$)/;
const hasText = (line: Line) => /[^\s>]/.test(line.text);
// A numbered item's line, which reads as a list under text only when it starts at 1.
const NUMBERED_LINE = /^[\s>]*\d+[.)](?:[ \t]|$)/;

/**
 * `tr` with a blank line between a list and each caret that `tr` left on an
 * empty line by taking an item's marker off. Text typed on the line straight
 * after a list item belongs to that item; after a blank line it starts a
 * paragraph. A list item below gets a blank line too, so it stays a list.
 */
function blankLinesAroundEnd(tr: Transaction): Transaction {
  const { startState, newDoc, newSelection } = tr;
  if (newSelection.ranges.length !== startState.selection.ranges.length) return tr;
  const changes: ChangeSpec[] = [];
  const carets = new Map<number, { line: number; offset: number }>();
  const moved = new Map<number, number>();
  // Enter on an empty item ended its list: the item's row becomes an empty line's, and no other row changes (listEdges.ts).
  let ended = false;
  newSelection.ranges.forEach((_range, index) => {
    const start = startState.doc.lineAt(startState.selection.ranges[index].head);
    if (!ITEM_LINE.test(start.text)) return;
    // The line the item was on, not the caret's: a document may already have moved the caret off a line it gives no room.
    const line = newDoc.lineAt(tr.changes.mapPos(start.from, 1));
    if (hasText(line)) return;
    ended = true;
    const above = line.number > 1 && hasText(newDoc.line(line.number - 1));
    if (!above) return;
    const next = line.number < newDoc.lines ? newDoc.line(line.number + 1) : null;
    const after = next && next.number < newDoc.lines ? newDoc.line(next.number + 1) : null;
    // A blank line is already under the item: its own line becomes the gap, and the caret takes the blank one, so
    // no row is added. A numbered item straight after that would stop being a list, so it gets the usual gap.
    if (next && !hasText(next) && !(after && NUMBERED_LINE.test(after.text))) {
      moved.set(index, next.to);
      return;
    }
    // A numbered item below stays a list only after a blank line; a bullet or text needs none.
    const below = next !== null && NUMBERED_LINE.test(next.text);
    // A quote's blank line keeps its ">".
    const blank = line.text.trimEnd();
    changes.push({ from: line.from, to: line.to, insert: `${blank}\n${line.text}${below ? `\n${blank}` : ''}` });
    carets.set(index, { line: line.from, offset: blank.length + 1 + line.length });
  });
  if (changes.length === 0 && moved.size === 0 && !(ended && startState.facet(docMode))) return tr;
  const extra = ChangeSet.of(changes, newDoc.length);
  const ranges = newSelection.ranges.map((range, index) => {
    const at = moved.get(index);
    if (at !== undefined) return EditorSelection.cursor(extra.mapPos(at, 1));
    const caret = carets.get(index);
    return caret === undefined ? range.map(extra) : EditorSelection.cursor(extra.mapPos(caret.line, -1) + caret.offset);
  });
  return startState.update({
    changes: tr.changes.compose(extra),
    selection: EditorSelection.create(ranges, newSelection.mainIndex),
    annotations: ended ? keepsRows.of(true) : undefined,
    scrollIntoView: true,
    userEvent: 'input',
  });
}

// A list item's line that ends at its marker or box, with no space after it.
const BARE_MARKER = /^[\s>]*(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?$/;

/**
 * `tr` with a space after each marker it left at the end of a line. Enter at
 * the start of an item's text takes the space before the caret with it, and
 * "-" with nothing after it reads as typed text, not as an empty item.
 */
function withMarkerSpaces(tr: Transaction): Transaction {
  const { newDoc } = tr;
  const spaces = new Map<number, ChangeSpec>();
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let at = fromB; at <= toB;) {
      const line = newDoc.lineAt(at);
      at = line.to + 1;
      if (BARE_MARKER.test(line.text) && !tr.newSelection.ranges.some((range) => range.head === line.to)) spaces.set(line.number, { from: line.to, insert: ' ' });
    }
  });
  if (spaces.size === 0) return tr;
  const added = ChangeSet.of([...spaces.values()], newDoc.length);
  return tr.startState.update({ changes: tr.changes.compose(added), selection: tr.newSelection.map(added, 1), scrollIntoView: true, userEvent: tr.annotation(Transaction.userEvent) });
}

/**
 * Enter in a list or quote, as in Obsidian. A non-empty item continues, split
 * at the caret. An empty nested item moves out one level, and an empty
 * top-level item loses its marker, so the list ends and the caret starts a
 * paragraph below a blank line. Numbered lists renumber (listNumbers.ts), and
 * no line is left holding only spaces. Returns false outside lists and quotes, so a plain
 * newline runs.
 */
export const insertNewlineInList: StateCommand = ({ state, dispatch }) => {
  let unchanged = false;
  const handled = continueMarkup({
    state,
    dispatch: (tr) => {
      if (tr.newDoc.eq(state.doc)) unchanged = true;
      else if (state.facet(docMode)) dispatch(withTaskBox(withMarkerSpaces(blankLinesAroundEnd(withoutSpaceLines(tr)))));
      else dispatch(withMarkerSpaces(blankLinesAroundEnd(withoutSpaceLines(tr))));
    },
  });
  // An item below one indented before its quote's ">" gets its own marker
  // back, a change of nothing. One indent after the ">" comes off instead.
  return unchanged ? indentInQuote(false)({ state, dispatch }) : handled;
};

/**
 * Backspace just after a list or quote marker takes one level of markup off.
 * On a top-level item that leaves an empty line, not the spaces that would
 * carry on the item above.
 */
export const deleteMarkupInList: StateCommand = ({ state, dispatch }) =>
  deleteMarkupBackward({
    state,
    dispatch: (tr) => dispatch(withoutSpaceLines(tr, (line) => {
      const before = tr.startState.doc.lineAt(tr.changes.invertedDesc.mapPos(line.from));
      return !/^(?:[-+*]|\d+[.)])/.test(before.text);
    })),
  });

// Inline styles as classes for editor.css. Marks still showing on an edited line are muted.
const highlight = HighlightStyle.define([
  { tag: tags.strong, class: 'cm-md-strong' },
  { tag: tags.emphasis, class: 'cm-md-em' },
  { tag: tags.strikethrough, class: 'cm-md-strike' },
  { tag: tags.heading, class: 'cm-md-strong' },
  { tag: [tags.processingInstruction, tags.labelName, tags.comment, tags.contentSeparator], class: 'cm-md-syntax' },
]);

// Cmd+[ and Cmd+] are Back and Forward in the app menu, as in Safari, and
// Cmd+Shift+\ toggles the right sidebar; a key the editor takes never reaches
// the menu. Tab and Shift+Tab still indent. Cmd+Option+Up and Down would add
// a cursor, which a page with one selection only turns into a caret move; a
// stack's sections take them for the next and previous section instead.
const MENU_KEYS = new Set(['Mod-[', 'Mod-]', 'Shift-Mod-\\', 'Mod-Alt-ArrowUp', 'Mod-Alt-ArrowDown', 'Shift-Alt-ArrowUp', 'Shift-Alt-ArrowDown']);
const editingKeymap = defaultKeymap.filter((binding) => !MENU_KEYS.has(binding.key ?? ''));

/**
 * Option+Shift+Up and Down, as in a word processor: the selection grows to
 * the start or the end of the paragraph, then by a paragraph a press. A
 * list item's start is its text's start, so its marker stays.
 */
function selectParagraph(forward: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const { doc } = state;
    const selection = EditorSelection.create(state.selection.ranges.map((range) => {
      let line = doc.lineAt(range.head);
      const edge = (of: Line) => (forward ? of.to : Math.min(of.to, prefixEnd(doc, of.from)));
      if (range.head === edge(line)) {
        const next = line.number + (forward ? 1 : -1);
        if (next < 1 || next > doc.lines) return range;
        line = doc.line(next);
      }
      return EditorSelection.range(range.anchor, edge(line));
    }), state.selection.mainIndex);
    dispatch(state.update({ selection, scrollIntoView: true, userEvent: 'select' }));
    return true;
  };
}

/**
 * How a Markdown page is edited. Every page that takes edits is edited as a
 * document: its Markdown always hidden, and typing, lists and paste as in a
 * word processor. A document (.mdo) also has the toolbar, and a click on a
 * link in it edits the link. In a note (.md) a click on a link follows it,
 * as it always has. The read-only log pages keep the plain reading setup.
 */
export type EditingSetup = 'document' | 'note' | 'plain';

export function editingSetup(path: string): EditingSetup {
  if (isDocFile(path)) return 'document';
  return isLogPage(path) || isDailyLog(path) ? 'plain' : 'note';
}

/**
 * The page editor's setup. The document is the Markdown body exactly as read:
 * only "\n" splits lines, so a stray "\r" stays a character and `toString()`
 * gives back the same text. `openNote` follows a link. Every page that can
 * be edited also gets doc mode (`editingSetup`).
 */
export function markdownEditorExtensions(path: string, openNote: OpenNote = () => undefined, setup: EditingSetup = editingSetup(path)): Extension[] {
  return [
    EditorState.lineSeparator.of('\n'),
    // Pasted and dropped text gets "\n" line ends, the ones the file is saved with.
    EditorView.clipboardInputFilter.of((text) => text.replace(/\r\n?/g, '\n')),
    pageContext.of({ path, openNote }),
    history(),
    markdown({ extensions: [GFM, wikiLinkSyntax, linkMarkStyle, mathSyntax], completeHTMLTags: false, addKeymap: false }),
    syntaxHighlighting(highlight),
    wikiLinks,
    fileInserts,
    fileObjects,
    livePreview,
    blockGuards,
    listNumbers,
    guardedLineMoves,
    tableKeys,
    callouts,
    // Before code blocks, so a math fence draws as a formula.
    math,
    codeBlocks,
    pageProperties,
    search({ top: true }),
    findBar,
    // The caret's line stays clear of the word-count footer over the page's bottom edge, as when "[[" is typed on the last line.
    EditorView.scrollMargins.of(() => ({ bottom: 56 })),
    keymap.of([
      { key: 'Enter', run: insertNewlineInList },
      { key: 'Backspace', run: deleteMarkupInList },
      { key: 'Tab', run: (view) => nestListItems(true)(view) || indentInQuote(true)(view), shift: (view) => nestListItems(false)(view) || indentInQuote(false)(view) },
      { key: 'Shift-Alt-ArrowUp', run: selectParagraph(false) },
      { key: 'Shift-Alt-ArrowDown', run: selectParagraph(true) },
      { key: 'Mod-b', run: toggleMarker('**') },
      { key: 'Mod-i', run: toggleMarker('*') },
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...editingKeymap,
    ]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false', 'data-testid': 'markdown-editor' }),
    placeholder('Start writing…'),
    isLogPage(path) ? readOnlyLogPage() : isDailyLog(path) ? readOnlyActivityLog() : [],
    setup === 'plain' ? [] : docModeExtensions({ followLinks: setup === 'note' }),
  ];
}
