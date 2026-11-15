import { ensureSyntaxTree } from '@codemirror/language';
import { Annotation, ChangeSet, EditorSelection, MapMode, StateField, Transaction, type ChangeDesc, type ChangeSpec, type Text, type TransactionSpec } from '@codemirror/state';
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
 * An edit that deletes across a list's edge takes the blank line that only
 * parted the list from the text with it, or it would show as an empty row.
 *
 * Only the lines an edit made neighbours change. A list that already sat
 * against text before the edit is left as written, unless the edit leaves
 * it unreadable: an empty item, or a number past 1, right under text.
 *
 * A key that takes an item out of its list, or ends a list, changes no row
 * of the page in a word processor. Here the blank lines beside the item stop
 * being a list's, and would show as rows. Such an edit says so (`keepsRows`)
 * and is given back the rows the page had: a blank line that would now show
 * is taken out, and the caret is kept on a line that shows. Making a line a
 * list item, by a key or by typing its marker, changes no row either: an
 * empty row the person left beside the line would become the new list's gap,
 * so a second blank line goes in beside it, and the row stays.
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

// A marker written out as text, with the backslash that keeps it text: "\\-", "\\- " or "1\\. " alone on a line.
const LITERAL_MARKER = /^[ \t]*(?:\\[-+*]|\d{1,9}\\[.)])[ \t]?$/;
// A line that holds an indent and nothing else.
const STARTED = /^[ \t]+$/;
// An item line's indent and marker, or a marker alone at the line's end.
const MARK = /^([ \t]*)([-+*]|\d{1,9}([.)]))(?:[ \t]|$)/;

/** Where an item line's marker starts, in columns, and which list it makes: its bullet, or its number's "." or ")". */
function markerOf(text: string): { indent: number; kind: string } | null {
  const match = MARK.exec(text.slice(quoteOf(text).length));
  return match ? { indent: match[1].replace(/\t/g, '    ').length, kind: match[3] ?? match[2] } : null;
}

/**
 * The kind of list an item whose marker starts at column `indent` would sit
 * beside, were it on the line after line `number`: that of the nearest item
 * above at the same column, past the deeper lines between. Null when the
 * lines above are no list, or hold no item at that column.
 */
export function siblingKind(doc: Text, number: number, indent: number, depth: number): string | null {
  for (let at = number; at >= 1; at -= 1) {
    const { text } = doc.line(at);
    const kind = lineKind(text);
    if (!listy(kind) || depthOf(text) !== depth) return null;
    const mark = kind === 'item' ? markerOf(text) : null;
    if (mark && mark.indent === indent) return mark.kind;
    if (mark && mark.indent < indent) return null;
  }
  return null;
}

/** The kind of the item on `text`, for an item typed there: null when the line is no item. */
export const itemKind = (text: string) => markerOf(text);

/** Whether `text` holds a marker still being typed, "-" or "1.", or one shown as typed again, "\\- ". */
function beingTyped(text: string): boolean {
  const kind = lineKind(text);
  return kind === 'pending' || (kind === 'text' && LITERAL_MARKER.test(text.slice(quoteOf(text).length)));
}

/**
 * The blank lines of `old` that the blank line `line` of the text after
 * `changes` was: none for a line the edit wrote. Of two blank lines that
 * became one, either may be the one that stayed, so both are given.
 */
function linesBefore(old: Text, changes: ChangeDesc, line: { from: number; to: number }): number[] {
  let written = false;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => { if (fromB <= line.from && line.to < toB) written = true; });
  const found: number[] = [];
  if (written) return found;
  const back = changes.invertedDesc;
  for (const side of [-1, 1]) {
    const at = back.mapPos(line.from, side);
    const before = old.lineAt(at);
    if (before.from === at && lineKind(before.text) === 'blank' && !found.includes(before.number)) found.push(before.number);
  }
  return found;
}

/** Whether line `number` of `old` was a blank line the page gave no room. `was` is the row kept over a marker then (`ownRow`). */
const gapThen = (old: Text, was: number | null, number: number) => listGaps(old, number, number, was).length > 0;

/**
 * The line of `old` that the blank line `line` of the text after `changes`
 * was, when the page drew it as a row there: an empty row the person left,
 * and no list's gap. 0 for a line the edit wrote, or one that was a gap.
 */
