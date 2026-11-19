import { describe, expect, it } from 'vitest';
import {
  AutoAddressError,
  CLIENT_NAME,
  buildRequest,
  parseAutoAddress,
  parseAutoConfig,
  serializeAutoConfig,
  streamUrl,
  validRoute,
  validStreamTarget,
} from '@/main/auto/autoRequests';
import type { AutoRoute } from '@/types/auto';

const BASE = 'https://host.example/agent';
const ID = '5a0000000001';
const image = 'a0'.repeat(32);

describe('the address rule', () => {
  it('keeps an https address, without the slash at its end', () => {
    expect(parseAutoAddress(' https://host.example/agent/ ')).toBe('https://host.example/agent');
    expect(parseAutoAddress('https://host.example')).toBe('https://host.example');
    expect(parseAutoAddress('HTTPS://Host.Example:8443/a/b')).toBe('https://host.example:8443/a/b');
  });

  it('takes http for this Mac only', () => {
    expect(parseAutoAddress('http://127.0.0.1:47861/agent')).toBe('http://127.0.0.1:47861/agent');
    expect(parseAutoAddress('http://localhost:47861')).toBe('http://localhost:47861');
    expect(parseAutoAddress('http://[::1]:47861/agent')).toBe('http://[::1]:47861/agent');
    for (const address of [
      'http://host.example/agent',
      'http://127.0.0.1.host.example/agent',
      'http://localhost.host.example',
      'http://192.168.1.20:47861',
      'http://10.0.0.5',
    ]) {
      expect(() => parseAutoAddress(address), address).toThrow(AutoAddressError);
    }
  });

  it('refuses anything that is not a plain web address', () => {
    for (const address of [
      '',
      '   ',
      'host.example/agent',
      'ftp://host.example',
      'file:///tmp/agent',
      'javascript:alert(1)',
      'https://name:secret@host.example/agent',
      'https://host.example/agent?next=1',
      'https://host.example/agent#top',
      `https://host.example/${'a'.repeat(2100)}`,
    ]) {
      expect(() => parseAutoAddress(address), address).toThrow(AutoAddressError);
    }
  });

  it('reads auto.json, and nothing from a file it does not know', () => {
    expect(parseAutoConfig(serializeAutoConfig(BASE))).toBe(BASE);
    expect(JSON.parse(serializeAutoConfig(BASE))).toEqual({ version: 1, url: BASE });
    expect(parseAutoConfig(null)).toBeNull();
    expect(parseAutoConfig('not json')).toBeNull();
    expect(parseAutoConfig('[]')).toBeNull();
    expect(parseAutoConfig(JSON.stringify({ version: 2, url: BASE }))).toBeNull();
    expect(parseAutoConfig(JSON.stringify({ version: 1, url: 'http://host.example' }))).toBeNull();
    expect(parseAutoConfig(JSON.stringify({ version: 1, url: 7 }))).toBeNull();
  });
});

