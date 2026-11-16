// @vitest-environment node
import * as fs from 'fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutoService, type AutoFetch, type AutoServiceDependencies } from '@/main/auto/AutoService';
import { AutoAddressError } from '@/main/auto/autoRequests';
import type { AutoDigest, AutoDigestDays, AutoSnapshot, AutoStatus, AutoStreamMessage, AutoThread, AutoUsage } from '@/types/auto';
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

describe('the plan usage', () => {
  it('reads the usage with a GET, keeping the plan and the limits and never an email', async () => {
    const auto = await connected();
    const usage = await auto.request({ kind: 'usage' });
    expect(asked.at(-1)?.url).toBe(`${standIn.url}/api/usage`);
    expect(asked.at(-1)?.init.method).toBe('GET');
    const data = (usage.success ? usage.data : null) as AutoUsage;
    expect(data.plan).toBe('Pro');
    expect(data.limits.map(({ label, used }) => ({ label, used }))).toEqual([
      { label: 'Weekly, all models', used: 0.45 },
      { label: 'Weekly, Large', used: 0.73 },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/email|@/);
  });

  it('gives a refusal with its status for a service without the route', async () => {
    await standIn.close();
    standIn = await startStandIn({ usage: 'missing', retryMs: 500 });
    const auto = await connected();
    const usage = await auto.request({ kind: 'usage' });
    expect(usage.success === false && usage.error).toMatchObject({ kind: 'refused', status: 404 });
  });

  it('passes on the usage event of the list stream, and reads the new numbers', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    standIn.setUsage({ limits: [{ key: 'five_hour', label: 'Five hours', used: 0.9 }] });
    await until(() => kinds('list').includes('usage'), 'the usage event');
    const usage = await auto.request({ kind: 'usage' });
    expect(usage.success && (usage.data as AutoUsage).limits.map(({ key, used }) => ({ key, used }))).toEqual([{ key: 'five_hour', used: 0.9 }]);
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
    standIn.raw('event: sparkle\ndata: {"shiny": true}\n\nevent: thread\ndata: not json\n\nevent: digest\ndata: {"date": "../13"}\n\nevent: order\ndata: {"ids": ["5a0000000003", "../x", 7]}\n\n');
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

  it('never marks a message as a send, and Done marks the entry a thread came from', async () => {
    const auto = await connected();
    await auto.request({ kind: 'threads' });
    await auto.request({ kind: 'message', id: BREAD, text: 'send it', cid: 'a1b2c3' });
    await auto.request({ kind: 'archive', id: '5a0000000006', archived: true, done: true });
    expect(standIn.requests.some((request) => JSON.stringify(request.body ?? {}).includes('sends'))).toBe(false);
    expect(standIn.requests.find((request) => request.path.endsWith('/messages'))?.body).toEqual({ text: 'send it', cid: 'a1b2c3' });
    expect(standIn.ticks).toEqual([{ date: '2026-11-13', id: 'item-2' }]);
    expect(standIn.digest()?.sections[1].entries[1]).toMatchObject({ id: 'item-2', state: 'resolved' });
  });
});

describe('what is his', () => {
  const listed = (id: string) => events('list').flatMap((message) => (message.event.kind === 'thread' && message.event.thread.id === id ? [message.event.thread] : []));

  it('reads a send he is asked to allow, takes his no back to the service, and his words after it as a message', async () => {
    const auto = await connected();
    const snapshot = await auto.request({ kind: 'thread', id: BREAD });
    await auto.follow({ stream: 'list', cursor: null });
    await auto.follow({ stream: 'thread', id: BREAD, cursor: snapshot.success ? (snapshot.data as AutoSnapshot).cursor : null });
    await until(() => count('open') === 2, 'both streams');
    await auto.request({ kind: 'message', id: BREAD, text: 'Send Robin a word about the swap', cid: 'a1b2c3' });
    await until(() => kinds('thread').includes('question'), 'the question');
    const asked = events('thread').find((message) => message.event.kind === 'question')?.event;
    const question = asked?.kind === 'question' ? asked.question : null;
    // The service's own wording: the title names the channel and the people, the detail what it is about and how it would go.
    expect(question).toEqual({
      id: expect.any(String), kind: 'grant', title: 'Send this Slack message to Robin?', detail: 'the seed swap\n\nThese exact words, once, from this thread.',
      text: 'I will bring the bean seedlings on Saturday.',
    });
    // Its row waits on him, with the title as its line and nothing to pick.
    await until(() => listed(BREAD).some((thread) => thread.status === 'waiting'), 'the waiting row');
    expect(listed(BREAD).find((thread) => thread.status === 'waiting')?.ask).toEqual({ id: question?.id, kind: 'grant', text: 'Send this Slack message to Robin?', options: [], question: null });
    // A yes with no signature from a phone is refused by the service, whoever posts it. Opal never does.
    const yes = await fetch(`${standIn.url}/api/threads/${BREAD}/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auto-Client': 'elsewhere' }, body: JSON.stringify({ id: question?.id, allow: true }),
    });
    expect(yes.status).toBe(403);
    expect(standIn.unsigned).toEqual([{ thread: BREAD, client: 'elsewhere' }]);
    // The plain no, and then his words as an ordinary message, which waits behind the turn.
    const no = await auto.request({ kind: 'answer', id: BREAD, answer: { id: question?.id ?? '', allow: false } });
    expect(no.success).toBe(true);
    expect(standIn.requests.at(-1)).toMatchObject({ path: `/api/threads/${BREAD}/answer`, body: { id: question?.id, allow: false } });
    const words = await auto.request({ kind: 'message', id: BREAD, text: 'Not this week', cid: 'a1b2c4' });
    expect(words.success && words.data).toMatchObject({ queued: true });
    await until(() => kinds('thread').filter((kind) => kind === 'end').length === 2, 'both turns to end');
    const written = events('thread').flatMap((message) => (message.event.kind === 'append' ? [message.event.text] : [])).join('');
    // The turn hears that it was not allowed, and folds the question to "Not allowed". His words get an answer of their own.
    expect(written.startsWith('Nothing was sent.')).toBe(true);
    expect(written).toContain('Beans and peas go in bed 2');
    const folded = events('thread').flatMap((message) => (message.event.kind === 'add' && message.event.item.role === 'asked' ? [message.event.item] : []));
    expect(folded).toEqual([{ role: 'asked', text: 'Send this Slack message to Robin?', answer: 'Not allowed' }]);
    // Nothing Opal posted said yes.
    expect(standIn.requests.filter((request) => request.headers['x-auto-client'] !== 'elsewhere').some((request) => /"allow":true|signature/.test(JSON.stringify(request.body ?? {})))).toBe(false);
  });

  it('reads no words that come with a no to a send, as the service does not', async () => {
    const auto = await connected();
    const snapshot = await auto.request({ kind: 'thread', id: BREAD });
    await auto.follow({ stream: 'thread', id: BREAD, cursor: snapshot.success ? (snapshot.data as AutoSnapshot).cursor : null });
    await until(() => count('open') === 1, 'the thread stream');
    await auto.request({ kind: 'message', id: BREAD, text: 'Send Robin a word about the swap', cid: 'a1b2c3' });
    await until(() => kinds('thread').includes('question'), 'the question');
    const asked = events('thread').find((message) => message.event.kind === 'question')?.event;
    const id = asked?.kind === 'question' && asked.question ? asked.question.id : '';
    // Another client sends a reason with its no. It is dropped unread.
    await fetch(`${standIn.url}/api/threads/${BREAD}/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auto-Client': 'elsewhere' }, body: JSON.stringify({ id, allow: false, message: 'Not this week' }),
    });
    await until(() => kinds('thread').includes('end'), 'the end of the turn');
    const written = events('thread').flatMap((message) => (message.event.kind === 'append' ? [message.event.text] : [])).join('');
    expect(written).toBe('Nothing was sent.');
    expect(JSON.stringify(events('thread'))).not.toContain('Not this week');
  });

  it('reads the move that is his from the list, and its end when the thread moves on', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    await auto.request({ kind: 'message', id: BREAD, text: 'Write a note for the club', cid: 'a1b2c3' });
    await until(() => listed(BREAD).some((thread) => thread.yours !== ''), 'his move');
    expect(listed(BREAD).at(-1)).toMatchObject({ status: 'idle', yours: 'Read the note and send it to the club' });
    const list = await auto.request({ kind: 'threads' });
    expect(list.success && (list.data as { threads: AutoThread[] }).threads.find((thread) => thread.id === BREAD)?.yours).toBe('Read the note and send it to the club');
    await auto.request({ kind: 'message', id: BREAD, text: 'Thanks', cid: 'a1b2c4' });
    await until(() => listed(BREAD).at(-1)?.yours === '', 'the move to end');
  });
});