function rowBefore(old: Text, was: number | null, changes: ChangeDesc, line: { from: number; to: number }): number {
  return linesBefore(old, changes, line).find((number) => !gapThen(old, was, number)) ?? 0;
}

/**
 * The line of `old` with text on it that the blank line `line` of the text
 * after `changes` was, as an item whose marker the edit took off: 0 for a
 * line the edit wrote, or one that was blank before.
 */
function emptiedBefore(old: Text, changes: ChangeDesc, line: { from: number; to: number }): number {
  let written = false;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => { if (fromB <= line.from && line.to < toB) written = true; });
  if (written) return 0;
  const at = changes.invertedDesc.mapPos(line.from, -1);
  const before = old.lineAt(at);
  return before.from === at && lineKind(before.text) !== 'blank' ? before.number : 0;
}

/**
 * The empty row over a marker that is still being typed, as the position of
 * its line after `changes`, or null. The text alone cannot tell the blank
 * line written for a marker typed right under a paragraph, which is that
 * marker's gap, from an empty row the person left above the line they type
 * on. So a blank line that showed as a row before a marker was typed under
 * it stays a row for as long as the marker is being typed, and every other
 * blank line over such a marker is its gap, as the text says.
 */
function ownRowAfter(old: Text, was: number | null, changes: ChangeDesc, doc: Text, head: number): number | null {
  if (was !== null) {
    const at = changes.mapPos(was, -1, MapMode.TrackDel);
    const line = at === null ? null : doc.lineAt(at);
    if (line && line.from === at && line.number < doc.lines && lineKind(line.text) === 'blank' && beingTyped(doc.line(line.number + 1).text)) return at;
  }
  const line = doc.lineAt(head);
  if (line.number < 2 || !beingTyped(line.text)) return null;
  const above = doc.line(line.number - 1);
  return lineKind(above.text) === 'blank' && rowBefore(old, was, changes, above) > 0 ? above.from : null;
}

/** The empty row the person left over a marker being typed, which `listGaps` keeps a row: its line's position. */
export const ownRow = StateField.define<number | null>({
  create: () => null,
  update: (value, tr) => (tr.docChanged ? ownRowAfter(tr.startState.doc, value, tr.changes, tr.newDoc, tr.newSelection.main.head) : value),
});

/**
 * Whether the item on line `number`, right under a list line, starts a list
 * of a kind that no list around it has: a number under bullets, or a bullet
 * under numbers. While such an item is empty, Markdown reads its line as
 * more of the line above.
 */
