import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_COLLECTION,
  browseAuto,
  browseRecent,
  collectionOf,
  filesLocationKey,
  isAutoLocation,
  locationPath,
  normalizeFilesLocation,
  parseFilesLocation,
  remapFilesLocation,
  serializeFilesLocation,
  type FilesLocation,
} from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { locationName, tabLabels } from '@/renderer/features/disk-explorer/components/tabLabels';
import { localDate } from '@/common/vaultModel';

const ROOTS = ['/Vault'];
const AUTO = browseAuto().location;

describe('Auto as a place a tab can show', () => {
  it('is a browse location with no file', () => {
    expect(AUTO).toEqual({ mode: 'browse', collection: AUTO_COLLECTION });
    expect(locationPath(AUTO)).toBeNull();
    expect(isAutoLocation(AUTO)).toBe(true);
    expect(isAutoLocation(browseRecent().location)).toBe(false);
    expect(isAutoLocation({ mode: 'focus', file: '/Vault/a.md' })).toBe(false);
    expect(isAutoLocation(null)).toBe(false);
  });

  it('goes into the URL and comes back out of it', () => {
    expect(serializeFilesLocation(AUTO)).toBe('?mode=browse&collection=auto');
    expect(parseFilesLocation('?mode=browse&collection=auto', ROOTS)).toEqual(AUTO);
    expect(parseFilesLocation('?mode=browse&collection=recent', ROOTS)).toEqual(browseRecent().location);
    expect(parseFilesLocation('?mode=browse&collection=other', ROOTS)).toBeNull();
    expect(filesLocationKey(AUTO)).not.toBe(filesLocationKey(browseRecent().location));
  });

  it('needs an opened folder, as Recent does, and stays put when files move', () => {
    expect(normalizeFilesLocation(AUTO, ROOTS)).toEqual(AUTO);
    expect(normalizeFilesLocation(AUTO, [])).toBeNull();
    expect(normalizeFilesLocation({ mode: 'browse', collection: { kind: 'other' } } as unknown as FilesLocation, ROOTS)).toBeNull();
    expect(remapFilesLocation(AUTO, '/Vault/a.md', '/Vault/b.md')).toBe(AUTO);
    expect(collectionOf('auto')).toBe(AUTO_COLLECTION);
    expect(collectionOf('settings')).toBeNull();
  });

  it('names its tab Auto', () => {
    expect(locationName(AUTO)).toBe('Auto');
    expect(locationName(browseRecent().location)).toBe('Recent');
    expect(tabLabels([AUTO, { mode: 'focus', file: '/Vault/Notes/Auto.md' }], ROOTS)).toEqual([
      { name: 'Auto', hint: null, title: 'Auto' },
      { name: 'Auto', hint: null, title: 'Notes/Auto.md' },
    ]);
  });
});

describe('an Auto tab across a relaunch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('is restored with the session, and a kind Opal does not know is dropped', async () => {
    window.localStorage.setItem('opal.tabs.session', JSON.stringify({
      version: 1,
      value: {
        date: localDate(),
        active: 0,
        tabs: [
          { history: [{ location: { mode: 'browse', collection: { kind: 'auto' } } }], index: 0 },
          { history: [{ location: { mode: 'browse', collection: { kind: 'other' } } }], index: 0 },
          { history: [{ location: { mode: 'browse', collection: { kind: 'recent' } } }], index: 0 },
        ],
      },
    }));
    const { useTabsStore, tabLocation } = await import('@/renderer/features/disk-explorer/store/tabsStore');
    expect(useTabsStore.getState().tabs.map(tabLocation)).toEqual([AUTO, browseRecent().location]);
  });
});
