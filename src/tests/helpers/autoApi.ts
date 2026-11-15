import { vi } from 'vitest';
import type {
  AutoAPI,
  AutoDigest,
  AutoDigestEntry,
  AutoFailure,
  AutoListEvent,
  AutoResult,
  AutoRoute,
  AutoSnapshot,
  AutoStatus,
  AutoStreamMessage,
  AutoThread,
  AutoThreadEvent,
} from '@/types/auto';

/** A list entry of a made-up thread. */
export function autoThread(id: string, fields: Partial<AutoThread> = {}): AutoThread {
  return {
    id, title: `Thread ${id}`, status: 'idle', last: '', activity: '', ask: null, unread: false, model: '', created: 1_794_000_000,
    updated: 1_794_000_000, error: null, queued: 0, archived: false, snoozed: null, woke: null, digest: null, waits: false, desk: null, yours: '', ...fields,
  };
}

export function autoSnapshot(thread: AutoThread, fields: Partial<AutoSnapshot> = {}): AutoSnapshot {
  return { thread, items: [], live: null, queue: [], unsent: null, next: [], cursor: 'b.1', seed: null, sendWaiting: false, sent: [], ...fields };
}

/** An entry of a made-up digest. */
export function digestEntry(id: string, fields: Partial<AutoDigestEntry> = {}): AutoDigestEntry {
  return { id, kind: 'text', title: '', md: `Words of ${id}`, section: '', state: 'open', thread: null, note: '', priority: '', draft: null, ...fields };
}

/** A day's digest from its sections; each entry takes its section's title, and `left` counts the open ones. */
export function autoDigest(date: string, sections: Array<[string, AutoDigestEntry[]]>): AutoDigest {
  const made = sections.map(([title, entries]) => ({ title, entries: entries.map((entry) => ({ ...entry, section: title })) }));
  return {
    date,
    path: `Library/digests/${date} digest.md`,
    left: made.reduce((sum, section) => sum + section.entries.filter((entry) => entry.state === 'open').length, 0),
    sections: made,
  };
}

export const AUTO_STATUS: AutoStatus = {
  auth: { loggedIn: true, token: 'none', error: null },
  signin: 'auto-login --on desk-mac',
  running: 0,
  waiting: 0,
  limit: 3,
  models: { '': 'Default', small: 'Small', large: 'Large' },
};

const ok = <T>(data: T): AutoResult<T> => ({ success: true, data }) as AutoResult<T>;

export interface FakeAuto {
  api: AutoAPI;
  /** What the fake service holds. Tests change it between calls. */
  state: {
    url: string | null;
    status: AutoStatus;
    threads: AutoThread[];
    snapshots: Record<string, AutoSnapshot>;
    /** The digests the service has, by day. */
    digests: Record<string, AutoDigest>;
    /** Every request fails this way while set. */
    fail: AutoFailure | null;
    /** Writes alone fail this way while set. */
    failWrites: AutoFailure | null;
    /** Reads of a digest and of the days alone fail this way while set. */
    failDigest: AutoFailure | null;
    /** Reads of a thread alone fail this way while set. */
    failThread: AutoFailure | null;
    /** While set, every write waits for it before it answers: a slow service. */
    gate: Promise<void> | null;
  };
  /** Every route asked for, in order. */
  routes: () => AutoRoute[];
  /** The routes of one kind. */
  asked: <K extends AutoRoute['kind']>(kind: K) => Array<Extract<AutoRoute, { kind: K }>>;
  /** The stream the page follows now, by kind. */
  followed: { list: { token: number; cursor: string | null } | null; thread: { token: number; id: string; cursor: string | null } | null };
  list: (event: AutoListEvent) => void;
  thread: (event: AutoThreadEvent) => void;
  /** A message about a stream itself: open, down or closed. */
  stream: (stream: 'list' | 'thread', type: 'open' | 'down') => void;
}

const READS = new Set<AutoRoute['kind']>(['status', 'threads', 'thread', 'digest', 'digests']);
const NO_DIGEST: AutoResult<never> = { success: false, error: { kind: 'refused', message: 'No digest.', code: 'not_found', status: 404 } };

