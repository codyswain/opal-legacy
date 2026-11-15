import { GFM, parser as baseParser, type MarkdownConfig } from '@lezer/markdown';

/** A node of the parsed tree. */
type SyntaxNode = ReturnType<typeof baseParser.parse>['topNode'];

/*
 * A reply's Markdown as a small tree of plain objects, which Markdown.tsx
 * draws as elements. The text is parsed, never run: HTML in a reply comes
 * out as the characters it is written with, and nothing here makes markup.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  /** A Markdown link or a bare address. */
  | { type: 'link'; href: string; children: Inline[] }
  /** A wiki link, `[[path|words]]`. */
  | { type: 'wiki'; target: string; children: Inline[] }
  | { type: 'break' };

export interface ListItem {
  /** A task's box: true when ticked, null for an item that is no task. */
  task: boolean | null;
  children: Block[];
}

export type Align = 'left' | 'right' | 'center' | null;

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  /** A fenced or indented block. With no language it holds words to paste, not code. */
  | { type: 'code'; language: string; text: string }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

/** One block at the top of a reply, with the text it was read from. */
export interface ParsedBlock {
  source: string;
  block: Block;
}

const WikiLinks: MarkdownConfig = {
  defineNodes: ['WikiLink'],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
        const rest = cx.slice(pos + 2, cx.end);
        const end = rest.indexOf(']]');
        if (end <= 0 || rest.slice(0, end).includes('\n') || rest.slice(0, end).includes('[[')) return -1;
        return cx.addElement(cx.elt('WikiLink', pos, pos + end + 4));
      },
    },
  ],
};

const parser = baseParser.configure([GFM, WikiLinks]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rarr: '→', larr: '←', times: '×', deg: '°' };

function entity(written: string): string {
  const name = written.slice(1, -1);
  if (name.startsWith('#')) {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : written;
  }
  return ENTITIES[name] ?? written;
}

/** Adds text, turning each line end into a break and joining it to text already there. */
function pushText(out: Inline[], text: string): void {
  const lines = text.split(/[ \t]*\n[ \t]*/);
  lines.forEach((line, at) => {
    if (at > 0) out.push({ type: 'break' });
    const last = out[out.length - 1];
    // A line opens without the spaces that indent it.
    const words = !last || last.type === 'break' ? line.replace(/^[ \t]+/, '') : line;
    if (!words) return;
    if (last?.type === 'text') last.text += words;
    else out.push({ type: 'text', text: words });
  });
}

const MARKS = new Set(['EmphasisMark', 'CodeMark', 'LinkMark', 'QuoteMark', 'HeaderMark', 'ListMark', 'TaskMarker', 'TableDelimiter', 'StrikethroughMark', 'LinkTitle', 'LinkLabel']);

function children(node: SyntaxNode, name: string): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) if (child.name === name) found.push(child);
  return found;
}