function startsOtherList(doc: Text, number: number): boolean {
  const { text } = doc.line(number);
  const mark = markerOf(text);
  if (!mark) return false;
  const bullet = (kind: string) => /[-+*]/.test(kind);
  // The nearest item above at each level, from the item's own level outwards, says which list is open there.
  let limit = mark.indent;
  for (let at = number - 1; at >= 1 && limit >= 0; at -= 1) {
    const above = doc.line(at).text;
    const kind = lineKind(above);
    if (depthOf(above) !== depthOf(text)) break;
    // A blank line inside a list, as over an item's second paragraph, ends nothing.
    if (kind === 'blank') continue;
    if (!listy(kind)) break;
    const other = kind === 'item' ? markerOf(above) : null;
    if (!other || other.indent > limit) continue;
    if (bullet(other.kind) === bullet(mark.kind)) return false;
    limit = other.indent - 1;
  }
  return true;
}

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
  // A line that could still become a marker, "2024" or "#", is text once the caret has left it for another line:
  // typed right under a list and ended with Enter, it is a paragraph, and gets its blank line then.
  const caretWas = tr.startState.selection.ranges.length === 1 ? oldDoc.lineAt(tr.startState.selection.main.head) : null;
  const caretIs = newDoc.lineAt(tr.newSelection.main.head).number;
  const pasted = tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop');
  const left = caretWas && lineKind(caretWas.text) === 'pending' ? tr.changes.mapPos(caretWas.from, -1) : -1;
  for (const number of [...pairs].sort((a, b) => a - b)) {
    const above = newDoc.line(number - 1);
    const below = newDoc.line(number);
    const upper = lineKind(above.text);
    const typedOut = lineKind(below.text) === 'pending' && below.from === left && number !== caretIs && /\S/.test(below.text);
    const lower = typedOut ? 'text' : lineKind(below.text);
    if (upper === 'blank' || lower === 'blank' || upper === 'pending' || lower === 'pending') continue;
    if (depthOf(above.text) !== depthOf(below.text)) continue;
    // Two list lines need nothing between them, but for an empty item that starts a list of another kind: a
    // number typed right under bullets would read as more of the last bullet until it had text.
    const other = listy(upper) && lower === 'item' && EMPTY_ITEM.test(below.text.slice(quoteOf(below.text).length)) && startsOtherList(newDoc, number);
    if (listy(upper) === listy(lower) && !other) continue;
    // A later line of an item under text is only an indented line.
    if (upper === 'text' && lower === 'more') continue;
    if (tree === undefined) tree = ensureSyntaxTree(tr.state, Math.min(newDoc.length, below.to + 1), 50);
    if (!tree || raw(tree, above.from + quoteOf(above.text).length) || raw(tree, below.from + quoteOf(below.text).length)) continue;
    // Lines that were neighbours of the same kinds before the edit stay as written, unless the list under the text can no longer be read.
    const oldAbove = before(above);
    const oldBelow = before(below);
    // Text pasted or dropped onto the empty line right under a list did not stand there before: it is as new as
    // text typed there, which gets its blank line from the typing rule (listKeys.ts).
    const fresh = pasted && oldBelow !== null && lineKind(oldBelow.text) === 'blank' && listy(upper) && lower === 'text';
    const stood = !typedOut && !fresh && oldAbove !== null && oldBelow !== null && oldAbove.number + 1 === oldBelow.number
      && listy(lineKind(oldAbove.text)) === listy(upper) && listy(lineKind(oldBelow.text)) === listy(lower);
    const body = below.text.slice(quoteOf(below.text).length);
    const unreadable = lower === 'item' && (EMPTY_ITEM.test(body) || PAST_ONE.test(body));
    if (stood && !unreadable) continue;
    changes.push({ from: below.from, insert: `${quoteOf(below.text).replace(/[ \t]+$/, '')}\n` });
    if (EMPTY_ITEM.test(body)) emptied.push({ from: below.from, to: below.to });
    // Enter gave the caret's new line the indent of the item above, for a later line of it: the line under a
    // paragraph starts at the margin.
    const next = typedOut && number < newDoc.lines ? newDoc.line(number + 1) : null;
    if (next && next.number === caretIs && /^[ \t]+$/.test(next.text.slice(quoteOf(next.text).length))) changes.push({ from: next.from + quoteOf(next.text).length, to: next.to });
  }
  return { changes, emptied };
}

const EDITS = ['input', 'delete', 'move'];

/**
 * Set on an edit that takes an item out of its list or ends a list, which
 * changes no row of the page in a word processor: the page keeps the rows it
 * had (see the note at the top).
 */
export const keepsRows = Annotation.define<boolean>();

const blankAt = (doc: Text, number: number) => lineKind(doc.line(number).text) === 'blank';

// A line Markdown can read as the underline of a heading, past its quote marks: "---" or "===".
const UNDERLINE = /^ {0,3}(?:-+|=+)[ \t]*$/;

/**
 * Whether the blank line `number` keeps a line of text from standing right
 * over a "---" rule or a "===" line. Without it Markdown reads the text as a
 * heading and the rule is gone, so the line stays even where it shows as a row.
 */
function holdsRuleApart(doc: Text, number: number): boolean {
  if (number < 2 || number >= doc.lines) return false;
  const above = doc.line(number - 1).text;
  const below = doc.line(number + 1).text;
  const kind = lineKind(above);
  return kind !== 'blank' && !listy(kind) && UNDERLINE.test(below.slice(quoteOf(below).length));
}

// A list marker as typed, whole or in part, with or without the backslash that keeps it text.
const TYPED_MARKER = /^(?:\\?[-+*]|\d{1,9}\\?[.)]?)[ \t]?$/;

/**
 * Whether `tr` deletes the last of a marker typed out as text, "-" or
 * "\\- ", and leaves its line empty. The blank line written over it when it
 * was typed under a paragraph has no list to part from the text any more, so
 * this keeps the page's rows too, whichever key's rule made the deletion.
 */
