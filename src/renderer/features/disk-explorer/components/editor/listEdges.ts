import { ensureSyntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, Transaction, type ChangeSpec, type Text, type TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/*
 * Where a list meets text. Markdown reads a line of text right under a list
 * item as more of that item, an empty item right under text as that text's
 * heading underline, and a numbered item past 1 right under text as text.
 * A word processor has none of these: a list is a list and the line next to
 * it is its own paragraph. So every edit of the person's own that leaves a
 * list line touching a line of text gets the blank line Markdown needs
 * between them, in the same step, and the page gives that blank line no
 * room (`listGaps` here, drawn by livePreview.ts), with the caret stepping
 * over it. The file reads the same in any Markdown tool as it does here.
 *
 * Only the lines an edit made neighbours change. A list that already sat
 * against text before the edit is left as written, unless the edit leaves
 * it unreadable: an empty item, or a number past 1, right under text.
 */

const QUOTE = /^(?:[ \t]*>[ \t]?)*/;
const quoteOf = (text: string) => QUOTE.exec(text)?.[0] ?? '';
const depthOf = (text: string) => quoteOf(text).split('>').length - 1;

// A list item's line past its quote marks: its indent, its marker, then a space or the line's end after a space.
const ITEM = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]/;
// A marker with nothing after it, as one stands while it is typed, and what may still become one: "-", "1", "1.", "[", "#".
const MARKER_SO_FAR = /^[ \t]*(?:[-+*]|\d{1,9}[.)]?|\[[ xX]?\]?|#{1,6}|>)?$/;
// An item with no text: its marker, a box perhaps, and spaces.
const EMPTY_ITEM = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]*)?$/;
// A numbered item at the margin that does not start at 1.
const PAST_ONE = /^(?:[2-9]|\d{2,9})[.)][ \t]/;
// A later line of an item: indented under its text.
const MORE = /^(?:\t| {2,})[ \t]*\S/;

type Kind = 'blank' | 'item' | 'more' | 'pending' | 'text';

/** What a line is to the list rules, read off its text past its quote marks. */
export function lineKind(text: string): Kind {
  const body = text.slice(quoteOf(text).length);
  if (!/\S/.test(body)) return 'blank';
  if (ITEM.test(body)) return 'item';
  if (MARKER_SO_FAR.test(body)) return 'pending';
  return MORE.test(body) ? 'more' : 'text';
}

const listy = (kind: Kind) => kind === 'item' || kind === 'more';

const RAW = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'Table']);

/** Whether `at` is inside code, HTML or a table, whose lines are never list lines or text for these rules. */
function raw(tree: { resolveInner: (pos: number, side?: -1 | 0 | 1) => SyntaxNode }, at: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(at, 1); node; node = node.parent) if (RAW.has(node.name)) return true;
  return false;
}

/**
 * The blank lines to write where `tr` left a list line touching a line of
 * text, in the new text's positions, or none.
 */
