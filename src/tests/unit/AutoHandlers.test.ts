// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoHandlers } from '@/main/auto/AutoHandlers';
import type { AutoService } from '@/main/auto/AutoService';
import { AutoAddressError } from '@/main/auto/autoRequests';
import { firstHeading, resolveVaultPage, vaultRelative } from '@/main/auto/autoPages';
import { HiddenPathError, PathNotAllowedError } from '@/main/fs/RootRegistry';
import { HIDDEN_MESSAGE } from '@/types/hidden';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

let dir: string;
let vault: string;
let other: string;
let hidden: Set<string>;

/** The boundary as RootRegistry keeps it: inside an opened folder, and not hidden. */
const registry = {
  list: () => [other, vault],
  assertAllowed: async (target: string) => {
    const real = await realpath(target);
    if (![vault, other].some((root) => real === root || real.startsWith(`${root}/`))) throw new PathNotAllowedError(target);
    if (hidden.has(real)) throw new HiddenPathError();
    return real;
  },
};
const pages = { registry, vaults: async () => [vault] };

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-auto-pages-')));
  vault = path.join(dir, 'Vault');
  other = path.join(dir, 'Other');
  hidden = new Set();
  await mkdir(path.join(vault, 'Projects/Garden'), { recursive: true });
  await mkdir(path.join(other, 'Projects/Garden'), { recursive: true });
  await writeFile(path.join(vault, 'Projects/Garden/Beds.md'), '# Beds\n');
  await writeFile(path.join(vault, 'Projects/Garden/Seeds.mdo'), '# Seeds\n');
  await writeFile(path.join(vault, 'Projects/Garden/plan.pdf'), 'pdf');
  await writeFile(path.join(other, 'Projects/Garden/Beds.md'), '# Other beds\n');
  await writeFile(path.join(other, 'Only here.md'), '# Only here\n');
  await writeFile(path.join(dir, 'outside.md'), '# Outside\n');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('a page’s first heading', () => {
  it('skips front matter and fenced blocks, strips closing marks, and bounds the length', () => {
    expect(firstHeading('---\ntitle: x\n# not this\n---\nText\n\n## Planting plan ##\n')).toBe('Planting plan');
    expect(firstHeading('```\n# a comment\n```\n#   Spaced   words  \n')).toBe('Spaced words');
    expect(firstHeading('\uFEFF# With a mark\n')).toBe('With a mark');
    expect(firstHeading('No heading here\n#hashtag\n')).toBeNull();
    expect(firstHeading('---\nnever closed\n# Inside\n')).toBeNull();
    expect(firstHeading(`# ${'long '.repeat(80)}`)?.length).toBe(160);
  });

  it('reads only the start of the file', async () => {
    await writeFile(path.join(vault, 'Late.md'), `${'words\n'.repeat(5_000)}# Too late\n`);
    expect(await resolveVaultPage(pages, 'Late.md')).toEqual({ path: path.join(vault, 'Late.md'), title: null });
  });
});

describe('a vault path from the service', () => {
  it('opens the file in the vault, read with .md, then .mdo, then as written', async () => {
    expect(await resolveVaultPage(pages, 'Projects/Garden/Beds.md')).toEqual({ path: path.join(vault, 'Projects/Garden/Beds.md'), title: 'Beds' });
    expect(await resolveVaultPage(pages, 'Projects/Garden/Beds')).toEqual({ path: path.join(vault, 'Projects/Garden/Beds.md'), title: 'Beds' });
    expect(await resolveVaultPage(pages, 'Projects/Garden/Seeds')).toEqual({ path: path.join(vault, 'Projects/Garden/Seeds.mdo'), title: 'Seeds' });
    expect(await resolveVaultPage(pages, './Projects//Garden/plan.pdf')).toEqual({ path: path.join(vault, 'Projects/Garden/plan.pdf'), title: null });
  });

  it('looks in the vault first, then in the other opened folders', async () => {
    expect(await resolveVaultPage(pages, 'Only here')).toEqual({ path: path.join(other, 'Only here.md'), title: 'Only here' });
  });

  it('never leaves the opened folders', async () => {
    for (const written of ['../outside.md', 'Projects/../../outside.md', path.join(dir, 'outside.md'), '/etc/hosts', '~/notes.md', 'a\\b.md', 'a\0b', '', 7, null, 'x'.repeat(1025)]) {
      const page = await resolveVaultPage(pages, written);
      expect('error' in page, String(written)).toBe(true);
    }
    expect(vaultRelative('Projects/../x.md')).toBeNull();
    // A link inside the vault that points out of it is refused by the boundary.
    await symlink(path.join(dir, 'outside.md'), path.join(vault, 'Way out.md'));
    expect(await resolveVaultPage(pages, 'Way out.md')).toEqual({ error: 'Could not find Way out.md.', missing: true });
  });

  it('says a hidden file is hidden, a folder or a missing file is not found', async () => {
    hidden.add(path.join(vault, 'Projects/Garden/Beds.md'));
    hidden.add(path.join(other, 'Projects/Garden/Beds.md'));
    expect(await resolveVaultPage(pages, 'Projects/Garden/Beds.md')).toEqual({ error: HIDDEN_MESSAGE });
    expect(await resolveVaultPage(pages, 'Projects/Garden')).toEqual({ error: 'Could not find Projects/Garden.', missing: true });
    expect(await resolveVaultPage(pages, 'Projects/Nowhere.md')).toEqual({ error: 'Could not find Projects/Nowhere.md.', missing: true });
    expect(await resolveVaultPage({ registry: { ...registry, list: () => [] }, vaults: async () => [] }, 'a.md')).toEqual({ error: 'Open your vault folder first.' });
  });
});