/** Every route, with the request it must become. */
const routes: Array<[AutoRoute, 'GET' | 'POST', string, unknown]> = [
  [{ kind: 'upload-image', expectedAddress: BASE, mime: 'image/png', data: 'YWJj' }, 'POST', '/api/images', { mime: 'image/png', data: 'YWJj' }],
  [{ kind: 'image', expectedAddress: BASE, id: image }, 'GET', `/api/images/${image}`, undefined],
  [{ kind: 'create', text: '', model: '', cid: 'a1', images: [image] }, 'POST', '/api/threads', { text: '', model: '', cid: 'a1', images: [image] }],
  [{ kind: 'message', id: ID, text: 'Look here', cid: 'a2', images: [image] }, 'POST', `/api/threads/${ID}/messages`, { text: 'Look here', cid: 'a2', images: [image] }],
  [{ kind: 'digest-thread', date: '2026-11-13', id: 'item-1', words: null, cid: 'a1', images: [image] }, 'POST', '/api/digest/thread', { date: '2026-11-13', id: 'item-1', cid: 'a1', images: [image] }],
  [{ kind: 'status' }, 'GET', '/api/status', undefined],
  [{ kind: 'check-status' }, 'POST', '/api/status/check', {}],
  [{ kind: 'threads' }, 'GET', '/api/threads', undefined],
  [{ kind: 'archived', limit: null }, 'GET', '/api/threads?archived=1', undefined],
  [{ kind: 'archived', limit: 10 }, 'GET', '/api/threads?archived=1&limit=10', undefined],
  [{ kind: 'thread', id: ID }, 'GET', `/api/threads/${ID}`, undefined],
  [{ kind: 'create', text: 'Plan the beds', model: '', cid: 'a1b2c3d4e5' }, 'POST', '/api/threads', { text: 'Plan the beds', model: '', cid: 'a1b2c3d4e5' }],
  [{ kind: 'message', id: ID, text: 'send it', cid: 'a1b2c3d4e5' }, 'POST', `/api/threads/${ID}/messages`, { text: 'send it', cid: 'a1b2c3d4e5' }],
  [{ kind: 'stop', id: ID }, 'POST', `/api/threads/${ID}/stop`, {}],
  [{ kind: 'answer', id: ID, answer: { id: 'q1', answers: { 'Which wood?': 'Cedar' } } }, 'POST', `/api/threads/${ID}/answer`, { id: 'q1', answers: { 'Which wood?': 'Cedar' } }],
  [{ kind: 'answer', id: ID, answer: { id: 'q1', allow: true } }, 'POST', `/api/threads/${ID}/answer`, { id: 'q1', allow: true }],
  [{ kind: 'answer', id: ID, answer: { id: 'q1', allow: false, message: 'Use the trash' } }, 'POST', `/api/threads/${ID}/answer`, { id: 'q1', allow: false, message: 'Use the trash' }],
  [{ kind: 'model', id: ID, model: 'small' }, 'POST', `/api/threads/${ID}/model`, { model: 'small' }],
  [{ kind: 'mode', id: ID, mode: 'orchestrate', agentsModel: 'small' }, 'POST', `/api/threads/${ID}/mode`, { mode: 'orchestrate', agentsModel: 'small' }],
  [{ kind: 'mode', id: ID, mode: '', agentsModel: '' }, 'POST', `/api/threads/${ID}/mode`, { mode: '', agentsModel: '' }],
  [{ kind: 'create', text: 'Plan the beds', model: '', mode: 'orchestrate', agentsModel: 'large', cid: 'a1b2c3d4e5' }, 'POST', '/api/threads', { text: 'Plan the beds', model: '', mode: 'orchestrate', agentsModel: 'large', cid: 'a1b2c3d4e5' }],
  [{ kind: 'rename', id: ID, title: 'Beds' }, 'POST', `/api/threads/${ID}/rename`, { title: 'Beds' }],
  [{ kind: 'archive', id: ID, archived: true }, 'POST', `/api/threads/${ID}/archive`, { archived: true }],
  [{ kind: 'archive', id: ID, archived: true, done: true }, 'POST', `/api/threads/${ID}/archive`, { archived: true, done: true }],
  [{ kind: 'archive', id: ID, archived: false, done: true }, 'POST', `/api/threads/${ID}/archive`, { archived: false }],
  [{ kind: 'move', id: ID, before: '5a0000000002' }, 'POST', `/api/threads/${ID}/move`, { before: '5a0000000002' }],
  [{ kind: 'move', id: ID, before: null }, 'POST', `/api/threads/${ID}/move`, { before: null }],
  [{ kind: 'snooze', id: ID, until: 1_800_000_000 }, 'POST', `/api/threads/${ID}/snooze`, { until: 1_800_000_000 }],
  [{ kind: 'snooze', id: ID, until: null }, 'POST', `/api/threads/${ID}/snooze`, { until: null }],
  [{ kind: 'snooze', id: ID, until: 1_800_000_000, wait: { say: 'Sam, about the glass' } }, 'POST', `/api/threads/${ID}/snooze`, { until: 1_800_000_000, wait: { say: 'Sam, about the glass' } }],
  [{ kind: 'snooze', id: ID, until: null, wait: { say: 'Sam, about the glass' } }, 'POST', `/api/threads/${ID}/snooze`, { wait: { say: 'Sam, about the glass' } }],
  [{ kind: 'start', id: ID }, 'POST', `/api/threads/${ID}/start`, {}],
  [{ kind: 'desk', id: ID, on: true }, 'POST', `/api/threads/${ID}/desk`, { on: true }],
  [{ kind: 'desk', id: ID, on: false }, 'POST', `/api/threads/${ID}/desk`, { on: false }],
  [{ kind: 'digest', date: null }, 'GET', '/api/digest', undefined],
  [{ kind: 'digest', date: '2026-11-13' }, 'GET', '/api/digest?date=2026-11-13', undefined],
  [{ kind: 'digests' }, 'GET', '/api/digests', undefined],
  [{ kind: 'digest-archive', date: '2026-11-13', archived: true }, 'POST', '/api/digest/archive', { date: '2026-11-13', archived: true }],
  [{ kind: 'digest-archive', date: '2026-11-13', archived: false }, 'POST', '/api/digest/archive', { date: '2026-11-13', archived: false }],
  [{ kind: 'digest-resolve', date: '2026-11-13', ids: ['item-1'], resolved: true }, 'POST', '/api/digest/resolve', { date: '2026-11-13', id: 'item-1', resolved: true }],
  [{ kind: 'digest-resolve', date: '2026-11-13', ids: ['item-1', 'text-news-3d20bff3'], resolved: false }, 'POST', '/api/digest/resolve', { date: '2026-11-13', ids: ['item-1', 'text-news-3d20bff3'], resolved: false }],
  [{ kind: 'digest-note', date: '2026-11-13', id: 'item-1', text: 'Ask about peat' }, 'POST', '/api/digest/note', { date: '2026-11-13', id: 'item-1', text: 'Ask about peat' }],
  [{ kind: 'digest-note', date: '2026-11-13', id: 'item-1', text: '' }, 'POST', '/api/digest/note', { date: '2026-11-13', id: 'item-1', text: '' }],
  [{ kind: 'digest-thread', date: '2026-11-13', id: 'item-1', words: null, cid: null }, 'POST', '/api/digest/thread', { date: '2026-11-13', id: 'item-1', start: false }],
  [{ kind: 'digest-thread', date: '2026-11-13', id: 'item-1', words: 'send it', cid: 'a1b2c3d4e5' }, 'POST', '/api/digest/thread', { date: '2026-11-13', id: 'item-1', words: 'send it', cid: 'a1b2c3d4e5' }],
  [{ kind: 'digest-continue', date: '2026-11-13', id: 'item-1', thread: ID, words: null, cid: null }, 'POST', '/api/digest/continue', { date: '2026-11-13', id: 'item-1', thread: ID }],
  [{ kind: 'digest-continue', date: '2026-11-13', id: 'item-1', thread: ID, words: null, cid: 'a1b2c3d4e5' }, 'POST', '/api/digest/continue', { date: '2026-11-13', id: 'item-1', thread: ID, cid: 'a1b2c3d4e5' }],
  [{ kind: 'digest-continue', date: '2026-11-13', id: 'item-1', thread: ID, words: 'and the lid', cid: 'a1b2c3d4e5' }, 'POST', '/api/digest/continue', { date: '2026-11-13', id: 'item-1', thread: ID, words: 'and the lid', cid: 'a1b2c3d4e5' }],
  [{ kind: 'usage' }, 'GET', '/api/usage', undefined],
];

