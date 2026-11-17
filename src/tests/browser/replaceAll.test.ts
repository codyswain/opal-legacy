import { expect, it, vi } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { replaceAll, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

it('replaces matches on 1,500 Markdown lines within two seconds', () => {
  const path = '/Vault/Notes/Plan.mdo';
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [path]: '' });

  const lines = Array.from({ length: 1_500 }, (_, i) => `Line ${i} has a plan and **bold** text and [a link](https://x.com/${i}).`);
  const doc = `${lines.join('\n')}\n`;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: markdownEditorExtensions(path) }),
  });
  try {
    ensureSyntaxTree(view.state, doc.length, 5_000);
    view.dispatch({});
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'plan', replace: 'plan-b' })) });

    const started = performance.now();
    replaceAll(view);
    const elapsed = performance.now() - started;
    expect(view.state.doc.toString()).toBe(doc.replaceAll('plan', 'plan-b'));
    expect(elapsed).toBeLessThan(2_000);
  } finally {
    view.destroy();
  }
});
