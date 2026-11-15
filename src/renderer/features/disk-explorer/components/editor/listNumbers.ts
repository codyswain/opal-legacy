import { ensureSyntaxTree } from '@codemirror/language';
import { ChangeSet, EditorState, MapMode, Prec, Transaction, type ChangeSpec, type Extension, type Text } from '@codemirror/state';
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
 * A number that grows a digit, 9 to 10, moves its item's text one column to
 * the right. The lines under that item, its nested lists and later
 * paragraphs, are indented to match, or Markdown would read them as no
 * longer inside it.
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

const QUOTE = /^(?:[ \t]*>[ \t]?)*/;
const quoteLength = (text: string) => QUOTE.exec(text)?.[0].length ?? 0;

/** The column `text` ends at, with tab stops every 4. */
function columnOf(text: string): number {
  let at = 0;
  for (const character of text) at = character === '\t' ? at + 4 - (at % 4) : at + 1;
  return at;
}

/** The spaces between a marker and its text that count toward the text's column: one to four, else one. */
function gapAfter(doc: Text, markTo: number, lineTo: number): number {
  const spaces = /^ */.exec(doc.sliceString(markTo, Math.min(lineTo, markTo + 6)))?.[0].length ?? 0;
  return spaces === 0 || spaces > 4 ? 1 : spaces;
}

/**
 * The indent that keeps an item's later lines inside it when its marker
 * grows from `oldMark` to `width` characters: every line that was indented
 * to the item's text moves right together, by what the least indented of
 * them is short. Nothing when the marker did not grow, when the item moved
 * to another indent, which leaves its lines where they are on purpose, or
 * when its lines already reach.
 */
function keptInside(tr: Transaction, oldMark: SyntaxNode, markFrom: number, width: number): ChangeSpec[] {
  const oldDoc = tr.startState.doc;
  const { newDoc } = tr;
  const item = oldMark.parent;
  const grow = width - (oldMark.to - oldMark.from);
  if (!item || grow <= 0) return [];
  const first = oldDoc.lineAt(item.from);
  const end = item.to > item.from && oldDoc.lineAt(item.to).from === item.to ? item.to - 1 : item.to;
  const last = oldDoc.lineAt(end).number;
  if (last === first.number) return [];
  const lead = columnOf(first.text.slice(quoteLength(first.text), oldMark.from - first.from));
  const line = newDoc.lineAt(markFrom);
  if (columnOf(line.text.slice(quoteLength(line.text), markFrom - line.from)) !== lead) return [];
  const textAt = lead + (oldMark.to - oldMark.from) + gapAfter(oldDoc, oldMark.to, first.to);
  const inside: { at: number; column: number }[] = [];
  for (let number = first.number + 1; number <= last; number += 1) {
    const old = oldDoc.line(number);
    const quote = quoteLength(old.text);
    const indent = /^[ \t]*/.exec(old.text.slice(quote))?.[0] ?? '';
    if (quote + indent.length === old.length || columnOf(indent) < textAt) continue;
    const at = tr.changes.mapPos(old.from + quote + indent.length, 1, MapMode.TrackDel);
    if (at === null) continue;
    const now = newDoc.lineAt(at);
    inside.push({ at, column: columnOf(now.text.slice(quoteLength(now.text), at - now.from)) });
  }
  const short = textAt + grow - Math.min(...inside.map((each) => each.column));
  return inside.length > 0 && short > 0 ? inside.map(({ at }) => ({ from: at, insert: ' '.repeat(short) })) : [];
}

