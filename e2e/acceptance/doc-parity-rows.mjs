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
// `opal` and `why`, when set, are a difference kept on purpose: what the
// page does instead, and the reason. The run checks that it still holds.
//
// `modes` lists where the row applies: "doc" is a document (.mdo), "note"
// is a note (.md). Default: both.

export const ROWS = [
  // ---- Bulleted lists
  { id: 'B1', area: 'Bullets', does: 'Type "- " on an empty line', start: '‸', keys: ['t:- '], expect: '- ‸', shows: ['bullet::0'] },
  { id: 'B2', area: 'Bullets', does: 'Type "* " on an empty line', start: '‸', keys: ['t:* '], expect: '* ‸', shows: ['bullet::0'] },
  { id: 'B3', area: 'Bullets', does: 'Type "- " on the line under a paragraph', start: 'Text\n‸', keys: ['t:- ', 't:a'], expect: 'Text\n- a‸', shows: ['bullet::0'] },
  { id: 'B4', area: 'Bullets', does: 'Type "- " in front of text already on the line', start: '‸milk', keys: ['t:- '], expect: '- ‸milk', shows: ['bullet::0'] },
  { id: 'B5', area: 'Bullets', does: 'Enter at the end of an item', start: '- one‸', keys: ['Enter', 't:two'], expect: '- one\n- two‸', shows: ['bullet::0', 'bullet::0'] },
  { id: 'B6', area: 'Bullets', does: 'Enter in the middle of an item', start: '- on‸e', keys: ['Enter'], expect: '- on\n- ‸e' },
  { id: 'B7', area: 'Bullets', does: 'Enter at the start of an item', start: '- one\n- ‸two', keys: ['Enter'], expect: '- one\n- \n- ‸two' },
  { id: 'B8', area: 'Bullets', does: 'Enter on an empty item at the top level ends the list', start: '- one\n- ‸', keys: ['Enter', 't:after'], expect: '- one\n\nafter‸' },
  { id: 'B9', area: 'Bullets', does: 'Enter on an empty nested item steps out one level', start: '- one\n  - two\n  - ‸', keys: ['Enter'], expect: '- one\n  - two\n- ‸' },
  { id: 'B10', area: 'Bullets', does: 'Enter on an empty item in the middle of a list', start: '- one\n- ‸\n- three', keys: ['Enter'], expect: '- one\n\n‸\n\n- three' },
  { id: 'B11', area: 'Bullets', does: 'Tab at the start of an item nests it', start: '- one\n- ‸two', keys: ['Tab'], expect: '- one\n  - ‸two', shows: ['bullet::0', 'bullet::1'] },
  { id: 'B12', area: 'Bullets', does: 'Tab with the caret inside an item\'s text types a tab', start: '- one\n- tw‸o', keys: ['Tab'], expect: '- one\n- tw\t‸o', opal: '- one\n  - tw‸o', why: 'Tab nests the item wherever the caret is in it. A word processor nests only from the start of the item and types a tab elsewhere, which Markdown shows as a space.' },
  { id: 'B13', area: 'Bullets', does: 'Tab on two selected items nests both', start: '- one\n- «two\n- thr»ee', keys: ['Tab'], expect: '- one\n  - «two\n  - thr»ee' },
  { id: 'B14', area: 'Bullets', does: 'Tab three levels deep', start: '- one\n  - two\n  - ‸three', keys: ['Tab'], expect: '- one\n  - two\n    - ‸three', shows: ['bullet::0', 'bullet::1', 'bullet::2'] },
  { id: 'B15', area: 'Bullets', does: 'Shift+Tab moves a nested item out', start: '- one\n  - ‸two', keys: ['Shift+Tab'], expect: '- one\n- ‸two' },
  { id: 'B16', area: 'Bullets', does: 'Shift+Tab at the top level does nothing', start: '- one\n- ‸two', keys: ['Shift+Tab'], expect: '- one\n- ‸two' },
  { id: 'B17', area: 'Bullets', does: 'Backspace at the start of an item takes its bullet off and keeps the text in place', start: '- one\n- ‸two', keys: ['Backspace'], expect: '- one\n  ‸two' },
  { id: 'B18', area: 'Bullets', does: 'A second Backspace moves the text out to the margin', start: '- one\n- ‸two', keys: ['Backspace', 'Backspace'], expect: '- one\n\n‸two' },
  { id: 'B18b', area: 'Bullets', does: 'A third Backspace joins the text to the item above', start: '- one\n- ‸two', keys: ['Backspace', 'Backspace', 'Backspace'], expect: '- one‸two' },
  { id: 'B18c', area: 'Bullets', does: 'With an item below, the three Backspaces leave no empty row in the list', start: '- one\n- ‸two\n- three', keys: ['Backspace', 'Backspace', 'Backspace'], expect: '- one‸two\n- three' },
  { id: 'B19', area: 'Bullets', does: 'Backspace on an empty item takes its bullet off', start: '- one\n- ‸', keys: ['Backspace'], expect: '- one\n  ‸' },
  { id: 'B19b', area: 'Bullets', does: 'Two more Backspaces on it go to the margin, then back to the end of the item above', start: '- one\n- ‸', keys: ['Backspace', 'Backspace', 'Backspace'], expect: '- one‸' },
  { id: 'B20', area: 'Bullets', does: 'Backspace at the start of the first item makes it a paragraph (a word processor keeps its indent for one more press)', start: '- ‸one\n- two', keys: ['Backspace'], expect: '‸one\n\n- two', alt: ['‸one\n- two'] },
  { id: 'B21', area: 'Bullets', does: 'Delete at the end of an item pulls the next item\'s text up', start: '- one‸\n- two', keys: ['Delete'], expect: '- one‸two' },
  { id: 'B22', area: 'Bullets', does: 'Typing over a selection across two items joins them', start: '- o«ne\n- tw»o', keys: ['t:x'], expect: '- ox‸o' },
  { id: 'B23', area: 'Bullets', does: 'Enter, Tab, text, Enter, Enter, Enter walks in and back out', start: '- one‸', keys: ['Enter', 'Tab', 't:two', 'Enter', 'Enter', 'Enter', 't:end'], expect: '- one\n  - two\n\nend‸' },

  { id: 'B24', area: 'Bullets', does: 'Type "- " in front of a line with text right under it: only that line becomes a bullet', start: 'Alpha\n‸Beta\nGamma', keys: ['t:- '], expect: 'Alpha\n- ‸Beta\n\nGamma', shows: ['bullet::0'] },
  { id: 'B25', area: 'Bullets', does: 'Delete at the end of a list pulls the paragraph under it up', start: '- one‸\n\nPara', keys: ['Delete'], expect: '- one‸Para' },
  { id: 'B26', area: 'Bullets', does: 'After Backspace took a bullet off, Enter at the end of that line goes on without a bullet', start: '- one\n- ‸two', keys: ['Backspace', 'Meta+ArrowRight', 'Enter', 't:x'], expect: '- one\n  two\n  x‸', shows: ['bullet::0'] },

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
  { id: 'N17', area: 'Numbers', does: 'Typing next to a list written 1., 1., 1. leaves its numbers as written', start: '1. a\n1. b\n\n‸', keys: ['t:- x'], expect: '1. a\n1. b\n\n- x‸' },

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

  // ---- Typing: what is written for you, and what is not
  { id: 'A1', area: 'Typing', does: 'Two hyphens become a dash', start: '‸', keys: ['t:a -- b'], expect: 'a – b‸', opal: 'a -- b‸', why: 'Left out on purpose: no dash is written for the person.' },
  { id: 'A2', area: 'Typing', does: 'Straight quotes become curly', start: '‸', keys: ['t:"x" it\'s'], expect: '“x” it’s‸', opal: '"x" it\'s‸', why: 'Left out on purpose: plain quotes keep files easy to search.' },
  { id: 'A3', area: 'Typing', does: 'A typed web address becomes a link', start: '‸', keys: ['t:see https://example.com/a now'], expect: 'see https://example.com/a now‸', linkShown: true },
  { id: 'A5', area: 'Typing', does: 'The first letter of an item is made a capital', start: '- ‸', keys: ['t:one'], expect: '- One‸', opal: '- one‸', why: 'Left out with the other autocorrections: text is written as typed.' },
  { id: 'A4', area: 'Typing', does: 'Tab in a paragraph types a tab', start: 'a‸b', keys: ['Tab', 't:x'], expect: 'a\tx‸b', opal: 'ax‸b', why: 'Tab does nothing outside a list: Markdown shows a tab as a space, and one at a line start turns the line into code.' },
];
