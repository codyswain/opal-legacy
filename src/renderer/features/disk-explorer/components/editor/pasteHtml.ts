/*
 * A clipboard's HTML as Markdown, so text copied from a web page or a word
 * processor pastes with its bold, italic, strikethrough, links, headings,
 * lists, check boxes, quotes, code and tables, as it would into a word
 * processor. Only what Markdown holds is kept: colours, fonts, sizes,
 * underline and pictures are dropped. Text is escaped where it would read as
 * Markdown. HTML with no formatting to keep gives null, and the clipboard's
 * plain text is pasted as before.
 *
 * The HTML is parsed into a document of its own, which runs no script and
 * loads nothing.
 */

interface Style {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  href: string | null;
}

interface Run extends Style {
  text: string;
}

const PLAIN: Style = { bold: false, italic: false, strike: false, code: false, href: null };

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS',
]);
const BLOCK_SELECTOR = [...BLOCK_TAGS].map((tag) => tag.toLowerCase()).join(',');
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IMG', 'PICTURE', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NOSCRIPT', 'TEMPLATE']);
const SAFE_LINK = /^(?:https?:|mailto:|obsidian:|opal:)/i;

/** State for one conversion: whether anything worth keeping was found. */
interface Found {
  rich: boolean;
}

function weightOf(value: string): boolean | null {
  const weight = value.trim().toLowerCase();
  if (!weight) return null;
  if (weight === 'bold' || weight === 'bolder') return true;
  if (weight === 'normal' || weight === 'lighter') return false;
  const number = Number(weight);
  return Number.isFinite(number) ? number >= 600 : null;
}

/** The style text inside `element` takes, given the style around it. */
function styleOf(element: HTMLElement, around: Style): Style {
  const style = { ...around };
  const tag = element.tagName;
  if (tag === 'B' || tag === 'STRONG') style.bold = true;
  if (tag === 'I' || tag === 'EM') style.italic = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') style.strike = true;
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') style.code = true;
  if (tag === 'A') {
    const href = element.getAttribute('href')?.trim() ?? '';
    if (SAFE_LINK.test(href)) style.href = href;
  }
  // A word processor writes its styles inline, and wraps what it copies in a bold tag with a normal weight.
  const weight = weightOf(element.style.fontWeight);
  if (weight !== null) style.bold = weight;
  const slant = element.style.fontStyle.trim().toLowerCase();
  if (slant === 'italic' || slant === 'oblique') style.italic = true;
  else if (slant === 'normal') style.italic = false;
  const line = `${element.style.textDecoration} ${element.style.textDecorationLine}`.toLowerCase();
  if (line.includes('line-through')) style.strike = true;
  return style;
}

/** The runs of styled text under `node`, with "\n" for a line break. */
function runsOf(node: Node, around: Style, pre: boolean, out: Run[] = []): Run[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.nodeValue ?? '';
    const text = pre ? raw : raw.replace(/[ \t\r\n]+/g, ' ');
    if (text) out.push({ ...around, text });
    return out;
  }
  if (!(node instanceof HTMLElement) || SKIPPED.has(node.tagName)) return out;
  if (node.tagName === 'BR') {
    out.push({ ...PLAIN, text: '\n' });
    return out;
  }
  const style = styleOf(node, around);
  for (const child of node.childNodes) runsOf(child, style, pre, out);
  return out;
}

const WORD = /[\p{L}\p{N}]/u;

/** `text` written so Markdown reads it as plain text. */
function escaped(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const before = text[index - 1] ?? '';
    const after = text[index + 1] ?? '';
    if ('\\*`[]<'.includes(character)) out += `\\${character}`;
    // An underscore inside a word is only a character.
    else if (character === '_' && !(WORD.test(before) && WORD.test(after))) out += '\\_';
    else if (character === '~' && (before === '~' || after === '~')) out += '\\~';
    // Two dollar signs around text would read as a formula.
    else if (character === '$' && /\S/.test(after) && /\S\$/.test(text.slice(index + 1))) out += '\\$';
    else out += character;
  }
  return out;
}