/** The changes that put the numbers of the lists `tr` touched in order, in the new text's positions. */
function renumbering(tr: Transaction): ChangeSpec[] {
  const { newDoc } = tr;
  let from = newDoc.length;
  let to = 0;
  const edited: [number, number][] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => { from = Math.min(from, fromB); to = Math.max(to, toB); edited.push([fromB, toB]); });
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
  /** The marker that started at `at` before the edit. */
  const markBefore = (at: number): SyntaxNode | null => {
    const node = before.resolveInner(at, 1);
    return node.name === 'ListMark' && node.from === at && node.parent?.name === 'ListItem' ? node : null;
  };
  const changes: ChangeSpec[] = [];
  for (const list of lists) {
    const { start, count, split } = counted(list);
    // A list changes only when its own items did: it lost or gained one, it is new, the edit reached the marks that
    // open one of its items, or it is the second half of a list cut in two. Text typed in an item, or on the line
    // under the list, which Markdown reads as more of the last item, leaves the list as written.
    const old = earlier(list);
    const resized = old !== null && old.getChildren('ListItem').length !== count;
    const reached = edited.some(([editFrom, editTo]) => editFrom < list.to && editTo > list.from);
    const marks = () => list.getChildren('ListItem').some((item) => {
      const line = newDoc.lineAt(item.from);
      const end = prefixEnd(newDoc, line.from);
      return edited.some(([editFrom, editTo]) => editFrom < end && editTo >= line.from);
    });
    if (!split && !resized && !(reached && (old === null || marks()))) continue;
    list.getChildren('ListItem').forEach((item, index) => {
      const mark = item.getChild('ListMark');
      if (!mark) return;
      const written = newDoc.sliceString(mark.from, mark.to);
      const digits = /^\d+/.exec(written)?.[0] ?? '';
      const want = String(start + index);
      if (digits && digits !== want) changes.push({ from: mark.from, to: mark.from + digits.length, insert: want });
      const was = digits ? markBefore(back(mark.from)) : null;
      if (was) changes.push(...keptInside(tr, was, mark.from, written.length - digits.length + want.length));
    });
  }
  return changes;
}

// A list item's line: its quote marks and indent, then its marker.
const ITEM_MARK = /^((?:[ \t]*>[ \t]?)*[ \t]*)([-+*]|\d{1,9}[.)])(?:[ \t]|$)/;

/**
 * The indents for items whose marker the edit itself made wider, such as a
 * bullet turned into a number: found from the lines the edit wrote, since
 * until their lines are indented again the new text reads as other lists.
 */
function widened(tr: Transaction): ChangeSpec[] {
  const { newDoc } = tr;
  const before = latestTree(tr.startState);
  const seen = new Set<number>();
  const changes: ChangeSpec[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    for (let at = fromB; at <= toB;) {
      const line = newDoc.lineAt(at);
      at = line.to + 1;
      const match = seen.has(line.number) ? null : ITEM_MARK.exec(line.text);
      seen.add(line.number);
      if (!match) continue;
      const markFrom = line.from + match[1].length;
      const node = before.resolveInner(tr.changes.invertedDesc.mapPos(markFrom, 1), 1);
      if (node.name === 'ListMark' && node.parent?.name === 'ListItem') changes.push(...keptInside(tr, node, markFrom, match[2].length));
    }
  });
  return changes;
}

const EDITS = ['input', 'delete', 'move'];

/** The person's edit with the numbers of the lists it touched put in order. */
export function withListNumbers(tr: Transaction): Transaction | readonly (Transaction | { changes: ChangeSpec[]; sequential: true })[] {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !EDITS.some((event) => tr.isUserEvent(event))) return tr;
  if (!changesItems(tr)) return tr;
  // First the lines under markers the edit made wider, so the lists read as they will be; then their numbers.
  const indents = widened(tr);
  const indented = indents.length > 0 ? tr.startState.update({ changes: tr.changes.compose(ChangeSet.of(indents, tr.newDoc.length)), filter: false }) : tr;
  const numbers = renumbering(indented);
  if (indents.length === 0 && numbers.length === 0) return tr;
  return [tr, ...(indents.length > 0 ? [{ changes: indents, sequential: true as const }] : []), ...(numbers.length > 0 ? [{ changes: numbers, sequential: true as const }] : [])];
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