function untypesMarker(tr: Transaction): boolean {
  if (!tr.isUserEvent('delete')) return false;
  let count = 0;
  let marker = false;
  tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    count += 1;
    marker = inserted.length === 0 && toA <= tr.startState.doc.lineAt(fromA).to && TYPED_MARKER.test(tr.startState.sliceDoc(fromA, toA)) && !/[^\s>]/.test(tr.newDoc.lineAt(fromB).text);
  });
  return count === 1 && marker;
}

/**
 * What gives the page its rows back after `tr`, an edit that should change
 * none: `doc` is its text with the edge gaps in, `desc` the way there from
 * the text before, `head` the caret. Blank lines the edit left showing go,
 * nearest the caret first; an empty row that the edit made a list's gap
 * gets a blank line beside it, which is the gap instead; a caret's line the
 * list under it would hide gets a blank line under it the same way; and a
 * caret on a line the page gives no room moves to the blank line beside it
 * that shows. Null when there is nothing to do, or no way to the same rows.
 */
function rowsKept(tr: Transaction, doc: Text, desc: ChangeDesc, head: number): { changes: ChangeSet; head: number } | null {
  const old = tr.startState.doc;
  const was = tr.startState.field(ownRow, false) ?? null;
  let first = doc.lines + 1;
  let last = 0;
  desc.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    first = Math.min(first, doc.lineAt(fromB).number);
    last = Math.max(last, doc.lineAt(toB).number);
  });
  if (first > last) return null;
  // The lines written, the blank lines on either side of them, and the line past those.
  while (first > 1 && blankAt(doc, first - 1)) first -= 1;
  if (first > 1) first -= 1;
  while (last < doc.lines && blankAt(doc, last + 1)) last += 1;
  if (last < doc.lines) last += 1;
  const back = desc.invertedDesc;
  const oldFirst = old.lineAt(back.mapPos(doc.line(first).from, -1)).number;
  const oldLast = old.lineAt(back.mapPos(doc.line(last).to, 1)).number;
  // Code, HTML and tables keep their own blank lines, and a drawn block draws the lines beside it its own way.
  const tree = ensureSyntaxTree(tr.startState, old.line(oldLast).to, 50);
  if (!tree) return null;
  for (let number = oldFirst; number <= oldLast; number += 1) {
    const line = old.line(number);
    if (raw(tree, line.from + quoteOf(line.text).length)) return null;
  }
  const want = oldLast - oldFirst + 1 - listGaps(old, oldFirst, oldLast, was).length;
  let text = doc;
  let caret = head;
  let end = last;
  let total = ChangeSet.empty(doc.length);
  let own = ownRowAfter(old, was, desc, doc, head);
  // The rows of the text before that have their blank line beside them again.
  const given = new Set<number>();
  for (let turn = 0; turn < 12; turn += 1) {
    const gaps = new Set(listGaps(text, first, end, own));
    const have = end - first + 1 - gaps.size;
    const at = text.lineAt(caret).number;
    if (have === want) {
      if (!gaps.has(at)) return total.empty && caret === head ? null : { changes: total, head: caret };
      // The caret is on a line with no room: the blank line beside it that shows takes it.
      let to = 0;
      for (let number = at - 1; number >= first && blankAt(text, number) && to === 0; number -= 1) if (!gaps.has(number)) to = number;
      for (let number = at + 1; number <= end && blankAt(text, number) && to === 0; number += 1) if (!gaps.has(number)) to = number;
      if (to === 0) return null;
      caret = text.line(to).to;
      continue;
    }
    let step: ChangeSet;
    const whole = desc.composeDesc(total.desc);
    if (have > want) {
      // A blank line the edit left showing, never the caret's own: one that was a list's gap before it, so each
      // empty row stays where it was, or else the one nearest the caret.
      let pick = 0;
      let gapped = false;
      for (let number = first; number <= end; number += 1) {
        if (number === at || gaps.has(number) || !blankAt(text, number) || holdsRuleApart(text, number)) continue;
        const gap = linesBefore(old, whole, text.line(number)).some((before) => gapThen(old, was, before));
        const nearer = pick === 0 || Math.abs(number - at) < Math.abs(pick - at);
        if (pick === 0 || (gap && !gapped) || (gap === gapped && nearer)) { pick = number; gapped = gap; }
      }
      // None is left that can go, as when the last one keeps text off a rule: what was done so far stands.
      if (pick === 0) return gaps.has(at) || (total.empty && caret === head) ? null : { changes: total, head: caret };
      const line = text.line(pick);
      // The line with the line break after it, as a blank line written for a marker is tracked (typing.ts).
      step = ChangeSet.of(pick < text.lines ? { from: line.from, to: line.to + 1 } : { from: line.from - 1, to: line.to }, text.length);
      end -= 1;
    } else if (gaps.has(at)) {
      // The caret's empty line reads as the gap over the list under it: a blank line after it is the gap instead.
      if (!blankAt(text, at)) return null;
      const line = text.line(at);
      step = ChangeSet.of({ from: line.to, insert: `\n${quoteOf(line.text).replace(/[ \t]+$/, '')}` }, text.length);
      end += 1;
    } else {
      // An empty row the person had reads as the gap of the list the edit made beside it: the nearest such row
      // gets a blank line after it, and one of the two is the gap. So does an item's own row that the edit emptied
      // and that now reads as the gap over the list under it, with the caret moved up off it; the caret goes back to
      // it when it was there. An edit that moved the caret down to a blank line under the item used that line instead.
      let pick = 0;
      let row = 0;
      let emptied = false;
      for (const number of gaps) {
        // A row is kept by its line number before the edit, an emptied item's line by that number made negative.
        const empty = rowBefore(old, was, whole, text.line(number));
        const item = empty === 0 && number > at ? emptiedBefore(old, whole, text.line(number)) : 0;
        const before = empty !== 0 ? empty : -item;
        if (before === 0 || given.has(before)) continue;
        if (pick === 0 || Math.abs(number - at) < Math.abs(pick - at)) { pick = number; row = before; emptied = item !== 0; }
      }
      // Fewer rows and no empty row lost: the edit used a blank line that was there, and that stands.
      if (pick === 0) return total.empty && caret === head ? null : { changes: total, head: caret };
      given.add(row);
      const line = text.line(pick);
      if (emptied && -row === old.lineAt(tr.startState.selection.main.head).number) caret = line.to;
      step = ChangeSet.of({ from: line.to, insert: `\n${quoteOf(line.text).replace(/[ \t]+$/, '')}` }, text.length);
      end += 1;
    }
    total = total.compose(step);
    caret = step.mapPos(caret, -1);
    own = own === null ? null : step.mapPos(own, -1);
    text = step.apply(text);
  }
  return null;
}

