import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Markdown, MarkdownLinksContext } from '@/renderer/features/auto/markdown/Markdown';
import { TooltipProvider } from '@/renderer/shared/ui';
import { parseMarkdown, settleStreaming, type Block } from '@/renderer/features/auto/markdown/parseMarkdown';
import { codeTarget, linkTarget, wikiTarget } from '@/renderer/features/auto/model/links';

const blocks = (text: string, streaming = false): Block[] => parseMarkdown(text, { streaming }).map((parsed) => parsed.block);
const text = (value: string) => ({ type: 'text', text: value });

const CONTEXT = { roots: ['/Users/me/Vault'], tops: new Set(['Library', 'Projects', 'Recipes']) };

describe('a reply’s Markdown, parsed', () => {
  it('reads paragraphs, with a line end as a break', () => {
    expect(blocks('One line\nand another\n\nA second paragraph')).toEqual([
      { type: 'paragraph', children: [text('One line'), { type: 'break' }, text('and another')] },
      { type: 'paragraph', children: [text('A second paragraph')] },
    ]);
  });

  it('reads headings', () => {
    expect(blocks('# One\n\n### Three ###\n\nTitle\n=====')).toEqual([
      { type: 'heading', level: 1, children: [text('One')] },
      { type: 'heading', level: 3, children: [text('Three')] },
      { type: 'heading', level: 1, children: [text('Title')] },
    ]);
  });

  it('reads emphasis, strong, strike and inline code', () => {
    expect(blocks('A **bold _nested_** word, ~~gone~~ and `code * here`.')).toEqual([{
      type: 'paragraph',
      children: [
        text('A '),
        { type: 'strong', children: [text('bold '), { type: 'em', children: [text('nested')] }] },
        text(' word, '),
        { type: 'del', children: [text('gone')] },
        text(' and '),
        { type: 'code', text: 'code * here' },
        text('.'),
      ],
    }]);
  });

  it('reads links: written, bare, in angle brackets, pictures as their words, and wiki links', () => {
    const [paragraph] = blocks('[the plan](Projects/Garden/Beds.md "Beds") https://example.com/a. <https://example.com/b> ![a chart](files/chart.png) [[Recipes/Bread|bread]] [[Library/notes/Plan.md]] www.example.com');
    expect(paragraph.type === 'paragraph' && paragraph.children.filter((node) => node.type !== 'text')).toEqual([
      { type: 'link', href: 'Projects/Garden/Beds.md', children: [text('the plan')] },
      { type: 'link', href: 'https://example.com/a', children: [text('https://example.com/a')] },
      { type: 'link', href: 'https://example.com/b', children: [text('https://example.com/b')] },
      { type: 'link', href: 'files/chart.png', children: [text('a chart')] },
      { type: 'wiki', target: 'Recipes/Bread', children: [text('bread')] },
      { type: 'wiki', target: 'Library/notes/Plan.md', children: [text('Plan')] },
      { type: 'link', href: 'https://www.example.com', children: [text('www.example.com')] },
    ]);
  });

  it('keeps a bracketed word with no address as the words it is', () => {
    expect(blocks('See [the note] and \\*stars\\* &amp; more')).toEqual([{ type: 'paragraph', children: [text('See [the note] and *stars* & more')] }]);
  });

  it('reads nested lists, numbered lists from their first number, and tasks', () => {
    expect(blocks('- one\n  - inner\n- two\n\n3. three\n4. four\n\n- [ ] open\n- [x] done')).toEqual([
      {
        type: 'list', ordered: false, start: 1,
        items: [
          { task: null, children: [{ type: 'paragraph', children: [text('one')] }, { type: 'list', ordered: false, start: 1, items: [{ task: null, children: [{ type: 'paragraph', children: [text('inner')] }] }] }] },
          { task: null, children: [{ type: 'paragraph', children: [text('two')] }] },
        ],
      },
      {
        type: 'list', ordered: true, start: 3,
        items: [
          { task: null, children: [{ type: 'paragraph', children: [text('three')] }] },
          { task: null, children: [{ type: 'paragraph', children: [text('four')] }] },
        ],
      },
      {
        type: 'list', ordered: false, start: 1,
        items: [
          { task: false, children: [{ type: 'paragraph', children: [text('open')] }] },
          { task: true, children: [{ type: 'paragraph', children: [text('done')] }] },
        ],
      },
    ]);
  });

  it('reads quotes, with blocks inside them', () => {
    expect(blocks('> A loaf that spreads\n> was proofed too long.\n>\n> - shorten the rise')).toEqual([{
      type: 'quote',
      children: [
        { type: 'paragraph', children: [text('A loaf that spreads'), { type: 'break' }, text('was proofed too long.')] },
        { type: 'list', ordered: false, start: 1, items: [{ task: null, children: [{ type: 'paragraph', children: [text('shorten the rise')] }] }] },
      ],
    }]);
  });

  it('reads code blocks: fenced with a language, fenced without, indented, and one not yet closed', () => {
    expect(blocks('```python\ndef scale(x):\n    return x * 2\n```')).toEqual([{ type: 'code', language: 'python', text: 'def scale(x):\n    return x * 2' }]);
    expect(blocks('```\nWords to paste\n```')).toEqual([{ type: 'code', language: '', text: 'Words to paste' }]);
    expect(blocks('Intro\n\n    indented')).toEqual([{ type: 'paragraph', children: [text('Intro')] }, { type: 'code', language: 'text', text: 'indented' }]);
    expect(blocks('```js\nconst a = 1;\nconst b')).toEqual([{ type: 'code', language: 'js', text: 'const a = 1;\nconst b' }]);
  });

  it('reads tables, with their alignment and an empty cell where two bars meet', () => {
    expect(blocks('| Step | Takes | Notes |\n| :--- | ---: | :-: |\n| Fold | 3 h | **Four** folds |\n| Bake |  | |')).toEqual([{
      type: 'table',
      align: ['left', 'right', 'center'],
      head: [[text('Step')], [text('Takes')], [text('Notes')]],
      rows: [
        [[text('Fold')], [text('3 h')], [{ type: 'strong', children: [text('Four')] }, text(' folds')]],
        [[text('Bake')], [], []],
      ],
    }]);
  });

  it('reads rules', () => {
    expect(blocks('Above\n\n---\n\nBelow').map((block) => block.type)).toEqual(['paragraph', 'rule', 'paragraph']);
  });

  it('never makes markup of HTML: it stays the characters it was written with', () => {
    expect(blocks('<script>alert(1)</script>\n\nA <b onclick="x()">bold</b> word <!-- hidden -->\n\n<img src=x onerror=alert(1)>')).toEqual([
      { type: 'paragraph', children: [text('<script>alert(1)</script>')] },
      { type: 'paragraph', children: [text('A <b onclick="x()">bold</b> word <!-- hidden -->')] },
      { type: 'paragraph', children: [text('<img src=x onerror=alert(1)>')] },
    ]);
  });

  it('gives each block the text it was read from, which stays the same as more arrives', () => {
    const first = parseMarkdown('Intro\n\n- one\n- two\n\nLast par', { streaming: true });
    const later = parseMarkdown('Intro\n\n- one\n- two\n\nLast paragraph, now longer', { streaming: true });
    expect(first.map((parsed) => parsed.source)).toEqual(['Intro', '- one\n- two', 'Last par']);
    expect(later.slice(0, 2).map((parsed) => parsed.source)).toEqual(first.slice(0, 2).map((parsed) => parsed.source));
  });
});

