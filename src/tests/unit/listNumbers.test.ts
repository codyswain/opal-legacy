import { afterEach, describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { pasteSpec } from '@/renderer/features/disk-explorer/components/editor/clipboard';
import { editingSetup, markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { setHeading, toggleList } from '@/renderer/features/disk-explorer/components/editor/formatCommands';
import { followLinkClicks } from '@/renderer/features/disk-explorer/components/editor/linkEditorEffect';
import { levelNumeral } from '@/renderer/features/disk-explorer/components/editor/listNumbers';
import { docMode } from '@/renderer/features/disk-explorer/components/editor/livePreview';

/*
 * Lists as a word processor keeps them: numbers that count for themselves,
 * Backspace at an item's start, the keys, and paste into a list. Each test
 * runs in a document (.mdo) and, where it says so, in a note (.md), which
 * is edited the same way.
 */

const DOC = '/Vault/Notes/Plan.mdo';
const NOTE = '/Vault/Notes/Plan.md';
const MOD: KeyboardEventInit = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

let views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
});

/** A page with the caret at "‸", or a selection between two of them. */
function mount(marked: string, page = DOC) {
  const at = marked.indexOf('‸');
  const end = marked.indexOf('‸', at + 1);
  const doc = marked.replace(/‸/g, '');
  const selection = end === -1 ? { anchor: at } : { anchor: at, head: end - 1 };
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection, extensions: markdownEditorExtensions(page) }) });
  views.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();
/** The page with the caret marked. */
const marked = (view: EditorView) => {
  const { head } = view.state.selection.main;
  return `${text(view).slice(0, head)}‸${text(view).slice(head)}`;
};
const press = (view: EditorView, key: string, init: KeyboardEventInit = {}) => runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...init }), 'editor');

function after(page: string, key: string, init: KeyboardEventInit = {}, file = DOC): string {
  const view = mount(page, file);
  press(view, key, init);
  return text(view);
}

const numbers = (view: EditorView) => [...view.contentDOM.querySelectorAll('.cm-md-number')].map((element) => element.textContent);

describe('how a page is edited', () => {
  it('edits a note as a document, with clicks on links still followed, and leaves log pages plain', () => {
    expect(editingSetup(DOC)).toBe('document');
    expect(editingSetup(NOTE)).toBe('note');
    expect(editingSetup('/Vault/Library/logs/2031-03-04 log.md')).toBe('plain');
    const note = mount('a [link](https://example.com)‸', NOTE);
    expect(note.state.facet(docMode)).toBe(true);
    expect(note.state.facet(followLinkClicks)).toBe(true);
    expect(mount('a‸').state.facet(followLinkClicks)).toBe(false);
  });
});

