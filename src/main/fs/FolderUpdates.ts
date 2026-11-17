import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { SHORT_TIMEOUTS, gitEnvironment } from '@/main/files/GitLfsStore';
import type { FolderUpdateOutcome } from '@/types/auto';
import { gitBusy, repoOf } from './gitActivity';

/*
 * Brings an opened folder that is a git checkout up to date with its
 * branch's upstream: `git fetch` for that upstream, then `git merge
 * --ff-only` to it. Two explicit steps, so no `pull.rebase` setting can make
 * it rebase. It only ever fast-forwards: no merge commit, rebase, stash,
 * reset, checkout, commit or push. When git refuses (local commits, local
 * changes the incoming commits also change, an untracked file in the way, a
 * merge in progress, no network, a password it would ask for) it gives up
 * and the tree stays as it was: git makes those checks before the merge
 * writes its first file.
 *
 * Once the merge writes, nothing may cut it short, or the tree is left half
 * moved with `index.lock` behind. So the merge is never killed: at its time
 * limit the page hears `refused`, the process runs to its end, and no other
 * command of this service starts in that checkout until it has closed. Files
 * kept in Git LFS arrive as pointers (`GIT_LFS_SKIP_SMUDGE=1`), so a file
 * store that does not answer cannot stop it halfway; Opal fetches their bytes
 * when one is opened. A fetch writes only git's own folder; at its limit it
 * is asked to stop (SIGTERM), so git can take away its lock files, and is
 * killed two seconds later if it is still there.
 */

export interface FolderUpdateLimits {
  /** The fetch's time limit. */
  fetchMs: number;
  /** The fast-forward's time limit. */
  mergeMs: number;
  /** The time limit of each small question to git (the branch, its upstream, HEAD). */
  lookMs: number;
  /** The least time between the starts of two runs in one checkout. */
  gapMs: number;
}

export const FOLDER_UPDATE_LIMITS: FolderUpdateLimits = { fetchMs: 20_000, mergeMs: 30_000, lookMs: 5_000, gapMs: 10_000 };

export interface FolderUpdatesDependencies {
  /** The opened folders: the main process's own record, never anything the page names. */
  folders: () => readonly string[];
  limits?: Partial<FolderUpdateLimits>;
  /** The environment git runs with; gitEnvironment() by default. */
  env?: () => NodeJS.ProcessEnv;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** Told every git command as it starts, with what it adds to the environment, for tests. */
  onCommand?: (args: readonly string[], cwd: string, envAdded: Readonly<Record<string, string>>) => void;
}

interface GitAnswer {
  code: number | null;
  stdout: string;
}

/** The most of git's output that is read; the answers asked for are one line. */
const OUTPUT_LIMIT = 64 * 1024;

/**
 * Settings for every command. No hook runs (a post-merge hook could do
 * anything), no submodule is touched, nothing is stashed, and no housekeeping
 * starts after. LFS gives up in seconds when its store does not answer.
 */
const SAFE = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'submodule.recurse=false',
  '-c', 'merge.autoStash=false',
  '-c', 'maintenance.auto=false',
  '-c', 'gc.auto=0',
  ...SHORT_TIMEOUTS,
];

/** No prompt of any kind: git's own, a credential helper's, or ssh's. */
const NO_PROMPTS = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', SSH_ASKPASS_REQUIRE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' };

/** A name from the repo's config that git could read as an option is not used. */
const plain = (value: string) => value.length > 0 && !value.startsWith('-') && !/[\s\0]/.test(value);

/**
 * How a command is stopped at its time limit: `kill` ends its process group
 * at once; `term` asks it to stop and kills it after TERM_GRACE_MS; `never`
 * leaves it to finish, and only the wait for its answer ends.
 */
type Stop = 'kill' | 'term' | 'never';

/** How long a command asked to stop has to take away its lock files before it is killed. */
export const TERM_GRACE_MS = 2_000;

