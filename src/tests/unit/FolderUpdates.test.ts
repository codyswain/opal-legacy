// @vitest-environment node
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { createServer } from 'net';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FOLDER_UPDATE_LIMITS, FolderUpdates, TERM_GRACE_MS, type FolderUpdatesDependencies } from '@/main/fs/FolderUpdates';
import { gitEnvironment } from '@/main/files/GitLfsStore';

/*
 * Every repo here is a temp folder on this Mac: a bare remote, a clone that
 * stands for the opened folder, and a second clone that pushes. Nothing is
 * fetched from the network and no real checkout is touched. The user's and
 * the system's git settings are left out.
 */
const ENV: NodeJS.ProcessEnv = {
  ...gitEnvironment(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();

let dir: string;
let remote: string;
let vault: string;
let other: string;
let commands: string[][];
/** What each command added to the environment, in the same order. */
let added: Record<string, string>[];

const write = async (root: string, relative: string, text: string) => {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), text);
};

/** A commit on the remote, made in the second clone and pushed. */
const push = async (relative: string, text: string) => {
  await write(other, relative, text);
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', `Change ${relative}`);
  git(other, 'push', '-q', 'origin', 'main');
};

/** Every file of the working tree and its bytes, the HEAD, and what is in git's folder that a rewrite would leave. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (folder: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(root, full)] = (await readFile(full)).toString('base64');
    }
  };
  await walk(root);
  files[':HEAD'] = git(root, 'rev-parse', 'HEAD');
  files[':status'] = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  files[':stash'] = git(root, 'stash', 'list');
  return files;
}

const updates = (more: Partial<FolderUpdatesDependencies> = {}) =>
  new FolderUpdates({
    folders: () => [vault],
    env: () => ENV,
    limits: { gapMs: 0 },
    onCommand: (args, _cwd, envAdded) => {
      commands.push([...args]);
      added.push({ ...envAdded });
    },
    ...more,
  });

/** The git subcommands run, without the settings in front. */
const subcommands = () => commands.map((args) => args.find((arg, at) => at > 0 && args[at - 1] !== '-c' && arg !== '-c') ?? '');

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'opal-folder-updates-')));
  remote = path.join(dir, 'remote.git');
  vault = path.join(dir, 'Vault');
  other = path.join(dir, 'Elsewhere');
  commands = [];
  added = [];
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  git(dir, 'clone', '-q', remote, other);
  git(other, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  await write(other, 'Notes/Ideas.md', '# Ideas\n\nA rain gauge.\n');
  await write(other, 'Projects/Beds.md', '# Beds\n\nFour beds.\n');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'First');
  git(other, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'clone', '-q', remote, vault);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('bringing an opened folder up to date', () => {
  it('fast-forwards a checkout behind its upstream', async () => {
    await push('Library/notes/New page.md', '# New page\n');
    expect(await updates().update()).toBe('updated');
    expect(await readFile(path.join(vault, 'Library/notes/New page.md'), 'utf8')).toBe('# New page\n');
    expect(git(vault, 'rev-parse', 'HEAD')).toBe(git(other, 'rev-parse', 'HEAD'));
    // Only these commands, and the merge only fast-forwards.
    expect(new Set(subcommands())).toEqual(new Set(['symbolic-ref', 'for-each-ref', 'fetch', 'rev-parse', 'merge']));
    const merge = commands.find((args) => args.includes('merge')) ?? [];
    expect(merge).toEqual(expect.arrayContaining(['--ff-only', '--no-autostash', 'core.hooksPath=/dev/null']));
    expect(commands.find((args) => args.includes('fetch'))).toEqual(expect.arrayContaining(['--no-write-fetch-head', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']));
  });

  it('says current when already level', async () => {
    expect(await updates().update()).toBe('current');
  });

  it('keeps a changed file that the incoming commits do not touch', async () => {
    await writeFile(path.join(vault, 'Notes/Ideas.md'), '# Ideas\n\nA rain gauge on the shed.\n');
    await push('Projects/Seeds.md', '# Seeds\n');
    expect(await updates().update()).toBe('updated');
    expect(await readFile(path.join(vault, 'Notes/Ideas.md'), 'utf8')).toBe('# Ideas\n\nA rain gauge on the shed.\n');
    expect(await readFile(path.join(vault, 'Projects/Seeds.md'), 'utf8')).toBe('# Seeds\n');
  });

  it('refuses when the incoming commits change a file changed here, and leaves every file and the HEAD as they were', async () => {
    await writeFile(path.join(vault, 'Notes/Ideas.md'), '# Ideas\n\nTyped here.\n');
    await push('Notes/Ideas.md', '# Ideas\n\nWritten there.\n');
    await push('Projects/Seeds.md', '# Seeds\n');
    const before = await snapshot(vault);
    expect(await updates().update()).toBe('refused');
    expect(await snapshot(vault)).toEqual(before);
  });

  it('refuses with local commits not on the upstream, leaving the HEAD where it was', async () => {
    await write(vault, 'Local.md', '# Local\n');
    git(vault, 'add', '-A');
    git(vault, 'commit', '-q', '-m', 'Local');
    await push('Projects/Seeds.md', '# Seeds\n');
    const before = await snapshot(vault);
    expect(await updates().update()).toBe('refused');
    expect(await snapshot(vault)).toEqual(before);
  });

  it('says current for a checkout only ahead of its upstream', async () => {
    await write(vault, 'Local.md', '# Local\n');
    git(vault, 'add', '-A');
    git(vault, 'commit', '-q', '-m', 'Local');
    const head = git(vault, 'rev-parse', 'HEAD');
    expect(await updates().update()).toBe('current');
    expect(git(vault, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('refuses when an untracked file is in the way', async () => {
    await write(vault, 'Projects/Seeds.md', 'mine, not committed\n');
    await push('Projects/Seeds.md', '# Seeds\n');
    const before = await snapshot(vault);
    expect(await updates().update()).toBe('refused');
    expect(await snapshot(vault)).toEqual(before);
  });

  it('refuses while a merge is in progress', async () => {
    await push('Projects/Seeds.md', '# Seeds\n');
    await writeFile(path.join(vault, '.git/MERGE_HEAD'), `${git(vault, 'rev-parse', 'HEAD')}\n`);
    const head = git(vault, 'rev-parse', 'HEAD');
    expect(await updates().update()).toBe('refused');
    expect(git(vault, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('says none for a branch with no upstream and for a folder that is not a checkout', async () => {
    git(vault, 'checkout', '-q', '-b', 'alone');
    await push('Projects/Seeds.md', '# Seeds\n');
    expect(await updates().update()).toBe('none');
    expect(subcommands()).not.toContain('fetch');
    const plain = path.join(dir, 'Plain');
    await mkdir(plain);
    commands = [];
    expect(await updates({ folders: () => [plain] }).update()).toBe('none');
    expect(commands).toEqual([]);
    expect(await updates({ folders: () => [] }).update()).toBe('none');
  });

  it('skips a repo that git is busy rewriting, running nothing', async () => {
    await push('Projects/Seeds.md', '# Seeds\n');
    await writeFile(path.join(vault, '.git/index.lock'), '');
    expect(await updates().update()).toBe('none');
    await rm(path.join(vault, '.git/index.lock'));
    await writeFile(path.join(vault, '.git/MERGE_AUTOSTASH'), '');
    expect(await updates().update()).toBe('none');
    expect(commands).toEqual([]);
    await rm(path.join(vault, '.git/MERGE_AUTOSTASH'));
    expect(await updates().update()).toBe('updated');
  });

  it('never rebases, whatever pull.rebase says', async () => {
    git(vault, 'config', 'pull.rebase', 'true');
    git(vault, 'config', 'rebase.autoStash', 'true');
    await write(vault, 'Local.md', '# Local\n');
    git(vault, 'add', '-A');
    git(vault, 'commit', '-q', '-m', 'Local');
    await push('Projects/Seeds.md', '# Seeds\n');
    const before = await snapshot(vault);
    expect(await updates().update()).toBe('refused');
    expect(await snapshot(vault)).toEqual(before);
    expect(git(vault, 'rev-list', '--count', 'HEAD')).toBe('2');
    await expect(stat(path.join(vault, '.git/rebase-merge'))).rejects.toThrow();
    expect(subcommands()).not.toContain('rebase');
    expect(subcommands()).not.toContain('pull');
  });

  it('for requests at once runs once and then once more, however many came while the first ran', async () => {
    await push('Projects/Seeds.md', '# Seeds\n');
    const service = updates();
    const outcomes = await Promise.all([service.update(), service.update(), service.update()]);
    expect([...outcomes].sort()).toEqual(['current', 'current', 'updated']);
    expect(subcommands().filter((name) => name === 'fetch')).toHaveLength(2);

    commands = [];
    await push('Projects/Tap.md', '# Tap\n');
    const first = service.update();
    // Once the first run is under way, two more requests make one more run after it.
    while (!subcommands().includes('symbolic-ref')) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = service.update();
    const third = service.update();
    expect(await first).toBe('updated');
    expect(await second).toBe('current');
    expect(await third).toBe('current');
    expect(subcommands().filter((name) => name === 'fetch')).toHaveLength(2);
  });

  it('starts runs in one checkout no sooner than ten seconds apart', async () => {
    expect(FOLDER_UPDATE_LIMITS).toEqual({ fetchMs: 20_000, mergeMs: 30_000, lookMs: 5_000, gapMs: 10_000 });
    let clock = 1_000_000;
    const waits: number[] = [];
    const service = updates({
      limits: {},
      now: () => clock,
      wait: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    expect(await service.update()).toBe('current');
    expect(waits).toEqual([]);
    clock += 3_000;
    await push('Projects/Seeds.md', '# Seeds\n');
    expect(await service.update()).toBe('updated');
    expect(waits).toEqual([7_000]);
    clock += 12_000;
    expect(await service.update()).toBe('current');
    expect(waits).toEqual([7_000]);
  });

  it('asks a fetch that hangs to stop at its limit, so git takes its lock files away, and leaves the tree as it was', async () => {
    await push('Projects/Seeds.md', '# Seeds\n');
    // The remote's end of a fetch, made to hang: it notes its process, and that it was asked to stop.
    const pidFile = path.join(dir, 'hung.pid');
    const asked = path.join(dir, 'asked-to-stop');
    const hang = path.join(dir, 'hang.sh');
    await writeFile(hang, `#!/bin/sh\necho $$ > '${pidFile}'\ntrap 'touch "${asked}"; exit 1' TERM\nsleep 30 &\nwait\n`);
    await chmod(hang, 0o755);
    git(vault, 'config', 'remote.origin.uploadpack', hang);
    const before = await snapshot(vault);
    const started = Date.now();
    expect(await updates({ limits: { gapMs: 0, fetchMs: 500 } }).update()).toBe('refused');
    // Answered once it had gone, well inside the grace before a kill.
    expect(Date.now() - started).toBeLessThan(500 + TERM_GRACE_MS);
    expect(await gone(Number((await readFile(pidFile, 'utf8')).trim()))).toBe(true);
    expect(existsSync(asked)).toBe(true);
    expect(await locks(path.join(vault, '.git'))).toEqual([]);
    expect(await snapshot(vault)).toEqual(before);
    expect(subcommands()).not.toContain('merge');
  }, 15_000);

  it('kills what a stopped fetch started that will not stop, two seconds after asking', async () => {
    await push('Projects/Seeds.md', '# Seeds\n');
    const pidFile = path.join(dir, 'hung.pid');
    const hang = path.join(dir, 'hang.sh');
    // The remote's end, deaf to the request to stop; git itself stops when asked.
    await writeFile(hang, `#!/bin/sh\ntrap '' TERM\necho $$ > '${pidFile}'\nexec sleep 30\n`);
    await chmod(hang, 0o755);
    git(vault, 'config', 'remote.origin.uploadpack', hang);
    const before = await snapshot(vault);
    const started = Date.now();
    expect(await updates({ limits: { gapMs: 0, fetchMs: 300 } }).update()).toBe('refused');
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    // Asked, it is still there; at the end of the grace it is killed.
    expect(alive(pid)).toBe(true);
    expect(Date.now() - started).toBeLessThan(300 + TERM_GRACE_MS);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, started + 300 + TERM_GRACE_MS - Date.now())));
    expect(await gone(pid)).toBe(true);
    expect(await locks(path.join(vault, '.git'))).toEqual([]);
    expect(await snapshot(vault)).toEqual(before);
  }, 15_000);

  it('never kills a merge that has started: answers refused at its limit, and starts nothing in that checkout until the merge has closed', async () => {
    // A file whose checkout is slow: the merge writes it through a filter that takes a second, past the merge's limit
    // but inside the bound on how long a second request waits.
    await push('.gitattributes', '*.slow filter=slow\n');
    git(vault, 'fetch', '-q', 'origin');
    git(vault, 'merge', '-q', '--ff-only', 'origin/main');
    const pidFile = path.join(dir, 'filter.pid');
    git(vault, 'config', 'filter.slow.smudge', `echo $$ > '${pidFile}'; sleep 1; cat`);
    git(vault, 'config', 'filter.slow.clean', 'cat');
    await push('Notes/Big.slow', 'slow bytes\n');
    await push('Notes/Plain.md', '# Plain\n');
    const head = git(other, 'rev-parse', 'HEAD');

    // What the second run saw as each of its commands started: was the first merge still there?
    let second = false;
    const seen: { filterAlive: boolean; lock: boolean }[] = [];
    const service = updates({
      limits: { gapMs: 0, mergeMs: 800 },
      onCommand: (args, _cwd, envAdded) => {
        commands.push([...args]);
        added.push({ ...envAdded });
        if (second) seen.push({ filterAlive: existsSync(pidFile) && alive(Number(readPid(pidFile))), lock: existsSync(path.join(vault, '.git/index.lock')) });
      },
    });
    const started = Date.now();
    expect(await service.update()).toBe('refused');
    expect(Date.now() - started).toBeLessThan(1_000);
    // Given up on, but still at work: its filter runs and git holds the index.
    expect(alive(Number(readPid(pidFile)))).toBe(true);
    expect(existsSync(path.join(vault, '.git/index.lock'))).toBe(true);
    expect(subcommands().at(-1)).toBe('merge');

    // A second request waits for it: no command starts while the merge writes.
    second = true;
    const ran = commands.length;
    const next = service.update();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(commands.length).toBe(ran);
    expect(await next).toBe('current');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((at) => !at.filterAlive && !at.lock)).toBe(true);

    // The tree is whole: the merge ran to its end.
    expect(git(vault, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(vault, 'status', '--porcelain=v1', '--untracked-files=all')).toBe('');
    expect(await readFile(path.join(vault, 'Notes/Big.slow'), 'utf8')).toBe('slow bytes\n');
    expect(await readFile(path.join(vault, 'Notes/Plain.md'), 'utf8')).toBe('# Plain\n');
    expect(existsSync(path.join(vault, '.git/index.lock'))).toBe(false);
  }, 20_000);

  it('bounds a request’s wait for a merge that outlives everything: it answers refused and starts nothing, and a later request runs once the merge has closed', async () => {
    await push('.gitattributes', '*.slow filter=slow\n');
    git(vault, 'fetch', '-q', 'origin');
    git(vault, 'merge', '-q', '--ff-only', 'origin/main');
    // A checkout that writes until it is let go.
    const pidFile = path.join(dir, 'filter.pid');
    const release = path.join(dir, 'release');
    git(vault, 'config', 'filter.slow.smudge', `echo $$ > '${pidFile}'; while [ ! -f '${release}' ]; do sleep 0.05; done; cat`);
    git(vault, 'config', 'filter.slow.clean', 'cat');
    await push('Notes/Big.slow', 'slow bytes\n');
    const head = git(other, 'rev-parse', 'HEAD');
    const service = updates({ limits: { gapMs: 0, mergeMs: 300 } });

    let started = Date.now();
    expect(await service.update()).toBe('refused');
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(alive(Number(readPid(pidFile)))).toBe(true);

    // The second request waits no longer than the merge's limit, then gives up having started nothing.
    const ran = commands.length;
    started = Date.now();
    expect(await service.update()).toBe('refused');
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(commands.length).toBe(ran);
    expect(alive(Number(readPid(pidFile)))).toBe(true);

    // Let go, the merge finishes; a third request runs as usual.
    await writeFile(release, '');
    for (let tries = 0; tries < 100 && existsSync(path.join(vault, '.git/index.lock')); tries += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await service.update()).toBe('current');
    expect(commands.length).toBeGreaterThan(ran);
    expect(git(vault, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(vault, 'status', '--porcelain=v1', '--untracked-files=all')).toBe('');
    expect(await readFile(path.join(vault, 'Notes/Big.slow'), 'utf8')).toBe('slow bytes\n');
  }, 20_000);

  it('runs the merge, and only the merge, with LFS downloads off', async () => {
    await push('Projects/Seeds.md', '# Seeds\n');
    expect(await updates().update()).toBe('updated');
    const merge = commands.findIndex((args) => args.includes('merge'));
    expect(added[merge]).toEqual({ GIT_LFS_SKIP_SMUDGE: '1' });
    expect(added.filter((_env, at) => at !== merge).every((env) => Object.keys(env).length === 0)).toBe(true);
  });

  (hasGitLfs() ? it : it.skip)('with a file store that is down, a fast-forward that brings an LFS file still completes, the file left a pointer (needs git-lfs)', async () => {
    const port = await closedPort();
    // The LFS filter, set inside the temp repo only, with its store at a port nothing listens on.
    git(vault, 'config', 'filter.lfs.process', 'git-lfs filter-process');
    git(vault, 'config', 'filter.lfs.smudge', 'git-lfs smudge -- %f');
    git(vault, 'config', 'filter.lfs.clean', 'git-lfs clean -- %f');
    git(vault, 'config', 'filter.lfs.required', 'true');
    git(vault, 'config', 'lfs.url', `http://127.0.0.1:${port}/lfs`);
    git(vault, 'config', 'lfs.transfer.maxretries', '1');
    // The second clone has no LFS filter, so it commits the pointer as written.
    const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 12\n`;
    await write(other, '.gitattributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    await write(other, 'Library/files/photo.bin', pointer);
    await push('Notes/Plain.md', '# Plain\n');
    const head = git(other, 'rev-parse', 'HEAD');

    // Without the setting the same fast-forward, in a copy, fails halfway: the smudge cannot reach the store, and files are left behind.
    const control = path.join(dir, 'Control');
    execFileSync('cp', ['-R', vault, control]);
    git(control, 'fetch', '-q', 'origin');
    expect(() => execFileSync('git', ['merge', '-q', '--ff-only', 'origin/main'], { cwd: control, env: ENV, stdio: 'ignore' })).toThrow();
    expect(git(control, 'status', '--porcelain')).not.toBe('');

    expect(await updates().update()).toBe('updated');
    expect(git(vault, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(vault, 'status', '--porcelain')).toBe('');
    expect(await readFile(path.join(vault, 'Library/files/photo.bin'), 'utf8')).toBe(pointer);
    expect(await readFile(path.join(vault, 'Notes/Plain.md'), 'utf8')).toBe('# Plain\n');
  }, 60_000);
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(file: string): string {
  return execFileSync('cat', [file], { encoding: 'utf8' }).trim();
}

/** Waits up to a second for a process to be gone. */
async function gone(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 50; tries += 1) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/** Every lock file under a git folder. */
async function locks(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.lock')) found.push(path.join(entry.parentPath, entry.name));
  }
  return found;
}

function hasGitLfs(): boolean {
  try {
    execFileSync('git', ['lfs', 'version'], { env: ENV, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A port on 127.0.0.1 that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}