describe('a reply that is still arriving', () => {
  it('is a table from its first row', () => {
    expect(settleStreaming('Intro\n\n| Step | Start')).toBe('Intro\n\n| Step | Start\n| --- | --- |');
    expect(settleStreaming('| Step | Start |\n| --')).toBe('| Step | Start |\n| --- | --- |');
    expect(settleStreaming('| Step | Start |\n| --- | :-: |')).toBe('| Step | Start |\n| --- | :-: |');
    expect(blocks('| Step | Start', true)).toEqual([{ type: 'table', align: [null, null], head: [[text('Step')], [text('Start')]], rows: [] }]);
    expect(blocks('| Step | Start |\n| --- | --- |\n| Fold | 12', true)).toEqual([{
      type: 'table', align: [null, null], head: [[text('Step')], [text('Start')]], rows: [[[text('Fold')], [text('12')]]],
    }]);
  });

  it('shows a link’s words while its address arrives', () => {
    expect(settleStreaming('See [the plan](Projects/Gar')).toBe('See the plan');
    expect(blocks('See [the plan](Projects/Gar', true)).toEqual([{ type: 'paragraph', children: [text('See the plan')] }]);
    expect(blocks('See [the plan](Projects/Garden/Beds.md) now', true)[0]).toMatchObject({ children: [text('See '), { type: 'link' }, text(' now')] });
  });

  it('closes bold and code opened on the last line', () => {
    expect(blocks('Tomatoes go in **Bed', true)).toEqual([{ type: 'paragraph', children: [text('Tomatoes go in '), { type: 'strong', children: [text('Bed')] }] }]);
    expect(blocks('Tomatoes go in **', true)).toEqual([{ type: 'paragraph', children: [text('Tomatoes go in')] }]);
    expect(blocks('Tomatoes go in **Bed 4*', true)).toEqual([{ type: 'paragraph', children: [text('Tomatoes go in '), { type: 'strong', children: [text('Bed 4')] }] }]);
    expect(blocks('Run `npm te', true)).toEqual([{ type: 'paragraph', children: [text('Run '), { type: 'code', text: 'npm te' }] }]);
    expect(blocks('Run `', true)).toEqual([{ type: 'paragraph', children: [text('Run')] }]);
  });

  it('leaves the inside of an open code block alone', () => {
    expect(settleStreaming('```js\nconst a = **\n| x | y')).toBe('```js\nconst a = **\n| x | y');
  });

  it('changes nothing in a reply that is whole', () => {
    expect(blocks('Tomatoes go in **Bed')).toEqual([{ type: 'paragraph', children: [text('Tomatoes go in **Bed')] }]);
  });
});

