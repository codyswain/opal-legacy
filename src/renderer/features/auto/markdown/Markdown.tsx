import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { codeTarget, linkTarget, wikiTarget, type LinkContext, type LinkTarget } from '../model/links';
import { parseMarkdown, type Block, type Inline } from './parseMarkdown';
import '../auto.css';

/** How links in a reply are followed. */
export interface MarkdownLinks {
  context: LinkContext;
  /** Opens a file by its path from the vault's top. */
  openVault: (path: string, newTab: boolean) => void;
}

const NO_LINKS: MarkdownLinks = { context: { roots: [], tops: new Set() }, openVault: () => undefined };

export const MarkdownLinksContext = React.createContext<MarkdownLinks>(NO_LINKS);

/** A web or mail address opens outside the app, the way every other link in Opal does: the main process decides. */
function openExternal(event: React.MouseEvent, url: string) {
  event.preventDefault();
  window.open(url, '_blank');
}

function LinkView({ target, children }: { target: LinkTarget | null; children: React.ReactNode }) {
  const { openVault } = React.useContext(MarkdownLinksContext);
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
  return (
    <span
      role="link"
      tabIndex={0}
      title={target.path}
      data-vault-path={target.path}
      onClick={(event) => openVault(target.path, event.metaKey || event.ctrlKey)}
      onAuxClick={(event) => event.button === 1 && openVault(target.path, true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') openVault(target.path, event.metaKey || event.ctrlKey);
      }}
    >
      {children}
    </span>
  );
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
    case 'code':
      return <LinkView target={codeTarget(node.text, context)}><code>{node.text}</code></LinkView>;
    case 'link':
      return <LinkView target={linkTarget(node.href, context)}>{inlineViews(node.children, context)}</LinkView>;
    case 'wiki':
      return <LinkView target={wikiTarget(node.target)}>{inlineViews(node.children, context)}</LinkView>;
  }
}

function inlineViews(nodes: readonly Inline[], context: LinkContext): React.ReactNode {
  return nodes.map((node, at) => <InlineView key={at} node={node} context={context} />);
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
  return (
    <div className="auto-md-block" data-paste={paste || undefined} data-language={language || undefined}>
      <pre>{text}</pre>
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
        <div className="auto-md-table">
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
        </div>
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
