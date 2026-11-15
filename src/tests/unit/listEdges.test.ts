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

    it('redoes an edit that kept its rows as one step', () => {
      const view = mount('Text\n\n- ‸a\n- b', page);
      press(view, 'Backspace');
      undo(view);
      redo(view);
      expect(view.state.doc.toString()).toBe('Text\na\n\n- b');
      expect(caretShown(view)).toBe(true);
    });
  });
}
