import * as React from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import { IconButton } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { codeTarget, isPagePath, linkTarget, ownWords, tidyName, wikiTarget, type LinkContext, type LinkTarget } from '../model/links';
import { usePageTitle } from '../store/pageLinks';
import { parseMarkdown, type Block, type Inline } from './parseMarkdown';
import '../auto.css';

/** How a link to a file in the vault ended: opened, not on this Mac, or refused for another reason (said elsewhere). */
export type VaultOpen = 'opened' | 'missing' | 'refused';

export interface VaultOpenOptions {
  /** The link says a missing page where it is, so the foot of the sidebar says nothing. */
  atLink?: boolean;
  /** Called when the page was not found and the opened folders are being brought up to date. */
  onWorking?: () => void;
}

/** How links in a reply are followed. */
export interface MarkdownLinks {
  context: LinkContext;
  /** Opens a file by its path from the vault's top. */
  openVault: (path: string, newTab: boolean, options?: VaultOpenOptions) => Promise<VaultOpen> | void;
}

const NO_LINKS: MarkdownLinks = { context: { roots: [], tops: new Set() }, openVault: () => undefined };

export const MarkdownLinksContext = React.createContext<MarkdownLinks>(NO_LINKS);

/** How long the line under a link to a missing page stays, unless a click anywhere takes it first. */
export const MISSING_LINE_MS = 6_000;
export const MISSING_LINE = 'This file is not on this Mac yet.';

/** A web or mail address opens outside the app, the way every other link in Opal does: the main process decides. */
function openExternal(event: React.MouseEvent, url: string) {
  event.preventDefault();
  window.open(url, '_blank');
}

/** The words of inline nodes, as one string. */
function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.text;
      if (node.type === 'break') return ' ';
      return plainText(node.children);
    })
    .join('');
}

/** A page's name when its link has no words of its own: its first heading once read, its tidy file name until then. */
function PageName({ path }: { path: string }) {
  const title = usePageTitle(path);
  return <>{title ?? tidyName(path)}</>;
}

/**
 * A link to a file in the vault. A page reads as a page: a small page icon,
 * then its words in the text's colour, cut inside the column on one line,
 * with its path from the folder's top on hover and for a screen reader. A
 * page that is not here yet is looked for again after the opened folders are
 * brought up to date, with the working mark in place of the icon; if it is
 * still missing, a quiet line under the link says so.
 */
function VaultLink({ path, words }: { path: string; words: React.ReactNode | null }) {
  const { openVault } = React.useContext(MarkdownLinksContext);
  const [working, setWorking] = React.useState(false);
  const [missing, setMissing] = React.useState(false);
  const busy = React.useRef(false);
  const alive = React.useRef(true);
  React.useEffect(() => () => {
    alive.current = false;
  }, []);
  React.useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => setMissing(false), MISSING_LINE_MS);
    const away = () => setMissing(false);
    document.addEventListener('pointerdown', away, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', away, true);
    };
  }, [missing]);
  const page = isPagePath(path);
  const open = (newTab: boolean) => {
    if (busy.current) return;
    setMissing(false);
    const result = openVault(path, newTab, { atLink: true, onWorking: () => alive.current && setWorking(true) });
    if (!result) return;
    busy.current = true;
    void result.then(
      (outcome) => {
        busy.current = false;
        if (!alive.current) return;
        setWorking(false);
        if (outcome === 'missing') setMissing(true);
      },
      () => {
        busy.current = false;
        if (alive.current) setWorking(false);
      }
    );
  };
  const link = (
    <span
      role="link"
      tabIndex={0}
      title={path}
      aria-busy={working || undefined}
      data-vault-path={path}
      data-page={page || undefined}
      data-working={working || undefined}
      className={page ? 'auto-page-link' : undefined}
      onClick={(event) => open(event.metaKey || event.ctrlKey)}
      onAuxClick={(event) => event.button === 1 && open(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open(event.metaKey || event.ctrlKey);
      }}
    >
      {page ? (
        <>
          {working ? <span aria-hidden className="auto-spin auto-page-icon" /> : <FileText aria-hidden className="auto-page-icon" strokeWidth={1.75} />}
          <span className="auto-page-words">{words ?? <PageName path={path} />}</span>
        </>
      ) : (
        words ?? tidyName(path)
      )}
    </span>
  );
  return (
    <span className="auto-vault-link" data-page={page || undefined}>
      {link}
      {/* Always in the page, so a screen reader hears the line when it comes. */}
      <span role="status" className="auto-page-missing" data-testid="auto-page-missing">
        {missing ? MISSING_LINE : ''}
      </span>
    </span>
  );
}

function LinkView({ target, children }: { target: LinkTarget | null; children: React.ReactNode }) {
  if (!target) return <>{children}</>;
  if (target.kind === 'external') {
    return (
      <a
        href={target.url}
        target="_blank"
        rel="noreferrer"
        title={target.url}
        onClick={(event) => openExternal(event, target.url)}
        onAuxClick={(event) => event.button === 1 && openExternal(event, target.url)}
      >
        {children}
      </a>
    );
  }
  // A file in the vault opens as a page in Opal, once the main process has found it in an opened folder.
  return <VaultLink path={target.path} words={children} />;
}

/** A link to the vault keeps words of its own; words that only say its address again become the page's name. */
function linkWords(target: LinkTarget | null, words: readonly Inline[], written: string, kind: 'link' | 'wiki', context: LinkContext): React.ReactNode {
  if (target?.kind !== 'vault' || !isPagePath(target.path) || ownWords(plainText(words), written, target.path, kind)) return inlineViews(words, context);
  return null;
}

