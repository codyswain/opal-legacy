import { basenameFsPath, isFsPathAtOrBelow } from '@/common/fsPaths';
import { routeLink } from '@/renderer/features/disk-explorer/components/editor/linkSchemes';

/*
 * Where a link in a reply goes. A web or mail address leaves the app the
 * way every other link in Opal does. A path that names a file in the vault
 * becomes a path from the vault's top, which the main process then looks up
 * inside the opened folders. Anything else is not a link.
 */

export type LinkTarget = { kind: 'external'; url: string } | { kind: 'vault'; path: string };

export interface LinkContext {
  /** The opened folders. */
  roots: readonly string[];
  /** The names at the top of the opened folders, such as `Library` and `Projects`. */
  tops: ReadonlySet<string>;
}

const PAGE = /\.(md|mdo)$/i;

/** A path with its `.` and empty parts removed, or null when a `..` would leave the top. */
function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts.join('/') : null;
}

/**
 * An absolute path as a path from the vault's top: the part below an opened
 * folder on this Mac, or, for a path written on the service's machine, the
 * part below a folder named as an opened folder is.
 */
function belowRoot(path: string, roots: readonly string[]): string | null {
  const root = roots.find((candidate) => path !== candidate && isFsPathAtOrBelow(candidate, path));
  if (root) return path.slice(root.length + 1);
  const names = new Set(roots.map(basenameFsPath).filter(Boolean));
  const parts = path.split('/');
  const at = parts.findIndex((part) => names.has(part));
  return at === -1 || at === parts.length - 1 ? null : parts.slice(at + 1).join('/');
}

function vaultTarget(written: string, context: LinkContext, named: boolean): LinkTarget | null {
  let path: string | null = written;
  if (path.startsWith('/')) path = belowRoot(path, context.roots);
  else if (!named && !context.tops.has(path.split('/')[0]) && !PAGE.test(path)) return null;
  const normal = path ? normalize(path) : null;
  return normal ? { kind: 'vault', path: normal } : null;
}

/** Where `href` goes, or null when it is not something Opal follows. */
export function linkTarget(href: string, context: LinkContext): LinkTarget | null {
  const written = href.trim();
  if (!written || written.startsWith('#') || written.startsWith('//') || written.startsWith('~')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(written)) {
    const route = routeLink(written, context.roots);
    if (route.kind === 'external') return { kind: 'external', url: route.url };
    return route.kind === 'vault' ? vaultTarget(route.target, context, true) : null;
  }
  let path = written.split('#')[0].split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // As written.
  }
  return vaultTarget(path, context, false);
}

/** A wiki link's target: always a path from the vault's top. */
export function wikiTarget(target: string): LinkTarget | null {
  const normal = normalize(target.split('#')[0].trim());
  return normal ? { kind: 'vault', path: normal } : null;
}

/** The vault page a code span names, when its text is nothing but that page's path. */
export function codeTarget(text: string, context: LinkContext): LinkTarget | null {
  const written = text.trim();
  if (!PAGE.test(written) || /\s{2,}|\n/.test(written)) return null;
  if (!written.startsWith('/') && !context.tops.has(written.split('/')[0])) return null;
  return vaultTarget(written, context, false);
}

/** Whether a vault path names a page: a Markdown file, or a path with no kind, which is read as one. */
export function isPagePath(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return PAGE.test(name) || !/\.[A-Za-z0-9]{1,8}$/.test(name);
}

/** A page's file name, tidied: no folder and no extension. */
export function tidyName(path: string): string {
  const name = path.split('/').filter(Boolean).pop() ?? path;
  return name.replace(PAGE, '') || name;
}

const comparable = (value: string): string => {
  let text = value.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // As written.
  }
  return text.replace(/^<|>$/g, '').replace(/^\.?\/+/, '').toLowerCase();
};

/**
 * Whether a link's words are its own, and not only its address said again:
 * the path or the address as written, the path without its extension, or the
 * file's name. A wiki link with no words is given the file's name by the
 * parser, so for one that name counts as no words too.
 */
export function ownWords(words: string, written: string, path: string, kind: 'link' | 'wiki' | 'code'): boolean {
  if (kind === 'code') return false;
  const said = comparable(words);
  if (!said) return false;
  const file = path.split('/').pop() ?? path;
  const same = [written, path, path.replace(PAGE, ''), file].map(comparable);
  if (kind === 'wiki') same.push(comparable(tidyName(path)), comparable(written.split('/').pop() ?? ''));
  return !same.includes(said);
}
