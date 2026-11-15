import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState, Prec, Transaction, type ChangeSpec, type Extension, type Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { latestTree } from './extensionPoints';

/*
 * Numbered lists count for themselves, as in a word processor. An edit that
 * adds, removes, moves or nests an item rewrites the numbers of the list it
 * touched, in the same step, so the file holds 1, 2, 3 and one undo takes
 * the edit and its numbers back together. A list keeps the number it starts
 * at. A list cut in two, by an item in its middle becoming plain text,
 * carries on counting after the gap.
 *
 * Only the person's own edits count: text that arrives from the disk, undo
 * and redo keep their bytes. Typing inside an item's text changes no number,
 * so a list written "1.", "1.", "1." stays that way until its items change.
 *
 * The page draws nested levels as 1, a, i, repeating, while the file keeps
 * digits, the only numbers Markdown reads.
 */

// A list item's line up to its text: quote marks, indent, the marker, a task's box.
const ITEM_PREFIX = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*/;

/** Where the marks that open the list item line holding `at` end, or the line's start for any other line. */
export function prefixEnd(doc: Text, at: number): number {
  const line = doc.lineAt(at);
  return line.from + (ITEM_PREFIX.exec(line.text)?.[0].length ?? 0);
}

/** Whether `tr` changes which lines there are, or the marks that open a list item: the edits that can change a list's items. */
function changesItems(tr: Transaction): boolean {
  let found = false;
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    if (found) return;
    const before = tr.startState.doc;
    if (inserted.lines > 1 || before.lineAt(fromA).number !== before.lineAt(toA).number) found = true;
    else if (fromA < prefixEnd(before, fromA) || fromB < prefixEnd(tr.newDoc, fromB)) found = true;
  });
  return found;
}

const numberAt = (doc: Text, mark: SyntaxNode) => Number.parseInt(doc.sliceString(mark.from, mark.to), 10);

/** How many list items a list is nested in. */
function depthOf(list: SyntaxNode): number {
  let depth = 0;
  for (let node = list.parent; node; node = node.parent) if (node.name === 'ListItem') depth += 1;
  return depth;
}

/** The innermost numbered list holding `at`. */
function orderedAt(tree: Tree, at: number): SyntaxNode | null {
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(at, side); node; node = node.parent) {
      if (node.name === 'OrderedList' && node.from <= at && at <= node.to) return node;
    }
  }
  return null;
}

const firstMark = (list: SyntaxNode) => list.getChild('ListItem')?.getChild('ListMark') ?? null;

/** The nearest numbered list before `list` among its siblings. */
function listBefore(list: SyntaxNode): SyntaxNode | null {
  for (let node = list.prevSibling, steps = 0; node && steps < 8; node = node.prevSibling, steps += 1) {
    if (node.name === 'OrderedList') return node;
  }
  return null;
}

/** The changes that put the numbers of the lists `tr` touched in order, in the new text's positions. */
function renumbering(tr: Transaction): ChangeSpec[] {
  const { newDoc } = tr;
  let from = newDoc.length;
  let to = 0;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => { from = Math.min(from, fromB); to = Math.max(to, toB); });
  if (to < from) return [];
  // The lists to look at: down to the end of the outermost list the edit is in, since moving an item changes the lists
  // under and after it, and two lines past the edit, where the second half of a list cut in two starts.
  const near = newDoc.line(Math.min(newDoc.lines, newDoc.lineAt(to).number + 3)).to;
  const parsed = ensureSyntaxTree(tr.state, near, 50);
  if (!parsed) return [];
  let reach = near;
  for (let node: SyntaxNode | null = parsed.resolveInner(Math.min(to, newDoc.length), -1); node; node = node.parent) {
    if (node.name === 'OrderedList' || node.name === 'BulletList') reach = Math.max(reach, Math.min(node.to, newDoc.length));
  }
  const after = reach > near ? ensureSyntaxTree(tr.state, reach, 50) : parsed;
  if (!after) return [];
  const before = latestTree(tr.startState);
  const back = (at: number) => tr.changes.invertedDesc.mapPos(at, 1);
  /** The list `list` was before the edit, at the same depth, or null for a new one. */
  const earlier = (list: SyntaxNode): SyntaxNode | null => {
    const mark = firstMark(list);
    const old = mark ? orderedAt(before, back(mark.from)) : null;
    return old && depthOf(old) === depthOf(list) ? old : null;
  };
  const known = new Map<number, { start: number; count: number; split: boolean }>();
  const counted = (list: SyntaxNode): { start: number; count: number; split: boolean } => {
    const seen = known.get(list.from);
    if (seen) return seen;
    const mark = firstMark(list);
    const old = earlier(list);
    const oldMark = old ? firstMark(old) : null;
    let start = oldMark ? numberAt(tr.startState.doc, oldMark) : mark ? numberAt(newDoc, mark) : 1;
    let split = false;
    const previous = old ? listBefore(list) : null;
    const previousOld = previous ? earlier(previous) : null;
    if (old && previous && previousOld && previousOld.from === old.from) {
      const first = counted(previous);
      start = first.start + first.count;
      split = true;
    }
    if (!Number.isFinite(start)) start = 1;
    const result = { start, count: list.getChildren('ListItem').length, split };
    known.set(list.from, result);
    return result;
  };
  const lists: SyntaxNode[] = [];
  after.iterate({
    from: Math.max(0, newDoc.lineAt(from).from - 1),
    to: reach,
    enter: (ref) => { if (ref.name === 'OrderedList') lists.push(ref.node); },
  });
  const changes: ChangeSpec[] = [];
  for (const list of lists) {
    const { start, count, split } = counted(list);
    // A list the edit did not reach changes only when it lost or gained items, or as the second half of one cut in two.
    const old = earlier(list);
    const resized = old !== null && old.getChildren('ListItem').length !== count;
    if (!(list.from <= to + 1 && list.to >= from - 1) && !split && !resized) continue;
    list.getChildren('ListItem').forEach((item, index) => {
      const mark = item.getChild('ListMark');
      if (!mark) return;
      const digits = /^\d+/.exec(newDoc.sliceString(mark.from, mark.to))?.[0] ?? '';
      const want = String(start + index);
      if (digits && digits !== want) changes.push({ from: mark.from, to: mark.from + digits.length, insert: want });
    });
  }
  return changes;
}

const EDITS = ['input', 'delete', 'move'];

/** The person's edit with the numbers of the lists it touched put in order. */
export function withListNumbers(tr: Transaction): Transaction | readonly [Transaction, { changes: ChangeSpec[]; sequential: true }] {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !EDITS.some((event) => tr.isUserEvent(event))) return tr;
  if (!changesItems(tr)) return tr;
  const changes = renumbering(tr);
  return changes.length > 0 ? [tr, { changes, sequential: true }] : tr;
}

/** Runs after every other filter, so it numbers the edit as it will be written. */
export const listNumbers: Extension = Prec.highest(EditorState.transactionFilter.of(withListNumbers));

const ROMAN: readonly [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

function roman(value: number): string {
  let out = '';
  let rest = value;
  for (const [size, letters] of ROMAN) {
    while (rest >= size) { out += letters; rest -= size; }
  }
  return out;
}

function letters(value: number): string {
  let out = '';
  for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26)) out = String.fromCharCode(97 + ((rest - 1) % 26)) + out;
  return out;
}

/** An item's number as the page draws it at a list depth: 1, a, i, then round again. */
export function levelNumeral(value: number, depth: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 3999) return String(value);
  const level = ((depth % 3) + 3) % 3;
  return level === 1 ? letters(value) : level === 2 ? roman(value) : String(value);
}
