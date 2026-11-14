// @vitest-environment node
import * as fs from 'fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutoService, type AutoFetch, type AutoServiceDependencies } from '@/main/auto/AutoService';
import { AutoAddressError } from '@/main/auto/autoRequests';
import type { AutoSnapshot, AutoStatus, AutoStreamMessage, AutoThread } from '@/types/auto';
import { startStandIn, type StandIn } from '../fixtures/auto/standIn.mjs';

const BREAD = '5a0000000002';
const BEDS = '5a0000000001';

let userData: string;
let standIn: StandIn;
let messages: AutoStreamMessage[];
let asked: Array<{ url: string; init: Parameters<AutoFetch>[1] }>;
let services: AutoService[];

/** Node's own fetch, with every call written down. The stand-in listens on 127.0.0.1 only. */
const recordingFetch: AutoFetch = (url, init) => {
  asked.push({ url, init });
  return fetch(url, init);
};

function service(overrides: Partial<AutoServiceDependencies> = {}): AutoService {
  const made = new AutoService({
    userData,
    fs,
    fetch: recordingFetch,
    onStream: (message) => messages.push(message),
    reconnectMs: 30,
    ...overrides,
  });
  services.push(made);
  return made;
}

async function connected(overrides: Partial<AutoServiceDependencies> = {}): Promise<AutoService> {
  const made = service(overrides);
  await made.setAddress(standIn.url);
  return made;
}