describe('the mark for the Mac', () => {
  const TRELLIS = '5a0000000005';
  const mark = (thread: unknown) => (thread as { thread: AutoThread }).thread.desk;
  /** A write from another client, as the phone would make it. */
  const fromPhone = (path: string, body: unknown) =>
    fetch(`${standIn.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auto-Client': 'phone' }, body: JSON.stringify(body) });

  it('is set and taken off through the service, which names the client that set it', async () => {
    const auto = await connected();
    const on = await auto.request({ kind: 'desk', id: TRELLIS, on: true });
    expect(on.success && mark(on.data)).toEqual({ at: expect.any(Number), by: 'opal' });
    expect(standIn.requests.at(-1)).toMatchObject({ path: `/api/threads/${TRELLIS}/desk`, body: { on: true } });
    const list = await auto.request({ kind: 'threads' });
    expect(list.success && (list.data as { threads: AutoThread[] }).threads.find((thread) => thread.id === TRELLIS)?.desk?.by).toBe('opal');
    const off = await auto.request({ kind: 'desk', id: TRELLIS, on: false });
    expect(off.success && mark(off.data)).toBeNull();
  });

  it('is ended by the service when another client picks the thread up, and the list stream says so', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    await fromPhone(`/api/threads/${TRELLIS}/desk`, { on: true });
    await until(() => events('list').some((message) => message.event.kind === 'thread' && message.event.thread.desk?.by === 'phone'), 'the mark');
    // Words from the client that set the mark do not end it; Opal's do.
    await fromPhone(`/api/threads/${TRELLIS}/messages`, { text: 'One more thing', cid: 'p1' });
    await until(() => standIn.thread(TRELLIS)?.status === 'idle' && !standIn.thread(TRELLIS)?.live, 'the turn to end');
    expect(standIn.entries().find((thread) => thread.id === TRELLIS)?.desk).toMatchObject({ by: 'phone' });
    await auto.request({ kind: 'message', id: TRELLIS, text: 'Picked up on the Mac', cid: 'm1' });
    await until(() => {
      const last = events('list').filter((message) => message.event.kind === 'thread' && message.event.thread.id === TRELLIS).at(-1);
      return last?.event.kind === 'thread' && last.event.thread.desk === null;
    }, 'the mark to end');
  });
});

describe('what is put away', () => {
  const GLASS = '5a000000000a';
  const TRELLIS = '5a0000000005';
  const HOUR = 3600;
  const listed = (id: string) => events('list').flatMap((message) => (message.event.kind === 'thread' && message.event.thread.id === id ? [message.event.thread] : []));
  const tomorrow = () => Math.floor(Date.now() / 1000) + 24 * HOUR;

  it('reads what he archived, newest first, each with when, the count of all of it, and a first few by number', async () => {
    const auto = await connected();
    const all = await auto.request({ kind: 'archived', limit: null });
    expect(asked.at(-1)?.url).toBe(`${standIn.url}/api/threads?archived=1`);
    const whole = (all.success ? all.data : null) as { threads: AutoThread[]; total: number };
    expect(whole.total).toBe(12);
    expect(whole.threads.map((thread) => thread.title).slice(0, 3)).toEqual(['Fence paint', 'Bird feeder', 'Leaf mould bin']);
    expect(whole.threads.every((thread) => thread.archived && typeof thread.archivedAt === 'number')).toBe(true);
    const times = whole.threads.map((thread) => thread.archivedAt ?? 0);
    expect(times).toEqual([...times].sort((left, right) => right - left));

    const some = await auto.request({ kind: 'archived', limit: 10 });
    expect(asked.at(-1)?.url).toBe(`${standIn.url}/api/threads?archived=1&limit=10`);
    const first = (some.success ? some.data : null) as { threads: AutoThread[]; total: number };
    expect(first.threads).toHaveLength(10);
    expect(first.total).toBe(12);
    // The list he works from never carries them.
    const list = await auto.request({ kind: 'threads' });
    expect(list.success && (list.data as { threads: AutoThread[] }).threads.some((thread) => thread.archived)).toBe(false);
  });

  it('serves an archived thread like any other, and a restore puts it back where it sat with no time of archiving', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    const before = (await auto.request({ kind: 'threads' })) as { success: true; data: { threads: AutoThread[] } };
    const order = before.data.threads.map((thread) => thread.id);

    const gone = await auto.request({ kind: 'archive', id: TRELLIS, archived: true });
    expect(gone.success && (gone.data as { thread: AutoThread }).thread).toMatchObject({ archived: true, archivedAt: expect.any(Number) });
    const archive = await auto.request({ kind: 'archived', limit: 10 });
    // Archived a moment ago: first of the 13.
    expect(archive.success && (archive.data as { threads: AutoThread[]; total: number })).toMatchObject({ total: 13, threads: expect.arrayContaining([expect.objectContaining({ id: TRELLIS })]) });
    expect(archive.success && (archive.data as { threads: AutoThread[] }).threads[0].id).toBe(TRELLIS);
    const read = await auto.request({ kind: 'thread', id: TRELLIS });
    expect(read.success && (read.data as AutoSnapshot).items.at(-1)).toMatchObject({ role: 'assistant', text: 'String lines every 20 cm hold a vine up to two metres.' });

    messages.length = 0;
    const back = await auto.request({ kind: 'archive', id: TRELLIS, archived: false });
    expect(standIn.requests.at(-1)).toMatchObject({ path: `/api/threads/${TRELLIS}/archive`, body: { archived: false } });
    expect(back.success && (back.data as { thread: AutoThread }).thread).toMatchObject({ archived: false, archivedAt: null });
    await until(() => kinds('list').includes('order'), 'the order');
    const after = (await auto.request({ kind: 'threads' })) as { success: true; data: { threads: AutoThread[] } };
    expect(after.data.threads.map((thread) => thread.id)).toEqual(order);
  });

  it('reads a wait on a thread: who he waits on, where, until when, and what was heard', async () => {
    const auto = await connected();
    const list = (await auto.request({ kind: 'threads' })) as { success: true; data: { threads: AutoThread[] } };
    const glass = list.data.threads.find((thread) => thread.id === GLASS);
    expect(glass).toMatchObject({ snoozed: expect.any(Number), snoozedAt: expect.any(Number) });
    expect(glass?.wait).toEqual({
      say: 'until Sam sends the quote for the glass', state: 'watching', on: 'Sam', what: 'the quote for the greenhouse glass', where: 'Gmail',
      link: 'https://mail.example/mail/u/0/#all/18c2f0a1b2c3d4e5', check: 'Any reply from Sam with a price',
      since: expect.any(Number), expires: glass?.snoozed, heard: 'Sam: I will measure the frames on Monday.', reply: '',
    });
    // A thread nobody waits for has none.
    expect(list.data.threads.find((thread) => thread.id === BREAD)?.wait).toBeNull();
  });

  it('puts a thread away until a reply: his words go as they are, Auto finds the conversation, then the service watches it', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    const until_ = tomorrow();
    const put = await auto.request({ kind: 'snooze', id: TRELLIS, until: until_, wait: { say: 'Robin, about the seed swap' } });
    expect(standIn.requests.at(-1)).toMatchObject({ path: `/api/threads/${TRELLIS}/snooze`, body: { until: until_, wait: { say: 'Robin, about the seed swap' } } });
    expect(put.success && (put.data as { thread: AutoThread }).thread).toMatchObject({
      snoozed: until_, snoozedAt: expect.any(Number), woke: null,
      wait: { say: 'Robin, about the seed swap', state: 'finding', on: '', what: '', where: '', link: '', expires: until_, heard: '', reply: '' },
    });
    await until(() => listed(TRELLIS).at(-1)?.wait?.state === 'watching', 'the wait to be watched');
    const watching = listed(TRELLIS).at(-1);
    expect(watching).toMatchObject({ snoozed: until_, wait: { on: 'Robin', where: 'Slack', what: 'an answer about the seed swap', link: 'https://chat.example/archives/C0SEEDS/p1794700000123456' } });
    // His words show in the thread as his message, as the service writes them.
    await until(() => standIn.thread(TRELLIS)?.status === 'idle' && !standIn.thread(TRELLIS)?.live, 'the turn to end');
    const snapshot = await auto.request({ kind: 'thread', id: TRELLIS });
    const items = snapshot.success ? (snapshot.data as AutoSnapshot).items : [];
    expect(items.some((item) => item.role === 'user' && item.text === 'Wait for a reply: Robin, about the seed swap')).toBe(true);
    expect(items.at(-1)).toMatchObject({ role: 'assistant', text: expect.stringMatching(/^Waiting on Robin in Slack\. The wait gives up /) });
  });

  it('asks who he means when his words name nobody, which brings the thread back until he answers', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    const until_ = tomorrow();
    await auto.request({ kind: 'snooze', id: TRELLIS, until: until_, wait: { say: 'someone at the club' } });
    // A question brings a snoozed thread back at once. The wait stays, with no conversation named yet.
    await until(() => listed(TRELLIS).at(-1)?.status === 'waiting', 'the question');
    expect(listed(TRELLIS).at(-1)).toMatchObject({ snoozed: null, ask: { kind: 'ask', text: 'Who are you waiting on?', options: ['Robin', 'Sam'] }, wait: { state: 'finding', on: '' } });
    const snapshot = await auto.request({ kind: 'thread', id: TRELLIS });
    const question = snapshot.success ? (snapshot.data as AutoSnapshot).live?.question : null;
    await auto.request({ kind: 'answer', id: TRELLIS, answer: { id: question?.id ?? '', answers: { 'Who are you waiting on?': 'Sam' } } });
    await until(() => listed(TRELLIS).at(-1)?.wait?.state === 'watching', 'the wait to be watched');
    expect(listed(TRELLIS).at(-1)).toMatchObject({ snoozed: until_, wait: { on: 'Sam', expires: until_ } });
  });

  it('reads a wait on a text: the place is Messages, and its link is a number that is no web address', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    await auto.request({ kind: 'snooze', id: TRELLIS, until: tomorrow(), wait: { say: 'a text from Robin' } });
    await until(() => listed(TRELLIS).at(-1)?.wait?.state === 'watching', 'the wait to be watched');
    expect(listed(TRELLIS).at(-1)?.wait).toMatchObject({ on: 'Robin', where: 'Messages', link: 'imessage:+15550100' });
    await until(() => standIn.thread(TRELLIS)?.status === 'idle' && !standIn.thread(TRELLIS)?.live, 'the turn to end');
    standIn.reply(TRELLIS, 'Robin: Saturday at ten.');
    await until(() => listed(TRELLIS).at(-1)?.wait?.state === 'met' && standIn.thread(TRELLIS)?.status === 'idle' && !standIn.thread(TRELLIS)?.live, 'the reply');
    const snapshot = await auto.request({ kind: 'thread', id: TRELLIS });
    const items = snapshot.success ? (snapshot.data as AutoSnapshot).items : [];
    // The number is in the wait's link and in nothing Auto says.
    expect(JSON.stringify(items)).not.toContain('+15550100');
    expect(items.at(-1)).toMatchObject({ role: 'assistant', text: 'Robin replied in Messages: Saturday at ten.' });
  });

  it('gives a wait with no time of his own the service’s: two working days on at 5 pm', async () => {
    const auto = await connected();
    const put = await auto.request({ kind: 'snooze', id: TRELLIS, until: null, wait: { say: 'Robin' } });
    expect(standIn.requests.at(-1)?.body).toEqual({ wait: { say: 'Robin' } });
    const thread = (put.success ? (put.data as { thread: AutoThread }).thread : null) as AutoThread;
    const gives = new Date((thread.snoozed ?? 0) * 1000);
    expect([gives.getHours(), gives.getMinutes()]).toEqual([17, 0]);
    expect([0, 6]).not.toContain(gives.getDay());
    expect(thread.wait?.expires).toBe(thread.snoozed);
  });

  it('brings the thread back on top when the reply arrives, with the reply’s line and a note in its history', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    standIn.heard(GLASS, 'Sam: Still waiting on the supplier.');
    await until(() => listed(GLASS).at(-1)?.wait?.heard === 'Sam: Still waiting on the supplier.', 'what was heard');
    expect(listed(GLASS).at(-1)).toMatchObject({ snoozed: expect.any(Number), wait: { state: 'watching' } });

    standIn.reply(GLASS, 'Sam: 4 mm toughened, 86 for the lot.');
    await until(() => listed(GLASS).at(-1)?.wait?.state === 'met', 'the reply');
    const met = listed(GLASS).find((thread) => thread.wait?.state === 'met');
    expect(met).toMatchObject({ snoozed: null, snoozedAt: null, woke: expect.any(Number), last: 'Sam: 4 mm toughened, 86 for the lot.', wait: { state: 'met', on: 'Sam', reply: 'Sam: 4 mm toughened, 86 for the lot.' } });
    await until(() => standIn.thread(GLASS)?.status === 'idle' && !standIn.thread(GLASS)?.live, 'the turn to end');
    const list = (await auto.request({ kind: 'threads' })) as { success: true; data: { threads: AutoThread[] } };
    expect(list.data.threads[0].id).toBe(GLASS);
    const snapshot = await auto.request({ kind: 'thread', id: GLASS });
    const items = snapshot.success ? (snapshot.data as AutoSnapshot).items : [];
    expect(items.at(-2)).toEqual({ role: 'note', text: 'Sam replied' });
    expect(items.at(-1)).toMatchObject({ role: 'assistant', text: expect.stringContaining('4 mm toughened, 86 for the lot.') });

    // His next words end the finished wait.
    await auto.request({ kind: 'message', id: GLASS, text: 'Order it', cid: 'a1b2c5' });
    await until(() => listed(GLASS).at(-1)?.wait === null, 'the wait to clear');
  });

  it('brings it back when the time runs out, saying nobody replied', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    standIn.expire(GLASS);
    await until(() => listed(GLASS).at(-1)?.wait?.state === 'expired', 'the wait to run out');
    expect(listed(GLASS).find((thread) => thread.wait?.state === 'expired')).toMatchObject({ snoozed: null, woke: expect.any(Number), last: 'No reply from Sam.', wait: { state: 'expired', reply: '' } });
    await until(() => standIn.thread(GLASS)?.status === 'idle' && !standIn.thread(GLASS)?.live, 'the turn to end');
    const snapshot = await auto.request({ kind: 'thread', id: GLASS });
    const items = snapshot.success ? (snapshot.data as AutoSnapshot).items : [];
    expect(items.at(-2)).toMatchObject({ role: 'note', text: expect.stringMatching(/^No reply by /) });
  });

  it('ends a wait when he brings the thread back, when he snoozes it to a time, and when he archives it', async () => {
    const auto = await connected();
    const back = await auto.request({ kind: 'snooze', id: GLASS, until: null });
    expect(standIn.requests.at(-1)?.body).toEqual({ until: null });
    expect(back.success && (back.data as { thread: AutoThread }).thread).toMatchObject({ snoozed: null, snoozedAt: null, woke: null, wait: null });

    const until_ = tomorrow();
    await auto.request({ kind: 'snooze', id: TRELLIS, until: until_, wait: { say: 'Robin' } });
    const plain = await auto.request({ kind: 'snooze', id: TRELLIS, until: until_ + HOUR });
    expect(plain.success && (plain.data as { thread: AutoThread }).thread).toMatchObject({ snoozed: until_ + HOUR, wait: null });

    await auto.request({ kind: 'snooze', id: BREAD, until: until_, wait: { say: 'Robin' } });
    const gone = await auto.request({ kind: 'archive', id: BREAD, archived: true });
    expect(gone.success && (gone.data as { thread: AutoThread }).thread).toMatchObject({ archived: true, snoozed: null, wait: null });
  });

  it('gives the service’s sentence for a time it will not take', async () => {
    const auto = await connected();
    const past = await auto.request({ kind: 'snooze', id: TRELLIS, until: 1_000, wait: { say: 'Robin' } });
    expect(past.success === false && past.error).toMatchObject({ kind: 'refused', message: 'Pick a time in the future.' });
    expect(standIn.thread(TRELLIS)?.wait ?? null).toBeNull();
  });
});

describe('the digest queue', () => {
  const DAY = '2026-11-13';
  const entry = (digest: AutoDigest, id: string) => digest.sections.flatMap((section) => section.entries).find((each) => each.id === id);

  it('reads the latest digest, a day by its date, and the days that have one', async () => {
    const auto = await connected();
    const latest = await auto.request({ kind: 'digest', date: null });
    const digest = (latest.success ? latest.data : null) as AutoDigest;
    expect(digest.date).toBe(DAY);
    expect(digest.left).toBe(8);
    expect(digest.sections.map((section) => section.title)).toEqual(['Meetings', 'Top 3', 'People', 'Plots', 'Yesterday', 'Drafted replies']);
    expect(entry(digest, 'item-1')).toMatchObject({ kind: 'item', state: 'open', draft: { title: 'Garden centre', paste: expect.stringContaining('Two trays') } });
    expect(entry(digest, 'item-2')).toMatchObject({ state: 'thread', thread: '5a0000000006', priority: 'High' });
    expect(entry(digest, 'text-yesterday-88ae3a55')).toMatchObject({ state: 'resolved' });
    expect(entry(digest, 'draft-1')).toMatchObject({ kind: 'draft', draft: { title: 'Garden club', paste: expect.stringContaining('the 21st') } });
    expect(entry(digest, 'text-plots-3d20bff3')?.md).toContain('| Plot | Bed |');

    const earlier = await auto.request({ kind: 'digest', date: '2026-11-12' });
    expect(earlier.success && (earlier.data as AutoDigest).date).toBe('2026-11-12');
    expect(asked.at(-1)?.url).toBe(`${standIn.url}/api/digest?date=2026-11-12`);
    const days = await auto.request({ kind: 'digests' });
    expect(days.success && (days.data as AutoDigestDays)).toEqual({ days: [DAY, '2026-11-12', '2026-11-11'], latest: DAY, archived: [] });
  });

  it('archives a digest and puts it back, and says which days are archived', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    const before = (await auto.request({ kind: 'digest', date: null })) as { success: true; data: AutoDigest };
    expect(before.data.archived).toBe(false);

    const archived = await auto.request({ kind: 'digest-archive', date: DAY, archived: true });
    expect(standIn.requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/digest/archive', body: { date: DAY, archived: true } });
    // A mark for the screens: the day comes back whole, with nothing in it changed.
    expect(archived.success && archived.data).toEqual({ ...before.data, archived: true });
    await until(() => events('list').some((message) => message.event.kind === 'digest' && message.event.date === DAY), 'the digest event');
    const days = await auto.request({ kind: 'digests' });
    expect(days.success && days.data).toEqual({ days: [DAY, '2026-11-12', '2026-11-11'], latest: DAY, archived: [DAY] });
    // It stays readable, by its day and as the latest.
    const again = await auto.request({ kind: 'digest', date: DAY });
    expect(again.success && (again.data as AutoDigest).archived).toBe(true);

    const back = await auto.request({ kind: 'digest-archive', date: DAY, archived: false });
    expect(back.success && (back.data as AutoDigest).archived).toBe(false);
    const after = await auto.request({ kind: 'digests' });
    expect(after.success && (after.data as AutoDigestDays).archived).toEqual([]);
    const noDay = await auto.request({ kind: 'digest-archive', date: '2020-01-01', archived: true });
    expect(noDay.success === false && noDay.error).toMatchObject({ kind: 'refused', message: 'No digest.' });
  });

  it('says there is no digest in the service’s own words', async () => {
    await standIn.close();
    standIn = await startStandIn({ digests: 'none', retryMs: 500 });
    const auto = await connected();
    expect(await auto.request({ kind: 'digest', date: null })).toEqual({ success: false, error: { kind: 'refused', message: 'No digest.', status: 404, code: 'not_found' } });
    const days = await auto.request({ kind: 'digests' });
    expect(days.success && days.data).toEqual({ days: [], latest: null, archived: [] });
  });

  it('resolves one entry or several, reopens them, and gets the day back each time', async () => {
    const auto = await connected();
    const one = await auto.request({ kind: 'digest-resolve', date: DAY, ids: ['person-robin-seed-swap'], resolved: true });
    expect(one.success && (one.data as AutoDigest).left).toBe(7);
    expect(standIn.requests.at(-1)?.body).toEqual({ date: DAY, id: 'person-robin-seed-swap', resolved: true });
    const several = await auto.request({ kind: 'digest-resolve', date: DAY, ids: ['text-yesterday-5c1d2e3f', 'text-yesterday-a7b8c9d0'], resolved: true });
    expect(standIn.requests.at(-1)?.body).toEqual({ date: DAY, ids: ['text-yesterday-5c1d2e3f', 'text-yesterday-a7b8c9d0'], resolved: true });
    expect(several.success && (several.data as AutoDigest).left).toBe(5);
    const back = await auto.request({ kind: 'digest-resolve', date: DAY, ids: ['person-robin-seed-swap'], resolved: false });
    expect(back.success && entry(back.data as AutoDigest, 'person-robin-seed-swap')?.state).toBe('open');
    // A to-do is resolved by its box, without any tick by number.
    const item = await auto.request({ kind: 'digest-resolve', date: DAY, ids: ['item-3'], resolved: true });
    expect(item.success && entry(item.data as AutoDigest, 'item-3')?.state).toBe('resolved');
    expect(standIn.requests.some((request) => request.path.includes('/digest/tick') || request.path.includes('/digest/inbox'))).toBe(false);
  });

  it('writes a note on an entry and removes it', async () => {
    const auto = await connected();
    const noted = await auto.request({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'Ask about peat-free' });
    expect(noted.success && entry(noted.data as AutoDigest, 'item-1')?.note).toBe('Ask about peat-free');
    const removed = await auto.request({ kind: 'digest-note', date: DAY, id: 'item-1', text: '' });
    expect(removed.success && entry(removed.data as AutoDigest, 'item-1')?.note).toBe('');
  });

  it('makes an entry a thread that waits, once, and says so on the list stream', async () => {
    const auto = await connected();
    await auto.follow({ stream: 'list', cursor: null });
    await until(() => count('open') === 1, 'the list stream');
    const made = await auto.request({ kind: 'digest-thread', date: DAY, id: 'meeting-allotment-committee', words: null, cid: null });
    const thread = (made.success ? made.data : null) as { thread: AutoThread };
    expect(thread.thread).toMatchObject({ title: 'Allotment committee', waits: true, digest: { date: DAY, id: 'meeting-allotment-committee' } });
    expect(standIn.requests.at(-1)?.body).toEqual({ date: DAY, id: 'meeting-allotment-committee', start: false });
    expect(standIn.entries()[0].id).toBe(thread.thread.id);
    const again = await auto.request({ kind: 'digest-thread', date: DAY, id: 'meeting-allotment-committee', words: null, cid: null });
    expect(again.success && (again.data as { thread: AutoThread }).thread.id).toBe(thread.thread.id);
    await until(() => kinds('list').includes('digest'), 'the digest event');
    expect(events('list').find((message) => message.event.kind === 'digest')?.event).toEqual({ kind: 'digest', date: DAY });
    const digest = await auto.request({ kind: 'digest', date: null });
    expect(digest.success && entry(digest.data as AutoDigest, 'meeting-allotment-committee')).toMatchObject({ state: 'thread', thread: thread.thread.id });
  });

  it('starts a thread from an entry with his words, his note going along', async () => {
    const auto = await connected();
    await auto.request({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'Ask about peat-free' });
    const made = await auto.request({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Ask for collection on Saturday', cid: 'a1b2c3d4e5' });
    const { thread } = (made.success ? made.data : null) as { thread: AutoThread };
    expect(thread.waits).toBe(false);
    expect(standIn.requests.at(-1)?.body).toEqual({ date: DAY, id: 'item-1', words: 'Ask for collection on Saturday', cid: 'a1b2c3d4e5' });
    await until(() => standIn.thread(thread.id)?.status === 'idle' && !standIn.thread(thread.id)?.live, 'the turn to end');
    const snapshot = await auto.request({ kind: 'thread', id: thread.id });
    const first = (snapshot.success ? (snapshot.data as AutoSnapshot).items[0] : null) as { role: 'user'; text: string };
    expect(first.text.startsWith('Digest, Friday November 13, item 1: Order the seed trays')).toBe(true);
    expect(first.text.endsWith('says:\n\nAsk about peat-free\n\nAsk for collection on Saturday')).toBe(true);
  });

  it('gives the service’s sentence for an entry or a day it does not have', async () => {
    const auto = await connected();
    const missing = await auto.request({ kind: 'digest-resolve', date: DAY, ids: ['item-99'], resolved: true });
    expect(missing.success === false && missing.error).toMatchObject({ kind: 'refused', message: 'No such entry.' });
    const noDay = await auto.request({ kind: 'digest-note', date: '2020-01-01', id: 'item-1', text: 'x' });
    expect(noDay.success === false && noDay.error).toMatchObject({ kind: 'refused', message: 'No digest.' });
  });
});