/** Whether `tr` takes a line break out of the text: a deletion or a replacement that runs across lines. */
function removesBreak(tr: Transaction): boolean {
  let removes = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (toA > fromA && tr.startState.doc.lineAt(fromA).number !== tr.startState.doc.lineAt(toA).number) removes = true;
  });
  return removes;
}

/**
 * The blank lines that parted a list from the text beside it before `tr`
 * and part no list from anything after it: a deletion across the list's
 * edge took the list line next to them. They would show as empty rows the
 * person never made, so they go with the deletion. `doc` is the text with
 * the edge gaps in, `desc` the way there from the text before, `head` the
 * caret, whose own line stays.
 */
function orphanGaps(tr: Transaction, doc: Text, desc: ChangeDesc, head: number): ChangeSpec[] {
  const old = tr.startState.doc;
  let first = old.lines + 1;
  let last = 0;
  desc.iterChangedRanges((fromA, toA) => {
    first = Math.min(first, old.lineAt(fromA).number);
    last = Math.max(last, old.lineAt(toA).number);
  });
  if (first > last) return [];
  while (first > 1 && blankAt(old, first - 1)) first -= 1;
  if (first > 1) first -= 1;
  while (last < old.lines && blankAt(old, last + 1)) last += 1;
  if (last < old.lines) last += 1;
  const tree = ensureSyntaxTree(tr.startState, old.line(last).to, 50);
  if (!tree) return [];
  const caret = doc.lineAt(head).number;
  const was = tr.startState.field(ownRow, false) ?? null;
  const own = ownRowAfter(old, was, desc, doc, head);
  const out: ChangeSpec[] = [];
  for (const number of listGaps(old, first, last, was)) {
    const line = old.line(number);
    // Next to code, HTML or a table the blank line is drawn its own way, and stays.
    if (raw(tree, old.line(number - 1).from + quoteOf(old.line(number - 1).text).length) || raw(tree, old.line(number + 1).from + quoteOf(old.line(number + 1).text).length)) continue;
    const at = desc.mapPos(line.from, 1, MapMode.TrackDel);
    if (at === null) continue;
    const now = doc.lineAt(at);
    if (now.from !== at || now.number === caret || lineKind(now.text) !== 'blank' || listGaps(doc, now.number, now.number, own).length > 0) continue;
    // Only a line that is still whole: its own line break was not part of the deletion.
    if (now.number === 1 || now.number === doc.lines || holdsRuleApart(doc, now.number)) continue;
    out.push({ from: now.from, to: now.to + 1 });
  }
  return out;
}