function edgeGaps(tr: Transaction): { changes: ChangeSpec[]; emptied: { from: number; to: number }[] } {
  const { newDoc } = tr;
  const oldDoc = tr.startState.doc;
  const pairs = new Set<number>();
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const first = newDoc.lineAt(fromB).number;
    const last = newDoc.lineAt(toB).number;
    for (let number = Math.max(2, first); number <= Math.min(newDoc.lines, last + 1); number += 1) pairs.add(number);
  });
  const emptied: { from: number; to: number }[] = [];
  if (pairs.size === 0) return { changes: [], emptied };
  const changes: ChangeSpec[] = [];
  let tree: ReturnType<typeof ensureSyntaxTree> | undefined;
  /** The line of the old text that `line` was, when it was a whole line there. */
  const before = (line: { from: number }) => {
    const at = tr.changes.invertedDesc.mapPos(line.from, 1);
    const old = oldDoc.lineAt(at);
    return old.from === at ? old : null;
  };
  for (const number of [...pairs].sort((a, b) => a - b)) {
    const above = newDoc.line(number - 1);
    const below = newDoc.line(number);
    const upper = lineKind(above.text);
    const lower = lineKind(below.text);
    if (upper === 'blank' || lower === 'blank' || upper === 'pending' || lower === 'pending') continue;
    if (listy(upper) === listy(lower) || depthOf(above.text) !== depthOf(below.text)) continue;
    // A later line of an item under text is only an indented line.
    if (upper === 'text' && lower === 'more') continue;
    if (tree === undefined) tree = ensureSyntaxTree(tr.state, Math.min(newDoc.length, below.to + 1), 50);
    if (!tree || raw(tree, above.from + quoteOf(above.text).length) || raw(tree, below.from + quoteOf(below.text).length)) continue;
    // Lines that were neighbours of the same kinds before the edit stay as written, unless the list under the text can no longer be read.
    const oldAbove = before(above);
    const oldBelow = before(below);
    const stood = oldAbove !== null && oldBelow !== null && oldAbove.number + 1 === oldBelow.number
      && listy(lineKind(oldAbove.text)) === listy(upper) && listy(lineKind(oldBelow.text)) === listy(lower);
    const body = below.text.slice(quoteOf(below.text).length);
    const unreadable = lower === 'item' && (EMPTY_ITEM.test(body) || PAST_ONE.test(body));
    if (stood && !unreadable) continue;
    changes.push({ from: below.from, insert: `${quoteOf(below.text).replace(/[ \t]+$/, '')}\n` });
    if (EMPTY_ITEM.test(body)) emptied.push({ from: below.from, to: below.to });
  }
  return { changes, emptied };
}

const EDITS = ['input', 'delete', 'move'];

/** The person's edit with a blank line wherever it left a list touching text. */
export function withListEdges(tr: Transaction): Transaction | readonly (Transaction | TransactionSpec)[] {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !EDITS.some((event) => tr.isUserEvent(event))) return tr;
  const { changes, emptied } = edgeGaps(tr);
  if (changes.length === 0) return tr;
  // A caret at the start of the lower line stays with that line, under the new blank one.
  const set = ChangeSet.of(changes, tr.newDoc.length);
  // An item the edit emptied read, until its blank line went in, as the heading underline of the text above it,
  // which a document hides and keeps the caret out of. The caret goes back where the edit itself left it.
  const meant = tr.startState.selection.main.map(tr.changes);
  // Only for a deletion: an edit that wrote the marker put the caret after it itself.
  const back = tr.isUserEvent('delete') && tr.newSelection.ranges.length === 1 && meant.empty && emptied.some((line) => meant.head >= line.from && meant.head <= line.to);
  const selection = back ? EditorSelection.single(set.mapPos(meant.head, 1)) : tr.newSelection.map(set, 1);
  return [tr, { changes, selection, sequential: true }];
}

/**
 * The blank lines between a list and the text beside it, which a document
 * gives no room: a blank line right under a list line whose next line is no
 * list item, and one right over a list item whose line above is text. Blank
 * lines between a list's own items, and any further blank line, show as
 * rows. Lines are numbered from 1; `first` to `last` are the lines to look
 * at.
 */
export function listGaps(doc: Text, first: number, last: number): number[] {
  const gaps: number[] = [];
  for (let number = Math.max(2, first); number <= Math.min(doc.lines - 1, last); number += 1) {
    const line = doc.line(number);
    if (lineKind(line.text) !== 'blank') continue;
    const above = doc.line(number - 1);
    const below = doc.line(number + 1);
    const upper = lineKind(above.text);
    const lower = lineKind(below.text);
    const depth = depthOf(line.text);
    // Under a list: the line after it is neither another item of the list nor a later paragraph of the last one.
    const under = listy(upper) && lower !== 'item' && lower !== 'more' && depthOf(above.text) === depth;
    // Over a list: the line before it is text, or a marker being typed stands under text.
    const over = (lower === 'item' || (lower === 'pending' && /^[ \t]*(?:[-+*]|\d{1,9}[.)])$/.test(below.text.slice(quoteOf(below.text).length))))
      && (upper === 'text' || upper === 'pending') && depthOf(below.text) === depth;
    if (under || over) gaps.push(number);
  }
  return gaps;
}
