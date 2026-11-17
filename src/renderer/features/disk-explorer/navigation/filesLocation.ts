import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  remapFsPath,
} from '@/common/fsPaths';
import { isStackKind } from '@/common/stackModel';
import type { StackKind } from '@/types/stack';

export const FILES_ROUTE_PATH = '/files';

/**
 * The built-in views a tab can show. Folders browse in the sidebar tree.
 */
export interface FilesCollection {
  kind: 'recent' | 'auto' | 'digest';
}

export const RECENT_COLLECTION: FilesCollection = { kind: 'recent' };
export const AUTO_COLLECTION: FilesCollection = { kind: 'auto' };
export const DIGEST_COLLECTION: FilesCollection = { kind: 'digest' };

/** The collection of a stored or written kind, or null for one Opal does not know. */
export function collectionOf(kind: unknown): FilesCollection | null {
  switch (kind) {
    case 'recent': return RECENT_COLLECTION;
    case 'auto': return AUTO_COLLECTION;
    case 'digest': return DIGEST_COLLECTION;
    default: return null;
  }
}

export interface FilesBrowseLocation {
  mode: 'browse';
  collection: FilesCollection;
}

export interface FilesFocusLocation {
  mode: 'focus';
  file: string;
  /** A stack's head opened on its own. Set only on a path that would otherwise open as a stack. */
  alone?: true;
}

/** Several files in one scroll, opened by their head: today's daily page, a recording summary or a thread card. */
export interface FilesStackLocation {
  mode: 'stack';
  kind: StackKind;
  /** The head. */
  file: string;
}

/** What a tab shows: Recent, one file, or a stack of files. */
export type FilesLocation = FilesBrowseLocation | FilesFocusLocation | FilesStackLocation;

export interface FilesNavigationIntent {
  location: FilesLocation;
}

/** The file a place shows, or null for a built-in view. */
export function locationPath(location: FilesLocation): string | null {
  return location.mode === 'browse' ? null : location.file;
}

export function normalizeFilesLocation(
  candidate: FilesLocation | null,
  roots: readonly string[]
): FilesLocation | null {
  if (!candidate || roots.length === 0) return null;
  if (candidate.mode === 'browse') {
    const collection = collectionOf(candidate.collection.kind);
    return collection ? { mode: 'browse', collection } : null;
  }
  const file = normalizeFsPath(candidate.file);
  if (!isAbsoluteFsPath(file) || !roots.some((root) => isFsPathAtOrBelow(root, file))) {
    return null;
  }
  if (candidate.mode === 'stack') {
    return isStackKind(candidate.kind) ? { mode: 'stack', kind: candidate.kind, file } : null;
  }
  return candidate.alone ? { mode: 'focus', file, alone: true } : { mode: 'focus', file };
}

export function parseFilesLocation(
  search: string,
  roots: readonly string[]
): FilesLocation | null {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search
  );
  const mode = params.get('mode');
  if (mode === 'browse') {
    const collection = collectionOf(params.get('collection'));
    return collection ? normalizeFilesLocation({ mode, collection }, roots) : null;
  }
  const file = params.get('file');
  if (!file) return null;
  if (mode === 'stack') {
    const kind = params.get('kind');
    return isStackKind(kind) ? normalizeFilesLocation({ mode, kind, file }, roots) : null;
  }
  if (mode !== 'focus') return null;
  return normalizeFilesLocation(
    params.get('alone') === '1' ? { mode, file, alone: true } : { mode, file },
    roots
  );
}

export function serializeFilesLocation(location: FilesLocation): string {
  const params = new URLSearchParams();
  params.set('mode', location.mode);
  if (location.mode === 'browse') {
    params.set('collection', location.collection.kind);
  } else if (location.mode === 'stack') {
    params.set('kind', location.kind);
    params.set('file', normalizeFsPath(location.file));
  } else {
    params.set('file', normalizeFsPath(location.file));
    if (location.alone) params.set('alone', '1');
  }
  return `?${params.toString()}`;
}

export function filesLocationKey(location: FilesLocation): string {
  return serializeFilesLocation(location);
}

export function browseRecent(): FilesNavigationIntent {
  return { location: { mode: 'browse', collection: RECENT_COLLECTION } };
}

export function browseAuto(): FilesNavigationIntent {
  return { location: { mode: 'browse', collection: AUTO_COLLECTION } };
}

export function isAutoLocation(location: FilesLocation | null): boolean {
  return location?.mode === 'browse' && location.collection.kind === 'auto';
}

export function browseDigest(): FilesNavigationIntent {
  return { location: { mode: 'browse', collection: DIGEST_COLLECTION } };
}

export function isDigestLocation(location: FilesLocation | null): boolean {
  return location?.mode === 'browse' && location.collection.kind === 'digest';
}

/** A file shown in a tab. */
export function fileLocation(file: string): FilesFocusLocation {
  return { mode: 'focus', file: normalizeFsPath(file) };
}

export function focusFile(file: string): FilesNavigationIntent {
  return { location: fileLocation(file) };
}

/** A stack opened by its head. */
export function stackLocation(kind: StackKind, file: string): FilesStackLocation {
  return { mode: 'stack', kind, file: normalizeFsPath(file) };
}

/** A file shown on its own, even when it would otherwise open as a stack. */
export function aloneLocation(file: string): FilesFocusLocation {
  return { mode: 'focus', file: normalizeFsPath(file), alone: true };
}

/** The place after a rename or move; Recent, Auto and files outside it stay as they are. */
export function remapFilesLocation(
  location: FilesLocation,
  oldPath: string,
  newPath: string
): FilesLocation {
  if (location.mode === 'browse') return location;
  const file = remapFsPath(location.file, oldPath, newPath);
  if (location.mode === 'stack') return stackLocation(location.kind, file);
  return location.alone ? aloneLocation(file) : fileLocation(file);
}