/** `text` with its words rewritten by `write`, and the spaces at its ends left outside. */
function around(text: string, write: (words: string) => string): string {
  const lead = /^\s*/.exec(text)?.[0] ?? '';
  const trail = /\s*$/.exec(text.slice(lead.length))?.[0] ?? '';
  const words = text.slice(lead.length, text.length - trail.length);
  return words ? `${lead}${write(words)}${trail}` : text;
}

/** `text` with the marks `open` and `close` around its words, never against a space. */
const wrapped = (text: string, open: string, close = open) => around(text, (words) => `${open}${words}${close}`);

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

const sameMarks = (a: Style, b: Style) => a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code;

/** Runs without their links, as Markdown. */
function marked(runs: readonly Run[], found: Found): string {
  let out = '';
  for (let index = 0; index < runs.length;) {
    const first = runs[index];
    let text = '';
    let end = index;
    while (end < runs.length && sameMarks(runs[end], first) && (runs[end].text === '\n') === (first.text === '\n')) { text += runs[end].text; end += 1; }
    index = end;
    if (first.text === '\n' || !/\S/.test(text)) { out += text; continue; }
    if (first.code) { found.rich = true; out += around(text, codeSpan); continue; }
    let piece = escaped(text);
    if (first.italic) piece = wrapped(piece, '*');
    if (first.bold) piece = wrapped(piece, '**');
    if (first.strike) piece = wrapped(piece, '~~');
    if (first.italic || first.bold || first.strike) found.rich = true;
    out += piece;
  }
  return out;
}

const destination = (url: string) => (/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url);

/** Runs as one piece of inline Markdown, its line breaks kept as "\n". */
function inlineOf(runs: readonly Run[], found: Found): string {
  let out = '';
  for (let index = 0; index < runs.length;) {
    const { href } = runs[index];
    let end = index;
    while (end < runs.length && runs[end].href === href) end += 1;
    const group = runs.slice(index, end);
    index = end;
    if (!href) { out += marked(group, found); continue; }
    const text = group.map((run) => run.text).join('');
    found.rich = true;
    // A link whose text is its own address is written as the address.
    if (text.trim() === href || !/\S/.test(text)) out += around(text, () => href);
    else out += wrapped(marked(group, found).replace(/\n/g, ' '), '[', `](${destination(href)})`);
  }
  // Spaces at a line's ends mean nothing, and two at its end would be a hard break.
  return out.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
}

/** A paragraph's line that would open a Markdown block, with that mark escaped. */
function plainLine(line: string): string {
  return line
    .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
    .replace(/^([-+>])(?=\s|$)/, '\\$1')
    .replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^(-{3,}|={3,}|_{3,})\s*$/, '\\$1')
    .replace(/^(\|)/, '\\$1');
}

const isBlock = (node: Node): node is HTMLElement => node instanceof HTMLElement && (BLOCK_TAGS.has(node.tagName) || node.querySelector(BLOCK_SELECTOR) !== null);

/** A list as lines: its items, with nested lists and later paragraphs under each item's text. */
function listLines(list: HTMLElement, found: Found): string[] {
  found.rich = true;
  const ordered = list.tagName === 'OL';
  let number = Number.parseInt(list.getAttribute('start') ?? '1', 10) || 1;
  const lines: string[] = [];
  let indent = '  ';
  for (const child of list.children) {
    if (!(child instanceof HTMLElement)) continue;
    // A word processor writes a nested list beside the item it belongs to, not inside it.
    if (child.tagName === 'UL' || child.tagName === 'OL') {
      lines.push(...listLines(child, found).map((line) => (line ? indent + line : line)));
      continue;
    }
    if (child.tagName !== 'LI') continue;
    // A box written as an input: the item's own child, or inside its first paragraph or label.
    const direct = [...child.children];
    const box = [...direct, ...direct.filter((element) => element.tagName === 'P' || element.tagName === 'LABEL').flatMap((element) => [...element.children])]
      .find((element) => element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox');
    const ticked = child.getAttribute('role') === 'checkbox' ? child.getAttribute('aria-checked') === 'true' : box ? box.hasAttribute('checked') : null;
    const marker = ticked !== null ? `- [${ticked ? 'x' : ' '}] ` : ordered ? `${number}. ` : '- ';
    if (ordered && ticked === null) number += 1;
    indent = ' '.repeat(ticked !== null ? 2 : marker.length);
    const blocks = blocksOf(child, found);
    if (blocks.length === 0) blocks.push(['']);
    blocks.forEach((block, index) => {
      const nested = /^\s*(?:[-+*]|\d+[.)])\s/.test(block[0] ?? '');
      if (index === 0) {
        lines.push(marker + (block[0] ?? ''), ...block.slice(1).map((line) => (line ? indent + line : line)));
        return;
      }
      // A nested list sits right under its item; another paragraph needs a blank line.
      if (!nested) lines.push('');
      lines.push(...block.map((line) => (line ? indent + line : line)));
    });
  }
  return lines;
}

