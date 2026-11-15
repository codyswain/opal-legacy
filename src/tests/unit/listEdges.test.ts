import { afterEach, describe, expect, it } from 'vitest';
import { redo, undo } from '@codemirror/commands';
import { EditorState, Text } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { toggleList } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { listGaps, siblingKind } from '@/renderer/features/disk-explorer/components/editor/listEdges';

/*
 * Where a list meets text: which blank lines a document gives no room, and
 * the keys that take an item out of its list or end a list, which change no
 * row of the page. Each case runs in a document (.mdo) and in a note (.md).
 */

const PAGES = [['a document', '/Vault/Notes/Plan.mdo'], ['a note', '/Vault/Notes/Plan.md']] as const;

let views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

/** A page with the caret at "‸". */
function mount(marked: string, page: string) {
  const at = marked.indexOf('‸');
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: marked.replace('‸', ''), selection: { anchor: at }, extensions: markdownEditorExtensions(page) }) });
  views.push(view);
  return view;
}

/** The page with the caret marked. */
const marked = (view: EditorView) => {
  const { head } = view.state.selection.main;
  const text = view.state.doc.toString();
  return `${text.slice(0, head)}‸${text.slice(head)}`;
};
const press = (view: EditorView, key: string, init: KeyboardEventInit = {}) => runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor');
/** The rows the page draws: its lines, less the blank lines it gives no room. */
const rows = (view: EditorView) => view.contentDOM.querySelectorAll('.cm-line').length - view.contentDOM.querySelectorAll('.cm-md-gap-hidden').length;
/** Whether the caret's own line has a row. */
const caretShown = (view: EditorView) => !listGaps(view.state.doc, 1, view.state.doc.lines).includes(view.state.doc.lineAt(view.state.selection.main.head).number);

function type(view: EditorView, typed: string) {
  for (const character of typed) {
    const at = view.state.selection.main.head;
    const insert = () => view.state.update({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
    if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, character, insert))) view.dispatch(insert());
  }
}

const gaps = (text: string) => listGaps(Text.of(text.split('\n')), 1, text.split('\n').length);

/** A page with the selection between "«" and "»" (anchor first). */
function mountSelected(markedText: string, page: string) {
  const anchor = markedText.indexOf('«');
  const head = markedText.replace('«', '').indexOf('»');
  const view = mount(`‸${markedText.replace('«', '').replace('»', '')}`, page);
  view.dispatch({ selection: { anchor, head } });
  return view;
}
/** What copy writes for the selection. */
const copied = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return view.state.facet(EditorView.clipboardOutputFilter).reduce((written, filter) => filter(written, view.state), view.state.sliceDoc(from, to));
};
/** Pastes `text` through the page's paste event, with no system clipboard. */
function pasteText(view: EditorView, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => (kind === 'text/plain' ? text : ''), files: [] } });
  view.contentDOM.dispatchEvent(event);
}
const caretToEnd = (view: EditorView) => view.dispatch({ selection: { anchor: view.state.doc.length } });

describe('the blank lines beside a list that get no room', () => {
  it('gives one blank line between a list and text no room, and shows each further one', () => {
    expect(gaps('Text\n\n- a\n\nMore')).toEqual([2, 4]);
    expect(gaps('Text\n\n\n- a\n\n\nMore')).toEqual([3, 5]);
    expect(gaps('Text\n\n\n\n- a')).toEqual([4]);
    // Blank lines that open the page: the first is the page's own empty line, the last the gap.
    expect(gaps('\n- a')).toEqual([]);
    expect(gaps('\n\n- a')).toEqual([2]);
  });

  it('draws a list tight whether or not its items are a blank line apart, and one row for an empty line between two halves of it', () => {
    expect(gaps('- a\n\n- b')).toEqual([2]);
    expect(gaps('- a\n\n\n- b')).toEqual([2]);
    expect(gaps('1. a\n\n\n\n2. b')).toEqual([2, 4]);
    expect(gaps('- a\n\n  more\n\n- b')).toEqual([2, 4]);
    // An indent typed for an item's next line, between two list lines, is that line being started.
    expect(gaps('- a\n  b\n  \n- c')).toEqual([]);
  });

  it('gives the blank line between two lists no room, whatever their kinds', () => {
    expect(gaps('- a\n- b\n\n1. c')).toEqual([3]);
    expect(gaps('1. a\n2. b\n\n- c')).toEqual([3]);
    expect(gaps('- a\n  1. b\n\n- c')).toEqual([3]);
  });

  it('gives the blank line over a marker being typed no room, unless it is an empty row the person left', () => {
    // The blank line written for a "-" typed right under a paragraph is that marker's gap.
    expect(gaps('Text\n\n-')).toEqual([2]);
    expect(gaps('Text\n\n\\- ')).toEqual([2]);
    // Line 2 starts at position 5: named as the person's own row, it shows.
    const doc = Text.of(['Text', '', '-']);
    expect(listGaps(doc, 1, 3, 5)).toEqual([]);
    expect(listGaps(Text.of(['Text', '', '\\- ']), 1, 3, 5)).toEqual([]);
    // Once the marker has made an item, the text decides again.
    expect(listGaps(Text.of(['Text', '', '- ']), 1, 3, 5)).toEqual([2]);
  });

  it('shows the blank line between a quote and a list under it as a row', () => {
    expect(gaps('> quote\n\n- a')).toEqual([]);
    expect(gaps('> quote\n\n\n- a')).toEqual([]);
    // Inside the quote the blank line is the list's gap, as anywhere else.
    expect(gaps('> Text\n>\n> - a')).toEqual([2]);
  });

  it('finds the list an item would stand beside', () => {
    const doc = Text.of(['- a', '  1. b', '     more', 'Text']);
    expect(siblingKind(doc, 3, 0, 0)).toBe('-');
    expect(siblingKind(doc, 3, 2, 0)).toBe('.');
    expect(siblingKind(doc, 4, 0, 0)).toBeNull();
  });
});