/**
 * The empty rows beside what `tr` pasted or dropped that now read as the gap
 * of a list it put there: each gets a blank line after it, which is the gap
 * instead, so a list pasted between two empty rows keeps both. Only a blank
 * line the edit did not touch counts, and none next to code, HTML or a
 * table. `doc` is the text with the edge gaps in, `desc` the way there from
 * the text before.
 */
function rowsBeside(tr: Transaction, doc: Text, desc: ChangeDesc): ChangeSpec[] {
  const old = tr.startState.doc;
  const was = tr.startState.field(ownRow, false) ?? null;
  let first = doc.lines + 1;
  let last = 0;
  desc.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    first = Math.min(first, doc.lineAt(fromB).number);
    last = Math.max(last, doc.lineAt(toB).number);
  });
  if (first > last) return [];
  const tree = ensureSyntaxTree(tr.startState, old.length, 50);
  if (!tree) return [];
  const out: ChangeSpec[] = [];
  const keep = (number: number) => {
    const line = doc.line(number);
    const before = linesBefore(old, desc, line);
    if (before.length !== 1 || gapThen(old, was, before[0]) || listGaps(doc, number, number).length === 0) return;
    for (const beside of [before[0] - 1, before[0] + 1]) {
      const neighbour = beside >= 1 && beside <= old.lines ? old.line(beside) : null;
      if (neighbour && raw(tree, neighbour.from + quoteOf(neighbour.text).length)) return;
    }
    out.push({ from: line.to, insert: `\n${quoteOf(line.text).replace(/[ \t]+$/, '')}` });
  };
  for (let number = first - 1; number >= 1 && blankAt(doc, number); number -= 1) keep(number);
  for (let number = last + 1; number <= doc.lines && blankAt(doc, number); number += 1) keep(number);
  return out;
}

/** The person's edit with a blank line wherever it left a list touching text, and with its rows kept when it asks. */
export function withListEdges(tr: Transaction): Transaction | readonly (Transaction | TransactionSpec)[] {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !EDITS.some((event) => tr.isUserEvent(event))) return tr;
  const { changes, emptied } = edgeGaps(tr);
  const keeps = (tr.annotation(keepsRows) === true || untypesMarker(tr)) && tr.newSelection.ranges.length === 1;
  const pasted = tr.newSelection.ranges.length === 1 && (tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'));
  if (changes.length === 0 && !keeps && !pasted && !removesBreak(tr)) return tr;
  // A caret at the start of the lower line stays with that line, under the new blank one.
  const set = ChangeSet.of(changes, tr.newDoc.length);
  // An item the edit emptied read, until its blank line went in, as the heading underline of the text above it,
  // which a document hides and keeps the caret out of. The caret goes back where the edit itself left it.
  const meant = tr.startState.selection.main.map(tr.changes);
  // Only for a deletion: an edit that wrote the marker put the caret after it itself.
  const back = tr.isUserEvent('delete') && tr.newSelection.ranges.length === 1 && meant.empty && emptied.some((line) => meant.head >= line.from && meant.head <= line.to);
  const selection = back ? EditorSelection.single(set.mapPos(meant.head, 1)) : tr.newSelection.map(set, 1);
  const rows = keeps ? rowsKept(tr, set.apply(tr.newDoc), tr.changes.composeDesc(set.desc), selection.main.head) : null;
  if (rows) return [tr, { changes: set.compose(rows.changes), selection: EditorSelection.cursor(rows.head), sequential: true }];
  // A deletion across a list's edge: the blank lines that only parted the list from its neighbours go with it.
  if (!keeps && tr.effects.length === 0 && tr.newSelection.ranges.length === 1 && removesBreak(tr)) {
    const orphans = orphanGaps(tr, set.apply(tr.newDoc), tr.changes.composeDesc(set.desc), selection.main.head);
    if (orphans.length > 0) {
      const gone = ChangeSet.of(orphans, tr.newDoc.length + set.newLength - set.length);
      return [tr, { changes: set.compose(gone), selection: selection.map(gone, 1), sequential: true }];
    }
  }
  // A list pasted or dropped beside an empty row leaves it a row.
  if (!keeps && pasted) {
    const rowed = rowsBeside(tr, set.apply(tr.newDoc), tr.changes.composeDesc(set.desc));
    if (rowed.length > 0) {
      const more = ChangeSet.of(rowed, tr.newDoc.length + set.newLength - set.length);
      return [tr, { changes: set.compose(more), selection: selection.map(more, -1), sequential: true }];
    }
  }
  return changes.length === 0 ? tr : [tr, { changes, selection, sequential: true }];
}

