import { language } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import type { Tree } from '@lezer/common';
import type { MarkdownParser } from '@lezer/markdown';
import { expect, it } from 'vitest';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

const editor = EditorState.create({ extensions: markdownEditorExtensions('/Vault/Example.mdo') });
const parser = editor.facet(language)!.parser as MarkdownParser;
const baseline = parser.configure({ remove: ['WordText'] });

function nodes(tree: Tree): string[] {
  const result: string[] = [];
  tree.iterate({
    enter: ({ name, from, to }) => { result.push(`${name}(${from},${to}`); },
    leave: () => { result.push(')'); },
  });
  return result;
}

it.each([
  'www.example.com https://example.com/one.two?x=18 user.Name+2@example.org mailto:a@b.com xmpp:a@b.com/resource',
  'אבalphaéé123é 中abc٩ \u{1f4da}a9 x_www.example.com 12https://example.com plain.alice@example.org',
  'a**bold**z a*b*c no_strong_here <em>A12</em> &amp; ~~done~~ [tag](https://example.com) `abc12`',
  '![Img](image.png) ![[Page|img]] [[Other Page#Heading]] $x_2 + b$ and \\(ax1\\)',
  '| ABC | 12 |\n| --- | -- |\n| [alpha][r] | 45www.site.org |\n\n[r]: https://example.org\n',
])('preserves Markdown node types and positions when scanning words in %s', (text) => {
  expect(nodes(parser.parse(text))).toEqual(nodes(baseline.parse(text)));
});
