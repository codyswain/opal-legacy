import { expect, it, vi } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownEditorExtensions } from '@/renderer/features/disk-explorer/components/editor/editorSetup';
import { visibleLine, visibleOffset } from '@/renderer/features/disk-explorer/components/editor/visibleText';
import { BUDGETS } from '@/renderer/shared/perf/marks';
import { installDiskApi } from '@/tests/helpers/diskApi';
import { installMarkdownApi } from '@/tests/helpers/markdownApi';

it('finds the caret’s place in a 22,000-character paragraph within one frame after an edit', () => {
  const path = '/Vault/Notes/Plan.mdo';
  installDiskApi({ listRoots: vi.fn(async () => ({ success: true as const, data: ['/Vault'] })) });
  installMarkdownApi({ [path]: '' });

  const words: string[] = [];
  for (let length = 0, index = 0; length < 22_000; index += 1) {
    const word = index % 40 === 0 ? `**bold ${index}**` : index % 55 === 0 ? `[link ${index}](https://example.com/${index})` : `word${index}`;
    words.push(word);
    length += word.length + 1;
  }
  const doc = `${words.join(' ')}\n`;
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: markdownEditorExtensions(path) }) });
  try {
    ensureSyntaxTree(view.state, doc.length, 5_000);
    view.dispatch({});
    const state = view.state;
    visibleLine(state, 0);
    const caret = 10_000;
    const samples: number[] = [];
    for (let sample = 0; sample < 7; sample += 1) {
      // The visible-line cache is keyed by state. Each sample measures its first read after an edit.
      const next = state.update({ changes: { from: caret, insert: 'x' } }).state;
      const started = performance.now();
      const line = visibleLine(next, caret);
      samples.push(performance.now() - started);
      expect(line.text[visibleOffset(line, caret)]).toBe('x');
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(BUDGETS.keystrokeMs);
  } finally {
    view.destroy();
  }
});