describe('numbers that count for themselves', () => {
  for (const [name, file] of [['a document', DOC], ['a note', NOTE]] as const) {
    it(`renumbers the items below a new one, in ${name}`, () => {
      expect(after('1. one‸\n2. two\n3. three\n', 'Enter', {}, file)).toBe('1. one\n2. \n3. two\n4. three\n');
    });
  }

  it('renumbers when an item is deleted, and keeps the number a list starts at', () => {
    const view = mount('5. one\n‸6. two\n‸7. three\n8. four\n');
    view.dispatch({ ...view.state.replaceSelection(''), userEvent: 'delete.selection' });
    expect(text(view)).toBe('5. one\n6. three\n7. four\n');
  });

  it('renumbers both lists when Tab nests an item and Shift+Tab moves one out', () => {
    expect(after('1. one\n2. ‸two\n3. three\n', 'Tab')).toBe('1. one\n   1. two\n2. three\n');
    expect(after('1. one\n   1. ‸two\n   2. deep\n2. three\n', 'Tab', { shiftKey: true })).toBe('1. one\n2. two\n   1. deep\n3. three\n');
  });

  it('goes on counting after an item in the middle becomes plain text', () => {
    const view = mount('1. one\n2. tw‸o\n3. three\n');
    toggleList('number')(view);
    expect(text(view)).toBe('1. one\n\ntwo\n\n2. three\n');
    // Ending the list on an empty item in its middle counts on in the same way.
    expect(after('1. one\n2. ‸\n3. three\n', 'Enter')).toBe('1. one\n\n\n\n2. three\n');
  });

  it('turns the whole list at that level into the new kind when one item is given another kind', () => {
    const numbers = mount('1. one\n2. tw‸o\n   - kid\n3. three\n');
    toggleList('bullet')(numbers);
    // The item with a nested list keeps its text column, so the nested list stays under it.
    expect(text(numbers)).toBe('- one\n-  two\n   - kid\n- three\n');
    const bullets = mount('- one\n- tw‸o\n- three\n');
    toggleList('number')(bullets);
    expect(text(bullets)).toBe('1. one\n2. two\n3. three\n');
    // Only the items of the kind it had: a box beside a bullet keeps its box.
    const mixed = mount('- one\n- [x] done\n- tw‸o\n');
    toggleList('task')(mixed);
    expect(text(mixed)).toBe('- [ ] one\n- [x] done\n- [ ] two\n');
    // The same kind again takes only that item out of the list.
    const off = mount('- one\n- tw‸o\n- three\n');
    toggleList('bullet')(off);
    expect(text(off)).toBe('- one\n\ntwo\n\n- three\n');
  });

  it('numbers a nested bullet turned into a number from 1', () => {
    const view = mount('1. one\n   - tw‸o\n2. three\n');
    toggleList('number')(view);
    expect(text(view)).toBe('1. one\n   1. two\n2. three\n');
  });

  it('changes no number for typing in an item, so a list written 1., 1., 1. stays as written', () => {
    const view = mount('1. a\n1. b‸\n1. c\n');
    view.dispatch({ changes: { from: 9, insert: 'x' }, selection: { anchor: 10 }, userEvent: 'input.type' });
    expect(text(view)).toBe('1. a\n1. bx\n1. c\n');
  });

  it('leaves text that arrives from the disk, and edits that are not the person\'s, as written', () => {
    const view = mount('1. a\n2. b\n‸');
    view.dispatch({ changes: { from: 5, insert: '7. new\n' }, annotations: Transaction.remote.of(true) });
    expect(text(view)).toBe('1. a\n7. new\n2. b\n');
    view.dispatch({ changes: { from: 0, insert: '9. top\n' } });
    expect(text(view)).toBe('9. top\n1. a\n7. new\n2. b\n');
  });

  it('takes an edit and its numbers back in one undo', () => {
    const view = mount('1. one‸\n2. two\n3. three\n');
    press(view, 'Enter');
    expect(text(view)).toBe('1. one\n2. \n3. two\n4. three\n');
    undo(view);
    expect(text(view)).toBe('1. one\n2. two\n3. three\n');
  });

  it('renumbers when Ctrl+Shift+Up moves an item', () => {
    expect(after('1. one\n2. tw‸o\n3. three\n', 'ArrowUp', { ctrlKey: true, shiftKey: true })).toBe('1. two\n2. one\n3. three\n');
    expect(after('- on‸e\n- two\n', 'ArrowDown', { ctrlKey: true, shiftKey: true })).toBe('- two\n- one\n');
  });

  it('draws nested levels as 1, a, i and round again, while the file keeps digits', () => {
    expect([levelNumeral(3, 0), levelNumeral(1, 1), levelNumeral(27, 1), levelNumeral(4, 2), levelNumeral(9, 2), levelNumeral(3, 3)]).toEqual(['3', 'a', 'aa', 'iv', 'ix', '3']);
    const view = mount('1. one\n   1. two\n   2. more\n      1. three\n2. four\n‸');
    expect(numbers(view)).toEqual(['1.', 'a.', 'b.', 'i.', '2.']);
    expect(text(view)).toBe('1. one\n   1. two\n   2. more\n      1. three\n2. four\n');
  });
});

