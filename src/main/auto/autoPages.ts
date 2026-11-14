import { stat } from 'fs/promises';
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

export type ResolvedPage = { path: string } | { error: string };

const PATH_LIMIT = 1_024;

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
        if ((await stat(real)).isFile()) return { path: real };
      } catch (error) {
        if (error instanceof HiddenPathError) hidden = true;
      }
    }
  }
  if (hidden) return { error: HIDDEN_MESSAGE };
  return { error: roots.length === 0 ? 'Open your vault folder first.' : `Could not find ${relative}.` };
}