function tableLines(table: HTMLElement, found: Found): string[] {
  const rows = [...table.querySelectorAll('tr')].filter((row) => row.closest('table') === table)
    .map((row) => [...row.children].filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH')
      .map((cell) => inlineOf(runsOf(cell, PLAIN, false), found).replace(/\n+/g, '<br>').replace(/\|/g, '\\|')));
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length === 0 || width === 0) return [];
  // One cell is only a box around text.
  if (rows.length === 1 && width === 1) return rows[0][0] ? [rows[0][0]] : [];
  found.rich = true;
  const line = (cells: readonly string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)];
}

/** The blocks under `parent`, each as its lines. */
function blocksOf(parent: Node, found: Found, around: Style = PLAIN): string[][] {
  const blocks: string[][] = [];
  let loose: Run[] = [];
  const flush = () => {
    const text = inlineOf(loose, found);
    loose = [];
    if (text) blocks.push(text.split('\n').map(plainLine));
  };
  for (const child of parent.childNodes) {
    if (!isBlock(child)) {
      runsOf(child, around, false, loose);
      continue;
    }
    flush();
    const tag = child.tagName;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      const text = inlineOf(runsOf(child, PLAIN, false), found).replace(/\n+/g, ' ');
      if (text) { found.rich = true; blocks.push([`${'#'.repeat(Number(heading[1]))} ${text}`]); }
    } else if (tag === 'UL' || tag === 'OL') {
      const lines = listLines(child, found);
      if (lines.length > 0) blocks.push(lines);
    } else if (tag === 'BLOCKQUOTE') {
      const inner = blocksOf(child, found);
      if (inner.length > 0) { found.rich = true; blocks.push(inner.flatMap((block, index) => [...(index > 0 ? ['>'] : []), ...block.map((line) => (line ? `> ${line}` : '>'))])); }
    } else if (tag === 'PRE') {
      const code = (child.textContent ?? '').replace(/\n$/, '');
      if (code.trim()) {
        found.rich = true;
        const fence = '`'.repeat(Math.max(3, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length + 1)));
        blocks.push([fence, ...code.split('\n'), fence]);
      }
    } else if (tag === 'TABLE') {
      const lines = tableLines(child, found);
      if (lines.length > 0) blocks.push(lines);
    } else if (tag === 'HR') {
      found.rich = true;
      blocks.push(['---']);
    } else {
      // A paragraph, or a box around blocks: its own style, such as a word processor's wrapper, carries to its text.
      blocks.push(...blocksOf(child, found, child instanceof HTMLElement ? styleOf(child, around) : around));
    }
  }
  flush();
  return blocks;
}

/** Whether the HTML is a code editor's or a terminal's: text in a fixed-width font with its spaces kept. */
function fromCodeEditor(body: HTMLElement): boolean {
  const first = [...body.children].find((element): element is HTMLElement => element instanceof HTMLElement && (element.tagName === 'DIV' || element.tagName === 'PRE'));
  if (!first || body.children.length > 2) return false;
  return first.style.whiteSpace === 'pre' && /mono|menlo|courier|consolas/i.test(first.style.fontFamily);
}

/**
 * The Markdown for a clipboard's HTML, or null when it holds no formatting
 * Markdown keeps, so the plain text should be pasted instead.
 */
export function markdownFromHtml(html: string): string | null {
  if (!html.trim() || typeof DOMParser === 'undefined') return null;
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  if (!body || fromCodeEditor(body)) return null;
  const found: Found = { rich: false };
  const blocks = blocksOf(body, found);
  if (!found.rich || blocks.length === 0) return null;
  return blocks.map((block) => block.join('\n')).join('\n\n');
}
