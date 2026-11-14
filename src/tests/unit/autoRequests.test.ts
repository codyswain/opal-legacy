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

describe('the request builder', () => {
  const routes: Array<[AutoRoute, 'GET' | 'POST', string, unknown]> = [
    [{ kind: 'status' }, 'GET', '/api/status', undefined],
    [{ kind: 'check-status' }, 'POST', '/api/status/check', {}],
    [{ kind: 'threads' }, 'GET', '/api/threads', undefined],
    [{ kind: 'thread', id: ID }, 'GET', `/api/threads/${ID}`, undefined],
    [{ kind: 'create', text: 'Plan the beds', model: '', cid: 'a1b2c3d4e5' }, 'POST', '/api/threads', { text: 'Plan the beds', model: '', cid: 'a1b2c3d4e5' }],
    [{ kind: 'message', id: ID, text: 'send it', cid: 'a1b2c3d4e5' }, 'POST', `/api/threads/${ID}/messages`, { text: 'send it', cid: 'a1b2c3d4e5' }],
    [{ kind: 'stop', id: ID }, 'POST', `/api/threads/${ID}/stop`, {}],
    [{ kind: 'answer', id: ID, answer: { id: 'q1', answers: { 'Which wood?': 'Cedar' } } }, 'POST', `/api/threads/${ID}/answer`, { id: 'q1', answers: { 'Which wood?': 'Cedar' } }],
    [{ kind: 'answer', id: ID, answer: { id: 'q1', allow: true } }, 'POST', `/api/threads/${ID}/answer`, { id: 'q1', allow: true }],
    [{ kind: 'answer', id: ID, answer: { id: 'q1', allow: false, message: 'Use the trash' } }, 'POST', `/api/threads/${ID}/answer`, { id: 'q1', allow: false, message: 'Use the trash' }],
    [{ kind: 'model', id: ID, model: 'small' }, 'POST', `/api/threads/${ID}/model`, { model: 'small' }],
    [{ kind: 'rename', id: ID, title: 'Beds' }, 'POST', `/api/threads/${ID}/rename`, { title: 'Beds' }],
    [{ kind: 'archive', id: ID, archived: true }, 'POST', `/api/threads/${ID}/archive`, { archived: true }],
    [{ kind: 'archive', id: ID, archived: true, done: true }, 'POST', `/api/threads/${ID}/archive`, { archived: true, done: true }],
    [{ kind: 'archive', id: ID, archived: false, done: true }, 'POST', `/api/threads/${ID}/archive`, { archived: false }],
    [{ kind: 'move', id: ID, before: '5a0000000002' }, 'POST', `/api/threads/${ID}/move`, { before: '5a0000000002' }],
    [{ kind: 'move', id: ID, before: null }, 'POST', `/api/threads/${ID}/move`, { before: null }],
    [{ kind: 'snooze', id: ID, until: 1_800_000_000 }, 'POST', `/api/threads/${ID}/snooze`, { until: 1_800_000_000 }],
    [{ kind: 'snooze', id: ID, until: null }, 'POST', `/api/threads/${ID}/snooze`, { until: null }],
    [{ kind: 'start', id: ID }, 'POST', `/api/threads/${ID}/start`, {}],
  ];

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

  it('checks a stream target and its cursor', () => {
    expect(validStreamTarget({ stream: 'list', cursor: null })).toEqual({ stream: 'list', cursor: null });
    expect(validStreamTarget({ stream: 'thread', id: ID, cursor: '6c1f7699.14' })).toEqual({ stream: 'thread', id: ID, cursor: '6c1f7699.14' });
    expect(validStreamTarget({ stream: 'thread', id: '../x', cursor: null })).toBeNull();
    expect(validStreamTarget({ stream: 'list', cursor: 'a b' })).toBeNull();
    expect(validStreamTarget({ stream: 'list', cursor: 'x&y=1' })).toBeNull();
    expect(validStreamTarget({ stream: 'other', cursor: null })).toBeNull();
  });
});
