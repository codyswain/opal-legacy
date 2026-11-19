import { replyChoice } from '@/common/autoReplyModel';
import { createHash } from 'node:crypto';
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
  AutoUsage,
} from '@/types/auto';

/** A list entry of a made-up thread. */
export function autoThread(id: string, fields: Partial<AutoThread> = {}): AutoThread {
  return {
    id, title: `Thread ${id}`, status: 'idle', last: '', activity: '', ask: null, unread: false, model: '', created: 1_794_000_000,
    updated: 1_794_000_000, error: null, queued: 0, archived: false, archivedAt: null, snoozed: null, snoozedAt: null, woke: null, wait: null,
    digest: null, waits: false, desk: null, yours: '', parent: null, mode: '', agentsModel: '', ...fields,
  };
}

export function autoSnapshot(thread: AutoThread, fields: Partial<AutoSnapshot> = {}): AutoSnapshot {
  return { thread, items: [], live: null, queue: [], unsent: null, next: [], cursor: 'b.1', seed: null, sendWaiting: false, sent: [], ...fields };
}

/** An entry of a made-up digest. */
export function digestEntry(id: string, fields: Partial<AutoDigestEntry> = {}): AutoDigestEntry {
  return { id, kind: 'text', title: '', md: `Words of ${id}`, section: '', state: 'open', thread: null, note: '', priority: '', draft: null, continues: null, ...fields };
}

