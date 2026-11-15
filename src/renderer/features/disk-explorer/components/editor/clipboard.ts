import { isolateHistory } from '@codemirror/commands';
import { Annotation, ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type Extension, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { latestTree, outsideProtected } from './extensionPoints';
import { inlineSpans, linkAt, listItemOf, withoutEdgeMarks, writeLink } from './formatCommands';
import { docMode } from './livePreview';
import { literalText, rawAt } from './typing';
import { webAddress } from './linkSchemes';
import { markdownFromHtml } from './pasteHtml';

/*
 * The clipboard in a document. Copy, cut and drag write balanced Markdown:
 * a selection that half covers bold or a link takes the marks it needs, so
 * `old and a l` out of `**bold** and a [link](url)` pastes as
 * `**old** and a [l](url)`. With nothing selected, copy and cut do nothing.
 * Paste and Match Style (⌘⇧V) writes the text literally. A URL pasted over
 * a selection links it, or over a link's text changes its address. Lines
 * pasted, dropped or composed into a quote, callout or list item take the
 * container's prefix, so the container stays one.
 */

// Code whose text is copied as it is: a selection inside one code span or block.
const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock']);

function codeAround(state: EditorState, from: number, to: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(from, 1); node; node = node.parent) {
    if (CODE.has(node.name)) return node.from <= from && to <= node.to ? node : null;
  }
  return null;
}

/** The Markdown of `from` to `to` with the marks of formatting it half covers added, so it pastes as it shows. */
export function balancedText(state: EditorState, from: number, to: number): string {
  if (codeAround(state, from, to) && rawAt(state, from) && rawAt(state, to)) return state.sliceDoc(from, to);
  ({ from, to } = outsideProtected(state, from, to));
  ({ from, to } = withoutEdgeMarks(state, from, to));
  let before = '';
  let after = '';
  for (const span of inlineSpans(state, from, to)) {
    const opens = state.sliceDoc(span.from, span.textFrom);
    const closes = state.sliceDoc(span.textTo, span.to);
    const startsBefore = span.from < from && from < span.textTo;
    const endsAfter = span.to > to && to > span.textFrom;
    // Outer spans come first: their opening marks go first, their closing marks last.
    if (startsBefore) before += opens;
    if (endsAfter) after = closes + after;
  }
  return before + state.sliceDoc(from, to) + after;
}

/** Copy and drag output: each selected range balanced. */
const balancedOutput = EditorView.clipboardOutputFilter.of((text, state) => {
  if (!state.facet(docMode)) return text;
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length > 0 && text === ranges.map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak)) {
    return ranges.map((range) => balancedText(state, range.from, range.to)).join(state.lineBreak);
  }
  const { main } = state.selection;
  return text === state.sliceDoc(main.from, main.to) ? balancedText(state, main.from, main.to) : text;
});

/** The marks that carry a line on in the container at `at`: quote marks and a list item's content indent. */
export function containerPrefix(state: EditorState, at: number): string {
  const line = state.doc.lineAt(at);
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, -1); node; node = node.parent) {
    if (node.name === 'Blockquote') {
      const quote = /^(?:[ \t]*>[ \t]?)+/.exec(line.text)?.[0] ?? '>';
      return quote.endsWith(' ') || quote.endsWith('\t') ? quote : `${quote} `;
    }
    if (node.name === 'ListItem') {
      const first = state.doc.lineAt(node.from);
      const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-+*]|\d+[.)])([ \t]*)/.exec(first.text);
      if (!match) return '';
      const spaces = match[4].length >= 1 && match[4].length <= 4 ? match[4].length : 1;
      return match[1] + match[2] + ' '.repeat(match[3].length + spaces);
    }
  }
  return '';
}

/**
 * `text` with every line after the first behind `prefix`; a blank line takes
 * the prefix without its spaces. A line that starts with the prefix already,
 * as a file insert writes it, is inside the container and stays as it is.
 */