/**
 * The blank lines beside a list that a document gives no room. Under a
 * list line: the blank line right under it, whatever comes next, so a list
 * written with a blank line between its items, two lists one blank line
 * apart and a list over text all sit tight, as in a word processor. Over a
 * list: the last blank line before an item, when text stands above the
 * blank lines, or they open the page. So one blank line beside a list is
 * never a row and each further one is; an empty line between two halves of
 * a list, with the blank line Markdown needs on each side of it, is one
 * row. Over a marker that is still being typed, the empty row the person
 * left there (`own`, the position of its line: the `ownRow` field) is a
 * row. Lines are numbered from 1; `first` to `last` are the lines to look
 * at.
 */
export function listGaps(doc: Text, first: number, last: number, own: number | null = null): number[] {
  const gaps: number[] = [];
  for (let number = Math.max(2, first); number <= Math.min(doc.lines - 1, last); number += 1) {
    const line = doc.line(number);
    if (lineKind(line.text) !== 'blank') continue;
    const above = doc.line(number - 1);
    const below = doc.line(number + 1);
    const lower = lineKind(below.text);
    const depth = depthOf(line.text);
    // An item's later line being started, an indent and nothing yet, is a line of the list to the one under it.
    const startedAbove = number > 2 && STARTED.test(above.text.slice(quoteOf(above.text).length)) && listy(lineKind(doc.line(number - 2).text));
    const upper = startedAbove ? 'more' : lineKind(above.text);
    // Under a list line. A line that holds an indent is a later line of the item being started, by Enter at the
    // end of one or by Shift+Enter, and keeps its row: a blank line as files hold them is empty.
    if (listy(upper) && depthOf(above.text) === depth) {
      const started = STARTED.test(line.text.slice(quoteOf(line.text).length));
      if (!started) gaps.push(number);
      continue;
    }
    // Over a list: an item, or a marker being typed, is next. A marker shown as typed again, by the first undo of
    // the formatting or the Backspace that does the same, stands where its item stood until the rest of it is deleted.
    const typed = lower === 'text' && LITERAL_MARKER.test(below.text.slice(quoteOf(below.text).length));
    const mark = lower === 'item' || lower === 'pending' ? markerOf(below.text) : null;
    if ((!mark && !typed) || depthOf(below.text) !== depth) continue;
    // An empty row the person left over the marker they are typing is theirs until the marker makes an item.
    if (lower !== 'item' && line.from === own) continue;
    // Text in another quote, as a quote over a list outside it, stands apart from the list on its own: the blank
    // line between them is a row, as it is between a quote and a paragraph.
    if (upper === 'text' || upper === 'pending') {
      if (depthOf(above.text) === depth) gaps.push(number);
    } else if (upper === 'blank') {
      // The last of several blank lines: what stands above them says whether it is a gap.
      let start = number - 1;
      while (start > 1 && lineKind(doc.line(start - 1).text) === 'blank') start -= 1;
      // Blank lines that open the page: the first is the page's own empty line, the last the gap.
      const before = start === 1 ? 'text' : lineKind(doc.line(start - 1).text);
      const sameQuote = start === 1 || depthOf(doc.line(start - 1).text) === depth;
      // Under a list the first of them is the gap already, so the last is one only with an empty line between.
      if (((before === 'text' || before === 'pending') && sameQuote) || (listy(before) && number - start >= 2)) gaps.push(number);
    }
  }
  return gaps;
}