async function until(test: () => boolean, what: string, timeout = 3_000): Promise<void> {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const events = (stream: 'list' | 'thread') =>
  messages.flatMap((message) => (message.type === 'event' && message.stream === stream ? [message] : []));
const kinds = (stream: 'list' | 'thread') => events(stream).map((message) => message.event.kind);
const count = (type: AutoStreamMessage['type']) => messages.filter((message) => message.type === type).length;

beforeEach(async () => {
  userData = await mkdtemp(path.join(os.tmpdir(), 'opal-auto-'));
  standIn = await startStandIn({ pace: 2, heartbeatMs: 40, retryMs: 500 });
  messages = [];
  asked = [];
  services = [];
});

afterEach(async () => {
  for (const made of services) made.stopAll();
  await standIn.close();
  await rm(userData, { recursive: true, force: true });
});

describe('the address', () => {
  it('is null until it is typed, and is kept in auto.json for this Mac', async () => {
    const auto = service();
    expect(await auto.config()).toEqual({ url: null });
    expect(await auto.setAddress(`${standIn.url}/`)).toEqual({ url: standIn.url });
    expect(JSON.parse(await readFile(path.join(userData, 'auto.json'), 'utf8'))).toEqual({ version: 1, url: standIn.url });
    expect(await service().config()).toEqual({ url: standIn.url });
  });

  it('refuses an address that is not https or on this Mac, and writes nothing', async () => {
    const auto = service();
    await expect(auto.setAddress('http://host.example/agent')).rejects.toThrow(AutoAddressError);
    await expect(readFile(path.join(userData, 'auto.json'), 'utf8')).rejects.toThrow();
    expect(await auto.config()).toEqual({ url: null });
  });

  it('forgets the address for an empty one', async () => {
    const auto = await connected();
    expect(await auto.setAddress('  ')).toEqual({ url: null });
    await expect(readFile(path.join(userData, 'auto.json'), 'utf8')).rejects.toThrow();
  });

  it('takes no address from a broken file, and asks nothing without one', async () => {
    await writeFile(path.join(userData, 'auto.json'), JSON.stringify({ version: 1, url: 'http://host.example' }));
    const auto = service();
    expect(await auto.config()).toEqual({ url: null });
    const result = await auto.request({ kind: 'status' });
    expect(result.success === false && result.error.kind).toBe('no-address');
    expect((await auto.follow({ stream: 'list', cursor: null })).success).toBe(false);
    expect(asked).toEqual([]);
  });
});

describe('requests', () => {
  it('reads the status, the list and a thread into its own shapes', async () => {
    const auto = await connected();
    const status = await auto.request({ kind: 'status' });
    expect(status.success && (status.data as AutoStatus).auth.loggedIn).toBe(true);
    expect(status.success && (status.data as AutoStatus).models).toEqual({ '': 'Default', small: 'Small', large: 'Large' });

    const list = await auto.request({ kind: 'threads' });
    const { threads, cursor } = (list.success ? list.data : {}) as { threads: AutoThread[]; cursor: string };
    expect(threads.map((thread) => thread.title).slice(0, 3)).toEqual(['Raised bed plan', 'Sourdough timings', 'Seed order for spring']);
    expect(threads[0].ask).toMatchObject({ kind: 'ask', text: 'Which wood for the frames?', options: ['Cedar', 'Larch'] });
    expect(threads.find((thread) => thread.title === 'Book the allotment inspection')).toMatchObject({ waits: true, digest: { id: 'item-2' } });
    expect(cursor).toMatch(/^[0-9a-f]+\.\d+$/);

    const snapshot = await auto.request({ kind: 'thread', id: BREAD });
    const data = (snapshot.success ? snapshot.data : null) as AutoSnapshot;
    expect(data.items.map((item) => item.role)).toEqual(['user', 'steps', 'assistant']);
    expect(data.next).toEqual(['Scale it to two loaves', 'Put the times in today’s page']);
    expect(data.sendWaiting).toBe(false);
  });

  it('asks only the address it was given, with a time limit, no redirects and no cookies', async () => {
    const auto = await connected();
    await auto.request({ kind: 'status' });
    await auto.request({ kind: 'thread', id: BREAD });
    await auto.request({ kind: 'rename', id: BREAD, title: 'Bread timings' });
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    expect(asked.length).toBe(4);
    for (const { url, init } of asked) {
      expect(url.startsWith(`${standIn.url}/api/`)).toBe(true);
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('writes as the service asks: a JSON POST that names the client and has no Origin', async () => {
    const auto = await connected();
    const result = await auto.request({ kind: 'rename', id: BREAD, title: 'Bread timings' });
    expect(result.success && (result.data as { thread: AutoThread }).thread.title).toBe('Bread timings');
    const post = standIn.requests.find((request) => request.method === 'POST');
    expect(post).toMatchObject({ path: `/api/threads/${BREAD}/rename`, body: { title: 'Bread timings' } });
    expect(post?.headers['content-type']).toBe('application/json');
    expect(post?.headers['x-auto-client']).toBe('opal');
    expect(post?.headers.origin).toBeUndefined();
  });

  it("gives the service's own sentence when it refuses", async () => {
    const auto = await connected();
    const result = await auto.request({ kind: 'thread', id: 'nosuchthread' });
    expect(result).toEqual({ success: false, error: { kind: 'refused', message: 'No such thread.', status: 404, code: 'not_found' } });
    standIn.failWrites('refuse');
    const write = await auto.request({ kind: 'stop', id: BREAD });
    expect(write.success === false && write.error).toMatchObject({ kind: 'refused', message: 'The stand-in refuses writes for now.' });
  });

  it("says it can't reach Auto when nothing, or something else, answers", async () => {
    const auto = service();
    // Outside the mount the stand-in answers as a proxy does when the service is not running.
    await auto.setAddress(standIn.url.replace('/agent', '/elsewhere'));
    const proxied = await auto.request({ kind: 'status' });
    expect(proxied).toEqual({ success: false, error: { kind: 'unreachable', message: "Can't reach Auto." } });

    await auto.setAddress(standIn.url);
    standIn.down();
    const down = await auto.request({ kind: 'threads' });
    expect(down.success === false && down.error.kind).toBe('unreachable');
    standIn.down(false);
    standIn.failWrites('drop');
    const dropped = await auto.request({ kind: 'message', id: BREAD, text: 'hello', cid: 'a1' });
    expect(dropped.success === false && dropped.error.kind).toBe('unreachable');
  });

  it('gives up on a request that gets no answer in time', async () => {
    const never: AutoFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const auto = await connected({ fetch: never, requestTimeoutMs: 40 });
    expect(await auto.request({ kind: 'status' })).toEqual({
      success: false,
      error: { kind: 'unreachable', message: 'Auto did not answer in time.' },
    });
  });

  it('reads no further than the size limit', async () => {
    const auto = await connected({ responseLimit: 2_000 });
    const result = await auto.request({ kind: 'thread', id: BREAD });
    expect(result).toEqual({ success: false, error: { kind: 'unreachable', message: "Auto's answer was too large to read." } });
    expect((await auto.request({ kind: 'status' })).success).toBe(true);
  });

  it('takes no answer that came from another address', async () => {
    const elsewhere: AutoFetch = async () => {
      const response = new Response(JSON.stringify({ threads: [], cursor: 'a.1' }), { headers: { 'Content-Type': 'application/json' } });
      Object.defineProperty(response, 'url', { value: 'https://other.example/agent/api/threads' });
      return response;
    };
    const auto = await connected({ fetch: elsewhere });
    expect((await auto.request({ kind: 'threads' })).success).toBe(false);
  });

  it('keeps only what fits its shapes from a strange answer', async () => {
    const strange = (body: unknown): AutoFetch => async () =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    const list = await (await connected({
      fetch: strange({ threads: [{ id: '../../x', title: 'Bad id' }, { id: 'ok1', title: 7, status: 'dancing', ask: 'no' }, 'junk', { id: 'gone', archived: true }], cursor: '<script>' }),
    })).request({ kind: 'threads' });
    expect(list.success && list.data).toEqual({
      threads: [expect.objectContaining({ id: 'ok1', title: '', status: 'idle', ask: null })],
      cursor: null,
    });
    const snapshot = await (await connected({ fetch: strange({ thread: 'none' }) })).request({ kind: 'thread', id: BREAD });
    expect(snapshot.success === false && snapshot.error.kind).toBe('unreachable');
  });
});

describe('streams', () => {
  it('follows the list from the cursor the list gave', async () => {
    const auto = await connected();
    const list = await auto.request({ kind: 'threads' });
    const cursor = (list.success ? (list.data as { cursor: string }).cursor : null);
    const followed = await auto.follow({ stream: 'list', cursor });
    await until(() => count('open') === 1, 'the list stream');
    await auto.request({ kind: 'rename', id: BREAD, title: 'Bread timings' });
    await auto.request({ kind: 'move', id: BREAD, before: null });
    standIn.signOut();
    await until(() => kinds('list').length === 3, 'three list events');
    expect(kinds('list')).toEqual(['thread', 'order', 'status']);
    const [renamed, moved, status] = events('list');
    expect(renamed.event.kind === 'thread' && renamed.event.thread.title).toBe('Bread timings');
    expect(moved.event.kind === 'order' && moved.event.ids.at(-1)).toBe(BREAD);
    expect(status.event.kind === 'status' && status.event.status.auth.loggedIn).toBe(false);
    expect(renamed.token).toBe(followed.success && followed.data.token);
    expect(status.cursor).toMatch(/^[0-9a-f]+\.\d+$/);
  });

  it("follows a thread's turn from the snapshot's cursor, in order", async () => {
    const auto = await connected();
    const snapshot = await auto.request({ kind: 'thread', id: BREAD });
    await auto.follow({ stream: 'thread', id: BREAD, cursor: snapshot.success ? (snapshot.data as AutoSnapshot).cursor : null });
    await until(() => count('open') === 1, 'the thread stream');
    await auto.request({ kind: 'message', id: BREAD, text: 'Where do the beans go?', cid: 'a1b2c3' });
    await until(() => kinds('thread').includes('end'), 'the end of the turn');
    const seen = kinds('thread');
    expect(seen[0]).toBe('turn');
    expect(seen).toContain('activity');
    expect(seen).toContain('add');
    expect(seen).toContain('append');
    expect(seen).toContain('set');
    expect(seen.indexOf('add')).toBeLessThan(seen.indexOf('append'));
    const turn = events('thread')[0].event;
    expect(turn.kind === 'turn' && turn.items).toEqual([{ role: 'user', text: 'Where do the beans go?', cid: 'a1b2c3' }]);
    const end = events('thread').find((message) => message.event.kind === 'end')?.event;
    expect(end).toEqual({ kind: 'end', outcome: 'done', error: null, next: ['Show the watering schedule', 'Draft the shopping list'] });
    const written = events('thread').flatMap((message) => (message.event.kind === 'append' ? [message.event.text] : [])).join('');
    expect(written).toContain('Beans and peas go in bed 2');
  });

  it('opens a broken stream again from the last cursor, and loses nothing sent meanwhile', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    await auto.request({ kind: 'rename', id: BREAD, title: 'One' });
    await until(() => kinds('list').length === 1, 'the first event');
    standIn.down();
    await until(() => count('down') === 1, 'the stream to break');
    standIn.down(false);
    await auto.request({ kind: 'rename', id: BREAD, title: 'Two' });
    await until(() => count('open') === 2, 'the stream to open again');
    await until(() => kinds('list').length === 2, 'the missed event');
    const titles = events('list').map((message) => message.event.kind === 'thread' && message.event.thread.title);
    expect(titles).toEqual(['One', 'Two']);
    // It asked again from the cursor of the last event it had.
    const reopened = asked.filter(({ url }) => url.includes('/api/events')).at(-1);
    expect(reopened?.url).toBe(`${standIn.url}/api/events?last=${events('list')[0].cursor}`);
    expect(reopened?.init.headers['Last-Event-ID']).toBe(events('list')[0].cursor);
  });

  it('says so once while the service stays away, and keeps trying', async () => {
    const auto = await connected();
    standIn.down();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => asked.filter(({ url }) => url.includes('/api/events')).length >= 3, 'three tries');
    expect(count('down')).toBe(1);
    expect(count('open')).toBe(0);
  });

  it('passes on a reset and stops, so the page can fetch again', async () => {
    const auto = await connected();
    const list = await auto.request({ kind: 'threads' });
    await auto.follow({ stream: 'list', cursor: list.success ? (list.data as { cursor: string }).cursor : null });
    await until(() => count('open') === 1, 'the list stream');
    standIn.restart();
    await until(() => kinds('list').includes('reset'), 'the reset');
    const tries = asked.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(asked.length).toBe(tries);
    expect(kinds('list')).toEqual(['reset']);
  });

  it('ends a stream for a thread that is gone', async () => {
    const auto = await connected();
    const followed = await auto.follow({ stream: 'thread', id: 'nosuchthread', cursor: null });
    await until(() => count('closed') === 1, 'the stream to close');
    expect(messages).toEqual([{ token: followed.success && followed.data.token, type: 'closed', message: 'No such thread.' }]);
    const tries = asked.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(asked.length).toBe(tries);
  });

  it('stays open on heartbeats, and opens again when a stream goes quiet', async () => {
    const auto = await connected({ quietMs: 150 });
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(count('down')).toBe(0);

    await standIn.close();
    standIn = await startStandIn({ heartbeatMs: 60_000, retryMs: 500 });
    messages = [];
    const quiet = await connected({ quietMs: 120 });
    await quiet.follow({ stream: 'list', cursor: null });
    await until(() => count('open') >= 2, 'a second connection');
    expect(count('down')).toBeGreaterThanOrEqual(1);
  });

  it('drops kinds it does not know and bodies it cannot read, and carries on', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    standIn.raw('event: sparkle\ndata: {"shiny": true}\n\nevent: thread\ndata: not json\n\nevent: digest\ndata: {"date": "2026-11-13"}\n\nevent: order\ndata: {"ids": ["5a0000000003", "../x", 7]}\n\n');
    await until(() => kinds('list').length === 1, 'the one event Opal knows');
    expect(events('list')[0].event).toEqual({ kind: 'order', ids: ['5a0000000003'] });
  });

  it('follows one stream of a kind at a time, and none after unfollow', async () => {
    const auto = await connected();
    const first = await auto.follow({ stream: 'thread', id: BREAD, cursor: null });
    await until(() => count('open') === 1, 'the first stream');
    const second = await auto.follow({ stream: 'thread', id: BEDS, cursor: null });
    await until(() => count('open') === 2, 'the second stream');
    await auto.request({ kind: 'rename', id: BREAD, title: 'Not followed' });
    await auto.request({ kind: 'rename', id: BEDS, title: 'Followed' });
    await until(() => kinds('thread').length === 1, 'one event');
    expect(events('thread')[0].token).toBe(second.success && second.data.token);
    expect(first.success && second.success && first.data.token).not.toBe(second.success && second.data.token);
    auto.unfollow('thread');
    await auto.request({ kind: 'rename', id: BEDS, title: 'After' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(kinds('thread').length).toBe(1);
  });

  it('never asks for a digest route, and never marks a message as a send', async () => {
    const auto = await connected();
    await auto.request({ kind: 'threads' });
    await auto.request({ kind: 'message', id: BREAD, text: 'send it', cid: 'a1b2c3' });
    await auto.request({ kind: 'archive', id: '5a0000000006', archived: true, done: true });
    expect(standIn.requests.some((request) => request.path.includes('digest'))).toBe(false);
    expect(standIn.requests.some((request) => JSON.stringify(request.body ?? {}).includes('sends'))).toBe(false);
    expect(standIn.requests.find((request) => request.path.endsWith('/messages'))?.body).toEqual({ text: 'send it', cid: 'a1b2c3' });
    expect(standIn.ticks).toEqual([{ date: '2026-11-13', id: 'item-2' }]);
  });
});