/** An address as a link holds it: a bare `www.` gets https, a bare mail address `mailto:`. */
function address(written: string): string {
  if (/^www\./i.test(written)) return `https://${written}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(written) && /^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(written)) return `mailto:${written}`;
  return written;
}

function inlineNode(node: SyntaxNode, doc: string, out: Inline[]): void {
  const raw = doc.slice(node.from, node.to);
  switch (node.name) {
    case 'Emphasis':
      out.push({ type: 'em', children: inlines(node, node.from, node.to, doc) });
      return;
    case 'StrongEmphasis':
      out.push({ type: 'strong', children: inlines(node, node.from, node.to, doc) });
      return;
    case 'Strikethrough':
      out.push({ type: 'del', children: inlines(node, node.from, node.to, doc) });
      return;
    case 'InlineCode': {
      const marks = children(node, 'CodeMark');
      let text = marks.length >= 2 ? doc.slice(marks[0].to, marks[marks.length - 1].from) : raw;
      text = text.replace(/\n/g, ' ');
      if (text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim()) text = text.slice(1, -1);
      out.push({ type: 'code', text });
      return;
    }
    case 'Link':
    case 'Image': {
      const marks = children(node, 'LinkMark');
      const url = node.getChild('URL');
      // A `[label]` with no address, or one that points at a definition elsewhere, is the words it was written with.
      if (!url || marks.length < 2) {
        pushText(out, raw);
        return;
      }
      const label = inlines(node, marks[0].to, marks[1].from, doc);
      const href = doc.slice(url.from, url.to).replace(/^<|>$/g, '');
      out.push({ type: 'link', href, children: label.length > 0 ? label : [{ type: 'text', text: href }] });
      return;
    }
    case 'Autolink': {
      const url = node.getChild('URL');
      const text = url ? doc.slice(url.from, url.to) : raw;
      out.push({ type: 'link', href: address(text), children: [{ type: 'text', text }] });
      return;
    }
    case 'URL':
      out.push({ type: 'link', href: address(raw), children: [{ type: 'text', text: raw }] });
      return;
    case 'WikiLink': {
      const [target, alias] = raw.slice(2, -2).split('|');
      const label = alias?.trim() || target.split('/').pop()?.replace(/#.*$/, '').replace(/\.(md|mdo)$/i, '') || target;
      out.push({ type: 'wiki', target: target.trim(), children: [{ type: 'text', text: label }] });
      return;
    }
    case 'HardBreak':
      out.push({ type: 'break' });
      return;
    case 'Escape':
      pushText(out, raw.slice(1));
      return;
    case 'Entity':
      pushText(out, entity(raw));
      return;
    default:
      // Marks draw nothing. Anything else, an HTML tag among them, is the characters it was written with.
      if (!MARKS.has(node.name)) pushText(out, raw);
  }
}

/** The inline content of `node` between two positions: its child nodes, and the text between them. */
function inlines(node: SyntaxNode, from: number, to: number, doc: string): Inline[] {
  const out: Inline[] = [];
  let at = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from > at) pushText(out, doc.slice(at, child.from));
    inlineNode(child, doc, out);
    at = Math.max(at, child.to);
  }
  if (to > at) pushText(out, doc.slice(at, to));
  const last = out[out.length - 1];
  if (last?.type === 'text') {
    last.text = last.text.replace(/[ \t]+$/, '');
    if (!last.text) out.pop();
  }
  while (out[out.length - 1]?.type === 'break') out.pop();
  return out;
}

/** A table row's cells, an empty one where two bars meet. */
function cells(row: SyntaxNode, doc: string): Inline[][] {
  const found: Inline[][] = [];
  let open = false;
  let first = true;
  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableCell') {
      found.push(inlines(child, child.from, child.to, doc));
      open = false;
    } else if (child.name === 'TableDelimiter') {
      if (open && !first) found.push([]);
      open = true;
    }
    first = false;
  }
  return found;
}

function alignment(row: string): Align[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .map((cell): Align => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null));
}

function literal(text: string): Block {
  const out: Inline[] = [];
  pushText(out, text);
  return { type: 'paragraph', children: out };
}

function codeText(node: SyntaxNode, doc: string): string {
  const parts = children(node, 'CodeText');
  return parts.length > 0 ? doc.slice(parts[0].from, parts[parts.length - 1].to) : '';
}

function blocks(node: SyntaxNode, doc: string): Block[] {
  const found: Block[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const made = block(child, doc);
    if (made) found.push(made);
  }
  return found;
}

function block(node: SyntaxNode, doc: string): Block | null {
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
  if (heading) {
    // A Setext heading ends before the line of = or - under it.
    const underline = node.name.startsWith('Setext') ? node.getChild('HeaderMark') : null;
    return { type: 'heading', level: Number(heading[1]), children: inlines(node, node.from, underline ? underline.from : node.to, doc) };
  }
  switch (node.name) {
    case 'Paragraph':
      return { type: 'paragraph', children: inlines(node, node.from, node.to, doc) };
    case 'Blockquote':
      return { type: 'quote', children: blocks(node, doc) };
    case 'BulletList':
    case 'OrderedList': {
      const items = children(node, 'ListItem').map((item): ListItem => {
        const task = item.getChild('Task');
        if (!task) return { task: null, children: blocks(item, doc) };
        const marker = task.getChild('TaskMarker');
        const rest = blocks(item, doc);
        return {
          task: marker ? /x/i.test(doc.slice(marker.from, marker.to)) : false,
          children: [{ type: 'paragraph', children: inlines(task, marker ? marker.to : task.from, task.to, doc) }, ...rest],
        };
      });
      const mark = node.firstChild?.getChild('ListMark');
      const start = mark ? parseInt(doc.slice(mark.from, mark.to), 10) : 1;
      return { type: 'list', ordered: node.name === 'OrderedList', start: Number.isFinite(start) ? start : 1, items };
    }
    case 'FencedCode': {
      const info = node.getChild('CodeInfo');
      return { type: 'code', language: info ? doc.slice(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() : '', text: codeText(node, doc) };
    }
    case 'CodeBlock':
      return { type: 'code', language: 'text', text: codeText(node, doc) };
    case 'HorizontalRule':
      return { type: 'rule' };
    case 'Table': {
      const header = node.getChild('TableHeader');
      const delimiter = node.getChild('TableDelimiter');
      const head = header ? cells(header, doc) : [];
      const rows = children(node, 'TableRow').map((row) => {
        const made = cells(row, doc);
        return head.map((_cell, at) => made[at] ?? []);
      });
      return { type: 'table', align: delimiter ? alignment(doc.slice(delimiter.from, delimiter.to)) : [], head, rows };
    }
    // A task's text is drawn by its list item; marks draw nothing.
    case 'Task':
    case 'ListMark':
    case 'QuoteMark':
      return null;
    default:
      // HTML blocks, comments and link definitions: the characters they were written with.
      return literal(doc.slice(node.from, node.to));
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const columns = (row: string): number => Math.max(1, row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length);

/**
 * A reply that is still arriving, made to read as it will once it is whole,
 * so text does not jump as the rest comes in: a table is a table from its
 * first row, a link shows its words while its address arrives, and bold or
 * code opened on the last line is closed.
 */
export function settleStreaming(text: string): string {
  const lines = text.split('\n');
  let fenced = false;
  for (const line of lines) if (FENCE.test(line)) fenced = !fenced;
  if (fenced) return text;

  // A table: once its first row is here, the row of dashes is filled in to match.
  let start = lines.length - 1;
  while (start > 0 && lines[start - 1].trim() !== '') start -= 1;
  const last = lines.length - 1;
  if (lines[start].trimStart().startsWith('|') && last - start <= 1) {
    const row = `|${' --- |'.repeat(columns(lines[start]))}`;
    if (last === start) lines.push(row);
    else if (!DELIMITER_ROW.test(lines[last]) || columns(lines[last]) < columns(lines[start])) lines[last] = row;
    return lines.join('\n');
  }

  let tail = lines[last];
  // A link whose address is still arriving shows its words.
  tail = tail.replace(/\[([^\]\n]*)\]\([^)\n]*$/, '$1');
  // Code or bold opened and not yet closed: closed here, or left out when nothing follows the mark yet.
  if ((tail.match(/`/g) ?? []).length % 2 === 1) tail = tail.endsWith('`') ? tail.slice(0, -1) : `${tail}\``;
  const plain = tail.replace(/`[^`]*`/g, '');
  if ((plain.match(/\*\*/g) ?? []).length % 2 === 1) tail = tail.endsWith('**') ? tail.slice(0, -2) : `${tail.replace(/\*$/, '')}**`;
  lines[last] = tail;
  return lines.join('\n');
}

/** The blocks of a reply, each with its source text, which stays the same while later blocks arrive. */
export function parseMarkdown(text: string, options: { streaming?: boolean } = {}): ParsedBlock[] {
  const doc = (options.streaming ? settleStreaming(text) : text).replace(/\r\n?/g, '\n');
  const tree = parser.parse(doc);
  const found: ParsedBlock[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const made = block(node, doc);
    if (made) found.push({ source: doc.slice(node.from, node.to), block: made });
  }
  return found;
}
