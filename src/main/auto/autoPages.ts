import { open, stat } from 'fs/promises';
import path from 'path';
import { HiddenPathError, type RootRegistry } from '@/main/fs/RootRegistry';
import { HIDDEN_MESSAGE } from '@/types/hidden';

/*
 * The service names files by their path from its vault's top, such as
 * `Library/notes/plan.md`. Opal reads such a path inside its own opened
 * folders only: the vault first, then any other. The file is found through
 * RootRegistry, the same check every other open passes, so a path can never
 * lead outside an opened folder or to a hidden file.
 */

export interface AutoPagesDependencies {
  registry: Pick<RootRegistry, 'assertAllowed' | 'list'>;
  /** The opened folders that are vaults. */
  vaults: () => Promise<string[]>;
}

/** A page found, with its first heading; or why there is none, `missing` when no opened folder holds it. */
export type ResolvedPage = { path: string; title: string | null } | { error: string; missing?: true };

const PATH_LIMIT = 1_024;
/** How much of a page is read for its heading. */
const HEAD_BYTES = 16 * 1024;
/** The longest heading kept, in characters. */
const TITLE_LIMIT = 160;

/**
 * A page's first heading, from the start of its text: front matter is
 * skipped, and so is a fenced block. Null when the start holds none.
 */
export function firstHeading(text: string): string | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let at = 0;
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)[ \t]*$/.test(line));
    if (end === -1) return null;
    at = end + 1;
  }
  let fence: string | null = null;
  for (; at < lines.length; at += 1) {
    const line = lines[at];
    const marks = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marks && marks[1][0] === fence[0] && marks[1].length >= fence.length) fence = null;
      continue;
    }
    if (marks) {
      fence = marks[1];
      continue;
    }
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!heading) continue;
    const words = heading[1].replace(/\s+/g, ' ').trim();
    if (!words) continue;
    return words.length > TITLE_LIMIT ? `${words.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : words;
  }
  return null;
}

/** The first heading of a Markdown file, read from its start only. */
async function headingOf(file: string): Promise<string | null> {
  if (!/\.(md|mdo|markdown)$/i.test(file)) return null;
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    // A line cut at the end of what was read is left out, with any half character.
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return firstHeading(bytesRead === HEAD_BYTES ? text.slice(0, text.lastIndexOf('\n') + 1) : text);
  } finally {
    await handle.close();
  }
}

/** A path from a folder's top as the service may write it: relative, with no `..` and no empty or dot parts. */
export function vaultRelative(written: unknown): string | null {
  if (typeof written !== 'string' || written.length === 0 || written.length > PATH_LIMIT) return null;
  if (written.includes('\0') || written.includes('\\') || path.isAbsolute(written) || written.startsWith('~')) return null;
  const parts = written.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

/** As the service reads a page path: with `.md`, then `.mdo`, then as written. A path that names its kind is read as written. */
function candidates(relative: string): string[] {
  return /\.[A-Za-z0-9]{1,8}$/.test(relative) ? [relative] : [`${relative}.md`, `${relative}.mdo`, relative];
}

/** The file in an opened folder that `written` names, or why there is none. */
export async function resolveVaultPage(deps: AutoPagesDependencies, written: unknown): Promise<ResolvedPage> {
  const relative = vaultRelative(written);
  if (!relative) return { error: 'That is not a path in the vault.' };
  const vaults = await deps.vaults().catch((): string[] => []);
  const roots = [...vaults, ...deps.registry.list().filter((root) => !vaults.includes(root))];
  let hidden = false;
  for (const root of roots) {
    for (const candidate of candidates(relative)) {
      try {
        const real = await deps.registry.assertAllowed(path.join(root, candidate));
        if ((await stat(real)).isFile()) return { path: real, title: await headingOf(real).catch(() => null) };
      } catch (error) {
        if (error instanceof HiddenPathError) hidden = true;
      }
    }
  }
  if (hidden) return { error: HIDDEN_MESSAGE };
  return roots.length === 0 ? { error: 'Open your vault folder first.' } : { error: `Could not find ${relative}.`, missing: true };
}