describe('Enter and Backspace at an item\'s start', () => {
  it('keeps the bullet on the empty item Enter leaves above', () => {
    const view = mount('- one\n- ‸two\n');
    press(view, 'Enter');
    expect(text(view)).toBe('- one\n- \n- two\n');
    expect(view.contentDOM.querySelectorAll('.cm-md-bullet')).toHaveLength(3);
    expect(after('1. one\n2. ‸two\n', 'Enter')).toBe('1. one\n2. \n3. two\n');
  });

  it('takes the marker off and keeps the text in place, then moves it to the margin, then joins it to the item', () => {
    const view = mount('- one\n- ‸two\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('- one\n  ‸two\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('- one\n\n‸two\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('- one‸two\n');
  });

  it('takes an empty item away in the same three steps', () => {
    const view = mount('- one\n- ‸\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('- one\n  ‸\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('- one\n\n‸\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('- one‸\n');
  });

  it('keeps the list below a list, and counting on, when a numbered item goes out to the margin', () => {
    const view = mount('1. one\n2. ‸two\n3. three\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('1. one\n   ‸two\n2. three\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('1. one\n\n‸two\n\n2. three\n');
    press(view, 'Backspace');
    expect(marked(view)).toBe('1. one‸two\n2. three\n');
  });

  it('joins a paragraph one blank line under a list to the list\'s last item, and leaves other paragraphs alone', () => {
    expect(after('- one\n\n‸after\n', 'Backspace')).toBe('- oneafter\n');
    expect(after('para\n\n‸after\n', 'Backspace')).toBe('para\nafter\n');
  });

  it('does the same for numbers, which renumber, for boxes, and in a note', () => {
    expect(after('1. one\n2. ‸two\n3. three\n', 'Backspace')).toBe('1. one\n   two\n2. three\n');
    expect(after('- [ ] one\n- [ ] ‸two\n', 'Backspace')).toBe('- [ ] one\n  two\n');
    expect(after('- one\n- ‸two\n', 'Backspace', {}, NOTE)).toBe('- one\n  two\n');
  });

  it('keeps the text the item\'s own under an item that ends in a nested list, and a nested first item under its parent', () => {
    expect(after('- one\n  - kid\n- ‸two\n', 'Backspace')).toBe('- one\n  - kid\n\n  two\n');
    expect(after('- one\n  - ‸kid\n', 'Backspace')).toBe('- one\n  kid\n');
  });

  it('leaves the first item of a list to become a paragraph, as before', () => {
    expect(after('- ‸one\n- two\n', 'Backspace')).not.toContain('- one');
  });
});

describe('a word processor\'s keys', () => {
  it('ticks a box on Cmd+Option+Enter', () => {
    expect(after('- [ ] on‸e\n', 'Enter', { ...MOD, altKey: true })).toBe('- [x] one\n');
  });

  it('clears formatting on Cmd+\\ and leaves Cmd+Shift+\\ to the menu', () => {
    expect(after('a ‸**word**‸ b\n', '\\', MOD)).toBe('a word b\n');
    const view = mount('a ‸**word**‸ b\n');
    expect(press(view, '\\', { ...MOD, shiftKey: true })).toBe(false);
    expect(text(view)).toBe('a **word** b\n');
  });

  it('does nothing on Cmd+U, since Markdown has no underline', () => {
    const view = mount('a ‸word‸ b\n');
    expect(press(view, 'u', MOD)).toBe(true);
    expect(text(view)).toBe('a word b\n');
    expect(view.state.selection.main.empty).toBe(false);
  });

  it('grows the selection by a paragraph on Option+Shift+Down and Up, a list item\'s marker left out', () => {
    const view = mount('- ‸one\n- two\n');
    press(view, 'ArrowDown', { altKey: true, shiftKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('one');
    press(view, 'ArrowDown', { altKey: true, shiftKey: true });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('one\n- two');
    const up = mount('- one\n- two‸\n');
    press(up, 'ArrowUp', { altKey: true, shiftKey: true });
    expect(up.state.sliceDoc(up.state.selection.main.from, up.state.selection.main.to)).toBe('two');
  });
});

describe('paste into a list', () => {
  const pasted = (page: string, clip: string, file = DOC) => {
    const view = mount(page, file);
    const spec = pasteSpec(view.state, clip, false);
    if (spec) view.dispatch(spec);
    return spec ? marked(view) : null;
  };

  it('makes each pasted line after the first an item of its own', () => {
    expect(pasted('- one‸\n', 'two\nthree')).toBe('- onetwo\n- three‸\n');
    expect(pasted('1. one\n2. ‸\n3. end\n', 'a\n\nb\nc\n')).toBe('1. one\n2. a\n3. b\n4. c‸\n5. end\n');
    expect(pasted('- [x] one‸\n', 'two\nthree', NOTE)).toBe('- [x] onetwo\n- [ ] three‸\n');
    expect(pasted('  - de‸ep\n', 'x\ny')).toBe('  - dex\n  - y‸ep\n');
  });

  it('leaves lines that are Markdown blocks, and one line, to the usual paste', () => {
    expect(pasted('- one‸\n', 'two\n## Heading')).toBeNull();
    expect(pasted('- one‸\n', 'two\n    code')).toBeNull();
    expect(pasted('- one‸\n', 'two')).toBeNull();
    expect(pasted('para‸\n', 'two\nthree')).toBeNull();
  });

  it('pastes whole items above an item at its start, below it at its end, and renumbers', () => {
    expect(pasted('1. ‸one\n2. two\n', '3. three\n')).toBe('1. three\n2. ‸one\n3. two\n');
    expect(pasted('1. one‸\n2. two\n', '7. x\n8. y')).toBe('1. one\n2. x\n3. y‸\n4. two\n');
    expect(pasted('- one\n- ‸\n', '- a\n  - b\n')).toBe('- one\n- a\n  - b‸\n');
  });
});

describe('what the fresh review found', () => {
  /** Types `typed` at the caret, one key at a time, through the page's own input handlers. */
  function type(view: EditorView, typed: string) {
    for (const character of typed) {
      const at = view.state.selection.main.head;
      const insert = () => view.state.update({ changes: { from: at, insert: character }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
      if (!view.state.facet(EditorView.inputHandler).some((handler) => handler(view, at, at, character, insert))) view.dispatch(insert());
    }
  }

  it('keeps the line under a typed bullet or number a paragraph, with a blank line the first undo takes back', () => {
    for (const typed of ['- ', '1. ']) {
      const view = mount('Alpha\n‸Beta\nGamma\n');
      type(view, typed);
      expect(text(view)).toBe(`Alpha\n${typed}Beta\n\nGamma\n`);
      undo(view);
      expect(text(view).endsWith('Beta\nGamma\n')).toBe(true);
    }
    // A box started on an empty line over text: the text typed into it later never takes that line in.
    const box = mount('Alpha\n\n‸\nGamma\n');
    type(box, '[] x');
    expect(text(box)).toBe('Alpha\n\n- [ ] x\n\nGamma\n');
    // Nothing is added over a blank line, another item or a heading.
    for (const below of ['', '- next', '## Head']) {
      const view = mount(`‸Beta\n${below}\n`);
      type(view, '- ');
      expect(text(view)).toBe(`- Beta\n${below}\n`);
    }
  });

  it('keeps nested lines inside an item whose number grows a digit', () => {
    const items = Array.from({ length: 9 }, (_, index) => `${index + 1}. item`);
    const view = mount(`${items[0]}‸\n${items.slice(1).join('\n')}\n   - kid\n     - deep\n\n   more\n`);
    press(view, 'Enter');
    expect(text(view).endsWith('9. item\n10. item\n    - kid\n      - deep\n\n    more\n')).toBe(true);
    // Back to nine and up to ten again: the lines already reach, so nothing more is added.
    undo(view);
    press(view, 'Enter');
    expect(text(view).endsWith('10. item\n    - kid\n      - deep\n\n    more\n')).toBe(true);
    expect(after('98. a‸\n99. b\n    - kid\n', 'Enter')).toBe('98. a\n99. \n100. b\n     - kid\n');
  });

  it('keeps nested lines inside items when bullets become numbers', () => {
    const bullets = Array.from({ length: 10 }, (_, index) => `- item ${index + 1}`);
    const view = mount(`‸${bullets.join('\n')}‸\n  - kid\n`);
    toggleList('number')(view);
    expect(text(view).endsWith('9. item 9\n10. item 10\n    - kid\n')).toBe(true);
    const first = mount('- one\n  - kid\n- tw‸o\n');
    toggleList('number')(first);
    expect(text(first)).toBe('1. one\n   - kid\n2. two\n');
  });

  it('leaves a list as written when the edit is on the line next to it', () => {
    const under = mount('1. a\n1. b\n1. c\n‸');
    type(under, '-');
    expect(text(under)).toBe('1. a\n1. b\n1. c\n-');
    expect(after('intro‸\n1. a\n1. b\n1. c\n', 'Enter')).toBe('intro\n\n1. a\n1. b\n1. c\n');
    expect(after('1. a\n2. b‸\n1) x\n5) y\n', 'Enter')).toBe('1. a\n2. b\n3. \n1) x\n5) y\n');
  });

  it('takes a box off in the same three steps, and the blank line under the text goes when it joins', () => {
    const boxes = mount('- [ ] one\n- [ ] ‸two\n');
    press(boxes, 'Backspace');
    press(boxes, 'Backspace');
    expect(marked(boxes)).toBe('- [ ] one\n\n‸two\n');
    const middle = mount('- one\n- ‸two\n- three\n');
    press(middle, 'Backspace');
    press(middle, 'Backspace');
    press(middle, 'Backspace');
    expect(marked(middle)).toBe('- one‸two\n- three\n');
  });

  it('never joins text to a table, a formula or HTML that ends the item above', () => {
    for (const block of ['  | a | b |\n  |---|---|\n  | 1 | 2 |', '  <div>x</div>']) {
      const doc = `- one\n\n${block}\n\n‸Para\n`;
      const view = mount(doc);
      press(view, 'Backspace');
      expect(text(view)).toContain(`${block}\n`);
      expect(text(view)).toContain('Para');
      expect(text(view)).not.toContain('|Para');
      expect(text(view)).not.toContain('</div>Para');
    }
  });

  it('pulls the paragraph under a list up on Delete at the list\'s end', () => {
    const view = mount('- one‸\n\nPara\n');
    press(view, 'Delete');
    expect(marked(view)).toBe('- one‸Para\n');
    // A list with a blank line between its items is left to the usual Delete.
    expect(after('- one‸\n\n- two\n', 'Delete')).toContain('- two');
  });

  it('goes on without a marker on Enter after Backspace took the marker off', () => {
    const view = mount('- one\n  two‸\n- three\n');
    press(view, 'Enter');
    type(view, 'x');
    expect(text(view)).toBe('- one\n  two\n  x\n- three\n');
  });

  it('gives the blank line under a list no room when the list sits right under text, and the caret steps over it', () => {
    const tight = mount('Intro\n- one\n- two\n\nAfter‸\n');
    expect(tight.contentDOM.querySelectorAll('.cm-md-gap-hidden')).toHaveLength(1);
    // Left from the start of "After" lands at the end of "two".
    tight.dispatch({ selection: { anchor: tight.state.doc.toString().indexOf('After') }, userEvent: 'select' });
    press(tight, 'ArrowLeft');
    expect(marked(tight)).toBe('Intro\n- one\n- two‸\n\nAfter\n');
    // A list with a blank line above it keeps the one below, and a note that is only read keeps every line.
    expect(mount('Intro\n\n- one\n\nAfter‸\n').contentDOM.querySelectorAll('.cm-md-gap-hidden')).toHaveLength(0);
    expect(mount('Intro\n- one\n\n\nAfter‸\n').contentDOM.querySelectorAll('.cm-md-gap-hidden')).toHaveLength(1);
  });

  it('starts a paragraph for a word typed on the empty line right under a list', () => {
    const view = mount('- one\n- two\n‸');
    type(view, 'after');
    expect(text(view)).toBe('- one\n- two\n\nafter');
    // A mark or a number typed there may be the next item, so nothing is added.
    const item = mount('- one\n- two\n‸');
    type(item, '- x');
    expect(text(item)).toBe('- one\n- two\n- x');
  });

  it('carries the list on, with no empty row, for an item typed one blank line under it', () => {
    const view = mount('- one\n- two\n\n‸');
    type(view, '- x');
    expect(text(view)).toBe('- one\n- two\n- x');
    const numbers = mount('1. one\n2. two\n\n‸');
    type(numbers, '1. x');
    expect(text(numbers)).toBe('1. one\n2. two\n3. x');
  });

  it('redoes on Cmd+Y', () => {
    const view = mount('- one\n- ‸two\n');
    press(view, 'Tab');
    undo(view);
    expect(text(view)).toBe('- one\n- two\n');
    press(view, 'y', MOD);
    expect(text(view)).toBe('- one\n  - two\n');
  });

  it('makes a heading in a list item normal text without a blank line', () => {
    const view = mount('- one\n- ## tw‸o\n- three\n');
    setHeading(0)(view);
    expect(text(view)).toBe('- one\n- two\n- three\n');
  });

  it('joins a list pasted inside an item\'s text to that text, each further item its own', () => {
    const view = mount('- on‸e\n');
    const spec = pasteSpec(view.state, '- two\n  - three\n', false);
    expect(spec).not.toBeNull();
    if (spec) view.dispatch(spec);
    expect(marked(view)).toBe('- ontwo\n- three‸e\n');
  });
});
