import { describe, expect, it } from 'vitest';
import { markdownFromHtml } from '@/renderer/features/disk-explorer/components/editor/pasteHtml';

/*
 * A clipboard's HTML as Markdown: what a web page and a word processor put
 * on the clipboard, and what is left to the plain-text paste.
 */

describe('Markdown from a clipboard\'s HTML', () => {
  it('keeps bold, italic, strikethrough, code and links, with marks never against a space', () => {
    expect(markdownFromHtml('<p>A <b>bold</b> and <i>slanted</i> <a href="https://example.com/a">link</a>.</p>')).toBe('A **bold** and *slanted* [link](https://example.com/a).');
    expect(markdownFromHtml('<p>x<strong> spaced </strong>y <del>gone</del> <code>a*b</code></p>')).toBe('x **spaced** y ~~gone~~ `a*b`');
    expect(markdownFromHtml('<p><b><i>both</i></b></p>')).toBe('***both***');
  });

  it('reads a word processor\'s inline styles, and its wrapper is not bold', () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="internal-guid-1"><p dir="ltr"><span style="font-weight:400;">plain </span><span style="font-weight:700;">heavy</span><span style="font-style:italic;"> tilted</span><span style="text-decoration:line-through;"> struck</span></p></b>';
    expect(markdownFromHtml(html)).toBe('plain **heavy** *tilted* ~~struck~~');
  });

  it('keeps lists, nested either way, numbered from their start, and check boxes', () => {
    expect(markdownFromHtml('<ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul>')).toBe('- one\n- two\n  - deep');
    expect(markdownFromHtml('<ol start="3"><li><p>one</p></li><li><p>two</p></li><ol><li><p>deep</p></li></ol></ol>')).toBe('3. one\n4. two\n   1. deep');
    expect(markdownFromHtml('<ul><li role="checkbox" aria-checked="true"><p>done</p></li><li role="checkbox" aria-checked="false"><p>todo</p></li></ul>')).toBe('- [x] done\n- [ ] todo');
    expect(markdownFromHtml('<ul><li><input type="checkbox" checked> a</li></ul>')).toBe('- [x] a');
  });

  it('keeps headings, paragraphs, quotes, code blocks, rules and tables as blocks', () => {
    expect(markdownFromHtml('<h2>Plan</h2><p>First line.</p><p>Second<br>line.</p>')).toBe('## Plan\n\nFirst line.\n\nSecond\nline.');
    expect(markdownFromHtml('<blockquote><p>said</p><p>twice</p></blockquote>')).toBe('> said\n>\n> twice');
    expect(markdownFromHtml('<pre>const a = 1;\nconst b = 2;\n</pre>')).toBe('```\nconst a = 1;\nconst b = 2;\n```');
    expect(markdownFromHtml('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb');
    expect(markdownFromHtml('<table><tr><th>Item</th><th>Cost</th></tr><tr><td>a|b</td><td><b>3</b></td></tr></table>')).toBe('| Item | Cost |\n| --- | --- |\n| a\\|b | **3** |');
  });

  it('escapes text that would read as Markdown', () => {
    expect(markdownFromHtml('<p><b>x</b> 2*3*4 [a] snake_case _lead `tick` &lt;b&gt;</p>')).toBe('**x** 2\\*3\\*4 \\[a\\] snake_case \\_lead \\`tick\\` \\<b>');
    expect(markdownFromHtml('<p><b>x</b></p><p># not a heading</p><p>1. not a list</p><p>- nor this</p>')).toBe('**x**\n\n\\# not a heading\n\n1\\. not a list\n\n\\- nor this');
  });

  it('writes a link whose text is its address as the address, and drops an address that is not a web one', () => {
    expect(markdownFromHtml('<a href="https://example.com/a">https://example.com/a</a>')).toBe('https://example.com/a');
    expect(markdownFromHtml('<p><a href="javascript:alert(1)">x</a></p>')).toBeNull();
  });

  it('gives null when there is no formatting to keep, so the plain text is pasted', () => {
    expect(markdownFromHtml('')).toBeNull();
    expect(markdownFromHtml('<p>one</p><p>two</p>')).toBeNull();
    expect(markdownFromHtml('<span style="color: red; font-size: 20px">only colour</span>')).toBeNull();
    expect(markdownFromHtml('<meta charset="utf-8"><div style="color: #ccc; font-family: Menlo, Monaco, monospace; white-space: pre;"><div><span style="font-weight: bold;">const</span> a = 1;</div></div>')).toBeNull();
  });

  it('reads a line break inside a code block, and leaves a code editor\'s HTML to the plain text', () => {
    expect(markdownFromHtml('<pre>a = 1<br>b = 2</pre>')).toBe('```\na = 1\nb = 2\n```');
    expect(markdownFromHtml('<span style="font-family: Menlo, monospace; white-space: pre;">def f():\n    <i># note</i>\n    return 1</span>')).toBeNull();
    expect(markdownFromHtml('<div style="font-family: \'Courier New\', monospace"><div>let a = <b>1</b>;</div><div>let b = 2;</div></div>')).toBeNull();
    // A word in a fixed-width font inside ordinary text is not a code editor's copy.
    expect(markdownFromHtml('<p>Run <span style="font-family: monospace">make</span> and <b>wait</b> for it to finish building.</p>')).toBe('Run make and **wait** for it to finish building.');
  });

  it('takes only web and mail addresses as links', () => {
    expect(markdownFromHtml('<p><b>x</b> <a href="opal://open?path=Notes/Plan.md">plan</a> <a href="mailto:alex@example.com">mail</a></p>')).toBe('**x** plan [mail](mailto:alex@example.com)');
  });

  it('drops pictures, scripts and styles', () => {
    expect(markdownFromHtml('<p><b>a</b><img src="https://example.com/x.png" alt="pic"><script>alert(1)</script><style>p{}</style> b</p>')).toBe('**a** b');
  });
});