describe('the request builder', () => {

  it('only accepts image IDs and bounded raster uploads', () => {
    const message = { kind: 'message', id: ID, text: '', cid: 'a1' };
    expect(validRoute({ ...message, images: [image] })).toEqual({ ...message, images: [image] });
    for (const images of [[], 42, ['x'], [image, image], [image, ''], Array(5).fill(image)]) {
      expect(validRoute({ ...message, images })).toBeNull();
    }
    expect(validRoute({ kind: 'image', expectedAddress: BASE, id: '../images/' })).toBeNull();
    expect(validRoute({ kind: 'upload-image', expectedAddress: BASE, mime: 'image/svg+xml', data: 'YWJj' })).toBeNull();
    for (const data of ['', 'a', '==ab', 'YW J', 'a'.repeat(6990508)]) {
      expect(validRoute({ kind: 'upload-image', expectedAddress: BASE, mime: 'image/png', data })).toBeNull();
    }
  });

  it.each(routes)('builds %j', (route, method, path, body) => {
    const built = buildRequest(BASE, route);
    expect(built.method).toBe(method);
    expect(built.url).toBe(`${BASE}${path}`);
    expect(built.body === undefined ? undefined : JSON.parse(built.body)).toEqual(body);
  });

  it('reads with GET and writes with a JSON POST that names the client and carries no Origin', () => {
    for (const [route] of routes) {
      const built = buildRequest(BASE, route);
      expect(Object.keys(built.headers).map((name) => name.toLowerCase())).not.toContain('origin');
      if (built.method === 'GET') {
        expect(built.body).toBeUndefined();
        expect(built.headers).toEqual({ Accept: 'application/json' });
      } else {
        expect(built.headers['Content-Type']).toBe('application/json');
        expect(built.headers['X-Auto-Client']).toBe(CLIENT_NAME);
        expect(JSON.parse(built.body ?? '')).toBeTypeOf('object');
      }
    }
  });

  it('never marks a message as a send request, whatever the page adds to a route', () => {
    const sneaky = { kind: 'message', id: ID, text: 'send it', cid: 'a1b2c3d4e5', sends: true } as unknown;
    const route = validRoute(sneaky);
    expect(route).toEqual({ kind: 'message', id: ID, text: 'send it', cid: 'a1b2c3d4e5' });
    for (const [each] of routes) expect(buildRequest(BASE, each).body ?? '').not.toContain('sends');
    expect(buildRequest(BASE, route as AutoRoute).body).toBe('{"text":"send it","cid":"a1b2c3d4e5"}');
    expect(validRoute({ kind: 'create', text: 'send it', model: '', cid: 'a1', sends: true })).toEqual({ kind: 'create', text: 'send it', model: '', cid: 'a1' });
  });

  it('builds a stream address from a cursor', () => {
    expect(streamUrl(BASE, { stream: 'list', cursor: null })).toBe(`${BASE}/api/events`);
    expect(streamUrl(BASE, { stream: 'list', cursor: '6c1f7699.14' })).toBe(`${BASE}/api/events?last=6c1f7699.14`);
    expect(streamUrl(BASE, { stream: 'thread', id: ID, cursor: '6c1f7699.14' })).toBe(`${BASE}/api/threads/${ID}/events?last=6c1f7699.14`);
  });
});