describe('the page’s way to Auto', () => {
  const handlers = new Map<string, Handler>();
  const service = {
    config: vi.fn(async () => ({ url: null as string | null })),
    setAddress: vi.fn(async (url: string) => {
      if (!url.startsWith('https://')) throw new AutoAddressError('The address must start with https://.');
      return { url };
    }),
    request: vi.fn(async () => ({ success: true as const, data: { ok: true } })),
    follow: vi.fn(async () => ({ success: true as const, data: { token: 1 } })),
    unfollow: vi.fn(),
  };
  const folders = { update: vi.fn(async () => 'updated' as const) };
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    new AutoHandlers({
      ipc: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); } } as never,
      service: service as unknown as AutoService,
      pages,
      folders,
    }).registerAll();
  });

  it('answers the address, and says why one is refused', async () => {
    expect(await call('auto:config')).toEqual({ success: true, data: { url: null } });
    expect(await call('auto:set-address', 'https://host.example/agent')).toEqual({ success: true, data: { url: 'https://host.example/agent' } });
    expect(await call('auto:set-address', 'http://host.example')).toEqual({
      success: false,
      error: { kind: 'invalid', message: 'The address must start with https://.' },
    });
    expect(await call('auto:set-address', { url: 'https://host.example' })).toMatchObject({ success: false, error: { kind: 'invalid' } });
    expect(service.setAddress).toHaveBeenCalledTimes(2);
  });

  it('passes on a route it knows, rebuilt, and nothing else', async () => {
    await call('auto:request', { kind: 'message', id: '5a0000000001', text: 'send it', cid: 'a1', sends: true, url: 'https://other.example' });
    expect(service.request).toHaveBeenCalledWith({ kind: 'message', id: '5a0000000001', text: 'send it', cid: 'a1' });
    for (const bad of [null, 'status', { kind: 'thread', id: '../status' }, { kind: 'digest' }, { kind: 'fetch', url: 'https://other.example' }]) {
      expect(await call('auto:request', bad)).toMatchObject({ success: false, error: { kind: 'invalid' } });
    }
    expect(service.request).toHaveBeenCalledTimes(1);
  });

  it('follows and unfollows only the two streams', async () => {
    expect(await call('auto:follow', { stream: 'thread', id: '5a0000000001', cursor: 'b.3' })).toEqual({ success: true, data: { token: 1 } });
    expect(await call('auto:follow', { stream: 'thread', id: 'a/b', cursor: null })).toMatchObject({ success: false });
    expect(await call('auto:unfollow', 'thread')).toEqual({ success: true, data: undefined });
    expect(await call('auto:unfollow', 'everything')).toMatchObject({ success: false });
    expect(service.follow).toHaveBeenCalledTimes(1);
    expect(service.unfollow).toHaveBeenCalledWith('thread');
  });

  it('resolves a page only inside an opened folder', async () => {
    expect(await call('auto:resolve-page', 'Projects/Garden/Beds')).toEqual({ success: true, data: { path: path.join(vault, 'Projects/Garden/Beds.md'), title: 'Beds' } });
    expect(await call('auto:resolve-page', '../outside.md')).toEqual({ success: false, error: { kind: 'invalid', message: 'That is not a path in the vault.' } });
    // A page no opened folder holds is said to be missing, so the page can bring the folders up to date and look again.
    expect(await call('auto:resolve-page', 'Projects/Nowhere.md')).toEqual({ success: false, error: { kind: 'missing', message: 'Could not find Projects/Nowhere.md.' } });
  });

  it('brings the opened folders up to date only with an address set, takes no argument, and answers one word', async () => {
    expect(await call('auto:update-folders')).toEqual({ success: true, data: 'none' });
    expect(folders.update).not.toHaveBeenCalled();
    service.config.mockResolvedValue({ url: 'https://host.example/agent' });
    expect(await call('auto:update-folders', '/etc', { remote: 'https://other.example', command: 'rm' })).toEqual({ success: true, data: 'updated' });
    expect(folders.update).toHaveBeenCalledTimes(1);
    expect(folders.update).toHaveBeenCalledWith();
    folders.update.mockRejectedValueOnce(new Error('/Users/someone/Vault: fatal'));
    expect(await call('auto:update-folders')).toEqual({ success: true, data: 'refused' });
    service.config.mockResolvedValue({ url: null });
  });
});