interface Running {
  /** Its answer: at its close, or with no code at the time limit (for `term`, once it has gone). */
  answer: Promise<GitAnswer>;
  /** Settles when the process has closed. */
  closed: Promise<void>;
}

/** Signals a command's process group, so the helpers git starts (ssh, upload-pack, git-lfs) get it too. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/** A git command, without a shell, in a session of its own, so no helper can ask on a terminal. */
function runGit(args: readonly string[], cwd: string, timeoutMs: number, env: NodeJS.ProcessEnv, stop: Stop, readOutput: boolean): Running {
  let stdout = '';
  let settle: (answer: GitAnswer) => void = () => undefined;
  const answer = new Promise<GitAnswer>((resolve) => {
    let settled = false;
    settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });
  const child = spawn('git', [...args], { cwd, env, detached: true, stdio: ['ignore', readOutput ? 'pipe' : 'ignore', 'ignore'] });
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const closed = new Promise<void>((resolve) => {
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
  const timer = setTimeout(() => {
    if (stop === 'kill') signalGroup(child, 'SIGKILL');
    if (stop === 'term') {
      signalGroup(child, 'SIGTERM');
      // Whatever of the group is still there then, git or a helper deaf to the request, is killed.
      graceTimer = setTimeout(() => {
        signalGroup(child, 'SIGKILL');
        // A process that does not close even then is not waited for longer.
        setTimeout(() => settle({ code: null, stdout: '' }), 1_000);
      }, TERM_GRACE_MS);
      return;
    }
    settle({ code: null, stdout: '' });
  }, timeoutMs);
  child.stdout?.on('data', (chunk: Buffer) => {
    if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString('utf8');
  });
  child.on('error', () => settle({ code: null, stdout: '' }));
  child.on('close', (code) => {
    clearTimeout(timer);
    // Past the limit there is no answer but none, however it ended.
    settle(graceTimer === undefined ? { code, stdout } : { code: null, stdout: '' });
  });
  return { answer, closed };
}

interface Lane {
  /** The run going now. */
  running: Promise<FolderUpdateOutcome> | null;
  /** The one run asked for while another goes, or while the gap since the last has not passed. */
  queued: Promise<FolderUpdateOutcome> | null;
  lastStart: number;
  /** Every command started in this checkout that has not closed yet; the next run waits for them. */
  open: Set<Promise<void>>;
}

const RANK: FolderUpdateOutcome[] = ['none', 'current', 'refused', 'updated'];

/** What a page hears of several checkouts: any update, else any refusal, else any that was current. */
function combined(outcomes: readonly FolderUpdateOutcome[]): FolderUpdateOutcome {
  return outcomes.reduce<FolderUpdateOutcome>((best, next) => (RANK.indexOf(next) > RANK.indexOf(best) ? next : best), 'none');
}

export class FolderUpdates {
  private readonly lanes = new Map<string, Lane>();
  private readonly limits: FolderUpdateLimits;
  private readonly now: () => number;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly deps: FolderUpdatesDependencies) {
    this.limits = { ...FOLDER_UPDATE_LIMITS, ...deps.limits };
    this.now = deps.now ?? Date.now;
    this.wait = deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Brings every opened folder that is a git checkout up to date, and says what happened. Never throws. */
  async update(): Promise<FolderUpdateOutcome> {
    try {
      const tops = new Set<string>();
      for (const folder of this.deps.folders()) {
        const repo = await repoOf(folder).catch(() => null);
        if (repo) tops.add(repo.top);
      }
      return combined(await Promise.all([...tops].map((top) => this.schedule(top))));
    } catch {
      return 'refused';
    }
  }

  /** One run at a time per checkout; a request during a run makes one more after it, no sooner than the gap. */
  private schedule(top: string): Promise<FolderUpdateOutcome> {
    let lane = this.lanes.get(top);
    if (!lane) {
      lane = { running: null, queued: null, lastStart: -Infinity, open: new Set() };
      this.lanes.set(top, lane);
    }
    const own = lane;
    if (own.queued) return own.queued;
    const queued = (async () => {
      // Always a step later than now, so `own.queued` is this run until it starts.
      await this.idle(own);
      const left = own.lastStart + this.limits.gapMs - this.now();
      if (left > 0) await this.wait(left);
      own.queued = null;
      own.lastStart = this.now();
      const running = this.runOnce(top, own).catch((): FolderUpdateOutcome => 'refused');
      own.running = running;
      try {
        return await running;
      } finally {
        if (own.running === running) own.running = null;
      }
    })();
    own.queued = queued;
    return queued;
  }

  /** Until the run going now has answered and every command it started has closed: a merge given up on still writes the tree. */
  private async idle(lane: Lane): Promise<void> {
    if (lane.running) await lane.running;
    while (lane.open.size > 0) await Promise.all([...lane.open]);
  }

  private git(lane: Lane, args: readonly string[], cwd: string, timeoutMs: number, how: { stop?: Stop; output?: boolean; env?: Record<string, string> } = {}): Promise<GitAnswer> {
    const full = [...SAFE, ...args];
    this.deps.onCommand?.(full, cwd, { ...how.env });
    const env = { ...(this.deps.env ?? gitEnvironment)(), ...NO_PROMPTS, ...how.env };
    const command = runGit(full, cwd, timeoutMs, env, how.stop ?? 'kill', how.output ?? false);
    lane.open.add(command.closed);
    void command.closed.then(() => lane.open.delete(command.closed));
    return command.answer;
  }

  private async runOnce(top: string, lane: Lane): Promise<FolderUpdateOutcome> {
    const { fetchMs, mergeMs, lookMs } = this.limits;
    // gitBusy takes a file and looks at the repo of its folder.
    const probe = path.join(top, 'probe');
    if (await gitBusy(probe)) return 'none';

    // The branch checked out; none while HEAD is detached, as during a rebase.
    const branch = await this.git(lane, ['symbolic-ref', '--quiet', 'HEAD'], top, lookMs, { output: true });
    const ref = branch.stdout.trim();
    if (branch.code !== 0 || !ref.startsWith('refs/heads/') || !plain(ref)) return 'none';

    // Its upstream: the remote, the branch there, and where this checkout keeps it.
    const upstream = await this.git(lane, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)', '--end-of-options', ref], top, lookMs, { output: true });
    const [remote = '', remoteRef = '', tracking = ''] = upstream.stdout.replace(/\n$/, '').split('\0');
    if (upstream.code !== 0 || remote === '.' || !plain(remote) || !remoteRef.startsWith('refs/heads/') || !plain(remoteRef) || !tracking.startsWith('refs/remotes/') || !plain(tracking)) {
      return 'none';
    }

    const fetched = await this.git(
      lane,
      ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--no-auto-maintenance', '--end-of-options', remote, `+${remoteRef}:${tracking}`],
      top,
      fetchMs,
      { stop: 'term' },
    );
    if (fetched.code !== 0) return 'refused';

    if (await gitBusy(probe)) return 'none';
    const before = await this.git(lane, ['rev-parse', '--verify', '--quiet', 'HEAD'], top, lookMs, { output: true });
    if (before.code !== 0) return 'refused';
    // Never killed once started (see the top of this file); LFS files arrive as pointers.
    const merged = await this.git(lane, ['merge', '--ff-only', '--quiet', '--no-stat', '--no-edit', '--no-autostash', '--end-of-options', tracking], top, mergeMs, {
      stop: 'never',
      env: { GIT_LFS_SKIP_SMUDGE: '1' },
    });
    if (merged.code !== 0) return 'refused';
    const after = await this.git(lane, ['rev-parse', '--verify', '--quiet', 'HEAD'], top, lookMs, { output: true });
    if (after.code !== 0) return 'refused';
    return after.stdout.trim() === before.stdout.trim() ? 'current' : 'updated';
  }
}