/** A day's digest from its sections; each entry takes its section's title, and `left` counts the open ones. */
export function autoDigest(date: string, sections: Array<[string, AutoDigestEntry[]]>): AutoDigest {
  const made = sections.map(([title, entries]) => ({ title, entries: entries.map((entry) => ({ ...entry, section: title })) }));
  return {
    date,
    path: `Library/digests/${date} digest.md`,
    left: made.reduce((sum, section) => sum + section.entries.filter((entry) => entry.state === 'open').length, 0),
    archived: false,
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
  modelOptions: { large: { efforts: ['high', 'ultra'], speeds: { priority: 'Fast' } } },
  modes: { '': 'Solo', orchestrate: 'Orchestrate' },
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
    /** The threads he archived, in any order: the service answers them newest archived first. */
    archived: AutoThread[];
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
    /** While set, a read of a thread waits for it before it answers: a snapshot that arrives late. */
    threadGate: Promise<void> | null;
    /** The plan's usage; null answers 404, as a service without the route does. */
    usage: AutoUsage | null;
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

const READS = new Set<AutoRoute['kind']>(['status', 'threads', 'archived', 'thread', 'digest', 'digests', 'usage', 'image']);
const NO_DIGEST: AutoResult<never> = { success: false, error: { kind: 'refused', message: 'No digest.', code: 'not_found', status: 404 } };

/** Puts a fake of the main process's Auto bridge on `window`: an in-memory service and two streams to push events down. */
export function installAutoApi(options: Partial<FakeAuto['state']> = {}): FakeAuto {
  const listeners = new Set<(message: AutoStreamMessage) => void>();
  const images = new Map<string, { mime: string; data: string }>();
  const state: FakeAuto['state'] = {
    url: 'https://host.example/agent',
    status: AUTO_STATUS,
    threads: [],
    snapshots: {},
    archived: [],
    digests: {},
    fail: null,
    failWrites: null,
    failDigest: null,
    failThread: null,
    gate: null,
    threadGate: null,
    usage: null,
    ...options,
  };
  const followed: FakeAuto['followed'] = { list: null, thread: null };
  let tokens = 0;
  const entry = (id: string) => state.threads.find((thread) => thread.id === id) ?? state.archived.find((thread) => thread.id === id) ?? autoThread(id);
  function updateThread(thread: AutoThread) {
    const update = (each: AutoThread) => each.id === thread.id ? thread : each;
    state.threads = state.threads.map(update);
    state.archived = state.archived.map(update);
    const snapshot = state.snapshots[thread.id];
    if (snapshot) state.snapshots[thread.id] = { ...snapshot, thread };
    return ok({ thread });
  }
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
      case 'upload-image': {
        const id = createHash('sha256').update(Buffer.from(route.data, 'base64')).digest('hex');
        images.set(id, { mime: route.mime, data: route.data });
        return ok({ id });
      }
      case 'image':
        return images.has(route.id)
          ? ok(images.get(route.id))
          : { success: false, error: { kind: 'refused', message: 'No image.', code: 'not_found', status: 404 } };
      case 'status':
      case 'check-status':
        return ok(state.status);
      case 'threads':
        return ok({ threads: state.threads, cursor: 'b.0' });
      case 'archived': {
        const all = [...state.archived].sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
        return ok({ threads: route.limit === null ? all : all.slice(0, route.limit), total: all.length });
      }
      case 'thread': {
        // What the service had when the read reached it; the answer may be held back.
        const found = state.snapshots[route.id];
        if (state.threadGate) await state.threadGate;
        return found
          ? ok(found)
          : { success: false, error: { kind: 'refused', message: 'No such thread.', code: 'not_found', status: 404 } };
      }
      case 'create': {
        const thread = autoThread('created1', { title: route.text.slice(0, 40), status: 'working', ...replyChoice(route) });
        state.threads = [thread, ...state.threads];
        state.snapshots[thread.id] = autoSnapshot(thread, { live: { items: [{ role: 'user', text: route.text, cid: route.cid, ...(route.images?.length ? { images: route.images } : {}) }], activity: '', state: 'working', question: null } });
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
      case 'archive': {
        // As the service keeps it: an archived thread leaves the list for the archive, and a restored one comes back.
        const thread: AutoThread = { ...entry(route.id), archived: route.archived, archivedAt: route.archived ? 1_794_100_000 : null, ...(route.archived ? { desk: null } : {}) };
        state.threads = state.threads.filter((each) => each.id !== route.id);
        state.archived = state.archived.filter((each) => each.id !== route.id);
        if (route.archived) state.archived = [thread, ...state.archived];
        else state.threads = [thread, ...state.threads];
        return ok({ thread });
      }
      case 'snooze': {
        const found = entry(route.id);
        const wait = route.wait && route.until !== null
          ? { say: route.wait.say, state: 'finding' as const, on: '', what: '', where: '', link: '', check: '', since: 1_794_000_100, expires: route.until, heard: '', reply: '' }
          : null;
        return ok({ thread: { ...found, snoozed: route.until, snoozedAt: route.until === null ? null : 1_794_000_100, wait } });
      }
      case 'rename':
        return ok({ thread: { ...entry(route.id), title: route.title } });
      case 'model':
        return updateThread({ ...entry(route.id), ...replyChoice(route) });
      case 'start':
        return ok({ thread: { ...entry(route.id), waits: false, status: 'working' } });
      case 'desk':
        return ok({ thread: { ...entry(route.id), desk: route.on ? { at: 1_794_000_900, by: 'opal' } : null } });
      case 'digests':
        return ok({ days: days(), latest: days()[0] ?? null, archived: days().filter((day) => state.digests[day].archived) });
      case 'digest-archive': {
        const digest = state.digests[route.date];
        if (!digest) return NO_DIGEST;
        state.digests[route.date] = { ...digest, archived: route.archived };
        return ok(state.digests[route.date]);
      }
      case 'digest': {
        const date = route.date ?? days()[0];
        return date && state.digests[date] ? ok(state.digests[date]) : NO_DIGEST;
      }
      case 'usage':
        return state.usage ? ok(state.usage) : { success: false, error: { kind: 'refused', message: 'Not found.', code: 'not_found', status: 404 } };
      case 'digest-resolve':
        return change(route.date, route.ids, (found) => ({ state: route.resolved ? 'resolved' : found.thread ? 'thread' : 'open' }));
      case 'digest-note':
        return change(route.date, [route.id], () => ({ note: route.text }));
      case 'digest-thread': {
        const found = state.digests[route.date]?.sections.flatMap((section) => section.entries).find((each) => each.id === route.id);
        if (!found) return NO_DIGEST;
        const id = `from-${route.id}`.slice(0, 40);
        const waits = route.words === null && !route.images?.length;
        const thread = autoThread(id, { title: found.title || found.md.slice(0, 40), digest: { date: route.date, id: route.id }, model: '', ...replyChoice(route), waits, status: waits ? 'idle' : 'working', last: found.md.slice(0, 80) });
        state.threads = [thread, ...state.threads.filter((each) => each.id !== id)];
        state.snapshots[id] = autoSnapshot(thread, waits ? { seed: found.md } : { live: { items: [{ role: 'user', text: route.words ?? '', cid: route.cid, ...(route.images?.length ? { images: route.images } : {}) }], activity: '', state: 'working', question: null } });
        change(route.date, [route.id], () => ({ state: 'thread', thread: id }));
        return ok({ thread });
      }
      case 'digest-continue': {
        const found = state.digests[route.date]?.sections.flatMap((section) => section.entries).find((each) => each.id === route.id);
        if (!found) return NO_DIGEST;
        const into = state.threads.find((each) => each.id === route.thread);
        if (found.state !== 'open' || found.continues?.id !== route.thread || !into) {
          return { success: false, error: { kind: 'refused', message: 'That entry no longer matches the thread.', code: 'no_match', status: 409 } };
        }
        // The entry goes in as one message, and a snoozed thread comes back.
        const thread: AutoThread = { ...into, model: route.model ?? into.model, snoozed: null, status: 'working', last: route.words ?? found.md.slice(0, 80) };
        change(route.date, [route.id], () => ({ state: 'thread', thread: thread.id, continues: null }));
        return updateThread(thread);
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
    resolvePage: vi.fn(async (path: string) => ok({ path: `/Vault/${path}`, title: null as string | null })),
    updateFolders: vi.fn(async () => ok('current')),
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
