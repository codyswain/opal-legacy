// The rows of the word-processor parity run (doc-parity-acceptance.mjs).
//
// Each row is one thing a person does and what a word processor does with
// it, written as the Markdown the file should hold afterwards. In `start`
// and `expect`, "‸" is the caret and "«" "»" are the ends of a selection
// (anchor first). `keys` are real key presses: "t:text" types text, and
// anything else is one key or chord. "paste:text", "pasteHtml:html" and
// "cut" / "copy" go through clipboard events with their own data, so the
// system clipboard is never read or written.
//
// `shows`, when set, checks what the page draws: the list markers by line,
// as "kind:label:depth" (label only for numbers), and that no Markdown
// mark is on show.
//
// `rows`, when set, is how many rows the page draws: the blank line Markdown
// needs between a list and text takes no room.
//
// `opal` and `why`, when set, are a difference kept on purpose: what the
// page does instead, and the reason. The run checks that it still holds.
//
// `modes` lists where the row applies: "doc" is a document (.mdo), "note"
// is a note (.md). Default: both.

export const ROWS = [
  // ---- Bulleted lists
  { id: 'B1', area: 'Bullets', does: 'Type "- " on an empty line', start: '‸', keys: ['t:- '], expect: '- ‸', shows: ['bullet::0'] },
  { id: 'B2', area: 'Bullets', does: 'Type "* " on an empty line', start: '‸', keys: ['t:* '], expect: '* ‸', shows: ['bullet::0'] },
  { id: 'B3', area: 'Bullets', does: 'Type "- " on the line under a paragraph', start: 'Text\n‸', keys: ['t:- ', 't:a'], expect: 'Text\n\n- a‸', shows: ['bullet::0'], rows: 2 },
  { id: 'B4', area: 'Bullets', does: 'Type "- " in front of text already on the line', start: '‸milk', keys: ['t:- '], expect: '- ‸milk', shows: ['bullet::0'] },
  { id: 'B5', area: 'Bullets', does: 'Enter at the end of an item', start: '- one‸', keys: ['Enter', 't:two'], expect: '- one\n- two‸', shows: ['bullet::0', 'bullet::0'] },
  { id: 'B6', area: 'Bullets', does: 'Enter in the middle of an item', start: '- on‸e', keys: ['Enter'], expect: '- on\n- ‸e' },
  { id: 'B7', area: 'Bullets', does: 'Enter at the start of an item', start: '- one\n- ‸two', keys: ['Enter'], expect: '- one\n- \n- ‸two' },
  { id: 'B8', area: 'Bullets', does: 'Enter on an empty item at the top level ends the list', start: '- one\n- ‸', keys: ['Enter', 't:after'], expect: '- one\n\nafter‸', rows: 2 },
  { id: 'B9', area: 'Bullets', does: 'Enter on an empty nested item steps out one level', start: '- one\n  - two\n  - ‸', keys: ['Enter'], expect: '- one\n  - two\n- ‸' },
  { id: 'B10', area: 'Bullets', does: 'Enter on an empty item in the middle of a list', start: '- one\n- ‸\n- three', keys: ['Enter'], expect: '- one\n\n‸\n- three' },
  { id: 'B11', area: 'Bullets', does: 'Tab at the start of an item nests it', start: '- one\n- ‸two', keys: ['Tab'], expect: '- one\n  - ‸two', shows: ['bullet::0', 'bullet::1'] },
  { id: 'B12', area: 'Bullets', does: 'Tab with the caret inside an item\'s text types a tab', start: '- one\n- tw‸o', keys: ['Tab'], expect: '- one\n- tw\t‸o', opal: '- one\n  - tw‸o', why: 'Tab nests the item wherever the caret is in it. A word processor nests only from the start of the item and types a tab elsewhere, which Markdown shows as a space.' },
  { id: 'B13', area: 'Bullets', does: 'Tab on two selected items nests both', start: '- one\n- «two\n- thr»ee', keys: ['Tab'], expect: '- one\n  - «two\n  - thr»ee' },
  { id: 'B14', area: 'Bullets', does: 'Tab three levels deep', start: '- one\n  - two\n  - ‸three', keys: ['Tab'], expect: '- one\n  - two\n    - ‸three', shows: ['bullet::0', 'bullet::1', 'bullet::2'] },
  { id: 'B15', area: 'Bullets', does: 'Shift+Tab moves a nested item out', start: '- one\n  - ‸two', keys: ['Shift+Tab'], expect: '- one\n- ‸two' },
  { id: 'B16', area: 'Bullets', does: 'Shift+Tab at the top level does nothing', start: '- one\n- ‸two', keys: ['Shift+Tab'], expect: '- one\n- ‸two' },
  { id: 'B17', area: 'Bullets', does: 'Backspace at the start of an item takes its bullet off and keeps the text in place', start: '- one\n- ‸two', keys: ['Backspace'], expect: '- one\n  ‸two' },
  { id: 'B18', area: 'Bullets', does: 'A second Backspace moves the text out to the margin, with no empty row', start: '- one\n- ‸two', keys: ['Backspace', 'Backspace'], expect: '- one\n\n‸two', rows: 2 },
  { id: 'B18b', area: 'Bullets', does: 'A third Backspace joins the text to the item above', start: '- one\n- ‸two', keys: ['Backspace', 'Backspace', 'Backspace'], expect: '- one‸two' },
  { id: 'B18c', area: 'Bullets', does: 'With an item below, the three Backspaces leave no empty row in the list', start: '- one\n- ‸two\n- three', keys: ['Backspace', 'Backspace', 'Backspace'], expect: '- one‸two\n- three' },
  { id: 'B19', area: 'Bullets', does: 'Backspace on an empty item takes its bullet off and leaves the caret on its own line (a word processor keeps it indented for one more press)', start: '- one\n- ‸', keys: ['Backspace'], expect: '- one\n\n‸', rows: 2 },
  { id: 'B19b', area: 'Bullets', does: 'One more Backspace goes back to the end of the item above', start: '- one\n- ‸', keys: ['Backspace', 'Backspace'], expect: '- one‸' },
  { id: 'B20', area: 'Bullets', does: 'Backspace at the start of the first item makes it a paragraph (a word processor keeps its indent for one more press)', start: '- ‸one\n- two', keys: ['Backspace'], expect: '‸one\n\n- two', alt: ['‸one\n- two'] },
  { id: 'B21', area: 'Bullets', does: 'Delete at the end of an item pulls the next item\'s text up', start: '- one‸\n- two', keys: ['Delete'], expect: '- one‸two' },
  { id: 'B22', area: 'Bullets', does: 'Typing over a selection across two items joins them', start: '- o«ne\n- tw»o', keys: ['t:x'], expect: '- ox‸o' },
  { id: 'B23', area: 'Bullets', does: 'Enter, Tab, text, Enter, Enter, Enter walks in and back out', start: '- one‸', keys: ['Enter', 'Tab', 't:two', 'Enter', 'Enter', 'Enter', 't:end'], expect: '- one\n  - two\n\nend‸' },

  { id: 'B24', area: 'Bullets', does: 'Type "- " in front of a line with text right under it: only that line becomes a bullet', start: 'Alpha\n‸Beta\nGamma', keys: ['t:- '], expect: 'Alpha\n\n- ‸Beta\n\nGamma', shows: ['bullet::0'], rows: 3 },
  { id: 'B25', area: 'Bullets', does: 'Delete at the end of a list pulls the paragraph under it up', start: '- one‸\n\nPara', keys: ['Delete'], expect: '- one‸Para' },
  { id: 'B26', area: 'Bullets', does: 'After Backspace took a bullet off, Enter at the end of that line goes on without a bullet', start: '- one\n- ‸two', keys: ['Backspace', 'Meta+ArrowRight', 'Enter', 't:x'], expect: '- one\n  two\n  x‸', shows: ['bullet::0'] },
  { id: 'B27', area: 'Bullets', does: 'A word typed on the empty line right under a list starts a paragraph, not more of the last item', start: '- one\n- two\n‸', keys: ['t:after'], expect: '- one\n- two\n\nafter‸', shows: ['bullet::0', 'bullet::0'] },
  { id: 'B28', area: 'Bullets', does: 'After a list is ended, typing "- " carries it on with no empty row', start: '- one‸', keys: ['Enter', 'Enter', 't:- x'], expect: '- one\n- x‸', shows: ['bullet::0', 'bullet::0'] },
  { id: 'B29', area: 'Bullets', does: 'End a list that has text under it: the caret gets a line of its own, and what is typed there is a paragraph', start: 'Top\n- a\n- ‸\n\nBottom', keys: ['Enter', 't:mid'], expect: 'Top\n- a\n\nmid‸\nBottom', shows: ['bullet::0'], rows: 4 },
  { id: 'B30', area: 'Bullets', does: 'Text that starts with a digit, typed under a list, is a paragraph too', start: '- one\n‸', keys: ['t:2 apples'], expect: '- one\n\n2 apples‸', shows: ['bullet::0'] },
  { id: 'B31', area: 'Bullets', does: 'Empty the first item of a list that sits under text: it stays an empty bullet with the caret in it', start: 'Groceries:\n- m‸\n- eggs', keys: ['Backspace', 't:tea'], expect: 'Groceries:\n\n- tea‸\n- eggs', shows: ['bullet::0', 'bullet::0'], rows: 3 },
  { id: 'B32', area: 'Bullets', does: 'Cmd+Shift+8 on an empty line between two lines of text, then typing: the text lands in the bullet', start: 'Top\n‸\nBottom', keys: ['Meta+Shift+8', 't:a'], expect: 'Top\n\n- a‸\n\nBottom', shows: ['bullet::0'], rows: 3 },
  { id: 'B33', area: 'Bullets', does: 'Backspace joins a paragraph to the list above it, and the line under it stays a paragraph', start: '- a\n- b\n\n‸mid\nBottom', keys: ['Backspace'], expect: '- a\n- b‸mid\n\nBottom', rows: 3 },

  // ---- Numbered lists
  { id: 'N1', area: 'Numbers', does: 'Type "1. " on an empty line', start: '‸', keys: ['t:1. '], expect: '1. ‸', shows: ['number:1.:0'] },
  { id: 'N2', area: 'Numbers', does: 'Type "1) " on an empty line', start: '‸', keys: ['t:1) '], expect: '1) ‸', shows: ['number:1):0'] },
  { id: 'N3', area: 'Numbers', does: 'Enter at the end of an item numbers the next', start: '1. one‸', keys: ['Enter', 't:two'], expect: '1. one\n2. two‸', shows: ['number:1.:0', 'number:2.:0'] },
  { id: 'N4', area: 'Numbers', does: 'Enter in the middle of a list renumbers the items below', start: '1. one‸\n2. two\n3. three', keys: ['Enter', 't:new'], expect: '1. one\n2. new‸\n3. two\n4. three', shows: ['number:1.:0', 'number:2.:0', 'number:3.:0', 'number:4.:0'] },
  { id: 'N5', area: 'Numbers', does: 'Deleting an item renumbers the items below', start: '1. one\n«2. two\n»3. three\n4. four', keys: ['Backspace'], expect: '1. one\n‸2. three\n3. four', alt: ['1. one\n2. ‸three\n3. four'], shows: ['number:1.:0', 'number:2.:0', 'number:3.:0'] },
  { id: 'N6', area: 'Numbers', does: 'Backspace at the start of an item takes its number off, and the rest renumber', start: '1. one\n2. ‸two\n3. three', keys: ['Backspace'], expect: '1. one\n   ‸two\n2. three', shows: ['number:1.:0', 'number:2.:0'] },
  { id: 'N7', area: 'Numbers', does: 'Tab nests an item and both lists renumber', start: '1. one\n2. ‸two\n3. three', keys: ['Tab'], expect: '1. one\n   1. ‸two\n2. three', shows: ['number:1.:0', 'number:a.:1', 'number:2.:0'] },
  { id: 'N8', area: 'Numbers', does: 'Shift+Tab moves an item out and both lists renumber', start: '1. one\n   1. ‸two\n   2. deep\n2. three', keys: ['Shift+Tab'], expect: '1. one\n2. ‸two\n   1. deep\n3. three', alt: ['1. one\n2. ‸two\n   2. deep\n3. three'] },
  { id: 'N9', area: 'Numbers', does: 'Nested levels count 1, a, i', start: '1. one\n   1. two\n      1. ‸three', keys: [], expect: '1. one\n   1. two\n      1. ‸three', shows: ['number:1.:0', 'number:a.:1', 'number:i.:2'] },
  { id: 'N10', area: 'Numbers', does: 'Enter on an empty item ends the list, and the items below carry on counting', start: '1. one\n2. ‸\n3. three', keys: ['Enter'], expect: '1. one\n\n‸\n\n2. three' },
  { id: 'N11', area: 'Numbers', does: 'Moving an item up with cut and paste renumbers', start: '1. one\n2. two\n«3. three\n»', keys: ['cut', 'caret:0', 'paste'], expect: '1. three\n‸2. one\n3. two\n', alt: ['1. three\n2. ‸one\n3. two\n'] },
  { id: 'N12', area: 'Numbers', does: 'Typing "3. " on an empty line stays text: only "1. " starts a list', start: '‸', keys: ['t:3. x'], expect: '3\\. x‸' },
  { id: 'N13', area: 'Numbers', does: 'A decimal at a line start stays text', start: '‸', keys: ['t:3.14 is pi'], expect: '3.14 is pi‸', shows: [] },
  { id: 'N14', area: 'Numbers', does: 'Undo after Enter in the middle of a list is one step', start: '1. one‸\n2. two\n3. three', keys: ['Enter', 'Meta+z'], expect: '1. one‸\n2. two\n3. three' },
  { id: 'N15', area: 'Numbers', does: 'A list that reaches 10 keeps its text in line', start: '8. eight\n9. nine‸', keys: ['Enter', 't:ten'], expect: '8. eight\n9. nine\n10. ten‸', shows: ['number:8.:0', 'number:9.:0', 'number:10.:0'] },

  { id: 'N16', area: 'Numbers', does: 'A list that grows from 9 to 10 keeps the nested item under item 10', start: '1. a‸\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n   - kid', keys: ['Enter'], expect: '1. a\n2. ‸\n3. b\n4. c\n5. d\n6. e\n7. f\n8. g\n9. h\n10. i\n    - kid', shows: ['number:1.:0', 'number:2.:0', 'number:3.:0', 'number:4.:0', 'number:5.:0', 'number:6.:0', 'number:7.:0', 'number:8.:0', 'number:9.:0', 'number:10.:0', 'bullet::1'] },
  { id: 'N17', area: 'Numbers', does: 'Typing next to a list written 1., 1., 1. leaves its numbers as written', start: '1. a\n1. b\n\n‸', keys: ['t:- x'], expect: '1. a\n1. b\n\n- x‸', rows: 3 },
  { id: 'N18', area: 'Numbers', does: 'Delete the first item of a numbered list that sits under a line of text: the list counts from 1 again', start: 'Steps:\n«1. one\n»2. two\n3. three', keys: ['Backspace'], expect: 'Steps:\n\n‸1. two\n2. three', alt: ['Steps:\n\n1. ‸two\n2. three'], shows: ['number:1.:0', 'number:2.:0'] },
  { id: 'N19', area: 'Numbers', does: 'Ctrl+Shift+Up on the second item of such a list keeps it a list', start: 'Steps:\n1. one\n2. tw‸o\n3. three', keys: ['Control+Shift+ArrowUp'], expect: 'Steps:\n\n1. tw‸o\n2. one\n3. three', shows: ['number:1.:0', 'number:2.:0', 'number:3.:0'] },
  { id: 'N20', area: 'Numbers', does: 'Enter at the start of the first item of a numbered list under text: an empty item 1 above it', start: 'Steps:\n1. ‸one\n2. two', keys: ['Enter'], expect: 'Steps:\n\n1. \n2. ‸one\n3. two', shows: ['number:1.:0', 'number:2.:0', 'number:3.:0'] },

  // ---- Checklists
  { id: 'C1', area: 'Checklists', does: 'Type "[] " on an empty line', start: '‸', keys: ['t:[] '], expect: '- [ ] ‸', shows: ['task::0'] },
  { id: 'C2', area: 'Checklists', does: 'Cmd+Shift+9 makes the line a checklist item', start: 'milk‸', keys: ['Meta+Shift+9'], expect: '- [ ] milk‸', shows: ['task::0'] },
  { id: 'C3', area: 'Checklists', does: 'Enter carries on with an empty box', start: '- [x] one‸', keys: ['Enter', 't:two'], expect: '- [x] one\n- [ ] two‸' },
  { id: 'C4', area: 'Checklists', does: 'Enter on an empty box ends the checklist', start: '- [ ] one\n- [ ] ‸', keys: ['Enter'], expect: '- [ ] one\n\n‸' },
  { id: 'C5', area: 'Checklists', does: 'Tab nests a checklist item', start: '- [ ] one\n- [ ] ‸two', keys: ['Tab'], expect: '- [ ] one\n  - [ ] ‸two' },
  { id: 'C6', area: 'Checklists', does: 'Cmd+Option+Enter ticks the box', start: '- [ ] on‸e', keys: ['Meta+Alt+Enter'], expect: '- [x] on‸e' },
  { id: 'C7', area: 'Checklists', does: 'Backspace at the start of an item takes its box off', start: '- [ ] one\n- [ ] ‸two', keys: ['Backspace'], expect: '- [ ] one\n  ‸two' },

  { id: 'C8', area: 'Checklists', does: 'A second Backspace moves the text out to the margin, as for a bullet', start: '- [ ] one\n- [ ] ‸two', keys: ['Backspace', 'Backspace'], expect: '- [ ] one\n\n‸two' },

  // ---- Mixed and nested lists
  { id: 'M1', area: 'Mixed', does: 'Cmd+Shift+7 turns bullets into numbers', start: '«- one\n- two\n- three»', keys: ['Meta+Shift+7'], expect: '«1. one\n2. two\n3. three»', alt: ['1. «one\n2. two\n3. three»'] },
  { id: 'M2', area: 'Mixed', does: 'Cmd+Shift+8 turns numbers into bullets', start: '«1. one\n2. two»', keys: ['Meta+Shift+8'], expect: '«- one\n- two»' },
  { id: 'M3', area: 'Mixed', does: 'Cmd+Shift+8 on a bullet makes it plain text', start: '- one\n- tw‸o', keys: ['Meta+Shift+8'], expect: '- one\n\ntw‸o' },
  { id: 'M4', area: 'Mixed', does: 'Cmd+Shift+7 on one nested bullet numbers that item', start: '1. one\n   - tw‸o\n2. three', keys: ['Meta+Shift+7'], expect: '1. one\n   1. tw‸o\n2. three' },
  { id: 'M7', area: 'Mixed', does: 'Cmd+Shift+8 on one item of a numbered list turns the whole list into bullets', start: '1. one\n2. tw‸o\n3. three', keys: ['Meta+Shift+8'], expect: '- one\n- tw‸o\n- three' },
  { id: 'M8', area: 'Mixed', does: 'Cmd+Shift+9 on one bullet turns the whole list into a checklist', start: '- one\n- tw‸o', keys: ['Meta+Shift+9'], expect: '- [ ] one\n- [ ] tw‸o' },
  { id: 'M5', area: 'Mixed', does: 'Enter in a bullet under a number keeps the kinds apart', start: '1. one\n   - two‸\n2. three', keys: ['Enter', 't:x'], expect: '1. one\n   - two\n   - x‸\n2. three' },
  { id: 'M6', area: 'Mixed', does: 'Cmd+Shift+7 on three paragraphs numbers them 1, 2, 3', start: '«one\ntwo\nthree»', keys: ['Meta+Shift+7'], expect: '«1. one\n2. two\n3. three»', alt: ['1. «one\n2. two\n3. three»'] },
  { id: 'M9', area: 'Mixed', does: 'Cmd+Shift+7 on a selection across two levels numbers each level from 1', start: '«- a\n- b\n  - kid\n  - kid2\n- c»', keys: ['Meta+Shift+7'], expect: '«1. a\n2. b\n   1. kid\n   2. kid2\n3. c»', alt: ['1. «a\n2. b\n   1. kid\n   2. kid2\n3. c»'], shows: ['number:1.:0', 'number:2.:0', 'number:a.:1', 'number:b.:1', 'number:3.:0'] },

  // ---- Where a list meets text: keys that change no row of the page
  { id: 'E1', area: 'List edges', does: 'Backspace on an only, empty bullet under a paragraph leaves one empty line', start: 'Text\n\n- ‸', keys: ['Backspace'], expect: 'Text\n‸', rows: 2 },
  { id: 'E2', area: 'List edges', does: 'Enter on an only, empty bullet under a paragraph leaves one empty line', start: 'Text\n\n- ‸', keys: ['Enter'], expect: 'Text\n‸', rows: 2 },
  { id: 'E3', area: 'List edges', does: 'Type a bullet under a paragraph, then Backspace it away: the rows stay as they were', start: 'Text\n‸\nBelow', keys: ['t:- ', 'Backspace', 'Backspace', 'Backspace'], expect: 'Text\n‸\nBelow', rows: 3 },
  { id: 'E4', area: 'List edges', does: 'Backspace on an empty first bullet with the list still under it, then typing', start: 'Text\n\n- ‸\n- b', keys: ['Backspace', 't:w'], expect: 'Text\nw‸\n\n- b', shows: ['bullet::0'], rows: 3 },
  { id: 'E5', area: 'List edges', does: 'Backspace at the start of a list\'s first item under text takes the bullet off and opens no row', start: 'Text\n\n- ‸a\n- b', keys: ['Backspace'], expect: 'Text\n‸a\n\n- b', shows: ['bullet::0'], rows: 3 },
  { id: 'E6', area: 'List edges', does: 'Cmd+Shift+8 on the only item of a list between two paragraphs opens no row', start: 'Top\n\n- a‸\n\nMore', keys: ['Meta+Shift+8'], expect: 'Top\na‸\nMore', rows: 3 },
  { id: 'E7', area: 'List edges', does: 'Enter at the end of the text above a list adds one row', start: 'Text‸\n\n- a\n- b', keys: ['Enter'], expect: 'Text\n‸\n\n- a\n- b', rows: 4 },
  { id: 'E8', area: 'List edges', does: 'Enter at the end of the text above a list, then typing: still one row more', start: 'Text‸\n\n- a\n- b', keys: ['Enter', 't:w'], expect: 'Text\nw‸\n\n- a\n- b', rows: 4 },
  { id: 'E9', area: 'List edges', does: 'Enter on an empty item in the middle of a numbered list: one empty row, and the list below counts on', start: '1. one\n2. ‸\n3. three', keys: ['Enter'], expect: '1. one\n\n‸\n\n2. three', rows: 3 },
  { id: 'E10', area: 'List edges', does: 'Type "1. " right after a bulleted list was ended: a numbered list starts under it', start: '- one\n- two‸', keys: ['Enter', 'Enter', 't:1. ', 't:x'], expect: '- one\n- two\n\n1. x‸', shows: ['bullet::0', 'bullet::0', 'number:1.:0'], rows: 3 },
  { id: 'E11', area: 'List edges', does: 'Type "- " right after a numbered list was ended: a bulleted list starts under it', start: '1. a\n2. b‸', keys: ['Enter', 'Enter', 't:- '], expect: '1. a\n2. b\n\n- ‸', shows: ['number:1.:0', 'number:2.:0', 'bullet::0'], rows: 3 },
  { id: 'E12', area: 'List edges', does: 'Type "[] " right after a bulleted list was ended: a box under the list', start: '- one\n- two‸', keys: ['Enter', 'Enter', 't:[] '], expect: '- one\n- two\n- [ ] ‸', rows: 3 },
  { id: 'E13', area: 'List edges', does: 'Type "[x] done" on the line right under a list: a paragraph at the margin', start: '- one\n- two\n‸', keys: ['t:[x] done'], expect: '- one\n- two\n\n[x] done‸', shows: ['bullet::0', 'bullet::0'], rows: 3 },
  { id: 'E14', area: 'List edges', does: 'Delete at the end of the text above a list pulls the first item\'s text up', start: 'Text‸\n\n- a\n- b', keys: ['Delete'], expect: 'Text‸a\n\n- b', shows: ['bullet::0'], rows: 2 },
  { id: 'E15', area: 'List edges', does: 'A second Backspace at the start of a list\'s last item moves its text out and opens no row under it', start: 'Text\n\n- a\n- ‸b\n\nMore', keys: ['Backspace', 'Backspace'], expect: 'Text\n\n- a\n\n‸b\nMore', shows: ['bullet::0'], rows: 4 },
  { id: 'E16', area: 'List edges', does: 'Backspace at the start of a first item with a box takes the box off and opens no row', start: 'Text\n\n- [ ] ‸a\n- [ ] b', keys: ['Backspace'], expect: 'Text\n‸a\n\n- [ ] b', rows: 3 },
  { id: 'E17', area: 'List edges', does: 'Delete at the end of the text above a one-item list joins the item and leaves no empty row', start: 'Text‸\n\n- a\n\nMore', keys: ['Delete'], expect: 'Text‸a\nMore', rows: 2 },
  { id: 'E18', area: 'List edges', does: 'Backspace over a selection from the text above a list to the list\'s end leaves no empty row', start: 'Text«\n\n- a\n- b»\n\nMore', keys: ['Backspace'], expect: 'Text‸\nMore', rows: 2 },
  { id: 'E19', area: 'List edges', does: 'Enter in a list written with a blank line between its items adds one row', start: '- a\n\n- b‸\n\nMore', keys: ['Enter'], expect: '- a\n\n- b\n\n- ‸\n\nMore', rows: 4 },
  { id: 'E20', area: 'List edges', does: 'A list written with a blank line between its items is drawn with no empty rows', start: '- a\n\n- b\n\n- c‸', keys: ['t:x'], expect: '- a\n\n- b\n\n- cx‸', shows: ['bullet::0', 'bullet::0', 'bullet::0'], rows: 3 },
  { id: 'E21', area: 'List edges', does: 'A line of digits typed right under a list, then Enter: two paragraphs at the margin', start: '- one\n- two\n‸', keys: ['t:2024', 'Enter', 't:x'], expect: '- one\n- two\n\n2024\nx‸', shows: ['bullet::0', 'bullet::0'], rows: 4 },
  { id: 'E22', area: 'List edges', does: 'Emptying the first line of the page, over a list, changes no row', start: 'T‸\n\n- a\n- b', keys: ['Backspace'], expect: '‸\n\n- a\n- b', rows: 3 },
  { id: 'E23', area: 'List edges', does: 'A second Backspace at the start of the last item of a list written with blank lines between its items opens no row', start: 'Top\n\n- a\n\n- b\n\n- ‸c\n\nEnd', keys: ['Backspace', 'Backspace'], expect: 'Top\n\n- a\n\n- b\n\n‸c\nEnd', rows: 5 },
  { id: 'E24', area: 'List edges', does: 'Shift+Enter at the end of an item breaks the line inside the item', start: '- a‸\n- b', keys: ['Shift+Enter', 't:x'], expect: '- a\n  x‸\n- b', rows: 3 },
  { id: 'E25', area: 'List edges', does: 'Paste text on the empty line right under a list: a paragraph at the margin', start: '- a\n- b\n‸', keys: ['paste:Hello'], expect: '- a\n- b\n\nHello‸', shows: ['bullet::0', 'bullet::0'], rows: 3 },
  { id: 'E26', area: 'List edges', does: 'Ctrl+Shift+Up in a list written with blank lines between its items moves the item, and the numbers follow', start: '1. a\n\n2. b‸\n\n3. c', keys: ['Control+Shift+ArrowUp'], expect: '1. b‸\n\n2. a\n\n3. c', rows: 3 },

  // Making a line a list item changes no row either, and neither does a marker while it is typed
  { id: 'E27', area: 'List edges', does: 'Type "- " on a line under an empty row: the row stays, and the bullet is where the caret was', start: 'Text\n\n‸', keys: ['t:- ', 't:a'], expect: 'Text\n\n\n- a‸', shows: ['bullet::0'], rows: 3 },
  { id: 'E28', area: 'List edges', does: 'A hyphen typed on a line under an empty row hides nothing', start: 'Text\n\n‸\nBelow', keys: ['t:-'], expect: 'Text\n\n-‸\nBelow', rows: 4 },
  { id: 'E29', area: 'List edges', does: 'A paragraph that starts "1." or "-", typed under an empty row, keeps that row', start: 'Text\n\n‸\nBelow', keys: ['t:1.'], expect: 'Text\n\n1.‸\nBelow', rows: 4 },
  { id: 'E30', area: 'List edges', does: 'Type "1. " on a line between two empty rows: both rows stay', start: 'Text\n\n‸\n\nBelow', keys: ['t:1. ', 't:a'], expect: 'Text\n\n\n1. a‸\n\n\nBelow', shows: ['number:1.:0'], rows: 5 },
  { id: 'E31', area: 'List edges', does: 'Type a bullet under an empty row, then Backspace it away: the rows stay as they were', start: 'Text\n\n‸\nBelow', keys: ['t:- ', 'Backspace', 'Backspace', 'Backspace'], expect: 'Text\n\n‸\nBelow', rows: 4 },
  { id: 'E32', area: 'List edges', does: 'Cmd+Shift+8 on a paragraph with an empty row on each side moves no row', start: 'One\n\nTw‸o\n\nThree', keys: ['Meta+Shift+8'], expect: 'One\n\n\n- Tw‸o\n\n\nThree', shows: ['bullet::0'], rows: 5 },
  { id: 'E33', area: 'List edges', does: 'Cmd+Shift+8 twice on such a paragraph leaves the page as it was', start: 'One\n\nTw‸o\n\nThree', keys: ['Meta+Shift+8', 'Meta+Shift+8'], expect: 'One\n\nTw‸o\n\nThree', rows: 5 },
  { id: 'E34', area: 'List edges', does: 'Enter on an empty last item of a list in a quote, over a row under the quote: the caret stays in the quote and no row goes', start: '> - a\n> - ‸\n\nEnd', keys: ['Enter', 't:x'], expect: '> - a\n>\n> x‸\n\nEnd', rows: 4 },
  { id: 'E35', area: 'List edges', does: 'Backspace on an empty last item of a list in a quote does the same', start: '> - a\n> - ‸\n\nEnd', keys: ['Backspace', 't:x'], expect: '> - a\n>\n> x‸\n\nEnd', rows: 4 },
  { id: 'E36', area: 'List edges', does: 'Backspace at the start of a heading right under a list joins its text to the last item', start: '- a\n- b\n\n## ‸Head', keys: ['Backspace'], expect: '- a\n- b‸Head', shows: ['bullet::0', 'bullet::0'], rows: 2 },
  { id: 'E37', area: 'List edges', does: 'Delete at the end of a list pulls the heading under it up', start: '- a\n- b‸\n\n## Head', keys: ['Delete'], expect: '- a\n- b‸Head', shows: ['bullet::0', 'bullet::0'], rows: 2 },
  { id: 'E38', area: 'List edges', does: 'Delete at the end of a heading over a list pulls the first item\'s text up', start: '# Head‸\n\n- a\n- b', keys: ['Delete'], expect: '# Head‸a\n\n- b', shows: ['bullet::0'], rows: 2 },
  { id: 'E39', area: 'List edges', does: 'Delete at the end of an item pulls the next item up in one press, in a list written with blank lines between its items', start: '- a‸\n\n- b\n\n- c', keys: ['Delete'], expect: '- a‸b\n\n- c', shows: ['bullet::0', 'bullet::0'], rows: 2 },
  { id: 'E40', area: 'List edges', does: 'Delete at the end of a bulleted list pulls up the first item of the numbered list under it in one press, and that list counts from 1', start: '- a\n- b‸\n\n1. c\n2. d', keys: ['Delete'], expect: '- a\n- b‸c\n1. d', shows: ['bullet::0', 'bullet::0', 'number:1.:0'], rows: 3 },
  { id: 'E41', area: 'List edges', does: 'A word typed on the empty line between a list and a table is a paragraph, not more of the last item', start: '- a\n- b\n‸\n| x | y |\n|---|---|\n| 1 | 2 |', keys: ['t:w'], expect: '- a\n- b\n\nw‸\n\n| x | y |\n|---|---|\n| 1 | 2 |', shows: ['bullet::0', 'bullet::0'] },
  { id: 'E42', area: 'List edges', does: 'Type "1. " on the line right under a bulleted list: a numbered list from the space on', start: '- one\n- two\n‸', keys: ['t:1. '], expect: '- one\n- two\n\n1. ‸', shows: ['bullet::0', 'bullet::0', 'number:1.:0'], rows: 3 },
  { id: 'E43', area: 'List edges', does: '"1." shows as typed until its space', start: '‸', keys: ['t:1.'], expect: '1.‸', shows: [], rows: 1 },
  { id: 'E44', area: 'List edges', does: 'Paste a list on an empty line between two empty rows: both rows stay', start: 'Top\n\n‸\n\nBottom', keys: ['paste:- a\n- b'], expect: 'Top\n\n\n- a\n- b‸\n\n\nBottom', shows: ['bullet::0', 'bullet::0'], rows: 6 },
  { id: 'E45', area: 'List edges', does: 'Backspace three times at the start of a last item over a rule: the rule stays a rule, and the text joins the item above', start: '- a\n- ‸b\n\n---\n\nText', keys: ['Backspace', 'Backspace', 'Backspace'], expect: '- a‸b\n\n---\n\nText', shows: ['bullet::0'], rows: 4 },
  { id: 'E46', area: 'List edges', does: 'Enter on an empty item one row under a quote: the row stays, and the text typed there is no part of the quote', start: '> quote\n\n- ‸', keys: ['Enter', 't:x'], expect: '> quote\n\nx‸', shows: [], rows: 3 },
  { id: 'E47', area: 'List edges', does: 'Shift+Right at the end of the line over a list, then Backspace: the first item\'s text joins the line, and no marker shows', start: 'Top‸\n\n- a\n- b', keys: ['Shift+ArrowRight', 'Backspace'], expect: 'Top‸a\n\n- b', shows: ['bullet::0'], rows: 2 },
  { id: 'E48', area: 'List edges', does: 'Copy two items selected from the start of the first one\'s text, and paste them on an empty item', start: '- «a\n- b»\n- ', keys: ['copy', 'caret:end', 'paste'], expect: '- a\n- b\n- a\n- b‸', shows: ['bullet::0', 'bullet::0', 'bullet::0', 'bullet::0'] },
  { id: 'E49', area: 'List edges', does: 'Paste two plain lines over a selection that runs across two items', start: '- o«ne\n- tw»o', keys: ['paste:X\nY'], expect: '- oX\n- Y‸o', shows: ['bullet::0', 'bullet::0'] },
  { id: 'E50', area: 'List edges', does: 'Delete on an empty row over a list, then type: the letter starts the item\'s text', start: 'Text\n‸\n\n- a', keys: ['Delete', 't:x'], expect: 'Text\n\n- x‸a', shows: ['bullet::0'], rows: 2 },
  { id: 'E51', area: 'List edges', does: 'Enter on an empty last item, undo, redo, then type: the text goes on the empty row', start: '- a\n- ‸\n\nPara', keys: ['Enter', 'Meta+z', 'Meta+Shift+z', 't:x'], expect: '- a\n\nx‸\nPara', shows: ['bullet::0'], rows: 3 },
  { id: 'E52', area: 'List edges', does: 'Enter on an empty item one empty row under a list, then type: both rows stay, and the text goes on the item\'s row', start: '- a\n- b\n\n\n- ‸\n- d', keys: ['Enter', 't:x'], expect: '- a\n- b\n\n\nx‸\n\n- d', shows: ['bullet::0', 'bullet::0', 'bullet::0'], rows: 5 },
  { id: 'E53', area: 'List edges', does: 'Type "[] " in front of text already on the line: a box', start: '‸milk', keys: ['t:[] '], expect: '- [ ] ‸milk', shows: ['task::0'] },
  { id: 'E54', area: 'List edges', does: 'Type "1." on an empty line, Enter, then type: "1." stays as typed and the text goes on the next line', start: '‸', keys: ['t:1.', 'Enter', 't:x'], expect: '1.\nx‸', shows: [], rows: 2 },

  // ---- Caret and selection across items
  { id: 'S1', area: 'Caret', does: 'Left at the start of an item goes to the end of the item above', start: '- one\n- ‸two', keys: ['ArrowLeft'], expect: '- one‸\n- two' },
  { id: 'S2', area: 'Caret', does: 'Right at the end of an item goes to the start of the next item\'s text', start: '- one‸\n- two', keys: ['ArrowRight'], expect: '- one\n- ‸two' },
  { id: 'S3', area: 'Caret', does: 'Cmd+Left goes to the start of the item\'s text', start: '- one tw‸o', keys: ['Meta+ArrowLeft', 't:x'], expect: '- x‸one two' },
  { id: 'S4', area: 'Caret', does: 'Cmd+Shift+Left then typing keeps the bullet', start: '- one tw‸o', keys: ['Meta+Shift+ArrowLeft', 't:x'], expect: '- x‸o' },
  { id: 'S5', area: 'Caret', does: 'Down keeps the caret in the text of the next item', start: '- on‸e\n- two', keys: ['ArrowDown', 't:x'], expect: '- one\n- twx‸o' },
  { id: 'S6', area: 'Caret', does: 'Shift+Down then Backspace joins the items', start: '- on‸e\n- two', keys: ['Shift+ArrowDown', 'Backspace'], expect: '- on‸o' },
  { id: 'S7', area: 'Caret', does: 'Select all then typing leaves plain text', start: '- one\n- tw‸o', keys: ['Meta+a', 't:x'], expect: 'x‸' },
  { id: 'S8', area: 'Caret', does: 'Option+Shift+Down extends the selection by a paragraph', start: '- ‸one\n- two\n- three', keys: ['Alt+Shift+ArrowDown', 'Backspace'], expect: '- ‸\n- two\n- three' },

  // ---- Cut, copy and paste
  { id: 'X1', area: 'Paste', does: 'Copy two items and paste them on an empty item', start: '«- one\n- two\n»- ', keys: ['copy', 'caret:end', 'paste'], expect: '- one\n- two\n- one\n- two‸', alt: ['- one\n- two\n- one\n- two\n‸'] },
  { id: 'X2', area: 'Paste', does: 'Paste two plain lines at the end of an item: the second becomes an item', start: '- one‸', keys: ['paste:two\nthree'], expect: '- onetwo\n- three‸' },
  { id: 'X3', area: 'Paste', does: 'Paste three plain lines on an empty numbered item', start: '1. one\n2. ‸', keys: ['paste:a\nb\nc'], expect: '1. one\n2. a\n3. b\n4. c‸' },
  { id: 'X4', area: 'Paste', does: 'Paste a link over selected text links it', start: 'see «the plan» now', keys: ['paste:https://example.com/plan'], expect: 'see [the plan](https://example.com/plan)‸ now', alt: ['see [«the plan»](https://example.com/plan) now'] },
  { id: 'X5', area: 'Paste', does: 'Paste a web page\'s list keeps the list', start: '‸', keys: ['pasteHtml:<ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul>||one\ntwo\ndeep'], expect: '- one\n- two\n  - deep‸' },
  { id: 'X6', area: 'Paste', does: 'Paste a web page\'s bold, italic and link keeps them', start: '‸', keys: ['pasteHtml:<p>A <b>bold</b> and <i>slanted</i> <a href="https://example.com/a">link</a>.</p>||A bold and slanted link.'], expect: 'A **bold** and *slanted* [link](https://example.com/a).‸' },
  { id: 'X7', area: 'Paste', does: 'Paste a word processor\'s numbered list keeps the list', start: '‸', keys: ['pasteHtml:<meta charset="utf-8"><b style="font-weight:normal;" id="internal-guid-1"><ol style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:decimal;"><p dir="ltr"><span style="font-weight:400;">one</span></p></li><li dir="ltr" style="list-style-type:decimal;"><p dir="ltr"><span style="font-weight:700;">two</span></p></li><ol style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:lower-alpha;"><p dir="ltr"><span style="font-weight:400;">deep</span></p></li></ol></ol></b>||one\ntwo\ndeep'], expect: '1. one\n2. **two**\n   1. deep‸' },
  { id: 'X8', area: 'Paste', does: 'Paste a heading and a paragraph from a web page', start: '‸', keys: ['pasteHtml:<h2>Plan</h2><p>First line.</p>||Plan\nFirst line.'], expect: '## Plan\n\nFirst line.‸' },
  { id: 'X9', area: 'Paste', does: 'Cmd+Shift+V pastes the same web text plain', start: '‸', keys: ['pastePlain:A bold and slanted link.'], expect: 'A bold and slanted link.‸' },
  { id: 'X10', area: 'Paste', does: 'Cut a whole item and paste it at the end of the list', start: '«- one\n»- two\n- three\n', keys: ['cut', 'caret:end', 'paste'], expect: '- two\n- three\n- one\n‸' },

  { id: 'X11', area: 'Paste', does: 'Paste a list in the middle of an item: the first joins the text, the next is its own item', start: '- on‸e', keys: ['paste:- two\n- three'], expect: '- ontwo\n- three‸e' },
  { id: 'X12', area: 'Paste', does: 'Paste code copied from a code editor: its text, with no stars from its colouring', start: '‸', keys: ['pasteHtml:<div style="font-family: Menlo, monospace; white-space: pre;"><div><span style="font-weight: bold;">const</span> a = 1;</div></div>||const a = 1;'], expect: 'const a = 1;‸' },
  { id: 'X13', area: 'Paste', does: 'Paste a list on an empty line over text: the text under it stays a paragraph', start: 'Top\n‸\nBottom', keys: ['paste:- a\n- b'], expect: 'Top\n\n- a\n- b‸\n\nBottom', rows: 4, shows: ['bullet::0', 'bullet::0'] },
  { id: 'X14', area: 'Paste', does: 'Paste a web page\'s list in the middle of a paragraph: the list gets lines of its own', start: 'Par‸a', keys: ['pasteHtml:<ul><li>two</li><li>three</li></ul>||two\nthree'], expect: 'Par\n\n- two\n- three‸\n\na', shows: ['bullet::0', 'bullet::0'] },
  { id: 'X15', area: 'Paste', does: 'Paste a list over a selection that runs across two items', start: '- o«ne\n- tw»o\n- three', keys: ['paste:- X\n- Y'], expect: '- oX\n- Y‸o\n- three' },

  // ---- Undo
  { id: 'U1', area: 'Undo', does: 'Undo right after "- " shows the typed characters again', start: '‸', keys: ['t:- ', 'Meta+z'], expect: '\\- ‸', alt: ['- ‸'], undoShowsText: '- ' },
  { id: 'U2', area: 'Undo', does: 'Undo takes back a new item', start: '- one‸', keys: ['Enter', 'Meta+z'], expect: '- one‸' },
  { id: 'U3', area: 'Undo', does: 'Undo takes back Tab', start: '- one\n- ‸two', keys: ['Tab', 'Meta+z'], expect: '- one\n- ‸two' },
  { id: 'U4', area: 'Undo', does: 'Redo puts it back', start: '- one\n- ‸two', keys: ['Tab', 'Meta+z', 'Meta+Shift+z'], expect: '- one\n  - ‸two' },
  { id: 'U5', area: 'Undo', does: 'Undo after typing two words then Enter keeps the words', start: '- ‸', keys: ['t:two words', 'wait:700', 'Enter', 'Meta+z'], expect: '- two words‸' },

  { id: 'U6', area: 'Undo', does: 'Cmd+Y redoes too', start: '- one\n- ‸two', keys: ['Tab', 'Meta+z', 'Meta+y'], expect: '- one\n  - ‸two' },

  // ---- Shortcuts
  { id: 'K1', area: 'Shortcuts', does: 'Cmd+B on a selection', start: 'a «word» b', keys: ['Meta+b'], expect: 'a **«word»** b' },
  { id: 'K2', area: 'Shortcuts', does: 'Cmd+I on a selection', start: 'a «word» b', keys: ['Meta+i'], expect: 'a *«word»* b' },
  { id: 'K3', area: 'Shortcuts', does: 'Cmd+Shift+X on a selection', start: 'a «word» b', keys: ['Meta+Shift+x'], expect: 'a ~~«word»~~ b' },
  { id: 'K4', area: 'Shortcuts', does: 'Cmd+U on a selection underlines it', start: 'a «word» b', keys: ['Meta+u'], expect: 'a <u>«word»</u> b', opal: 'a «word» b', why: 'Markdown has no underline. The key does nothing rather than write HTML.' },
  { id: 'K5', area: 'Shortcuts', does: 'Cmd+B then typing writes bold text', start: 'a ‸', keys: ['Meta+b', 't:bold'], expect: 'a **bold‸**' },
  { id: 'K6', area: 'Shortcuts', does: 'Cmd+Shift+8 starts a bullet on an empty line', start: '‸', keys: ['Meta+Shift+8', 't:x'], expect: '- x‸' },
  { id: 'K7', area: 'Shortcuts', does: 'Cmd+Shift+7 starts a numbered list on an empty line', start: '‸', keys: ['Meta+Shift+7', 't:x'], expect: '1. x‸' },
  { id: 'K8', area: 'Shortcuts', does: 'Cmd+] nests an item', start: '- one\n- tw‸o', keys: ['Meta+]'], expect: '- one\n  - tw‸o', opal: '- one\n- tw‸o', why: 'Cmd+] and Cmd+[ are Forward and Back between pages in this app. Tab and Shift+Tab change the level.' },
  { id: 'K9', area: 'Shortcuts', does: 'Cmd+[ moves an item out', start: '- one\n  - tw‸o', keys: ['Meta+['], expect: '- one\n- tw‸o', opal: '- one\n  - tw‸o', why: 'Cmd+] and Cmd+[ are Forward and Back between pages in this app. Tab and Shift+Tab change the level.' },
  { id: 'K10', area: 'Shortcuts', does: 'Cmd+Option+2 makes a heading', start: 'Pla‸n', keys: ['Meta+Alt+2'], expect: '## Pla‸n' },
  { id: 'K11', area: 'Shortcuts', does: 'Cmd+Option+0 makes normal text', start: '## Pla‸n', keys: ['Meta+Alt+0'], expect: 'Pla‸n' },
  { id: 'K12', area: 'Shortcuts', does: 'Cmd+\\ clears formatting', start: 'a «**word**» b', keys: ['Meta+\\'], expect: 'a «word» b' },
  { id: 'K13', area: 'Shortcuts', does: 'Cmd+K opens the link box', start: 'a «word» b', keys: ['Meta+k'], expect: 'a «word» b', linkBox: true },
  { id: 'K14', area: 'Shortcuts', does: 'Ctrl+Shift+Up moves the item up', start: '1. one\n2. tw‸o\n3. three', keys: ['Control+Shift+ArrowUp'], expect: '1. tw‸o\n2. one\n3. three' },
  { id: 'K15', area: 'Shortcuts', does: 'Ctrl+Shift+Down moves the item down', start: '- on‸e\n- two', keys: ['Control+Shift+ArrowDown'], expect: '- two\n- on‸e' },

  { id: 'K16', area: 'Shortcuts', does: 'Cmd+Option+0 on a heading in a list item leaves the list whole', start: '- one\n- ## tw‸o', keys: ['Meta+Alt+0'], expect: '- one\n- tw‸o' },
  { id: 'K17', area: 'Shortcuts', does: 'Ctrl+Shift+Down on a list\'s last item moves it under the paragraph below', start: '- one\n- tw‸o\n\nPara', keys: ['Control+Shift+ArrowDown'], expect: '- one\n\nPara\n- tw‸o', opal: '- one\n- tw‸o\n\nPara', why: 'A list item changes places only with another list line. Text right under an item would read as part of it in Markdown.' },

  // ---- Typing: what is written for you, and what is not
  { id: 'A1', area: 'Typing', does: 'Two hyphens become a dash', start: '‸', keys: ['t:a -- b'], expect: 'a – b‸', opal: 'a -- b‸', why: 'Left out on purpose: no dash is written for the person.' },
  { id: 'A2', area: 'Typing', does: 'Straight quotes become curly', start: '‸', keys: ['t:"x" it\'s'], expect: '“x” it’s‸', opal: '"x" it\'s‸', why: 'Left out on purpose: plain quotes keep files easy to search.' },
  { id: 'A3', area: 'Typing', does: 'A typed web address becomes a link', start: '‸', keys: ['t:see https://example.com/a now'], expect: 'see https://example.com/a now‸', linkShown: true },
  { id: 'A5', area: 'Typing', does: 'The first letter of an item is made a capital', start: '- ‸', keys: ['t:one'], expect: '- One‸', opal: '- one‸', why: 'Left out with the other autocorrections: text is written as typed.' },
  { id: 'A4', area: 'Typing', does: 'Tab in a paragraph types a tab', start: 'a‸b', keys: ['Tab', 't:x'], expect: 'a\tx‸b', opal: 'ax‸b', why: 'Tab does nothing outside a list: Markdown shows a tab as a space, and one at a line start turns the line into code.' },
];
