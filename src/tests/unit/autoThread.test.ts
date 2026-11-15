import { describe, expect, it } from 'vitest';
import type { AutoItem, AutoQuestion, AutoSnapshot, AutoThread, AutoThreadEvent } from '@/types/auto';
import {
  applyEvent,
  failure,
  fromSnapshot,
  parseEntry,
  sentLine,
  showsNext,
  stepLines,
  stepsSummary,
  turnRuns,
  turnStart,
  unconfirmed,
  waitingToGo,
  type ThreadView,
} from '@/renderer/features/auto/model/threadModel';
import {
  answerAllow,
  answerDeny,
  answerOption,
  answerPicks,
  answerTyped,
  isPicked,
  isSingle,
  pick,
  picksReady,
  splitQuestion,
} from '@/renderer/features/auto/model/questionModel';

const THREAD: AutoThread = {
  id: '5a0000000002', title: 'Sourdough timings', status: 'idle', last: 'Start at 8.', activity: '', ask: null, unread: false, model: '',
  created: 1, updated: 2, error: null, queued: 0, archived: false, snoozed: null, woke: null, digest: null, waits: false, desk: null, yours: '',
};
const user = (text: string, cid: string | null = null): AutoItem => ({ role: 'user', text, cid });
const reply = (text: string, open = false): AutoItem => ({ role: 'assistant', text, open });

function snapshot(fields: Partial<AutoSnapshot> = {}): AutoSnapshot {
  return {
    thread: THREAD, items: [user('When do I start?'), reply('Start at 8.')], live: null, queue: [], unsent: null, next: ['Scale it'],
    cursor: 'b.4', seed: null, sendWaiting: false, sent: [], ...fields,
  };
}
const view = (fields: Partial<AutoSnapshot> = {}): ThreadView => fromSnapshot(snapshot(fields));
const run = (start: ThreadView, events: AutoThreadEvent[]): ThreadView => events.reduce(applyEvent, start);

const WORKING = { items: [user('Now read the plan', 'a1b2c3d4e5'), reply('The plan has', true)], activity: 'Reading plan.md', state: 'working' as const, question: null as AutoQuestion | null };
const ASK: AutoQuestion = {
  id: 'q1', kind: 'ask',
  questions: [{ question: 'Which bed gets the tomatoes?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 3', description: '' }, { label: 'Bed 4', description: '' }] }],
};
const PERMISSION: AutoQuestion = { id: 'p1', kind: 'permission', tool: 'Bash', title: 'Run a command', detail: 'rm -rf build', reason: '' };

describe('a snapshot', () => {
  it('sets the history, the running turn, its question, the queue and the follow-ups', () => {
    const made = view({ live: { ...WORKING, question: ASK }, queue: [{ cid: 'f6', text: 'And then' }], next: [] });
    expect(made.history).toHaveLength(2);
    expect(made.live).toEqual({ items: WORKING.items, activity: 'Reading plan.md', state: 'working' });
    expect(made.question).toBe(ASK);
    expect(made.queue).toEqual([{ cid: 'f6', text: 'And then' }]);
    expect(made.cursor).toBe('b.4');
    expect(turnRuns(made)).toBe(true);
    expect(turnRuns(view())).toBe(false);
  });

  it('keeps the words of an entry only while it waits', () => {
    expect(view({ thread: { ...THREAD, waits: true }, seed: 'Digest, Friday, item 2: Book it' }).seed).toBe('Digest, Friday, item 2: Book it');
    expect(view({ seed: 'Digest, Friday, item 2: Book it' }).seed).toBeNull();
  });
});