function InlineView({ node, context }: { node: Inline; context: LinkContext }) {
  switch (node.type) {
    case 'text':
      return <>{node.text}</>;
    case 'break':
      return <br />;
    case 'strong':
      return <strong className="font-semibold">{inlineViews(node.children, context)}</strong>;
    case 'em':
      return <em>{inlineViews(node.children, context)}</em>;
    case 'del':
      return <del>{inlineViews(node.children, context)}</del>;
    case 'code': {
      const target = codeTarget(node.text, context);
      // A code span that is nothing but a page's path is a link to that page, drawn as one.
      if (target?.kind === 'vault') return <VaultLink path={target.path} words={isPagePath(target.path) ? null : <code>{node.text}</code>} />;
      return <code>{node.text}</code>;
    }
    case 'link': {
      const target = linkTarget(node.href, context);
      if (target?.kind === 'vault') return <VaultLink path={target.path} words={linkWords(target, node.children, node.href, 'link', context)} />;
      return <LinkView target={target}>{inlineViews(node.children, context)}</LinkView>;
    }
    case 'wiki': {
      const target = wikiTarget(node.target);
      if (target?.kind === 'vault') return <VaultLink path={target.path} words={linkWords(target, node.children, node.target, 'wiki', context)} />;
      return <LinkView target={target}>{inlineViews(node.children, context)}</LinkView>;
    }
  }
}

function inlineViews(nodes: readonly Inline[], context: LinkContext): React.ReactNode {
  return nodes.map((node, at) => <InlineView key={at} node={node} context={context} />);
}

/**
 * For a box that scrolls sideways: marks which of its edges is cut, so the
 * page fades that edge and the cut does not read as the end.
 */
function useEdgeFade<T extends HTMLElement>(): React.RefObject<T> {
  const box = React.useRef<T>(null);
  React.useEffect(() => {
    const element = box.current;
    if (!element) return;
    const mark = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollWidth - element.clientWidth - element.scrollLeft > 1;
      const fade = start && end ? 'both' : end ? 'end' : start ? 'start' : null;
      if (fade) element.setAttribute('data-fade', fade);
      else element.removeAttribute('data-fade');
    };
    mark();
    element.addEventListener('scroll', mark, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', mark);
      observer?.disconnect();
    };
  });
  return box;
}

/** A table in a box of its own, which scrolls sideways when it is wider than the column. */
function TableBox({ children }: { children: React.ReactNode }) {
  const box = useEdgeFade<HTMLDivElement>();
  return <div ref={box} className="auto-md-table">{children}</div>;
}

/** A fenced block with Copy at its corner. With no language, or `text`, it holds words to paste and is set as text. */
function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const paste = language === '' || language === 'text';
  const lines = useEdgeFade<HTMLPreElement>();
  return (
    <div className="auto-md-block" data-paste={paste || undefined} data-language={language || undefined}>
      <pre ref={lines}>{text}</pre>
      <IconButton label={copied ? 'Copied' : 'Copy'} onClick={copy} className="auto-md-copy bg-surface">
        {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
      </IconButton>
    </div>
  );
}

function BlockView({ block, context }: { block: Block; context: LinkContext }) {
  switch (block.type) {
    case 'paragraph':
      return <p>{inlineViews(block.children, context)}</p>;
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as 'h1';
      return <Tag>{inlineViews(block.children, context)}</Tag>;
    }
    case 'quote':
      return <blockquote>{blockViews(block.children, context)}</blockquote>;
    case 'list': {
      const items = block.items.map((item, at) => (
        <li key={at} data-task={item.task === null ? undefined : ''}>
          {item.task === null ? null : (
            <span className="auto-md-task" role="img" aria-label={item.task ? 'Done' : 'Not done'} data-checked={item.task || undefined} />
          )}
          {blockViews(item.children, context)}
        </li>
      ));
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'code':
      return <CodeBlock language={block.language} text={block.text} />;
    case 'table':
      return (
        <TableBox>
          <table>
            <thead>
              <tr>
                {block.head.map((cell, at) => (
                  <th key={at} style={block.align[at] ? { textAlign: block.align[at] } : undefined}>{inlineViews(cell, context)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) => (
                    <td key={column} style={block.align[column] ? { textAlign: block.align[column] } : undefined}>{inlineViews(cell, context)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableBox>
      );
    case 'rule':
      return <hr />;
  }
}

function blockViews(blocks: readonly Block[], context: LinkContext): React.ReactNode {
  return blocks.map((block, at) => <BlockView key={at} block={block} context={context} />);
}

/**
 * One block at the top of a reply. It draws again only when its own text
 * changes, so the blocks already written stay as they are while the rest of
 * a reply arrives.
 */
const TopBlock = React.memo(
  function TopBlock({ block, context }: { source: string; block: Block; context: LinkContext }) {
    return <BlockView block={block} context={context} />;
  },
  (before, after) => before.source === after.source && before.context === after.context
);

interface MarkdownProps {
  text: string;
  /** The text is still arriving. */
  streaming?: boolean;
  className?: string;
}

/**
 * Markdown as elements. Every piece of the text reaches the page as a text
 * node or as a checked link; none of it is ever set as HTML.
 */
export const Markdown = React.memo(function Markdown({ text, streaming = false, className }: MarkdownProps) {
  const { context } = React.useContext(MarkdownLinksContext);
  const blocks = React.useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  return (
    <div className={cn('auto-md', className)}>
      {blocks.map((parsed, at) => (
        <TopBlock key={at} source={parsed.source} block={parsed.block} context={context} />
      ))}
    </div>
  );
});