describe('where a link goes', () => {
  it('sends web and mail addresses outside the app', () => {
    expect(linkTarget('https://example.com/shaping', CONTEXT)).toEqual({ kind: 'external', url: 'https://example.com/shaping' });
    expect(linkTarget('mailto:club@example.com', CONTEXT)).toEqual({ kind: 'external', url: 'mailto:club@example.com' });
  });

  it('reads a path from the vault’s top as a vault file', () => {
    expect(linkTarget('Projects/Garden/Beds.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Projects/Garden/Beds.md' });
    expect(linkTarget('Recipes/Bread#method', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread' });
    expect(linkTarget('Library/a%20note.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Library/a note.md' });
    expect(linkTarget('notes.md', CONTEXT)).toEqual({ kind: 'vault', path: 'notes.md' });
    expect(linkTarget('./Projects/../Recipes/Bread.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread.md' });
  });

  it('reads an absolute path below an opened folder, on this Mac or as the service’s machine wrote it', () => {
    expect(linkTarget('/Users/me/Vault/Recipes/Bread.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread.md' });
    expect(linkTarget('/home/other/work/Vault/Recipes/Bread.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread.md' });
    expect(linkTarget('file:///Users/me/Vault/Recipes/Bread.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread.md' });
    expect(linkTarget('opal://open?path=Recipes%2FBread.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread.md' });
  });

  it('follows nothing else', () => {
    for (const href of ['', '#top', '//example.com/x', '~/notes.md', '../outside.md', '/etc/hosts', '/Users/me/Vault', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/hosts', 'Elsewhere/thing', 'ftp://example.com/x']) {
      expect(linkTarget(href, CONTEXT), href).toBeNull();
    }
  });

  it('reads a wiki link as a path from the vault’s top', () => {
    expect(wikiTarget('Recipes/Bread')).toEqual({ kind: 'vault', path: 'Recipes/Bread' });
    expect(wikiTarget('Recipes/Bread#Method')).toEqual({ kind: 'vault', path: 'Recipes/Bread' });
    expect(wikiTarget('../../etc/hosts')).toBeNull();
  });

  it('links a code span only when it is nothing but a vault page’s path', () => {
    expect(codeTarget('Projects/Kitchen/Pantry.md', CONTEXT)).toEqual({ kind: 'vault', path: 'Projects/Kitchen/Pantry.md' });
    expect(codeTarget('/Users/me/Vault/Recipes/Bread.mdo', CONTEXT)).toEqual({ kind: 'vault', path: 'Recipes/Bread.mdo' });
    expect(codeTarget('npm test', CONTEXT)).toBeNull();
    expect(codeTarget('Elsewhere/readme.md', CONTEXT)).toBeNull();
    expect(codeTarget('Projects/Garden', CONTEXT)).toBeNull();
  });
});

describe('the Auto feature’s source', () => {
  it('never sets HTML, builds no address and reaches no network from the page', () => {
    const collect = (directory: string): string[] =>
      readdirSync(directory).flatMap((name) => {
        const file = path.join(directory, name);
        if (statSync(file).isDirectory()) return collect(file);
        return /\.tsx?$/.test(name) ? [file] : [];
      });
    const files = collect(path.resolve(__dirname, '../../renderer/features/auto'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write|DOMParser/);
      expect(source, file).not.toMatch(/\bfetch\(|XMLHttpRequest|EventSource|WebSocket|sendBeacon/);
      expect(source, file).not.toMatch(/sends\s*:/);
    }
  });
});

describe('a reply, drawn', () => {
  const REPLY = [
    '## Timings',
    '',
    '| Step | Takes |',
    '| --- | ---: |',
    '| Fold | 3 h |',
    '',
    '1. Feed the **starter**',
    '   - a nested point',
    '',
    '> A quote',
    '',
    '```python',
    'def scale(x): return x * 2',
    '```',
    '',
    'See [Bread](Recipes/Bread.md), `Projects/Kitchen/Pantry.md` and a [video](https://example.com/shaping).',
    '',
    '---',
    '',
    '<script>window.hacked = true</script> <img src=x onerror="window.hacked = true">',
  ].join('\n');

  function draw(markdown: string, streaming = false) {
    const openVault = vi.fn();
    const result = render(
      <TooltipProvider>
        <MarkdownLinksContext.Provider value={{ context: CONTEXT, openVault }}>
          <Markdown text={markdown} streaming={streaming} />
        </MarkdownLinksContext.Provider>
      </TooltipProvider>
    );
    return { ...result, openVault };
  }

  it('draws headings, a table, lists, a quote, code and a rule as elements', () => {
    const { container } = draw(REPLY);
    expect(container.querySelector('h2')?.textContent).toBe('Timings');
    expect([...container.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Step', 'Takes']);
    expect((container.querySelectorAll('td')[1] as HTMLElement).style.textAlign).toBe('right');
    expect(container.querySelector('ol > li > ul > li')?.textContent).toBe('a nested point');
    expect(container.querySelector('ol strong')?.textContent).toBe('starter');
    expect(container.querySelector('blockquote')?.textContent).toBe('A quote');
    expect(container.querySelector('.auto-md-block[data-language="python"] pre')?.textContent).toBe('def scale(x): return x * 2');
    expect(container.querySelectorAll('hr')).toHaveLength(1);
  });

  it('never runs HTML from the text', () => {
    const { container } = draw(REPLY);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>window.hacked = true</script>');
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it('opens a web link outside the app, and nothing in the page navigates', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    draw(REPLY);
    const link = screen.getByRole('link', { name: 'video' });
    expect(link.getAttribute('href')).toBe('https://example.com/shaping');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledWith('https://example.com/shaping', '_blank');
    open.mockRestore();
  });

  it('opens a vault file through the app, by its path from the vault’s top', () => {
    const { openVault, container } = draw(REPLY);
    const page = screen.getByRole('link', { name: 'Bread' });
    expect(page.getAttribute('href')).toBeNull();
    fireEvent.click(page);
    expect(openVault).toHaveBeenLastCalledWith('Recipes/Bread.md', false, expect.objectContaining({ atLink: true }));
    fireEvent.click(container.querySelector('[data-vault-path="Projects/Kitchen/Pantry.md"]') as HTMLElement);
    expect(openVault).toHaveBeenLastCalledWith('Projects/Kitchen/Pantry.md', false, expect.objectContaining({ atLink: true }));
    fireEvent.keyDown(page, { key: 'Enter' });
    expect(openVault).toHaveBeenCalledTimes(3);
  });

  it('draws a link it does not follow as plain words', () => {
    const { container } = draw('A [strange link](javascript:alert(1)) and [another](/etc/hosts).');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[role="link"]')).toBeNull();
    expect(container.textContent).toBe('A strange link and another.');
  });

  it('sets a block with no language as words to paste, with Copy', () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = draw('```\nDear club,\nthe path is clear.\n```');
    expect(container.querySelector('.auto-md-block')?.hasAttribute('data-paste')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Dear club,\nthe path is clear.');
  });

  it('keeps the blocks already written as they are while a reply streams', () => {
    const { container, rerender, openVault } = draw('Intro paragraph\n\n- one\n- two\n\nThe la', true);
    const before = [...container.querySelectorAll('.auto-md > *')];
    rerender(
      <TooltipProvider>
        <MarkdownLinksContext.Provider value={{ context: CONTEXT, openVault }}>
          <Markdown text={'Intro paragraph\n\n- one\n- two\n\nThe last one, **now lon'} streaming />
        </MarkdownLinksContext.Provider>
      </TooltipProvider>
    );
    const after = [...container.querySelectorAll('.auto-md > *')];
    expect(after).toHaveLength(3);
    // The same elements, not new ones: nothing above the last block was drawn again.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2].querySelector('strong')?.textContent).toBe('now lon');
  });
});