/** Puts a fake of the main process's Auto bridge on `window`: an in-memory service and two streams to push events down. */
export function installAutoApi(options: Partial<FakeAuto['state']> = {}): FakeAuto {
  const listeners = new Set<(message: AutoStreamMessage) => void>();
  const state: FakeAuto['state'] = {
    url: 'https://host.example/agent',
    status: AUTO_STATUS,
    threads: [],
    snapshots: {},
    digests: {},
    fail: null,
    failWrites: null,
    failDigest: null,
    failThread: null,
    gate: null,
    ...options,
  };
  const followed: FakeAuto['followed'] = { list: null, thread: null };
  let tokens = 0;
  const entry = (id: string) => state.threads.find((thread) => thread.id === id) ?? autoThread(id);
  const days = () => Object.keys(state.digests).sort().reverse();
  /** Changes entries of a day and answers the day as it is after, counted again. */
  const change = (date: string, ids: string[], fields: (found: AutoDigestEntry) => Partial<AutoDigestEntry>): AutoResult<unknown> => {
    const digest = state.digests[date];
    if (!digest) return NO_DIGEST;
    const sections = digest.sections.map((section) => ({
      ...section,
      entries: section.entries.map((found) => (ids.includes(found.id) ? { ...found, ...fields(found) } : found)),
    }));
    state.digests[date] = { ...digest, sections, left: sections.reduce((sum, section) => sum + section.entries.filter((found) => found.state === 'open').length, 0) };
    return ok(state.digests[date]);
  };

  const request = vi.fn(async (route: AutoRoute): Promise<AutoResult<unknown>> => {
    if (state.fail) return { success: false, error: state.fail };
    if (state.failWrites && !READS.has(route.kind)) return { success: false, error: state.failWrites };
    if (state.failDigest && (route.kind === 'digest' || route.kind === 'digests')) return { success: false, error: state.failDigest };
    if (state.failThread && route.kind === 'thread') return { success: false, error: state.failThread };
    if (state.gate && !READS.has(route.kind)) {
      await state.gate;
      if (state.failWrites) return { success: false, error: state.failWrites };
    }
    switch (route.kind) {
      case 'status':
      case 'check-status':
        return ok(state.status);
      case 'threads':
        return ok({ threads: state.threads, cursor: 'b.0' });
      case 'thread':
        return state.snapshots[route.id]
          ? ok(state.snapshots[route.id])
          : { success: false, error: { kind: 'refused', message: 'No such thread.', code: 'not_found', status: 404 } };
      case 'create': {
        const thread = autoThread('created1', { title: route.text.slice(0, 40), status: 'working', model: route.model });
        state.threads = [thread, ...state.threads];
        state.snapshots[thread.id] = autoSnapshot(thread, { live: { items: [{ role: 'user', text: route.text, cid: route.cid }], activity: '', state: 'working', question: null } });
        return ok({ thread });
      }
      case 'message':
        return ok({ queued: state.snapshots[route.id]?.live != null });
      case 'stop':
        return ok({ returned: state.snapshots[route.id]?.queue ?? [] });
      case 'answer':
        return ok({ ok: true });
      case 'move':
        return ok({ ids: state.threads.map((thread) => thread.id) });
      case 'archive':
        return ok({ thread: { ...entry(route.id), archived: route.archived } });
      case 'snooze':
        return ok({ thread: { ...entry(route.id), snoozed: route.until } });
      case 'rename':
        return ok({ thread: { ...entry(route.id), title: route.title } });
      case 'model':
        return ok({ thread: { ...entry(route.id), model: route.model } });
      case 'start':
        return ok({ thread: { ...entry(route.id), waits: false, status: 'working' } });
      case 'desk':
        return ok({ thread: { ...entry(route.id), desk: route.on ? { at: 1_794_000_900, by: 'opal' } : null } });
      case 'digests':
        return ok({ days: days(), latest: days()[0] ?? null });
      case 'digest': {
        const date = route.date ?? days()[0];
        return date && state.digests[date] ? ok(state.digests[date]) : NO_DIGEST;
      }
      case 'digest-resolve':
        return change(route.date, route.ids, (found) => ({ state: route.resolved ? 'resolved' : found.thread ? 'thread' : 'open' }));
      case 'digest-note':
        return change(route.date, [route.id], () => ({ note: route.text }));
      case 'digest-thread': {
        const found = state.digests[route.date]?.sections.flatMap((section) => section.entries).find((each) => each.id === route.id);
        if (!found) return NO_DIGEST;
        const id = `from-${route.id}`.slice(0, 40);
        const waits = route.words === null;
        const thread = autoThread(id, { title: found.title || found.md.slice(0, 40), digest: { date: route.date, id: route.id }, waits, status: waits ? 'idle' : 'working', last: found.md.slice(0, 80) });
        state.threads = [thread, ...state.threads.filter((each) => each.id !== id)];
        state.snapshots[id] = autoSnapshot(thread, waits ? { seed: found.md } : { live: { items: [{ role: 'user', text: route.words ?? '', cid: route.cid }], activity: '', state: 'working', question: null } });
        change(route.date, [route.id], () => ({ state: 'thread', thread: id }));
        return ok({ thread });
      }
    }
  });

  const api = {
    config: vi.fn(async () => ok({ url: state.url })),
    setAddress: vi.fn(async (typed: string): Promise<AutoResult<{ url: string | null }>> => {
      const url = typed.trim();
      if (url && !url.startsWith('https://')) return { success: false, error: { kind: 'invalid', message: 'The address must start with https://. Only an address on this Mac may use http://.' } };
      state.url = url || null;
      return ok({ url: state.url });
    }),
    request,
    follow: vi.fn(async (target: Parameters<AutoAPI['follow']>[0]) => {
      tokens += 1;
      if (target.stream === 'list') followed.list = { token: tokens, cursor: target.cursor };
      else followed.thread = { token: tokens, id: target.id, cursor: target.cursor };
      return ok({ token: tokens });
    }),
    unfollow: vi.fn(async (stream: 'list' | 'thread') => {
      followed[stream] = null;
      return ok(undefined);
    }),
    resolvePage: vi.fn(async (path: string) => ok({ path: `/Vault/${path}` })),
    onStream: (callback: (message: AutoStreamMessage) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  } as unknown as AutoAPI;
  window.autoAPI = api;

  const send = (message: AutoStreamMessage) => {
    for (const listener of [...listeners]) listener(message);
  };
  const routes = () => request.mock.calls.map(([route]) => route);
  return {
    api,
    state,
    routes,
    asked: (kind) => routes().filter((route): route is Extract<AutoRoute, { kind: typeof kind }> => route.kind === kind),
    followed,
    list: (event) => {
      if (followed.list) send({ token: followed.list.token, type: 'event', stream: 'list', event, cursor: null });
    },
    thread: (event) => {
      if (followed.thread) send({ token: followed.thread.token, type: 'event', stream: 'thread', event, cursor: null });
    },
    stream: (stream, type) => {
      const follow = followed[stream];
      if (follow) send({ token: follow.token, type });
    },
  };
}