export function prefixLines(text: string, prefix: string): string {
  if (!prefix) return text;
  const blank = prefix.replace(/[ \t]+$/, '');
  return text.split('\n').map((line, index) => {
    if (index === 0 || line.startsWith(prefix) || (blank && line === blank)) return line;
    return `${line ? prefix : blank}${line}`;
  }).join('\n');
}

/** Marks a transaction whose lines already carry their container's prefix. */
const prefixed = Annotation.define<boolean>();

const SPREAD = ['input.paste', 'input.drop', 'move.drop', 'input.type.compose'];

/**
 * Lines pasted, dropped or composed into a quote, callout or list item take
 * the caret line's container prefix. A drag that moves text keeps the marks
 * around what it moves away, as Backspace does.
 */
function containedLines(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }) {
  return EditorState.transactionFilter.of((tr) => {
    const state = tr.startState;
    if (!tr.docChanged || !state.facet(docMode) || tr.annotation(prefixed) || !SPREAD.some((event) => tr.isUserEvent(event))) return tr;
    const edits: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => edits.push({ from, to, insert: inserted.toString() }));
    const moved = tr.isUserEvent('move.drop');
    if (!moved && !edits.some((edit) => edit.insert.includes('\n'))) return tr;
    const specs: ChangeSpec[] = [];
    const inserts: { at: number; length: number }[] = [];
    let changed = false;
    for (const edit of edits) {
      if (moved && edit.to > edit.from && !edit.insert) {
        specs.push(...replace(state, edit.from, edit.to, '').changes);
        changed = true;
        continue;
      }
      const insert = prefixLines(edit.insert, containerPrefix(state, edit.from));
      if (insert !== edit.insert) changed = true;
      specs.push({ from: edit.from, to: edit.to, insert });
      inserts.push({ at: edit.from, length: insert.length });
    }
    if (!changed) return tr;
    const changes = ChangeSet.of(specs, state.doc.length);
    // The caret or the dropped text's selection, as CodeMirror would put it.
    const last = inserts[inserts.length - 1];
    const selection = last && tr.selection
      ? (tr.newSelection.main.empty
        ? EditorSelection.cursor(changes.mapPos(last.at, 1))
        : EditorSelection.range(changes.mapPos(last.at, -1), changes.mapPos(last.at, 1)))
      : undefined;
    const history = tr.annotation(isolateHistory);
    return {
      changes,
      selection,
      effects: tr.effects,
      scrollIntoView: true,
      userEvent: tr.annotation(Transaction.userEvent),
      annotations: history ? [prefixed.of(true), isolateHistory.of(history)] : prefixed.of(true),
    };
  });
}

const URL_TEXT = /^(?:https?:\/\/|mailto:|obsidian:\/\/|opal:\/\/)\S+$/i;
const WWW_TEXT = /^www\.[^\s.]+\.\S+$/i;

/**
 * What a paste of `text` writes in a document, or null to leave it to
 * CodeMirror: a URL over a selection links it, or changes the address of
 * the link whose text holds the selection; `literal` text is escaped where
 * it would read as Markdown. Lines after the first take the container's
 * prefix.
 */
export function pasteSpec(state: EditorState, text: string, literal: boolean): TransactionSpec | null {
  if (state.selection.ranges.length > 1) return null;
  const range = state.selection.main;
  const pasted = text.replace(/\r\n?/g, '\n');
  const url = pasted.trim();
  // Paste and Match Style pastes a URL as text, so both stay a key away. A bare `www.` address links as a web page.
  if (!literal && !range.empty && (URL_TEXT.test(url) || WWW_TEXT.test(url)) && !rawAt(state, range.from)) {
    const address = webAddress(url);
    const link = linkAt(state, range.from);
    // Written as a link edit, not a paste, so doc mode's mark keeping leaves the address it replaces alone.
    if (link?.kind === 'link' && range.from >= link.textFrom && range.to <= link.textTo) {
      return writeLink(state, link, state.sliceDoc(link.textFrom, link.textTo), address, link);
    }
    return writeLink(state, range, state.sliceDoc(range.from, range.to), address, null);
  }
  if (!literal) return listIntoItem(state, pasted) ?? linesIntoItems(state, withoutMarkers(state, pasted)) ?? linesIntoItems(state, pasted);
  const prefix = containerPrefix(state, range.from);
  const insert = literalText(state, range.from, range.to, pasted, { prefix, table: inTable(state, range.from) });
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
    annotations: prefixed.of(true),
  };
}