describe('the events of a thread', () => {
  it('turn: moves the last turn into the history and starts a new one', () => {
    const before = view({ live: WORKING, unsent: 'Lost words', sendWaiting: true, thread: { ...THREAD, waits: true }, seed: 'Digest, x: y' });
    const after = applyEvent(before, { kind: 'turn', items: [user('Next', 'c1')], state: 'queued', activity: '' });
    expect(after.history.map((item) => item.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // A reply that was still being written is whole once it is history.
    expect(after.history.at(-1)).toEqual(reply('The plan has', false));
    expect(after.live).toEqual({ items: [user('Next', 'c1')], state: 'queued', activity: '' });
    expect(after.next).toEqual([]);
    expect(after.ending).toBeNull();
    expect(after.unsent).toBeNull();
    expect(after.seed).toBeNull();
    expect(after.sendWaiting).toBe(false);
  });

  it('add: appends an item to the running turn', () => {
    const after = applyEvent(view({ live: WORKING }), { kind: 'add', item: { role: 'steps', steps: [{ g: 'run', text: 'Run the tests', path: null }] } });
    expect(after.live?.items.map((item) => item.role)).toEqual(['user', 'assistant', 'steps']);
    expect(applyEvent(view(), { kind: 'add', item: reply('Stray') })).toEqual(view());
  });

  it('append: adds text to the last item, an open reply', () => {
    const after = run(view({ live: WORKING }), [{ kind: 'append', text: ' three' }, { kind: 'append', text: ' steps.' }]);
    expect(after.live?.items.at(-1)).toEqual(reply('The plan has three steps.', true));
    const steps = { ...WORKING, items: [...WORKING.items, { role: 'steps', steps: [] } as AutoItem] };
    expect(applyEvent(view({ live: steps }), { kind: 'append', text: 'x' }).live?.items).toEqual(steps.items);
    expect(applyEvent(view(), { kind: 'append', text: 'x' })).toEqual(view());
  });

  it('set: replaces an item of the running turn', () => {
    const after = applyEvent(view({ live: WORKING }), { kind: 'set', index: 1, item: reply('The plan has three steps.') });
    expect(after.live?.items).toEqual([WORKING.items[0], reply('The plan has three steps.')]);
    expect(applyEvent(view({ live: WORKING }), { kind: 'set', index: 5, item: reply('x') }).live?.items).toEqual(WORKING.items);
  });

  it('drop: removes an item of the running turn', () => {
    expect(applyEvent(view({ live: WORKING }), { kind: 'drop', index: 1 }).live?.items).toEqual([WORKING.items[0]]);
    expect(applyEvent(view({ live: WORKING }), { kind: 'drop', index: 9 }).live?.items).toEqual(WORKING.items);
  });

  it('activity: sets the live line', () => {
    expect(applyEvent(view({ live: WORKING }), { kind: 'activity', text: 'Running the tests' }).live?.activity).toBe('Running the tests');
    expect(applyEvent(view(), { kind: 'activity', text: 'x' }).live).toBeNull();
  });

  it('question: shows the card, or closes it', () => {
    const asked = applyEvent(view({ live: WORKING }), { kind: 'question', question: ASK });
    expect(asked.question).toBe(ASK);
    expect(applyEvent(asked, { kind: 'question', question: null }).question).toBeNull();
  });

  it('queue: holds the waiting messages, in full', () => {
    const after = run(view({ live: WORKING }), [{ kind: 'queue', queue: [{ cid: 'f6', text: 'One' }, { cid: 'f7', text: 'Two' }] }, { kind: 'queue', queue: [{ cid: 'f7', text: 'Two' }] }]);
    expect(after.queue).toEqual([{ cid: 'f7', text: 'Two' }]);
  });

  it('end: finishes the turn and takes the follow-ups', () => {
    const after = applyEvent(view({ live: { ...WORKING, question: ASK } }), { kind: 'end', outcome: 'done', error: null, next: ['Show the plan'] });
    expect(after.live).toBeNull();
    expect(after.question).toBeNull();
    expect(after.history).toHaveLength(4);
    expect(after.history.at(-1)).toEqual(reply('The plan has', false));
    expect(after.next).toEqual(['Show the plan']);
    expect(after.ending).toEqual({ outcome: 'done', error: null });
  });

  it('end: a stopped turn leaves a note, once', () => {
    const stopped = applyEvent(view({ live: WORKING }), { kind: 'end', outcome: 'stopped', error: null, next: [] });
    expect(stopped.history.at(-1)).toEqual({ role: 'note', text: 'Stopped' });
    const noted = view({ live: { ...WORKING, items: [...WORKING.items, { role: 'note', text: 'Stopped' }] } });
    expect(applyEvent(noted, { kind: 'end', outcome: 'stopped', error: null, next: [] }).history.filter((item) => item.role === 'note')).toHaveLength(1);
  });

  it('end: a failed turn keeps the service’s sentence', () => {
    const failed = applyEvent(view({ live: WORKING }), { kind: 'end', outcome: 'failed', error: 'The agent stopped answering.', next: [] });
    expect(failure(failed)).toBe('The agent stopped answering.');
    expect(failure(view({ thread: { ...THREAD, status: 'failed', error: 'It broke earlier.' } }))).toBe('It broke earlier.');
    expect(failure(view({ thread: { ...THREAD, status: 'failed' } }))).toBe('The turn did not finish.');
    expect(failure(view())).toBeNull();
    expect(failure(view({ live: WORKING, thread: { ...THREAD, status: 'failed', error: 'Old' } }))).toBeNull();
  });

  it('thread: takes the changed list entry of this thread only', () => {
    expect(applyEvent(view(), { kind: 'thread', thread: { ...THREAD, title: 'Bread' } }).thread.title).toBe('Bread');
    expect(applyEvent(view(), { kind: 'thread', thread: { ...THREAD, id: 'other', title: 'Other' } }).thread.title).toBe('Sourdough timings');
  });

  it('send: shows that a send waits on the phone, and the last five that went out', () => {
    const waiting = applyEvent(view(), { kind: 'send', waiting: true, sent: null });
    expect(waiting.sendWaiting).toBe(true);
    const went = applyEvent(waiting, { kind: 'send', waiting: false, sent: { at: 5, to: ['club@example.com'], subject: 'Plot inspection' } });
    expect(went.sendWaiting).toBe(false);
    expect(went.sent.map(sentLine)).toEqual(['Sent to club@example.com: Plot inspection']);
    const many = run(view(), Array.from({ length: 7 }, (_each, at): AutoThreadEvent => ({ kind: 'send', waiting: false, sent: { at, to: [], subject: `S${at}` } })));
    expect(many.sent.map((sent) => sent.subject)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6']);
    expect(sentLine({ at: 1, to: [], subject: '' })).toBe('Sent to no one: no subject');
  });

  it('reset: changes nothing here; the caller fetches the snapshot again', () => {
    const before = view({ live: WORKING });
    expect(applyEvent(before, { kind: 'reset' })).toBe(before);
  });

  it('a whole turn, event by event, ends as the snapshot of it would', () => {
    const after = run(view(), [
      { kind: 'turn', items: [user('Now read the plan', 'a1')], state: 'working', activity: '' },
      { kind: 'activity', text: 'Reading plan.md' },
      { kind: 'add', item: { role: 'steps', steps: [{ g: 'read', text: 'plan.md', path: 'Notes/plan.md' }] } },
      { kind: 'set', index: 1, item: { role: 'steps', steps: [{ g: 'read', text: 'plan.md', path: 'Notes/plan.md' }, { g: 'run', text: 'Count', path: null }] } },
      { kind: 'add', item: reply('', true) },
      { kind: 'add', item: reply('', true) },
      { kind: 'drop', index: 2 },
      { kind: 'append', text: 'The plan has' },
      { kind: 'append', text: ' three steps.' },
      { kind: 'set', index: 2, item: reply('The plan has three steps.') },
      { kind: 'end', outcome: 'done', error: null, next: ['Show the plan'] },
    ]);
    expect(after.live).toBeNull();
    expect(after.history.slice(2)).toEqual([
      user('Now read the plan', 'a1'),
      { role: 'steps', steps: [{ g: 'read', text: 'plan.md', path: 'Notes/plan.md' }, { g: 'run', text: 'Count', path: null }] },
      reply('The plan has three steps.'),
    ]);
  });
});

describe('follow-ups', () => {
  it('show only while the thread is at rest with a reply last', () => {
    expect(showsNext(view(), 0)).toBe(true);
    expect(showsNext(view({ next: [] }), 0)).toBe(false);
    expect(showsNext(view({ live: WORKING }), 0)).toBe(false);
    expect(showsNext(view({ queue: [{ cid: 'f6', text: 'x' }] }), 0)).toBe(false);
    expect(showsNext(view(), 1)).toBe(false);
    expect(showsNext(view({ unsent: 'Lost' }), 0)).toBe(false);
    expect(showsNext(view({ thread: { ...THREAD, status: 'failed' } }), 0)).toBe(false);
    expect(showsNext(view({ thread: { ...THREAD, status: 'stopped' } }), 0)).toBe(false);
    expect(showsNext(view({ items: [user('Only me')] }), 0)).toBe(false);
  });

  it('follow the turn that ended while the thread was open', () => {
    const done = applyEvent(view({ live: WORKING, next: [], thread: { ...THREAD, status: 'working' } }), { kind: 'end', outcome: 'done', error: null, next: ['Show the plan'] });
    expect(showsNext(done, 0)).toBe(true);
    const stopped = applyEvent(view({ live: WORKING }), { kind: 'end', outcome: 'stopped', error: null, next: ['Show the plan'] });
    expect(showsNext(stopped, 0)).toBe(false);
  });
});

describe('messages on their way', () => {
  const pending = [{ cid: 'a1', text: 'One' }, { cid: 'b2', text: 'Two' }, { cid: 'c3', text: 'Three' }];

  it('leave the pending list once the thread shows them', () => {
    const made = view({ items: [user('One', 'a1')], live: { ...WORKING, items: [user('Two', 'b2')] } });
    expect(unconfirmed(pending, made)).toEqual([{ cid: 'c3', text: 'Three' }]);
    expect(unconfirmed(pending, view({ queue: [{ cid: 'c3', text: 'Three' }] }))).toEqual(pending.slice(0, 2));
  });

  it('wait above the box: the service’s queue, then what it has not confirmed', () => {
    expect(waitingToGo(view({ live: WORKING, queue: [{ cid: 'b2', text: 'Two' }] }), pending)).toEqual([
      { cid: 'b2', text: 'Two' },
      { cid: 'a1', text: 'One' },
      { cid: 'c3', text: 'Three' },
    ]);
    expect(waitingToGo(null, pending)).toEqual(pending);
  });
});

describe('steps', () => {
  const steps = [
    { g: 'read', text: 'plan.md', path: 'Notes/plan.md' },
    { g: 'quiet', text: 'Looked up a tool', path: null },
    { g: 'change', text: 'plan.md', path: 'Notes/plan.md' },
    { g: 'run', text: 'Run the tests', path: null },
    { g: 'search', text: 'old drafts', path: null },
    { g: 'websearch', text: 'last frost date', path: null },
    { g: 'fetch', text: 'A sowing calendar', path: null },
    { g: 'agent', text: 'Count the beds', path: null },
    { g: 'plan', text: 'Three steps', path: null },
    { g: 'skill:garden', text: 'Garden', path: null },
    { g: 'mcp:checked the calendar', text: 'Checked the calendar', path: null },
    { g: 'tool:Weather', text: 'Weather', path: null },
  ];

  it('are one line each, with plumbing left out', () => {
    expect(stepLines(steps).map((line) => `${line.lead}${line.text}`)).toEqual([
      'Read Notes/plan.md',
      'Changed Notes/plan.md',
      'Run the tests',
      'Searched for old drafts',
      'Searched the web for last frost date',
      'A sowing calendar',
      'Helper: Count the beds',
      'Three steps',
      'Skill: Garden',
      'Checked the calendar',
      'Weather',
    ]);
    expect(stepLines(steps)[0].path).toBe('Notes/plan.md');
    expect(stepLines([{ g: 'quiet', text: 'x', path: null }])).toEqual([]);
  });

  it('are one line that says what was done, in the order it was first done', () => {
    const step = (g: string, text = 'x', path: string | null = null) => ({ g, text, path });
    expect(stepsSummary([step('read'), step('read'), step('read'), step('search')])).toBe('Read 3 files, searched');
    expect(stepsSummary([step('search'), step('websearch'), step('read'), step('change'), step('change')])).toBe('Searched, searched the web, read 1 file, changed 2 files');
    expect(stepsSummary([step('agent'), step('skill:garden'), step('run'), step('fetch')])).toBe('A helper, a skill, 2 more steps');
    expect(stepsSummary([step('run'), step('run'), step('mcp:weather')])).toBe('3 steps');
    expect(stepsSummary([step('search'), step('search'), step('websearch'), step('websearch'), step('agent'), step('agent'), step('run')])).toBe('Searched 2 times, searched the web 2 times, 2 helpers, 1 more step');
  });

  it('are their own line when there is one, and nothing when all are plumbing', () => {
    expect(stepsSummary([{ g: 'read', text: 'Notes/plan.md', path: 'Notes/plan.md' }, { g: 'quiet', text: 'x', path: null }])).toBe('Read Notes/plan.md');
    expect(stepsSummary([{ g: 'run', text: 'Run the tests', path: null }])).toBe('Run the tests');
    expect(stepsSummary([{ g: 'quiet', text: 'x', path: null }])).toBe('');
    expect(stepsSummary([])).toBe('');
  });
});

describe('where an unread thread opens', () => {
  const stepsItem: AutoItem = { role: 'steps', steps: [{ g: 'read', text: 'a', path: null }] };
  const at = (history: AutoItem[], fields: Partial<ThreadView> = {}) => turnStart({ ...fromSnapshot(snapshot()), history, ...fields });

  it('is his last message that has a reply under it', () => {
    expect(at([user('one'), reply('first'), user('two'), stepsItem, reply('second')])).toBe(2);
    expect(at([user('one'), reply('first')])).toBe(0);
  });

  it('is nowhere while a turn runs or a question waits, or with no reply under his last message', () => {
    expect(at([user('one'), reply('first'), user('two')])).toBeNull();
    expect(at([user('one'), stepsItem])).toBeNull();
    expect(at([reply('first')])).toBeNull();
    expect(at([])).toBeNull();
    expect(at([user('one'), reply('first')], { live: { items: [], activity: '', state: 'working' } })).toBeNull();
    expect(at([user('one'), reply('first')], { question: { id: 'q1', kind: 'permission', tool: '', title: 'Run it?', detail: '', reason: '' } })).toBeNull();
  });
});

describe('a digest entry', () => {
  const ENTRY = 'Digest, Friday November 13, item 2: Book the allotment inspection\n\nPriority: High\n\nThe committee walks the plots on the 21st.\n\nFrom Library/digests/2026-11-13 digest.md';

  it('is read from the message that starts its thread', () => {
    expect(parseEntry(ENTRY)).toEqual({
      source: 'Friday November 13, item 2',
      title: 'Book the allotment inspection',
      priority: 'High',
      body: 'The committee walks the plots on the 21st.',
      from: 'Library/digests/2026-11-13 digest.md',
      says: '',
    });
  });

  it('parts his own words from it, whoever the service says they are from', () => {
    const entry = parseEntry(`${ENTRY}\n\nRobin says:\nMove it to the 22nd.\nAnd ask about the lid.`);
    expect(entry?.says).toBe('Move it to the 22nd.\nAnd ask about the lid.');
    expect(entry?.from).toBe('Library/digests/2026-11-13 digest.md');
    expect(entry?.body).not.toContain('says:');
  });

  it('reads an entry of any kind, and words that follow a blank line', () => {
    const entry = parseEntry('Digest, Friday November 13, garden notes: The beds are dug\n\nThe beds are dug and the paths are laid.\n\nFrom Library/digests/2026-11-13 digest.md\n\nRobin says:\n\nOrder the mulch first.\n\nThen the netting.');
    expect(entry).toEqual({
      source: 'Friday November 13, garden notes',
      title: 'The beds are dug',
      priority: '',
      body: 'The beds are dug and the paths are laid.',
      from: 'Library/digests/2026-11-13 digest.md',
      says: 'Order the mulch first.\n\nThen the netting.',
    });
  });

  it('is not made of any other message', () => {
    expect(parseEntry('Plan the beds')).toBeNull();
    expect(parseEntry('Digest for today')).toBeNull();
    expect(parseEntry('Digest, Friday, item 2: Title only')).toEqual({ source: 'Friday, item 2', title: 'Title only', priority: '', body: '', from: null, says: '' });
  });

  it('takes a priority only from the first line under the title', () => {
    expect(parseEntry('Digest, Friday, item 2: Title\n\nThe detail.\n\nPriority: High')?.priority).toBe('');
    expect(parseEntry('Digest, Friday, item 2: Title\n\nPriority: Low\n\nThe detail.')).toMatchObject({ priority: 'Low', body: 'The detail.' });
  });
});

describe('answers to a question', () => {
  const ask = ASK as Extract<AutoQuestion, { kind: 'ask' }>;
  const several: Extract<AutoQuestion, { kind: 'ask' }> = {
    id: 'q2', kind: 'ask',
    questions: [
      { question: 'Which bed?', header: '', multiSelect: false, options: [{ label: 'Bed 3', description: '' }, { label: 'Bed 4', description: '' }] },
      { question: 'Which crops?', header: '', multiSelect: true, options: [{ label: 'Beans', description: '' }, { label: 'Peas', description: '' }] },
    ],
  };

  it('split a question into its first sentence and the rest', () => {
    expect(splitQuestion('Send the note now?')).toEqual({ ask: 'Send the note now?', rest: '' });
    expect(splitQuestion('Which bed gets the tomatoes? Bed 1 should rest.\n\n> Bed 3 is nearer the tap.')).toEqual({
      ask: 'Which bed gets the tomatoes?',
      rest: 'Bed 1 should rest.\n\n> Bed 3 is nearer the tap.',
    });
    expect(splitQuestion('Pick a bed for the tomatoes\nBed 3 or bed 4')).toEqual({ ask: 'Pick a bed for the tomatoes\nBed 3 or bed 4', rest: '' });
  });

  it('answer one single-choice question with a click', () => {
    expect(isSingle(ask)).toBe(true);
    expect(answerOption(ask, ask.questions[0], 'Bed 4')).toEqual({ id: 'q1', answers: { 'Which bed gets the tomatoes?': 'Bed 4' } });
  });

  it('gather picks for several parts, and send them once each part has one', () => {
    expect(isSingle(several)).toBe(false);
    let picks = pick({}, several.questions[0], 'Bed 3');
    expect(picksReady(several, picks)).toBe(false);
    picks = pick(picks, several.questions[1], 'Beans');
    picks = pick(picks, several.questions[1], 'Peas');
    picks = pick(picks, several.questions[0], 'Bed 4');
    expect(isPicked(picks, several.questions[1], 'Peas')).toBe(true);
    expect(isPicked(picks, several.questions[0], 'Bed 3')).toBe(false);
    expect(picksReady(several, picks)).toBe(true);
    expect(answerPicks(several, picks)).toEqual({ id: 'q2', answers: { 'Which bed?': 'Bed 4', 'Which crops?': ['Beans', 'Peas'] } });
    picks = pick(pick(picks, several.questions[1], 'Beans'), several.questions[1], 'Peas');
    expect(picksReady(several, picks)).toBe(false);
  });

  it('take his own words: for every part with no pick, or as the reason for a denial', () => {
    expect(answerTyped(ask, 'Neither, use the pots')).toEqual({ id: 'q1', answers: { 'Which bed gets the tomatoes?': 'Neither, use the pots' } });
    expect(answerTyped(several, 'Whatever is left', { 'Which bed?': 'Bed 3' })).toEqual({ id: 'q2', answers: { 'Which bed?': 'Bed 3', 'Which crops?': 'Whatever is left' } });
    expect(answerTyped(PERMISSION, 'Use the trash instead')).toEqual({ id: 'p1', allow: false, message: 'Use the trash instead' });
  });

  it('allow or deny a permission request, with a message only when there is one', () => {
    expect(answerAllow(PERMISSION)).toEqual({ id: 'p1', allow: true });
    expect(answerDeny(PERMISSION, '  ')).toEqual({ id: 'p1', allow: false });
    expect(answerDeny(PERMISSION, ' Use the trash ')).toEqual({ id: 'p1', allow: false, message: 'Use the trash' });
  });
});
