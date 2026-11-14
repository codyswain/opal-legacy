import { describe, expect, it } from 'vitest';
import {
  toItem,
  toListEvent,
  toNext,
  toQuestion,
  toSnapshot,
  toStatus,
  toThread,
  toThreadEvent,
  toThreads,
  validCid,
  validCursor,
  validThreadId,
} from '@/common/autoModel';

const ENTRY = {
  id: '82a494f21dd8',
  title: 'Shed shelf note',
  status: 'waiting',
  last: 'The loop reached 5.',
  activity: 'Waiting for you',
  ask: { id: '5f0c2a91b7e4', kind: 'ask', text: 'Order the brackets now?', options: ['Order', 'Not yet'], question: 'Order the brackets now?' },
  unread: false,
  model: '',
  created: 1794627177.0,
  updated: 1794627412.4,
  error: null as string | null,
  queued: 0,
  archived: false,
  snoozed: null as number | null,
  woke: 1794630000.0,
  digest: { date: '2026-11-13', id: 'item-3' },
};

describe("reading the service's answers", () => {
  it('keeps a list entry as the service gives it', () => {
    expect(toThread(ENTRY)).toEqual({ ...ENTRY, waits: false });
    expect(toThread({ ...ENTRY, waits: true })?.waits).toBe(true);
  });

  it('drops an entry whose id could not go into a path', () => {
    for (const id of ['', '../x', 'a/b', 'a b', 7, null, 'x'.repeat(65)]) expect(toThread({ ...ENTRY, id })).toBeNull();
    expect(toThreads([ENTRY, { ...ENTRY }, { ...ENTRY, id: 'a/b' }, 'junk', null]).map((thread) => thread.id)).toEqual([ENTRY.id]);
    expect(toThreads('nothing')).toEqual([]);
  });

  it('reads every field by its type, with a plain value for anything else', () => {
    const strange = toThread({ id: 'ok', title: ['x'], status: 'dancing', last: 7, ask: 'yes', unread: 'true', model: 'Not A Key', created: 'soon', snoozed: -1, woke: NaN, digest: 'item', queued: 2.9, error: '' });
    expect(strange).toEqual({
      id: 'ok', title: '', status: 'idle', last: '', activity: '', ask: null, unread: false, model: '', created: 0, updated: 0,
      error: null, queued: 2, archived: false, snoozed: null, woke: null, digest: null, waits: false,
    });
    expect(toThread({ id: 'ok', title: 'x'.repeat(5_000) })?.title.length).toBe(300);
  });

  it('gives a row its answer buttons only with the question they answer', () => {
    expect(toThread({ ...ENTRY, ask: { id: 'q1', kind: 'ask', text: 'Which?', options: ['A', 'B'] } })?.ask).toEqual({ id: 'q1', kind: 'ask', text: 'Which?', options: [], question: null });
    expect(toThread({ ...ENTRY, ask: { id: 'q1', kind: 'permission', text: 'Run a command' } })?.ask).toEqual({ id: 'q1', kind: 'permission', text: 'Run a command', options: [], question: null });
    expect(toThread({ ...ENTRY, ask: { id: '../q', kind: 'ask', text: 'Which?' } })?.ask).toBeNull();
  });

  it('reads items of every role and leaves out roles it does not know', () => {
    expect(toItem({ role: 'user', text: 'Count to 10', cid: 'a1b2c3d4e5' })).toEqual({ role: 'user', text: 'Count to 10', cid: 'a1b2c3d4e5' });
    expect(toItem({ role: 'user', text: 'Count to 10' })).toEqual({ role: 'user', text: 'Count to 10', cid: null });
    expect(toItem({ role: 'assistant', text: 'The plan has', open: true })).toEqual({ role: 'assistant', text: 'The plan has', open: true });
    expect(toItem({ role: 'steps', steps: [{ g: 'read', text: 'plan.md', path: 'Library/notes/plan.md' }, { g: 'run', text: 'Count' }, { text: 'no kind' }, 'junk'] })).toEqual({
      role: 'steps',
      steps: [{ g: 'read', text: 'plan.md', path: 'Library/notes/plan.md' }, { g: 'run', text: 'Count', path: null }],
    });
    expect(toItem({ role: 'asked', text: 'Post it?', answer: 'Not yet' })).toEqual({ role: 'asked', text: 'Post it?', answer: 'Not yet' });
    expect(toItem({ role: 'note', text: 'Stopped' })).toEqual({ role: 'note', text: 'Stopped' });
    expect(toItem({ role: 'widget', html: '<b>x</b>' })).toBeNull();
    expect(toItem('text')).toBeNull();
  });

  it('reads a question and a permission request', () => {
    expect(toQuestion({
      id: '5f0c2a91b7e4', kind: 'ask',
      questions: [{ question: 'Which draft?', header: 'Draft', multiSelect: false, options: [{ label: 'Short', description: 'Two lines' }, { label: '' }, 'junk'] }, { question: '' }],
    })).toEqual({
      id: '5f0c2a91b7e4', kind: 'ask',
      questions: [{ question: 'Which draft?', header: 'Draft', multiSelect: false, options: [{ label: 'Short', description: 'Two lines' }] }],
    });
    expect(toQuestion({ id: '0b7d3e1a9c22', kind: 'permission', tool: 'Bash', title: 'Run a command', detail: 'rm -rf build', reason: '' })).toEqual({
      id: '0b7d3e1a9c22', kind: 'permission', tool: 'Bash', title: 'Run a command', detail: 'rm -rf build', reason: '',
    });
    expect(toQuestion({ id: 'q', kind: 'ask', questions: [] })).toBeNull();
    expect(toQuestion({ id: 'q', kind: 'poll' })).toBeNull();
    expect(toQuestion(null)).toBeNull();
  });

  it('reads a snapshot, keeping of a waiting send only that it waits', () => {
    const snapshot = toSnapshot({
      thread: ENTRY,
      items: [{ role: 'user', text: 'Count to 10' }, { role: 'canvas' }],
      live: { items: [{ role: 'assistant', text: 'The', open: true }], activity: 'Reading', state: 'working', question: null },
      queue: [{ cid: 'f6e5d4c3b2', text: 'And then' }, { cid: 9 }],
      unsent: null,
      next: ['Show the plan', 7, '  '],
      cursor: '6c1f7699.14',
      seed: 'Digest, Friday November 13, item 3: Order brackets',
      send: { id: 's1', to: ['someone@example.com'], subject: 'Hello', text: 'The whole email' },
      sent: [{ at: 1794627000, to: ['someone@example.com'], subject: 'Hello', draft: 'd1' }],
    });
    expect(snapshot).toMatchObject({
      items: [{ role: 'user', text: 'Count to 10', cid: null }],
      live: { items: [{ role: 'assistant', text: 'The', open: true }], activity: 'Reading', state: 'working', question: null },
      queue: [{ cid: 'f6e5d4c3b2', text: 'And then' }],
      next: ['Show the plan'],
      cursor: '6c1f7699.14',
      sendWaiting: true,
      sent: [{ at: 1794627000, to: ['someone@example.com'], subject: 'Hello' }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('The whole email');
    expect(toSnapshot({ thread: { id: 'ok' } })).toMatchObject({ items: [], live: null, queue: [], next: [], cursor: null, seed: null, sendWaiting: false, sent: [] });
    expect(toSnapshot({ items: [] })).toBeNull();
  });

  it('keeps follow-ups word for word', () => {
    expect(toNext(['Show the bed photos', ' Draft the shopping list '])).toEqual(['Show the bed photos', ' Draft the shopping list ']);
    expect(toNext('Show')).toEqual([]);
  });

  it('reads the status', () => {
    expect(toStatus({
      auth: { loggedIn: false, checked: 1, token: 'ok', error: null },
      signin: 'auto-login --on desk-mac', running: 1, waiting: 0, limit: 3,
      models: { '': 'Default', small: 'Small', 'Bad Key': 'x', large: 7 },
    })).toEqual({
      auth: { loggedIn: false, token: 'ok', error: null },
      signin: 'auto-login --on desk-mac', running: 1, waiting: 0, limit: 3,
      models: { '': 'Default', small: 'Small' },
    });
    expect(toStatus({ auth: { loggedIn: 'yes' } })?.auth.loggedIn).toBeNull();
    expect(toStatus({ signin: 'x' })).toBeNull();
  });

  it('reads each list event, and nothing of a kind it does not know', () => {
    expect(toListEvent('thread', ENTRY)).toEqual({ kind: 'thread', thread: { ...ENTRY, waits: false } });
    expect(toListEvent('order', { ids: ['a1', '../b', 7, 'c3'] })).toEqual({ kind: 'order', ids: ['a1', 'c3'] });
    expect(toListEvent('status', { auth: {} })?.kind).toBe('status');
    expect(toListEvent('reset', {})).toEqual({ kind: 'reset' });
    expect(toListEvent('digest', { date: '2026-11-13' })).toBeNull();
    expect(toListEvent('thread', { id: '../x' })).toBeNull();
    expect(toListEvent('order', {})).toBeNull();
  });

  it('reads each thread event, and nothing of a kind it does not know', () => {
    expect(toThreadEvent('turn', { items: [{ role: 'user', text: 'Hi', cid: 'a1' }], state: 'queued', activity: '' })).toEqual({
      kind: 'turn', items: [{ role: 'user', text: 'Hi', cid: 'a1' }], state: 'queued', activity: '',
    });
    expect(toThreadEvent('add', { item: { role: 'note', text: 'Stopped' } })).toEqual({ kind: 'add', item: { role: 'note', text: 'Stopped' } });
    expect(toThreadEvent('add', { item: { role: 'canvas' } })).toBeNull();
    expect(toThreadEvent('append', { text: ' three steps.' })).toEqual({ kind: 'append', text: ' three steps.' });
    expect(toThreadEvent('append', { text: 7 })).toBeNull();
    expect(toThreadEvent('set', { index: 2, item: { role: 'assistant', text: 'Done.' } })).toEqual({ kind: 'set', index: 2, item: { role: 'assistant', text: 'Done.', open: false } });
    expect(toThreadEvent('set', { index: -1, item: { role: 'assistant', text: 'Done.' } })).toBeNull();
    expect(toThreadEvent('drop', { index: 2 })).toEqual({ kind: 'drop', index: 2 });
    expect(toThreadEvent('drop', { index: 1.5 })).toBeNull();
    expect(toThreadEvent('activity', { text: 'Running the tests' })).toEqual({ kind: 'activity', text: 'Running the tests' });
    expect(toThreadEvent('question', { question: null })).toEqual({ kind: 'question', question: null });
    expect(toThreadEvent('queue', { queue: [{ cid: 'f6', text: 'Next' }] })).toEqual({ kind: 'queue', queue: [{ cid: 'f6', text: 'Next' }] });
    expect(toThreadEvent('end', { outcome: 'failed', error: 'It broke.', next: [] })).toEqual({ kind: 'end', outcome: 'failed', error: 'It broke.', next: [] });
    expect(toThreadEvent('end', { outcome: 'odd', next: ['Show the plan'] })).toEqual({ kind: 'end', outcome: 'done', error: null, next: ['Show the plan'] });
    expect(toThreadEvent('thread', ENTRY)?.kind).toBe('thread');
    expect(toThreadEvent('send', { send: { id: 's1', text: 'The whole email' } })).toEqual({ kind: 'send', waiting: true, sent: null });
    expect(toThreadEvent('send', { send: null, sent: { at: 5, to: ['a@example.com'], subject: 'Hi' } })).toEqual({
      kind: 'send', waiting: false, sent: { at: 5, to: ['a@example.com'], subject: 'Hi' },
    });
    expect(toThreadEvent('reset', {})).toEqual({ kind: 'reset' });
    expect(toThreadEvent('sparkle', { shiny: true })).toBeNull();
    expect(toThreadEvent('turn', 'no body')).toBeNull();
  });

  it('checks ids, cursors and message ids', () => {
    expect(validThreadId('82a494f21dd8')).toBe(true);
    expect(validThreadId('a.b')).toBe(false);
    expect(validCursor('6c1f7699.14')).toBe(true);
    expect(validCursor('6c1f7699.14&x=1')).toBe(false);
    expect(validCid('a1b2c3d4e5')).toBe(true);
    expect(validCid('a-1')).toBe(false);
  });
});