const LIST_LINE = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * A pasted list at a list item, as a word processor pastes whole items: on
 * an empty item the pasted items take its place, at the start of an item's
 * text they go in above it, and at the end of its text below it. They sit at
 * that item's level, nested items one level deeper each, in the list's own
 * indent character. Numbers are put in order by the edit itself.
 */
function listIntoItem(state: EditorState, pasted: string): TransactionSpec | null {
  const range = state.selection.main;
  if (!range.empty || !state.facet(docMode)) return null;
  const line = state.doc.lineAt(range.head);
  const item = listItemOf(state, line);
  const lines = pasted.replace(/\n+$/, '').split('\n');
  if (!item || !lines.every((each) => !/\S/.test(each) || LIST_LINE.test(each)) || !LIST_LINE.test(lines[0])) return null;
  const empty = item.textFrom === line.to;
  const above = !empty && range.head === item.textFrom;
  if (!empty && !above && range.head !== line.to) return null;
  const lead = line.text.slice(0, item.markFrom - line.from);
  const indents = lines.map((each) => /^[ \t]*/.exec(each)?.[0] ?? '');
  const unit = Math.min(...indents.map((indent) => indent.replace(/\t/g, '    ').length).filter((width) => width > 0), Infinity);
  const tabs = /\t/.test(lead) || /^[ \t>]*\t/.test(state.doc.lineAt(Math.max(0, line.from - 1)).text);
  const items = lines.map((each, index) => {
    if (!/\S/.test(each)) return lead.replace(/[ \t]+$/, '');
    const width = indents[index].replace(/\t/g, '    ').length;
    const level = unit === Infinity ? 0 : Math.round(width / unit);
    return `${lead}${tabs ? '\t'.repeat(level) : indents[index]}${each.slice(indents[index].length)}`;
  }).join('\n');
  const change = empty ? { from: line.from, to: line.to, insert: items } : above ? { from: line.from, insert: `${items}\n` } : { from: line.to, insert: `\n${items}` };
  return {
    changes: change,
    selection: { anchor: above ? range.head + items.length + 1 : change.from + change.insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
    annotations: prefixed.of(true),
  };
}

/**
 * A pasted list as plain lines, for a caret in the middle of an item's
 * text, where a word processor joins the first pasted item to the text
 * before the caret and makes each further one an item of the list being
 * typed in. `pasted` as it is for anything else.
 */
function withoutMarkers(state: EditorState, pasted: string): string {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const item = listItemOf(state, line);
  const lines = pasted.replace(/\n+$/, '').split('\n');
  if (!item || range.from <= item.textFrom || range.from >= line.to || lines.length < 2 || !lines.every((each) => !/\S/.test(each) || LIST_LINE.test(each))) return pasted;
  return lines.map((each) => each.replace(/^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*/, '')).join('\n');
}

// A line that is a Markdown block of its own: a list item, heading, quote, fence, table row or indented code.
const BLOCK_LINE = /^(?:[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)| {0,3}(?:#{1,6}(?:[ \t]|$)|>|```|~~~|\|)|\t| {4})/;

/**
 * Plain lines pasted into a list item's text, as a word processor pastes
 * paragraphs into a list: the first line joins the item, and each line after
 * it becomes an item of its own, with the item's marker, the next numbers,
 * or an empty box. Empty lines are left out. Lines that are Markdown blocks
 * keep their meaning and are pasted as they are.
 */
function linesIntoItems(state: EditorState, pasted: string): TransactionSpec | null {
  const range = state.selection.main;
  if (!state.facet(docMode)) return null;
  const lines = pasted.replace(/\n+$/, '').split('\n').filter((each, index) => index === 0 || /\S/.test(each));
  const line = state.doc.lineAt(range.from);
  if (lines.length < 2 || range.to > line.to || lines.some((each) => BLOCK_LINE.test(each))) return null;
  const item = listItemOf(state, line);
  const marker = item && /^(?:[-+*]|(\d{1,9})([.)]))/.exec(line.text.slice(item.markFrom - line.from));
  if (!item || !marker || range.from < item.textFrom || rawAt(state, range.from)) return null;
  const lead = line.text.slice(0, item.markFrom - line.from);
  const box = item.kind === 'task' ? ' [ ]' : '';
  const insert = lines.map((each, index) => {
    if (index === 0) return each;
    const mark = marker[1] ? `${Number(marker[1]) + index}${marker[2]}` : marker[0];
    return `${lead}${mark}${box} ${each.trim()}`;
  }).join('\n');
  return {
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
    annotations: prefixed.of(true),
  };
}

function inTable(state: EditorState, at: number): boolean {
  for (let node: SyntaxNode | null = latestTree(state).resolveInner(at, 1); node; node = node.parent) {
    if (node.name === 'Table') return true;
  }
  return false;
}

/**
 * Edit > Paste and Match Style, from the menu or ⌘⇧V: the clipboard's text
 * pasted literally into the page that holds `target`, or as plain text
 * into another field, such as the Find bar's. The menu runs this rather
 * than the system's paste, whose paste event looks the same as ⌘V's.
 */
export async function pasteAndMatchStyle(target: Element | null = document.activeElement): Promise<void> {
  const host = target?.closest('.cm-content')?.closest('.cm-editor');
  const view = host instanceof HTMLElement ? EditorView.findFromDOM(host) : null;
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!text) return;
  if (!view) {
    document.execCommand('insertText', false, text);
    return;
  }
  if (view.state.readOnly) return;
  const spec = view.state.facet(docMode) ? pasteSpec(view.state, text, true) : null;
  view.dispatch(spec ?? { ...view.state.replaceSelection(text.replace(/\r\n?/g, '\n')), scrollIntoView: true, userEvent: 'input.paste' });
}

// Marks only Markdown source holds: a link between notes, a Markdown link, a highlight, a fence, a list marker or heading at a line start.
const MARKDOWN_SOURCE = /\[\[[^\]\n]+\]\]|\]\([^)\s]+\)|==[^=\n]+==|(?:^|\n) {0,3}(?:```|#{1,6} |[-+*] |\d{1,9}[.)] |> )/;

const clipboardEvents = EditorView.domEventHandlers({
  copy(event, view) {
    if (!view.state.facet(docMode) || view.state.selection.ranges.some((range) => !range.empty)) return false;
    event.preventDefault();
    return true;
  },
  cut(event, view) {
    if (!view.state.facet(docMode) || view.state.selection.ranges.some((range) => !range.empty)) return false;
    event.preventDefault();
    return true;
  },
  paste(event, view) {
    if (!view.state.facet(docMode) || view.state.readOnly) return false;
    const data = event.clipboardData;
    const plain = data?.getData('text/plain') ?? '';
    // Formatting comes from the clipboard's HTML, except into code, which takes the plain text.
    const html = data && data.files.length === 0 && !rawAt(view.state, view.state.selection.main.from) ? data.getData('text/html') : '';
    // Plain text that is Markdown already, as an app that draws Markdown copies it, is the better copy: it keeps
    // what the HTML beside it has lost, such as a link between notes.
    const rich = html && !MARKDOWN_SOURCE.test(plain) ? markdownFromHtml(html) : null;
    const text = rich ?? plain;
    if (!text) return false;
    const spec = pasteSpec(view.state, text, false)
      ?? (rich ? { ...view.state.replaceSelection(rich), scrollIntoView: true, userEvent: 'input.paste' } : null);
    if (!spec) return false;
    event.preventDefault();
    view.dispatch(spec);
    return true;
  },
});

/** Doc mode's clipboard. `replace` is doc mode's `replaceVisible`. */
export function clipboard(replace: (state: EditorState, from: number, to: number, insert: string) => { changes: ChangeSpec[] }): Extension {
  return [
    balancedOutput,
    clipboardEvents,
    containedLines(replace),
  ];
}