for (const [name, page] of PAGES) {
  describe(`keys that change no row of the page, in ${name}`, () => {
    it('takes an only, empty bullet under a paragraph off without leaving a row', () => {
      const view = mount('Text\n‸', page);
      type(view, '- a');
      expect(marked(view)).toBe('Text\n\n- a‸');
      expect(rows(view)).toBe(2);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n\n- ‸');
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸');
      expect(rows(view)).toBe(2);
      undo(view);
      expect(marked(view)).toBe('Text\n\n- ‸');
    });

    it('takes an empty first bullet off with the list still under it', () => {
      const view = mount('Text\n\n- ‸\n- b', page);
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸\n\n- b');
      expect(rows(view)).toBe(3);
      expect(caretShown(view)).toBe(true);
      type(view, 'w');
      expect(marked(view)).toBe('Text\nw‸\n\n- b');
      expect(rows(view)).toBe(3);
    });

    it('takes the bullet off a first item written tight under text, with a blank line for the list under it', () => {
      const view = mount('Text\n- ‸a\n- b', page);
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸a\n\n- b');
      expect(rows(view)).toBe(3);
    });

    it('takes an only, empty bullet between two paragraphs off, and both blank lines with it', () => {
      const view = mount('Text\n\n- ‸\n\nMore', page);
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸\nMore');
      expect(rows(view)).toBe(3);
    });

    it('takes the bullet off a list\'s first item without opening a row over it', () => {
      const view = mount('Text\n\n- ‸a\n- b', page);
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸a\n\n- b');
      expect(rows(view)).toBe(3);
      undo(view);
      expect(marked(view)).toBe('Text\n\n- ‸a\n- b');
    });

    it('takes a numbered list\'s first item out, and the next one counts from 1', () => {
      const view = mount('Text\n\n1. ‸a\n2. b', page);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸a\n\n1. b');
      expect(rows(view)).toBe(3);
    });

    it('turns a list off from the toolbar without opening rows', () => {
      const view = mount('Top\n\n- a‸\n\nMore', page);
      expect(rows(view)).toBe(3);
      toggleList('bullet')(view);
      expect(marked(view)).toBe('Top\na‸\nMore');
      expect(rows(view)).toBe(3);
      // Two blank lines were a row the person made, and one of them still is. Only the caret's item leaves the list.
      const spaced = mount('Top\n\n\n- a‸\n- b', page);
      expect(rows(spaced)).toBe(4);
      toggleList('bullet')(spaced);
      expect(marked(spaced)).toBe('Top\n\na‸\n\n- b');
      expect(rows(spaced)).toBe(4);
    });

    it('joins a list when the paragraph or the list under it is given its kind', () => {
      const paragraph = mount('- a\n\nMid‸', page);
      expect(rows(paragraph)).toBe(2);
      toggleList('bullet')(paragraph);
      expect(marked(paragraph)).toBe('- a\n\n- Mid‸');
      expect(rows(paragraph)).toBe(2);
      const numbered = mount('1. a\n\nMid‸', page);
      toggleList('number')(numbered);
      expect(marked(numbered)).toBe('1. a\n\n2. Mid‸');
      // A numbered list under a bulleted one, made bullets: one list, with no row opened between.
      const lists = mount('- a\n- b\n\n1. c‸\n2. d', page);
      expect(rows(lists)).toBe(4);
      toggleList('bullet')(lists);
      expect(marked(lists)).toBe('- a\n- b\n\n- c‸\n- d');
      expect(rows(lists)).toBe(4);
      // A paragraph between two paragraphs keeps its blank lines, which the page gives no room.
      const between = mount('Top\nMid‸\nBottom', page);
      toggleList('bullet')(between);
      expect(marked(between)).toBe('Top\n\n- Mid‸\n\nBottom');
      expect(rows(between)).toBe(3);
    });

    it('ends an only, empty item with Enter and leaves an empty line, not two', () => {
      const view = mount('Text\n\n- ‸', page);
      expect(rows(view)).toBe(2);
      press(view, 'Enter');
      expect(marked(view)).toBe('Text\n‸');
      expect(rows(view)).toBe(2);
    });

    it('ends an empty item in the middle of a numbered list as one empty row', () => {
      const view = mount('1. one\n2. ‸\n3. three', page);
      press(view, 'Enter');
      expect(marked(view)).toBe('1. one\n\n‸\n\n2. three');
      expect(rows(view)).toBe(3);
      type(view, 'x');
      expect(marked(view)).toBe('1. one\n\nx‸\n\n2. three');
      expect(rows(view)).toBe(3);
    });

    it('adds one row for Enter at the end of the text above a list', () => {
      const view = mount('Text‸\n\n- a\n- b', page);
      expect(rows(view)).toBe(3);
      press(view, 'Enter');
      expect(marked(view)).toBe('Text\n‸\n\n- a\n- b');
      expect(rows(view)).toBe(4);
      expect(caretShown(view)).toBe(true);
      type(view, 'w');
      expect(marked(view)).toBe('Text\nw‸\n\n- a\n- b');
      expect(rows(view)).toBe(4);
    });

    it('starts a list of another kind right under an ended list, drawn as a list from its marker on', () => {
      const view = mount('- one\n- two‸', page);
      press(view, 'Enter');
      press(view, 'Enter');
      expect(rows(view)).toBe(3);
      type(view, '1. ');
      expect(marked(view)).toBe('- one\n- two\n\n1. ‸');
      expect(rows(view)).toBe(3);
      expect([...view.contentDOM.querySelectorAll('.cm-md-number')].map((element) => element.textContent)).toEqual(['1.']);
      type(view, 'x');
      expect(marked(view)).toBe('- one\n- two\n\n1. x‸');
      expect(rows(view)).toBe(3);
      const numbered = mount('1. a\n2. b‸', page);
      press(numbered, 'Enter');
      press(numbered, 'Enter');
      type(numbered, '- ');
      expect(marked(numbered)).toBe('1. a\n2. b\n\n- ‸');
      expect(rows(numbered)).toBe(3);
    });

    it('carries a list on when an item of its own kind is typed right under it', () => {
      const view = mount('- one\n- two‸', page);
      press(view, 'Enter');
      press(view, 'Enter');
      type(view, '- ');
      expect(marked(view)).toBe('- one\n- two\n- ‸');
      const numbered = mount('1. a\n2. b‸', page);
      press(numbered, 'Enter');
      press(numbered, 'Enter');
      type(numbered, '1. ');
      expect(marked(numbered)).toBe('1. a\n2. b\n3. ‸');
    });

    it('takes a bullet typed under a paragraph back in three Backspaces, with no row opened', () => {
      const view = mount('Text\n‸\nBelow', page);
      type(view, '- ');
      expect(marked(view)).toBe('Text\n\n- ‸\n\nBelow');
      expect(rows(view)).toBe(3);
      // The mark shows as typed again, where its bullet stood.
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n\n\\- ‸\nBelow');
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸\nBelow');
      expect(rows(view)).toBe(3);
      type(view, 'w');
      expect(marked(view)).toBe('Text\nw‸\nBelow');
    });

    it('keeps text that starts like a box, typed on the line right under a list, a paragraph at the margin', () => {
      const view = mount('- one\n- two\n‸', page);
      type(view, '[x] ');
      expect(view.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
      type(view, 'done');
      expect(marked(view)).toBe('- one\n- two\n\n[x] done‸');
      expect(rows(view)).toBe(3);
      expect(view.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
    });

    it('draws a marker being typed on the line right under a list at the margin', () => {
      for (const typed of ['[', '2', '#', '1.']) {
        const view = mount('- one\n- two\n‸', page);
        type(view, typed);
        expect(marked(view)).toBe(`- one\n- two\n${typed}‸`);
        expect(view.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
      }
    });

    it('carries a bulleted list on with a box typed right under it', () => {
      const view = mount('- one\n- two‸', page);
      press(view, 'Enter');
      press(view, 'Enter');
      type(view, '[] ');
      expect(marked(view)).toBe('- one\n- two\n- [ ] ‸');
      expect(rows(view)).toBe(3);
    });

    it('opens a quote on the line right under a list with no blank line of its own', () => {
      const view = mount('- one\n- two\n‸', page);
      type(view, '> x');
      expect(marked(view)).toBe('- one\n- two\n> x‸');
    });

    it('pulls a list\'s first item up with Delete at the end of the text over it', () => {
      const view = mount('Text‸\n\n- a\n- b', page);
      press(view, 'Delete');
      expect(marked(view)).toBe('Text‸a\n\n- b');
      const numbered = mount('Text‸\n\n1. a\n2. b', page);
      press(numbered, 'Delete');
      expect(marked(numbered)).toBe('Text‸a\n\n1. b');
      // An item that holds a list of its own stays where it is.
      const nested = mount('Text‸\n\n- a\n  - c', page);
      press(nested, 'Delete');
      expect(marked(nested)).toBe('Text‸\n\n- a\n  - c');
    });

    it('moves the text of a list\'s last item out to the margin without opening a row under it', () => {
      const view = mount('Text\n\n- a\n- ‸b\n\nMore', page);
      expect(rows(view)).toBe(4);
      press(view, 'Backspace');
      expect(rows(view)).toBe(4);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n\n- a\n\n‸b\nMore');
      expect(rows(view)).toBe(4);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n\n- a‸b\n\nMore');
      expect(rows(view)).toBe(3);
    });

    it('takes a box off a list\'s first item, and pulls a box\'s text up with Delete, as it does a bullet\'s', () => {
      const view = mount('Text\n\n- [ ] ‸a\n- [ ] b', page);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n‸a\n\n- [ ] b');
      expect(rows(view)).toBe(3);
      const pulled = mount('Text‸\n\n- [ ] a\n- [ ] b', page);
      press(pulled, 'Delete');
      expect(marked(pulled)).toBe('Text‸a\n\n- [ ] b');
    });

    it('takes the blank line that parted a list from text away with a deletion that uses the list up', () => {
      const pulled = mount('Text‸\n\n- a\n\nMore', page);
      press(pulled, 'Delete');
      expect(marked(pulled)).toBe('Text‸a\nMore');
      expect(rows(pulled)).toBe(2);
      // A selection from the text above to the end of the list.
      const across = mount('Text\n\n- a\n- b\n\nMore', page);
      across.dispatch({ selection: { anchor: 13, head: 4 }, userEvent: 'select' });
      press(across, 'Backspace');
      expect(marked(across)).toBe('Text‸\nMore');
      expect(rows(across)).toBe(2);
      // The whole list: its row becomes one empty line.
      const whole = mount('Text\n\n- a\n- b\n\nMore', page);
      whole.dispatch({ selection: { anchor: 6, head: 13 }, userEvent: 'select' });
      press(whole, 'Backspace');
      expect(marked(whole)).toBe('Text\n‸\nMore');
      expect(rows(whole)).toBe(3);
      // Typing over a selection that runs into the list.
      const typed = mount('Text\n\n- ab\n\nMore', page);
      typed.dispatch({ selection: { anchor: 3, head: 9 }, userEvent: 'select' });
      typed.dispatch(typed.state.update({ changes: { from: 3, to: 9, insert: 'Z' }, selection: { anchor: 4 }, userEvent: 'input.type' }));
      expect(marked(typed)).toBe('TexZ‸b\nMore');
      expect(rows(typed)).toBe(2);
    });

    it('adds one row for Enter in a list written with a blank line between its items', () => {
      const view = mount('- a\n\n- b‸\n\nMore', page);
      expect(rows(view)).toBe(3);
      press(view, 'Enter');
      expect(rows(view)).toBe(4);
      type(view, 'c');
      expect(rows(view)).toBe(4);
      press(view, 'Enter');
      expect(rows(view)).toBe(5);
      press(view, 'Backspace');
      expect(rows(view)).toBe(5);
      expect(caretShown(view)).toBe(true);
    });

    it('makes a line of digits typed right under a list a paragraph once Enter ends it', () => {
      const view = mount('- one\n- two\n‸', page);
      type(view, '2024');
      press(view, 'Enter');
      type(view, 'x');
      expect(marked(view)).toBe('- one\n- two\n\n2024\nx‸');
      expect(view.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
    });

    it('keeps the rows when the first line of the page, over a list, is emptied', () => {
      const view = mount('T‸\n\n- a\n- b', page);
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('‸\n\n- a\n- b');
      expect(rows(view)).toBe(3);
      type(view, 'z');
      expect(rows(view)).toBe(3);
    });

    it('moves the text of the last item out of a list written with blank lines between its items, with no row opened', () => {
      const view = mount('Top\n\n- a\n\n- b\n\n- ‸c\n\nEnd', page);
      expect(rows(view)).toBe(5);
      press(view, 'Backspace');
      expect(rows(view)).toBe(5);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Top\n\n- a\n\n- b\n\n‸c\nEnd');
      expect(rows(view)).toBe(5);
      press(view, 'Backspace');
      expect(rows(view)).toBe(4);
      // An item's own second paragraph does the same on its first press.
      const later = mount('Top\n\n- a\n\n  ‸more\n\nEnd', page);
      expect(rows(later)).toBe(4);
      press(later, 'Backspace');
      expect(marked(later)).toBe('Top\n\n- a\n\n‸more\nEnd');
      expect(rows(later)).toBe(4);
    });

    it('breaks the line inside an item on Shift+Enter, with the caret on the new line', () => {
      const view = mount('- a‸\n- b', page);
      press(view, 'Enter', { shiftKey: true });
      expect(marked(view)).toBe('- a\n  ‸\n- b');
      expect(rows(view)).toBe(3);
      expect(caretShown(view)).toBe(true);
      type(view, 'x');
      expect(marked(view)).toBe('- a\n  x‸\n- b');
      const last = mount('Text\n\n- a\n- b‸\n\nMore', page);
      press(last, 'Enter', { shiftKey: true });
      expect(marked(last)).toBe('Text\n\n- a\n- b\n  ‸\n\nMore');
      expect(rows(last)).toBe(5);
      expect(caretShown(last)).toBe(true);
    });

    it('makes text pasted onto the empty line right under a list a paragraph', () => {
      const view = mount('- a\n- b\n‸', page);
      view.dispatch(view.state.update({ changes: { from: 8, insert: 'Hello' }, selection: { anchor: 13 }, userEvent: 'input.paste' }));
      expect(marked(view)).toBe('- a\n- b\n\nHello‸');
      expect(rows(view)).toBe(3);
      expect(view.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
    });

    it('moves an item past its neighbour in a list written with blank lines between its items', () => {
      const view = mount('Top\n\n1. a\n\n2. b‸\n\n3. c\n\nEnd', page);
      press(view, 'ArrowUp', { ctrlKey: true, shiftKey: true });
      expect(marked(view)).toBe('Top\n\n1. b‸\n\n2. a\n\n3. c\n\nEnd');
      press(view, 'ArrowDown', { ctrlKey: true, shiftKey: true });
      press(view, 'ArrowDown', { ctrlKey: true, shiftKey: true });
      expect(marked(view)).toBe('Top\n\n1. a\n\n2. c\n\n3. b‸\n\nEnd');
      // Past the list's end it stays, as in a list written tight.
      press(view, 'ArrowDown', { ctrlKey: true, shiftKey: true });
      expect(marked(view)).toBe('Top\n\n1. a\n\n2. c\n\n3. b‸\n\nEnd');
    });

    it('keeps the empty row over a line where a bullet, a number or a box is typed', () => {
      for (const [typed, written] of [['- ', '- '], ['* ', '* '], ['1. ', '1. '], ['[] ', '- [ ] ']]) {
        const view = mount('Text\n\n‸', page);
        expect(rows(view)).toBe(3);
        for (const character of typed) {
          type(view, character);
          expect(rows(view)).toBe(3);
        }
        // The row is still there: the list's own blank line went in under it.
        expect(marked(view)).toBe(`Text\n\n\n${written}‸`);
        type(view, 'a');
        expect(marked(view)).toBe(`Text\n\n\n${written}a‸`);
        expect(rows(view)).toBe(3);
        expect(caretShown(view)).toBe(true);
      }
      // With text under the line, and with two empty rows over it.
      const between = mount('Text\n\n‸\nBelow', page);
      type(between, '- a');
      expect(marked(between)).toBe('Text\n\n\n- a‸\n\nBelow');
      expect(rows(between)).toBe(4);
      const spaced = mount('Text\n\n\n‸', page);
      type(spaced, '- a');
      expect(marked(spaced)).toBe('Text\n\n\n\n- a‸');
      expect(rows(spaced)).toBe(4);
      // A marker typed in front of text that stands under an empty row.
      const front = mount('Text\n\n‸x', page);
      type(front, '- ');
      expect(marked(front)).toBe('Text\n\n\n- ‸x');
      expect(rows(front)).toBe(3);
    });

    it('shows the empty row over a paragraph that starts like a marker at every key', () => {
      for (const typed of ['-5 degrees', '1.5 litres', '+1', '#tag', '2024']) {
        const view = mount('Text\n\n‸\nBelow', page);
        for (const character of typed) {
          type(view, character);
          expect(rows(view)).toBe(4);
        }
        expect(view.state.doc.line(2).text).toBe('');
        expect(view.state.doc.lines).toBe(4);
      }
      // Deleting back to the marker hides nothing either.
      const view = mount('Text\n\n-x‸', page);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Text\n\n-‸');
      expect(rows(view)).toBe(3);
    });

    it('takes a marker typed under an empty row back without closing the row', () => {
      const view = mount('Text\n\n‸\nBelow', page);
      type(view, '- ');
      expect(marked(view)).toBe('Text\n\n\n- ‸\n\nBelow');
      for (let count = 0; count < 3; count += 1) {
        press(view, 'Backspace');
        expect(rows(view)).toBe(4);
      }
      expect(marked(view)).toBe('Text\n\n‸\nBelow');
      const star = mount('Text\n\n‸', page);
      type(star, '*');
      press(star, 'Backspace');
      expect(marked(star)).toBe('Text\n\n‸');
      expect(rows(star)).toBe(3);
    });

    it('keeps the rows through every undo and redo of a bullet typed under an empty row', () => {
      const view = mount('Text\n\n‸', page);
      type(view, '- ab');
      for (let count = 0; count < 4; count += 1) {
        undo(view);
        expect(rows(view)).toBe(3);
      }
      expect(view.state.doc.toString()).toBe('Text\n\n');
      for (let count = 0; count < 4; count += 1) {
        redo(view);
        expect(rows(view)).toBe(3);
      }
      expect(view.state.doc.toString()).toBe('Text\n\n\n- ab');
      // Typed right under the paragraph, the blank line is the marker's own at every step.
      const tight = mount('Text\n‸', page);
      type(tight, '- ab');
      for (let count = 0; count < 4; count += 1) {
        undo(tight);
        expect(rows(tight)).toBe(2);
      }
      expect(tight.state.doc.toString()).toBe('Text\n');
    });

    it('keeps an empty row over a marker typed in a quote', () => {
      const view = mount('> Text\n>\n> ‸', page);
      type(view, '- a');
      expect(marked(view)).toBe('> Text\n>\n>\n> - a‸');
      expect(rows(view)).toBe(3);
    });

    it('makes a paragraph a list item, and plain again, on a page with a blank line between its paragraphs, moving no row', () => {
      const view = mount('One\n\nTw‸o\n\nThree', page);
      expect(rows(view)).toBe(5);
      toggleList('bullet')(view);
      // Each empty row stays, with the list's own blank line beside it.
      expect(marked(view)).toBe('One\n\n\n- Tw‸o\n\n\nThree');
      expect(rows(view)).toBe(5);
      toggleList('bullet')(view);
      expect(marked(view)).toBe('One\n\nTw‸o\n\nThree');
      expect(rows(view)).toBe(5);
      const numbered = mount('One\n\nTw‸o\n\nThree', page);
      toggleList('number')(numbered);
      expect(marked(numbered)).toBe('One\n\n\n1. Tw‸o\n\n\nThree');
      expect(rows(numbered)).toBe(5);
      // A list made on an empty line between two empty rows.
      const empty = mount('One\n\n‸\n\nThree', page);
      toggleList('bullet')(empty);
      expect(marked(empty)).toBe('One\n\n\n- ‸\n\n\nThree');
      expect(rows(empty)).toBe(5);
      // An item an agent wrote tight between two paragraphs is taken out without a row opening.
      const tight = mount('One\n\n- Tw‸o\n\nThree', page);
      toggleList('bullet')(tight);
      expect(marked(tight)).toBe('One\nTw‸o\nThree');
      expect(rows(tight)).toBe(3);
    });

    it('ends a list inside a quote with the caret still in the quote, over a row under the quote', () => {
      const view = mount('> - a\n> - ‸\n\nEnd', page);
      expect(rows(view)).toBe(4);
      press(view, 'Enter');
      expect(marked(view)).toBe('> - a\n>\n> ‸\n\nEnd');
      expect(rows(view)).toBe(4);
      type(view, 'x');
      expect(marked(view)).toBe('> - a\n>\n> x‸\n\nEnd');
      const back = mount('> - a\n> - ‸\n\nEnd', page);
      press(back, 'Backspace');
      expect(marked(back)).toBe('> - a\n>\n> ‸\n\nEnd');
      expect(rows(back)).toBe(4);
      // A blank line of the quote itself is the caret's new line, as outside a quote.
      const inside = mount('> - a\n> - ‸\n>\n> End', page);
      press(inside, 'Enter');
      expect(rows(inside)).toBe(3);
      expect(caretShown(inside)).toBe(true);
    });

    it('joins a heading under a list to the list\'s last line, with Backspace at its start or Delete at the list\'s end', () => {
      const view = mount('- a\n- b\n\n## ‸Head', page);
      expect(rows(view)).toBe(3);
      press(view, 'Backspace');
      expect(marked(view)).toBe('- a\n- b‸Head');
      const pulled = mount('- a\n- b‸\n\n## Head', page);
      press(pulled, 'Delete');
      expect(marked(pulled)).toBe('- a\n- b‸Head');
      // The blank line that kept it apart from a list below goes with Backspace, as for a paragraph.
      const between = mount('- a\n\n## ‸Head\n\n- b', page);
      press(between, 'Backspace');
      expect(marked(between)).toBe('- a‸Head\n- b');
      // A heading written over an underline loses the underline with its place.
      const setext = mount('- a\n- b\n\n‸Head\n====', page);
      press(setext, 'Backspace');
      expect(marked(setext)).toBe('- a\n- b‸Head');
      const under = mount('- a\n- b‸\n\nHead\n----', page);
      press(under, 'Delete');
      expect(marked(under)).toBe('- a\n- b‸Head');
      // A heading inside a list item is that item's text, and is left to the item's own steps.
      const inItem = mount('- a\n\n- # ‸Head', page);
      press(inItem, 'Backspace');
      expect(inItem.state.doc.toString()).toContain('# Head');
    });

    it('pulls the first item\'s text up with Delete at the end of a heading over a list', () => {
      const view = mount('# Head‸\n\n- a\n- b', page);
      press(view, 'Delete');
      expect(marked(view)).toBe('# Head‸a\n\n- b');
      expect(rows(view)).toBe(2);
      const numbered = mount('# Head‸\n\n1. a\n2. b', page);
      press(numbered, 'Delete');
      expect(marked(numbered)).toBe('# Head‸a\n\n1. b');
      // The only item of a list between a heading and text: no empty row is left.
      const only = mount('# Head‸\n\n- a\n\nMore', page);
      press(only, 'Delete');
      expect(marked(only)).toBe('# Head‸a\nMore');
      expect(rows(only)).toBe(2);
      // Over an underline, the text goes up to the heading's own line.
      const setext = mount('Head‸\n===\n\n- a\n- b', page);
      press(setext, 'Delete');
      expect(marked(setext)).toBe('Head‸a\n===\n\n- b');
    });

    it('pulls the next item up in one press of Delete, over the blank line the page gives no room', () => {
      const loose = mount('- a‸\n\n- b\n\n- c', page);
      expect(rows(loose)).toBe(3);
      press(loose, 'Delete');
      expect(marked(loose)).toBe('- a‸b\n\n- c');
      expect(rows(loose)).toBe(2);
      const numbers = mount('1. a‸\n\n2. b\n\n3. c', page);
      press(numbers, 'Delete');
      expect(marked(numbers)).toBe('1. a‸b\n\n2. c');
      // The first item of another list: what is left of that list counts from 1.
      const lists = mount('- a\n- b‸\n\n1. c\n2. d', page);
      press(lists, 'Delete');
      expect(marked(lists)).toBe('- a\n- b‸c\n1. d');
      expect(rows(lists)).toBe(3);
      expect([...lists.contentDOM.querySelectorAll('.cm-md-number')].map((element) => element.textContent)).toEqual(['1.']);
      const bullets = mount('1. a\n2. b‸\n\n- c', page);
      press(bullets, 'Delete');
      expect(marked(bullets)).toBe('1. a\n2. b‸c');
      // An empty row under the list goes first, in one press too.
      const row = mount('- a‸\n\n\nText', page);
      press(row, 'Delete');
      expect(marked(row)).toBe('- a‸\n\nText');
      expect(rows(row)).toBe(2);
    });

    it('makes text typed on the empty line between a list and a table a paragraph of its own', () => {
      const table = '| x | y |\n|---|---|\n| 1 | 2 |';
      const view = mount(`- a\n- b\n‸\n${table}`, page);
      type(view, 'w');
      expect(marked(view)).toBe(`- a\n- b\n\nw‸\n\n${table}`);
      expect(view.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
      type(view, 'x');
      expect(marked(view)).toBe(`- a\n- b\n\nwx‸\n\n${table}`);
      // Over a rule, which would underline the text as a heading, the same.
      const rule = mount('- a\n- b\n‸\n---', page);
      type(rule, 'w');
      expect(marked(rule)).toBe('- a\n- b\n\nw‸\n\n---');
      // A marker being typed there waits, as on any line under a list.
      const marker = mount(`- a\n- b\n‸\n${table}`, page);
      type(marker, '1');
      expect(marker.state.doc.toString().startsWith('- a\n- b\n1')).toBe(true);
    });

    it('keeps the empty rows beside a list that is pasted between them', () => {
      const paste = (view: EditorView, insert: string) => {
        const { head } = view.state.selection.main;
        view.dispatch(view.state.update({ changes: { from: head, insert }, selection: { anchor: head + insert.length }, userEvent: 'input.paste' }));
      };
      const view = mount('Top\n\n‸\n\nBottom', page);
      expect(rows(view)).toBe(5);
      paste(view, '- a\n- b');
      // One row became two, and the empty row on each side is still there.
      expect(marked(view)).toBe('Top\n\n\n- a\n- b‸\n\n\nBottom');
      expect(rows(view)).toBe(6);
      // Right under the text, the blank line written for the list is its gap, and the row under it stays.
      const under = mount('Top\n‸\n\nBottom', page);
      paste(under, '- a\n- b');
      expect(marked(under)).toBe('Top\n\n- a\n- b‸\n\n\nBottom');
      expect(rows(under)).toBe(5);
      // Text pasted on an empty row beside a list changes nothing else.
      const text = mount('- a\n\n‸\n\nText', page);
      paste(text, 'Hello');
      expect(marked(text)).toBe('- a\n\nHello‸\n\nText');
      expect(rows(text)).toBe(4);
    });

    it('draws a number typed right under bullets, or a bullet under numbers, as a list from its space on', () => {
      const view = mount('- one\n- two\n‸', page);
      type(view, '1.');
      expect(view.contentDOM.querySelectorAll('.cm-md-number')).toHaveLength(0);
      type(view, ' ');
      expect(marked(view)).toBe('- one\n- two\n\n1. ‸');
      expect([...view.contentDOM.querySelectorAll('.cm-md-number')].map((element) => element.textContent)).toEqual(['1.']);
      expect(rows(view)).toBe(3);
      const bullet = mount('1. one\n2. two\n‸', page);
      type(bullet, '- ');
      expect(marked(bullet)).toBe('1. one\n2. two\n\n- ‸');
      expect(bullet.contentDOM.querySelectorAll('.cm-md-list-cont')).toHaveLength(0);
      expect(bullet.contentDOM.querySelectorAll('.cm-md-list-marker')).toHaveLength(3);
      // A list of the same kind goes on, and a nested one of the same kind needs nothing.
      const same = mount('1. one\n2. two\n‸', page);
      type(same, '1. ');
      expect(marked(same)).toBe('1. one\n2. two\n3. ‸');
      const nested = mount('- one\n  - ‸x', page);
      press(nested, 'Backspace');
      expect(nested.state.doc.toString()).toBe('- one\n  x');
    });

    it('shows "1." as typed until its space makes it a number', () => {
      const markers = (view: EditorView) => view.contentDOM.querySelectorAll('.cm-md-list-marker').length;
      const view = mount('‸', page);
      type(view, '1.');
      expect(marked(view)).toBe('1.‸');
      expect(markers(view)).toBe(0);
      type(view, ' ');
      expect(marked(view)).toBe('1. ‸');
      expect(markers(view)).toBe(1);
      // On the line under an empty row the same, and the row stays.
      const under = mount('Text\n\n‸', page);
      type(under, '1.');
      expect(marked(under)).toBe('Text\n\n1.‸');
      expect(markers(under)).toBe(0);
      expect(rows(under)).toBe(3);
      type(under, ' ');
      expect(markers(under)).toBe(1);
      expect(rows(under)).toBe(3);
    });

    it('redoes an edit that kept its rows as one step', () => {
      const view = mount('Text\n\n- ‸a\n- b', page);
      press(view, 'Backspace');
      undo(view);
      redo(view);
      expect(view.state.doc.toString()).toBe('Text\na\n\n- b');
      expect(caretShown(view)).toBe(true);
    });

    it('keeps a blank line between text that leaves a list and a rule under it, so the rule never underlines the text', () => {
      const headings = (view: EditorView) => view.contentDOM.querySelectorAll('.cm-md-heading').length;
      const view = mount('- a\n- ‸b\n\n---\n\nText', page);
      press(view, 'Backspace');
      press(view, 'Backspace');
      expect(marked(view)).toBe('- a\n\n‸b\n\n---\n\nText');
      expect(headings(view)).toBe(0);
      press(view, 'Backspace');
      expect(marked(view)).toBe('- a‸b\n\n---\n\nText');
      expect(headings(view)).toBe(0);
      const button = mount('- a\n- b‸\n\n---\n\nText', page);
      toggleList('bullet')(button);
      expect(marked(button)).toBe('- a\n\nb‸\n\n---\n\nText');
      expect(headings(button)).toBe(0);
      // The blank line over the item still goes, so the text stays under the paragraph above.
      const first = mount('Top\n\n- ‸a\n\n---\n\nText', page);
      press(first, 'Backspace');
      expect(marked(first)).toBe('Top\n‸a\n\n---\n\nText');
      expect(headings(first)).toBe(0);
      const between = mount('---\n\n- ‸a\n\n---', page);
      press(between, 'Backspace');
      expect(marked(between)).toBe('---\n‸a\n\n---');
      const equals = mount('- a\n- ‸b\n\n===\n\nText', page);
      press(equals, 'Backspace');
      press(equals, 'Backspace');
      expect(marked(equals)).toBe('- a\n\n‸b\n\n===\n\nText');
      expect(headings(equals)).toBe(0);
    });

    it('keeps the empty row between a quote and a list under it when the item leaves the list', () => {
      const view = mount('> quote\n\n- ‸', page);
      expect(rows(view)).toBe(3);
      press(view, 'Enter');
      expect(marked(view)).toBe('> quote\n\n‸');
      expect(rows(view)).toBe(3);
      type(view, 'x');
      expect(marked(view)).toBe('> quote\n\nx‸');
      const back = mount('> quote\n\n- ‸a', page);
      press(back, 'Backspace');
      expect(marked(back)).toBe('> quote\n\n‸a');
      expect(rows(back)).toBe(3);
      const button = mount('> quote\n\n- a‸', page);
      toggleList('bullet')(button);
      expect(marked(button)).toBe('> quote\n\na‸');
    });

    it('selects past a first item\'s marker with Shift+Right from the end of the line over the list', () => {
      const selectRight = (view: EditorView) => press(view, 'ArrowRight', { shiftKey: true });
      const view = mount('Top‸\n\n- a\n- b', page);
      selectRight(view);
      press(view, 'Backspace');
      expect(marked(view)).toBe('Top‸a\n\n- b');
      const numbered = mount('Top‸\n\n1. a\n2. b', page);
      selectRight(numbered);
      press(numbered, 'Delete');
      expect(marked(numbered)).toBe('Top‸a\n\n1. b');
      // A letter typed over the selection takes its place.
      const typed = mount('Top‸\n\n- a\n- b', page);
      selectRight(typed);
      const { from, to } = typed.state.selection.main;
      typed.dispatch(typed.state.update({ changes: { from, to, insert: 'x' }, selection: { anchor: from + 1 }, userEvent: 'input.type' }));
      expect(marked(typed)).toBe('Topx‸a\n\n- b');
      // Shift+Left from the start of the item's text selects back to the end of the line over the list.
      const back = mount('Top\n\n- ‸a', page);
      press(back, 'ArrowLeft', { shiftKey: true });
      expect([back.state.selection.main.from, back.state.selection.main.to]).toEqual([3, 7]);
    });

    it('copies the first item\'s marker with a selection from the start of its text to a later line', () => {
      const view = mountSelected('- «a\n- b»\n\n', page);
      const list = copied(view);
      expect(list).toBe('- a\n- b');
      caretToEnd(view);
      pasteText(view, list);
      expect(marked(view)).toBe('- a\n- b\n\n- a\n- b‸');
      const onItem = mountSelected('- «a\n- b»\n- ', page);
      const text = copied(onItem);
      caretToEnd(onItem);
      pasteText(onItem, text);
      expect(marked(onItem)).toBe('- a\n- b\n- a\n- b‸');
      const numbered = mountSelected('1. «a\n2. b»\n\nPara\n\n', page);
      expect(copied(numbered)).toBe('1. a\n2. b');
      // A nested item takes its indent too, so the copied items stay siblings.
      const nested = mountSelected('- p\n  - «b\n  - c»\n- ', page);
      const both = copied(nested);
      expect(both).toBe('  - b\n  - c');
      caretToEnd(nested);
      pasteText(nested, both);
      expect(marked(nested)).toBe('- p\n  - b\n  - c\n  - b\n  - c‸');
      // A selection inside one item copies only its text.
      expect(copied(mountSelected('- «a»b', page))).toBe('a');
    });

    it('pastes plain lines over a selection that runs across items as items, with the caret after them', () => {
      const view = mountSelected('- o«ne\n- tw»o', page);
      pasteText(view, 'X\nY');
      expect(marked(view)).toBe('- oX\n- Y‸o');
      const three = mountSelected('- a«b\n- c»d\n\nPara', page);
      pasteText(three, 'X\nY\nZ');
      expect(marked(three)).toBe('- aX\n- Y\n- Z‸d\n\nPara');
      const list = mountSelected('- o«ne\n- tw»o\n- three', page);
      pasteText(list, '- X\n- Y');
      expect(marked(list)).toBe('- oX\n- Y‸o\n- three');
    });

    it('takes an empty row over a list with one Delete, with the caret then at the start of the item\'s text', () => {
      const view = mount('Text\n‸\n\n- a', page);
      expect(rows(view)).toBe(3);
      press(view, 'Delete');
      expect(marked(view)).toBe('Text\n\n- ‸a');
      expect(rows(view)).toBe(2);
      type(view, 'x');
      expect(marked(view)).toBe('Text\n\n- x‸a');
      // At the top of the page, and between two lists, the blank line that would then show goes too.
      const top = mount('‸\n\n- a\n- b', page);
      press(top, 'Delete');
      expect(marked(top)).toBe('- ‸a\n- b');
      const between = mount('- a\n\n‸\n\n- b', page);
      press(between, 'Delete');
      expect(marked(between)).toBe('- a\n\n- ‸b');
      expect(rows(between)).toBe(2);
      // With no list under it, the empty line goes and the caret stays where it was.
      const plain = mount('Text\n‸\nPara', page);
      press(plain, 'Delete');
      expect(marked(plain)).toBe('Text\n‸Para');
    });

    it('puts the caret back on the empty row when an item ended by a key is redone', async () => {
      for (const key of ['Enter', 'Backspace']) {
        const view = mount('- a\n- ‸\n\nPara', page);
        press(view, key);
        expect(marked(view)).toBe('- a\n\n‸\nPara');
        undo(view);
        redo(view);
        // The caret is moved after the redo, in a microtask.
        await Promise.resolve();
        expect(marked(view)).toBe('- a\n\n‸\nPara');
        type(view, 'x');
        expect(marked(view)).toBe('- a\n\nx‸\nPara');
      }
    });

    it('keeps an emptied item\'s row when Enter ends it one empty row under the list above', () => {
      const view = mount('- a\n- b\n\n\n- ‸\n- d', page);
      expect(rows(view)).toBe(5);
      press(view, 'Enter');
      expect(marked(view)).toBe('- a\n- b\n\n\n‸\n\n- d');
      expect(rows(view)).toBe(5);
      type(view, 'x');
      expect(marked(view)).toBe('- a\n- b\n\n\nx‸\n\n- d');
      expect(rows(view)).toBe(5);
      // The list under it counts on from the one above, as Markdown reads them.
      const numbered = mount('1. a\n2. b\n\n\n1. ‸\n2. d', page);
      press(numbered, 'Enter');
      expect(marked(numbered)).toBe('1. a\n2. b\n\n\n‸\n\n3. d');
      expect(rows(numbered)).toBe(5);
    });

    it('makes a box of "[] " typed in front of text, as "- " makes a bullet', () => {
      const boxes = (view: EditorView) => view.contentDOM.querySelectorAll('.cm-md-task').length;
      const view = mount('‸milk', page);
      type(view, '[] ');
      expect(marked(view)).toBe('- [ ] ‸milk');
      expect(boxes(view)).toBe(1);
      // With a paragraph right under it, that paragraph keeps its own line.
      const between = mount('- a\n\n‸Para\nMore', page);
      type(between, '[] ');
      expect(marked(between)).toBe('- a\n- [ ] ‸Para\n\nMore');
      expect(boxes(between)).toBe(1);
      expect(rows(between)).toBe(3);
    });

    it('keeps a marker typed with no space after it, and starts a plain line under it on Enter', () => {
      for (const typed of ['1.', '1)', '-', '*']) {
        const view = mount('‸', page);
        type(view, typed);
        press(view, 'Enter');
        type(view, 'x');
        expect(marked(view)).toBe(`${typed}\nx‸`);
        expect(rows(view)).toBe(2);
      }
      const under = mount('Text\n‸', page);
      type(under, '1.');
      press(under, 'Enter');
      type(under, 'x');
      expect(marked(under)).toBe('Text\n1.\nx‸');
      expect(rows(under)).toBe(3);
      // An empty item, with its space, still ends its list.
      const item = mount('1. one\n2. ‸', page);
      press(item, 'Enter');
      expect(marked(item)).toBe('1. one\n\n‸');
    });

    it('shows "1. " or "* " typed on an empty line under a paragraph as typed again with one Backspace, as "- ", with no row opened', () => {
      for (const typed of ['1. ', '1) ', '* ', '- ']) {
        const view = mount('Text\n‸\nBelow', page);
        type(view, typed);
        expect(rows(view)).toBe(3);
        press(view, 'Backspace');
        expect(rows(view)).toBe(3);
        expect(view.contentDOM.querySelectorAll('.cm-md-list-marker')).toHaveLength(0);
        type(view, 'x');
        expect(rows(view)).toBe(3);
        expect(view.state.doc.toString()).toBe(`Text\n${typed.replace(/([-*.)]) $/, '\\$1 ')}x\nBelow`);
      }
    });
  });
}