describe('what the page may ask for', () => {
  it('takes every route the builder knows', () => {
    expect(validRoute({ kind: 'status' })).toEqual({ kind: 'status' });
    expect(validRoute({ kind: 'thread', id: ID })).toEqual({ kind: 'thread', id: ID });
    expect(validRoute({ kind: 'archive', id: ID, archived: true, done: true })).toEqual({ kind: 'archive', id: ID, archived: true, done: true });
    expect(validRoute({ kind: 'rename', id: ID, title: '  Beds  ' })).toEqual({ kind: 'rename', id: ID, title: 'Beds' });
    expect(validRoute({ kind: 'answer', id: ID, answer: { id: 'q1', answers: { 'Which?': ['A', 'B'] } } })).toEqual({
      kind: 'answer', id: ID, answer: { id: 'q1', answers: { 'Which?': ['A', 'B'] } },
    });
  });

  it('takes a mode as Solo or a word, with a model key for its agents, and nothing else', () => {
    expect(validRoute({ kind: 'mode', id: ID, mode: 'orchestrate', agentsModel: 'small', extra: 1 })).toEqual({ kind: 'mode', id: ID, mode: 'orchestrate', agentsModel: 'small' });
    expect(validRoute({ kind: 'mode', id: ID, mode: '' })).toEqual({ kind: 'mode', id: ID, mode: '', agentsModel: '' });
    expect(validRoute({ kind: 'mode', id: ID, mode: 'Swarm Mode', agentsModel: '' })).toBeNull();
    expect(validRoute({ kind: 'mode', id: ID, mode: 'orchestrate', agentsModel: 'Big Model' })).toBeNull();
    expect(validRoute({ kind: 'mode', id: '../x', mode: '' })).toBeNull();
    // A new thread may start in a mode; a body without one is the body an older service knows.
    expect(validRoute({ kind: 'create', text: 'Go', model: '', mode: 'orchestrate', agentsModel: 'large', cid: 'a1' })).toEqual({ kind: 'create', text: 'Go', model: '', mode: 'orchestrate', agentsModel: 'large', cid: 'a1' });
    expect(validRoute({ kind: 'create', text: 'Go', model: '', mode: 'nope mode', cid: 'a1' })).toBeNull();
    expect(buildRequest(BASE, { kind: 'create', text: 'Go', model: '', mode: '', agentsModel: '', cid: 'a1' }).body).toBe(JSON.stringify({ text: 'Go', model: '', cid: 'a1' }));
  });

  it('checks a thread id before it can reach a path', () => {
    for (const id of ['', '../status', 'a/b', 'a b', 'a?b=1', 'a#b', '%2e%2e', 'a'.repeat(65), 7, null, undefined, { id: 'x' }]) {
      for (const kind of ['thread', 'message', 'stop', 'answer', 'model', 'rename', 'archive', 'move', 'snooze', 'start']) {
        expect(validRoute({ kind, id, text: 'hello', cid: 'a1', model: '', title: 'T', archived: true, before: null, until: null }), `${kind} ${String(id)}`).toBeNull();
      }
    }
    expect(validRoute({ kind: 'move', id: ID, before: '../x' })).toBeNull();
    expect(validRoute({ kind: 'move', id: ID, before: ID })).toBeNull();
  });

  it('refuses what the service would refuse, and anything it does not know', () => {
    expect(validRoute(null)).toBeNull();
    expect(validRoute('status')).toBeNull();
    expect(validRoute({ kind: 'digest' })).toBeNull();
    expect(validRoute({ kind: 'inbox' })).toBeNull();
    expect(validRoute({ kind: 'gmail-draft', id: 'abc' })).toBeNull();
    expect(validRoute({ kind: 'page', path: 'Library/x' })).toBeNull();
    expect(validRoute({ kind: 'message', id: ID, text: '   ', cid: 'a1' })).toBeNull();
    expect(validRoute({ kind: 'message', id: ID, text: 'x'.repeat(100_001), cid: 'a1' })).toBeNull();
    expect(validRoute({ kind: 'message', id: ID, text: 'hello', cid: 'not a cid' })).toBeNull();
    expect(validRoute({ kind: 'create', text: 'hello', model: 'No Such', cid: 'a1' })).toBeNull();
    expect(validRoute({ kind: 'rename', id: ID, title: '' })).toBeNull();
    expect(validRoute({ kind: 'snooze', id: ID, until: 'tomorrow' })).toBeNull();
    expect(validRoute({ kind: 'snooze', id: ID, until: -5 })).toBeNull();
    expect(validRoute({ kind: 'answer', id: ID, answer: { id: 'q1' } })).toBeNull();
    expect(validRoute({ kind: 'answer', id: ID, answer: { id: 'q1', answers: {} } })).toBeNull();
    expect(validRoute({ kind: 'answer', id: ID, answer: { id: '../q', allow: true } })).toBeNull();
  });

  it('asks for what he archived, all of it or a first whole number of threads', () => {
    expect(validRoute({ kind: 'archived', limit: null, cursor: 'x' })).toEqual({ kind: 'archived', limit: null });
    expect(validRoute({ kind: 'archived', limit: 10 })).toEqual({ kind: 'archived', limit: 10 });
    expect(validRoute({ kind: 'archived', limit: 500 })).toEqual({ kind: 'archived', limit: 500 });
    for (const limit of [0, -1, 501, 1.5, '10', '10&archived=0', Number.NaN, Number.POSITIVE_INFINITY, undefined, {}]) {
      expect(validRoute({ kind: 'archived', limit }), `limit ${String(limit)}`).toBeNull();
    }
    expect(validRoute({ kind: 'archived' })).toBeNull();
  });

  it('puts a thread away until a reply with his words alone, trimmed and held to 2,000 characters', () => {
    expect(validRoute({ kind: 'snooze', id: ID, until: 1_800_000_000, wait: { say: '  Sam, about the glass  ', on: 'Sam', link: 'https://x.example', state: 'met' }, sends: true })).toEqual({
      kind: 'snooze', id: ID, until: 1_800_000_000, wait: { say: 'Sam, about the glass' },
    });
    expect(validRoute({ kind: 'snooze', id: ID, until: null, wait: { say: 'Sam' } })).toEqual({ kind: 'snooze', id: ID, until: null, wait: { say: 'Sam' } });
    expect(validRoute({ kind: 'snooze', id: ID, until: null, wait: { say: 'x'.repeat(2_000) } })).not.toBeNull();
    expect(validRoute({ kind: 'snooze', id: ID, until: null, wait: { say: 'x'.repeat(2_001) } })).toBeNull();
    for (const wait of [null, 'Sam', 7, [], {}, { say: '' }, { say: '   ' }, { say: 7 }, { say: null }]) {
      expect(validRoute({ kind: 'snooze', id: ID, until: 1_800_000_000, wait }), `wait ${JSON.stringify(wait)}`).toBeNull();
    }
    expect(validRoute({ kind: 'snooze', id: ID, until: 'tomorrow', wait: { say: 'Sam' } })).toBeNull();
    expect(validRoute({ kind: 'snooze', id: '../x', until: null, wait: { say: 'Sam' } })).toBeNull();
  });

  it('archives a digest by its day, on or off and nothing else', () => {
    const DAY = '2026-11-13';
    expect(validRoute({ kind: 'digest-archive', date: DAY, archived: true, ids: ['item-1'] })).toEqual({ kind: 'digest-archive', date: DAY, archived: true });
    expect(validRoute({ kind: 'digest-archive', date: DAY, archived: false })).toEqual({ kind: 'digest-archive', date: DAY, archived: false });
    for (const archived of ['true', 1, null, undefined]) {
      expect(validRoute({ kind: 'digest-archive', date: DAY, archived }), `archived ${String(archived)}`).toBeNull();
    }
    for (const date of ['', '2026-11-13?x=1', '2026-11-13/../x', '13-11-2026', null, undefined]) {
      expect(validRoute({ kind: 'digest-archive', date, archived: true }), `date ${String(date)}`).toBeNull();
    }
  });

  it('takes the mark for the Mac as on or off', () => {
    expect(validRoute({ kind: 'desk', id: ID, on: true, by: 'someone' })).toEqual({ kind: 'desk', id: ID, on: true });
    expect(validRoute({ kind: 'desk', id: ID, on: 'yes' })).toBeNull();
    expect(validRoute({ kind: 'desk', id: '../x', on: true })).toBeNull();
  });

  it('checks a digest’s day and every entry id before anything is sent', () => {
    const DAY = '2026-11-13';
    expect(validRoute({ kind: 'digest', date: null })).toEqual({ kind: 'digest', date: null });
    expect(validRoute({ kind: 'digest', date: DAY })).toEqual({ kind: 'digest', date: DAY });
    expect(validRoute({ kind: 'digests', anything: 1 })).toEqual({ kind: 'digests' });
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: ['item-1', 'text-news-3d20bff3'], resolved: true, sends: true })).toEqual({
      kind: 'digest-resolve', date: DAY, ids: ['item-1', 'text-news-3d20bff3'], resolved: true,
    });
    expect(validRoute({ kind: 'digest-note', date: DAY, id: 'item-1', text: '  Ask about peat  ' })).toEqual({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'Ask about peat' });
    expect(validRoute({ kind: 'digest-note', date: DAY, id: 'item-1', text: '   ' })).toEqual({ kind: 'digest-note', date: DAY, id: 'item-1', text: '' });
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1', words: null, cid: null })).toEqual({ kind: 'digest-thread', date: DAY, id: 'item-1', words: null, cid: null });
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Ask for Saturday', cid: 'a1', model: 'large', start: true })).toEqual({
      kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Ask for Saturday', cid: 'a1', model: 'large',
    });

    for (const date of ['', '2026-11-13?x=1', '2026-11-13/../x', '13-11-2026', '2026-1-3', 20261113, undefined]) {
      expect(validRoute({ kind: 'digest', date }), `digest ${String(date)}`).toBeNull();
      expect(validRoute({ kind: 'digest-resolve', date, ids: ['item-1'], resolved: true }), `resolve ${String(date)}`).toBeNull();
      expect(validRoute({ kind: 'digest-note', date, id: 'item-1', text: 'x' }), `note ${String(date)}`).toBeNull();
      expect(validRoute({ kind: 'digest-thread', date, id: 'item-1', words: null, cid: null }), `thread ${String(date)}`).toBeNull();
    }
    for (const id of ['', 'Item-1', 'item_1', '../item-1', 'item-1/x', '-item', 'a'.repeat(121), 7, null]) {
      expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: ['item-1', id], resolved: true }), `resolve ${String(id)}`).toBeNull();
      expect(validRoute({ kind: 'digest-note', date: DAY, id, text: 'x' }), `note ${String(id)}`).toBeNull();
      expect(validRoute({ kind: 'digest-thread', date: DAY, id, words: null, cid: null }), `thread ${String(id)}`).toBeNull();
    }
  });

  it('holds a resolve to 200 entries, a note to 4,000 characters, and words to a message’s length', () => {
    const DAY = '2026-11-13';
    const ids = (count: number) => Array.from({ length: count }, (_each, at) => `text-news-${at}`);
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: ids(200), resolved: true })).not.toBeNull();
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: ids(201), resolved: true })).toBeNull();
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: [], resolved: true })).toBeNull();
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: 'item-1', resolved: true })).toBeNull();
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: ['item-1', 'item-1'], resolved: true })).toBeNull();
    expect(validRoute({ kind: 'digest-resolve', date: DAY, ids: ['item-1'] })).toBeNull();
    expect(validRoute({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'x'.repeat(4_000) })).not.toBeNull();
    expect(validRoute({ kind: 'digest-note', date: DAY, id: 'item-1', text: 'x'.repeat(4_001) })).toBeNull();
    expect(validRoute({ kind: 'digest-note', date: DAY, id: 'item-1', text: 7 })).toBeNull();
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1', words: '   ', cid: 'a1' })).toBeNull();
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'x'.repeat(100_001), cid: 'a1' })).toBeNull();
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Ask', cid: 'not a cid' })).toBeNull();
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1', words: 'Ask', cid: null })).toBeNull();
    expect(validRoute({ kind: 'digest-thread', date: DAY, id: 'item-1' })).toBeNull();
  });

  it.each(['digest-thread', 'digest-continue'])('carries the optional reply model through %s', (kind) => {
    const entry: Record<string, unknown> = { kind, date: '2026-11-13', id: 'item-1', thread: ID, words: null, cid: null };
    for (const model of ['', 'codex-gpt-6--2-sol']) {
      const route = validRoute({ ...entry, model });
      expect(route).toMatchObject({ model });
      expect(JSON.parse(buildRequest(BASE, route as AutoRoute).body ?? '{}')).toMatchObject({ model });
    }
    for (const model of [null, 3, {}, 'not a model', 'a'.repeat(33)]) {
      expect(validRoute({ ...entry, model })).toBeNull();
    }
  });

  it('adds an entry to the thread it matches with only the named fields, each checked', () => {
    const DAY = '2026-11-13';
    // Extra fields such as send marks and start are dropped.
    expect(validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: 'Bring the stone', cid: 'a1', sends: true, model: 'large', start: true })).toEqual({
      kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: 'Bring the stone', cid: 'a1', model: 'large',
    });
    expect(validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: null, cid: null })).toEqual({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: null, cid: null });
    expect(validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: null, cid: 'a1' })).toEqual({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: null, cid: 'a1' });
    const built = buildRequest(BASE, validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: 'x', cid: 'a1', sends: true }) as AutoRoute);
    expect(Object.keys(JSON.parse(built.body ?? '{}'))).toEqual(['date', 'id', 'thread', 'words', 'cid']);
    for (const date of ['', '2026-11-13/../x', 20261113, undefined]) expect(validRoute({ kind: 'digest-continue', date, id: 'item-1', thread: ID, words: null, cid: null }), `date ${String(date)}`).toBeNull();
    for (const id of ['', 'Item-1', '../item-1', 7, null]) expect(validRoute({ kind: 'digest-continue', date: DAY, id, thread: ID, words: null, cid: null }), `id ${String(id)}`).toBeNull();
    for (const thread of ['', '../x', 'a/b', 'a b', 7, null, undefined]) expect(validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread, words: null, cid: null }), `thread ${String(thread)}`).toBeNull();
    for (const words of ['   ', 'x'.repeat(100_001), 7, undefined]) expect(validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words, cid: 'a1' }), `words ${String(words).slice(0, 10)}`).toBeNull();
    for (const cid of ['not a cid', 7, undefined]) expect(validRoute({ kind: 'digest-continue', date: DAY, id: 'item-1', thread: ID, words: 'Ask', cid }), `cid ${String(cid)}`).toBeNull();
  });

  it('asks for the plan usage with nothing from the page in its path', () => {
    const sneaky = { kind: 'usage', id: ID, date: '2026-11-13', path: '../threads', limit: 5 } as unknown;
    const route = validRoute(sneaky);
    expect(route).toEqual({ kind: 'usage' });
    expect(buildRequest(BASE, route as AutoRoute)).toEqual({ url: `${BASE}/api/usage`, method: 'GET', headers: { Accept: 'application/json' } });
  });

  it('has no way to tick a box by number or to fill the inbox', () => {
    for (const kind of ['digest-tick', 'tick', 'digest-inbox', 'inbox', 'digest/tick', 'digest/inbox']) {
      expect(validRoute({ kind, date: '2026-11-13', n: 1, checked: true }), kind).toBeNull();
    }
    for (const [route] of routes) {
      const { url } = buildRequest(BASE, route);
      expect(url).not.toContain('/digest/tick');
      expect(url).not.toContain('/digest/inbox');
    }
  });

  it('checks a stream target and its cursor', () => {
    expect(validStreamTarget({ stream: 'list', cursor: null })).toEqual({ stream: 'list', cursor: null });
    expect(validStreamTarget({ stream: 'thread', id: ID, cursor: '6c1f7699.14' })).toEqual({ stream: 'thread', id: ID, cursor: '6c1f7699.14' });
    expect(validStreamTarget({ stream: 'thread', id: '../x', cursor: null })).toBeNull();
    expect(validStreamTarget({ stream: 'list', cursor: 'a b' })).toBeNull();
    expect(validStreamTarget({ stream: 'list', cursor: 'x&y=1' })).toBeNull();
    expect(validStreamTarget({ stream: 'other', cursor: null })).toBeNull();
  });
});
