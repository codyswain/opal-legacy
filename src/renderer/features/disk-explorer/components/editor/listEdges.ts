import { ensureSyntaxTree } from '@codemirror/language';
import { Annotation, ChangeSet, EditorSelection, MapMode, Transaction, type ChangeDesc, type ChangeSpec, type Text, type TransactionSpec } from '@codemirror/state';
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
 * is taken out, and the caret is kept on a line that shows.
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
    if (listy(upper) === listy(lower) || depthOf(above.text) !== depthOf(below.text)) continue;
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
 * nearest the caret first; a caret's line the list under it would hide gets
 * a blank line under it for the list instead; and a caret on a line the page
 * gives no room moves to the blank line beside it that shows. Null when
 * there is nothing to do, or no way to the same rows.
 */
function rowsKept(tr: Transaction, doc: Text, desc: ChangeDesc, head: number): { changes: ChangeSet; head: number } | null {
  const old = tr.startState.doc;
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
  const want = oldLast - oldFirst + 1 - listGaps(old, oldFirst, oldLast).length;
  let text = doc;
  let caret = head;
  let end = last;
  let total = ChangeSet.empty(doc.length);
  for (let turn = 0; turn < 6; turn += 1) {
    const gaps = new Set(listGaps(text, first, end));
    const have = end - first + 1 - gaps.size;
    const at = text.lineAt(caret).number;
    // Fewer rows with the caret on one of them: the edit used a blank line that was there, and that stands.
    if (have === want || (have < want && !gaps.has(at))) {
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
    if (have > want) {
      // A blank line the edit left showing: the one nearest the caret, never the caret's own.
      let pick = 0;
      for (let number = first; number <= end; number += 1) {
        if (number === at || gaps.has(number) || !blankAt(text, number)) continue;
        if (pick === 0 || Math.abs(number - at) < Math.abs(pick - at)) pick = number;
      }
      if (pick === 0) return null;
      const line = text.line(pick);
      // The line with the line break after it, as a blank line written for a marker is tracked (typing.ts).
      step = ChangeSet.of(pick < text.lines ? { from: line.from, to: line.to + 1 } : { from: line.from - 1, to: line.to }, text.length);
      end -= 1;
    } else {
      // The caret's empty line reads as the gap over the list under it: a blank line after it is the gap instead.
      if (!blankAt(text, at)) return null;
      const line = text.line(at);
      step = ChangeSet.of({ from: line.to, insert: `\n${quoteOf(line.text).replace(/[ \t]+$/, '')}` }, text.length);
      end += 1;
    }
    total = total.compose(step);
    caret = step.mapPos(caret, -1);
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
  const out: ChangeSpec[] = [];
  for (const number of listGaps(old, first, last)) {
    const line = old.line(number);
    // Next to code, HTML or a table the blank line is drawn its own way, and stays.
    if (raw(tree, old.line(number - 1).from + quoteOf(old.line(number - 1).text).length) || raw(tree, old.line(number + 1).from + quoteOf(old.line(number + 1).text).length)) continue;
    const at = desc.mapPos(line.from, 1, MapMode.TrackDel);
    if (at === null) continue;
    const now = doc.lineAt(at);
    if (now.from !== at || now.number === caret || lineKind(now.text) !== 'blank' || listGaps(doc, now.number, now.number).length > 0) continue;
    // Only a line that is still whole: its own line break was not part of the deletion.
    if (now.number === 1 || now.number === doc.lines) continue;
    out.push({ from: now.from, to: now.to + 1 });
  }
  return out;
}

/** The person's edit with a blank line wherever it left a list touching text, and with its rows kept when it asks. */
export function withListEdges(tr: Transaction): Transaction | readonly (Transaction | TransactionSpec)[] {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !EDITS.some((event) => tr.isUserEvent(event))) return tr;
  const { changes, emptied } = edgeGaps(tr);
  const keeps = (tr.annotation(keepsRows) === true || untypesMarker(tr)) && tr.newSelection.ranges.length === 1;
  if (changes.length === 0 && !keeps && !removesBreak(tr)) return tr;
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
 * row. Lines are numbered from 1; `first` to `last` are the lines to look
 * at.
 */
export function listGaps(doc: Text, first: number, last: number): number[] {
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
    // Over a list: an item, or a marker being typed, is next.
    const mark = lower === 'item' || lower === 'pending' ? markerOf(below.text) : null;
    if (!mark) {
      // A marker shown as typed again, by the first undo of the formatting or the Backspace that does the same,
      // stands where its item stood until the rest of it is deleted.
      if (lower === 'text' && (upper === 'text' || upper === 'pending') && LITERAL_MARKER.test(below.text.slice(quoteOf(below.text).length)) && depthOf(below.text) === depth) gaps.push(number);
      continue;
    }
    if (depthOf(below.text) !== depth) continue;
    if (upper === 'text' || upper === 'pending') {
      gaps.push(number);
    } else if (upper === 'blank') {
      // The last of several blank lines: what stands above them says whether it is a gap.
      let start = number - 1;
      while (start > 1 && lineKind(doc.line(start - 1).text) === 'blank') start -= 1;
      // Blank lines that open the page: the first is the page's own empty line, the last the gap.
      const before = start === 1 ? 'text' : lineKind(doc.line(start - 1).text);
      // Under a list the first of them is the gap already, so the last is one only with an empty line between.
      if (before === 'text' || before === 'pending' || (listy(before) && number - start >= 2)) gaps.push(number);
    }
  }
  return gaps;
}
