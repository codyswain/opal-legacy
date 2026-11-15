import { describe, expect, it } from 'vitest';
import {
  toArchived,
  toDigest,
  toDigestDays,
  toItem,
  toListEvent,
  toNext,
  toQuestion,
  toSnapshot,
  toStatus,
  toThread,
  toThreadEvent,
  toThreads,
  toWait,
  validCid,
  validCursor,
  validDate,
  validEntryId,
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
    expect(toThread(ENTRY)).toEqual({ ...ENTRY, archivedAt: null, snoozedAt: null, wait: null, waits: false, desk: null, yours: '' });
    expect(toThread({ ...ENTRY, waits: true })?.waits).toBe(true);
  });

  it('reads when a thread was put away: archived, and snoozed', () => {
    expect(toThread({ ...ENTRY, archived: true, archived_at: 1794700000.5 })).toMatchObject({ archived: true, archivedAt: 1794700000.5 });
    // A time with no archive, or a snooze time with no snooze, says nothing.
    expect(toThread({ ...ENTRY, archived: false, archived_at: 1794700000 })?.archivedAt).toBeNull();
    expect(toThread({ ...ENTRY, snoozed: 1794800000, snoozed_at: 1794700000 })).toMatchObject({ snoozed: 1794800000, snoozedAt: 1794700000 });
    expect(toThread({ ...ENTRY, snoozed: null, snoozed_at: 1794700000 })?.snoozedAt).toBeNull();
    for (const other of ['yesterday', -5, NaN, null, {}]) expect(toThread({ ...ENTRY, archived: true, archived_at: other })?.archivedAt).toBeNull();
  });

  it('reads what a thread waits on, each line cut and nothing else kept', () => {
    const wait = {
      say: 'until Sam sends the quote', state: 'watching', on: 'Sam', what: 'the quote for the glass', where: 'Gmail',
      link: 'https://mail.example/mail/u/0/#all/18c2f0a1', check: 'Any reply from Sam', since: 1794724000.0, expires: 1794963600.0, checked: 1794724300.0,
      heard: 'Sam: I will measure on Monday.', reply: null as string | null,
    };
    expect(toWait(wait)).toEqual({
      say: 'until Sam sends the quote', state: 'watching', on: 'Sam', what: 'the quote for the glass', where: 'Gmail',
      link: 'https://mail.example/mail/u/0/#all/18c2f0a1', check: 'Any reply from Sam', since: 1794724000.0, expires: 1794963600.0,
      heard: 'Sam: I will measure on Monday.', reply: '',
    });
    expect(toThread({ ...ENTRY, snoozed: 1794963600, wait })?.wait?.on).toBe('Sam');
    for (const state of ['finding', 'watching', 'met', 'expired']) expect(toWait({ ...wait, state })?.state).toBe(state);
    // A state this app does not know is read as still watched.
    expect(toWait({ ...wait, state: 'paused' })).toMatchObject({ state: 'watching' });
    // The place is the service's own word, whatever it is: a text, and a place this app has never heard of.
    expect(toWait({ ...wait, where: 'Messages', link: 'imessage:+15550100' })).toMatchObject({ where: 'Messages', link: 'imessage:+15550100' });
    expect(toWait({ ...wait, where: 'Pigeon post' })?.where).toBe('Pigeon post');
    // One short line of plain text: trimmed, on one line, cut at 40 characters, and nothing that is not text.
    expect(toWait({ ...wait, where: '  Pigeon\n post  ' })?.where).toBe('Pigeon post');
    expect(toWait({ ...wait, where: 'p'.repeat(90) })?.where).toBe('p'.repeat(40));
    expect(toWait({ ...wait, where: `${'p'.repeat(39)} post` })?.where).toBe('p'.repeat(39));
    for (const other of [7, null, undefined, ['Slack'], { name: 'Slack' }, '   ']) expect(toWait({ ...wait, where: other })?.where).toBe('');
    // Words from outside are cut to a length, and anything that is not text is left out.
    expect(toWait({ say: 'x'.repeat(5_000), on: 'y'.repeat(500), what: 7, link: ['x'], heard: { text: 'no' }, reply: 'z'.repeat(9_000), since: 'now', expires: -1 })).toEqual({
      say: 'x'.repeat(2_000), state: 'watching', on: 'y'.repeat(80), what: '', where: '', link: '', check: '', since: null, expires: null, heard: '', reply: 'z'.repeat(2_000),
    });
    for (const other of [null, undefined, 'waiting', 7, ['x']]) expect(toWait(other)).toBeNull();
    expect(toThread({ ...ENTRY, wait: 'yes' })?.wait).toBeNull();
  });

  it('reads the archive: only archived threads, and how many there are before the limit', () => {
    const gone = { ...ENTRY, id: 'a1', archived: true, archived_at: 1794700000 };
    expect(toArchived({ threads: [gone, { ...ENTRY, id: 'b2' }, { ...gone, id: '../x' }, 'junk'], total: 14, cursor: 'b.1' })).toEqual({
      threads: [expect.objectContaining({ id: 'a1', archived: true, archivedAt: 1794700000 })],
      total: 14,
    });
    // A total the service did not give, or one smaller than what it sent, is what was sent.
    expect(toArchived({ threads: [gone] })?.total).toBe(1);
    expect(toArchived({ threads: [gone], total: 0 })?.total).toBe(1);
    expect(toArchived({ threads: [gone], total: 'many' })?.total).toBe(1);
    expect(toArchived({ total: 3 })).toBeNull();
    expect(toArchived(null)).toBeNull();
  });

  it('reads the mark for the Mac, and none from anything else', () => {
    expect(toThread({ ...ENTRY, desk: { at: 1794630000.5, by: 'ios' } })?.desk).toEqual({ at: 1794630000.5, by: 'ios' });
    expect(toThread({ ...ENTRY, desk: { by: 7 } })?.desk).toEqual({ at: 0, by: '' });
    expect(toThread({ ...ENTRY, desk: null })?.desk).toBeNull();
    expect(toThread({ ...ENTRY, desk: 'yes' })?.desk).toBeNull();
    expect(toThread({ ...ENTRY, desk: true })?.desk).toBeNull();
  });

  it('reads what is his to do in a thread as a few words, and nothing from anything else', () => {
    expect(toThread({ ...ENTRY, yours: 'Read and send the draft to the club' })?.yours).toBe('Read and send the draft to the club');
    expect(toThread({ ...ENTRY, yours: '  Call the supplier  ' })?.yours).toBe('Call the supplier');
    expect(toThread({ ...ENTRY, yours: 'x'.repeat(200) })?.yours).toHaveLength(80);
    for (const other of [null, 7, true, ['Call'], { text: 'Call' }]) expect(toThread({ ...ENTRY, yours: other })?.yours).toBe('');
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
      error: null, queued: 2, archived: false, archivedAt: null, snoozed: null, snoozedAt: null, woke: null, wait: null, digest: null, waits: false, desk: null, yours: '',
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
  });

  it('reads a send he is asked to allow up front, in the service’s shape', () => {
    const grant = {
      id: '0c5e2f7a1b33', kind: 'grant', title: 'Send this Slack message to Robin and Sam?', detail: 'the seed swap\n\nThese exact words, once, from this thread.',
      grant: { id: 'g1', thread_id: '82a494f21dd8', channel: 'slack', to: [{ name: 'Robin', id: 'U01' }, { name: 'Sam', id: 'U02' }], about: 'the seed swap', expires: 1794637200, life: 7200, text: 'I will bring the seedlings.', kind: null as string | null, outside: false },
    };
    // The title and the detail say who, how and what about. Of the grant part only the exact words are read; the rest is for his phone.
    expect(toQuestion(grant)).toEqual({
      id: '0c5e2f7a1b33', kind: 'grant', title: 'Send this Slack message to Robin and Sam?', detail: 'the seed swap\n\nThese exact words, once, from this thread.',
      text: 'I will bring the seedlings.',
    });
    // Without its words, or with a grant part it cannot read: still a card he can say no to.
    expect(toQuestion({ ...grant, title: 'Let Auto send one Slack message to Robin?', detail: 'From this thread, once, in the next two hours. You will see what went out.', grant: { ...grant.grant, text: null } })).toEqual({
      id: '0c5e2f7a1b33', kind: 'grant', title: 'Let Auto send one Slack message to Robin?', detail: 'From this thread, once, in the next two hours. You will see what went out.', text: null,
    });
    expect(toQuestion({ ...grant, grant: 7 })).toMatchObject({ kind: 'grant', text: null });
    expect(toQuestion({ id: '0c5e2f7a1b33', kind: 'grant' })).toEqual({ id: '0c5e2f7a1b33', kind: 'grant', title: '', detail: '', text: null });
    // Nothing of a signature is ever read, and a bad id is no question at all.
    expect(JSON.stringify(toQuestion({ ...grant, signature: 'abc', grant: { ...grant.grant, signature: 'abc' } }))).not.toContain('signature');
    expect(toQuestion({ ...grant, id: '../x' })).toBeNull();
  });

  it('reads a row’s question: a send to allow and a permission never get answer buttons', () => {
    const ask = { id: 'q0', text: 'Send this Slack message to Robin?', options: ['Yes', 'No'], question: 'Send it?' };
    expect(toThread({ ...ENTRY, ask: { ...ask, kind: 'grant' } })?.ask).toEqual({ id: 'q0', kind: 'grant', text: 'Send this Slack message to Robin?', options: [], question: null });
    expect(toThread({ ...ENTRY, ask: { ...ask, kind: 'permission' } })?.ask).toMatchObject({ kind: 'permission', options: [], question: null });
    expect(toThread({ ...ENTRY, ask: { ...ask, kind: 'ask' } })?.ask).toMatchObject({ kind: 'ask', options: ['Yes', 'No'], question: 'Send it?' });
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
    expect(toListEvent('thread', ENTRY)).toEqual({ kind: 'thread', thread: { ...ENTRY, archivedAt: null, snoozedAt: null, wait: null, waits: false, desk: null, yours: '' } });
    expect(toListEvent('order', { ids: ['a1', '../b', 7, 'c3'] })).toEqual({ kind: 'order', ids: ['a1', 'c3'] });
    expect(toListEvent('status', { auth: {} })?.kind).toBe('status');
    expect(toListEvent('reset', {})).toEqual({ kind: 'reset' });
    expect(toListEvent('digest', { date: '2026-11-13' })).toEqual({ kind: 'digest', date: '2026-11-13' });
    expect(toListEvent('digest', { date: '../13' })).toBeNull();
    expect(toListEvent('digest', {})).toBeNull();
    expect(toListEvent('sparkle', { shiny: true })).toBeNull();
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

  it('reads a digest: every entry with what became of it, and one shape for a drafted reply', () => {
    const digest = toDigest({
      date: '2026-11-13',
      path: 'Library/digests/2026-11-13 digest.md',
      today: true,
      left: 3, resolved: 1, threads: 1, total: 5,
      sections: [
        { title: 'Top 3', entries: [
          { id: 'item-1', kind: 'item', title: 'Order the seed trays', section: 'Top 3', n: 1, checked: false, priority: 'High', md: 'Two trays.',
            state: 'open', thread: null, note: 'Ask about peat', draft: { title: 'Garden centre', md: '**Garden centre**, email.', paste: 'Two trays, please.' } },
          { id: 'item-2', kind: 'item', title: 'Book the inspection', n: 2, checked: false, priority: '', md: 'On the 21st.', state: 'thread', thread: '82a494f21dd8', note: '', draft: null },
        ] },
        { title: 'Yesterday', entries: [
          { id: 'text-yesterday-3d20bff3', kind: 'text', title: '', md: 'The compost was turned.', state: 'resolved', thread: null, note: '' },
        ] },
        { title: 'Drafted replies', entries: [
          { id: 'draft-1', kind: 'draft', title: 'Garden club', md: '**Garden club**, newsletter.', paste: 'It reads well.', state: 'open', thread: null, note: '' },
        ] },
      ],
    });
    expect(digest).toEqual({
      date: '2026-11-13',
      path: 'Library/digests/2026-11-13 digest.md',
      left: 3,
      archived: false,
      sections: [
        { title: 'Top 3', entries: [
          { id: 'item-1', kind: 'item', title: 'Order the seed trays', md: 'Two trays.', section: 'Top 3', state: 'open', thread: null, note: 'Ask about peat', priority: 'High', draft: { title: 'Garden centre', paste: 'Two trays, please.' } },
          { id: 'item-2', kind: 'item', title: 'Book the inspection', md: 'On the 21st.', section: 'Top 3', state: 'thread', thread: '82a494f21dd8', note: '', priority: '', draft: null },
        ] },
        { title: 'Yesterday', entries: [
          { id: 'text-yesterday-3d20bff3', kind: 'text', title: '', md: 'The compost was turned.', section: 'Yesterday', state: 'resolved', thread: null, note: '', priority: '', draft: null },
        ] },
        { title: 'Drafted replies', entries: [
          { id: 'draft-1', kind: 'draft', title: 'Garden club', md: '**Garden club**, newsletter.', section: 'Drafted replies', state: 'open', thread: null, note: '', priority: '', draft: { title: 'Garden club', paste: 'It reads well.' } },
        ] },
      ],
    });
  });

  it('reads a kind it does not know as text, and drops what does not fit', () => {
    const digest = toDigest({
      date: '2026-11-13',
      sections: [
        'junk',
        { title: 7, entries: 'none' },
        { title: 'News', entries: [
          { id: 'widget-1', kind: 'widget', title: 'A chart', md: 'Three bars.', priority: 'High', paste: 'Not a draft', state: 'dancing' },
          { id: 'Bad Id', kind: 'text', md: 'Dropped' },
          { id: '../item-1', kind: 'item', md: 'Dropped' },
          { id: 'widget-1', kind: 'text', md: 'A second entry with the same id is dropped' },
          { id: 'item-9', kind: 'item', title: ['x'], md: 9, state: 'thread', thread: '../x', note: 3, draft: 'yes' },
          null,
        ] },
        { title: 'Empty', entries: [] },
      ],
    });
    expect(digest).toEqual({
      date: '2026-11-13',
      path: '',
      // The service gave no count, so Opal counts the open entries it can see.
      left: 2,
      archived: false,
      sections: [{ title: 'News', entries: [
        { id: 'widget-1', kind: 'text', title: 'A chart', md: 'Three bars.', section: 'News', state: 'open', thread: null, note: '', priority: '', draft: null },
        // Said to be a thread, with no thread that can be named: still open.
        { id: 'item-9', kind: 'item', title: '', md: '', section: 'News', state: 'open', thread: null, note: '', priority: '', draft: null },
      ] }],
    });
    expect(toDigest({ date: '2026-11-13' })).toEqual({ date: '2026-11-13', path: '', left: 0, archived: false, sections: [] });
    // He archived the day: a mark, read only from a plain true.
    expect(toDigest({ date: '2026-11-13', archived: true })?.archived).toBe(true);
    for (const other of ['true', 1, null, {}]) expect(toDigest({ date: '2026-11-13', archived: other })?.archived).toBe(false);
    expect(toDigest({ date: 'yesterday', sections: [] })).toBeNull();
    expect(toDigest({ sections: [] })).toBeNull();
    expect(toDigest('digest')).toBeNull();
    expect(toDigest({ date: '2026-11-13', left: -4, sections: [] })?.left).toBe(0);
    expect(toDigest({ date: '2026-11-13', sections: [{ title: 'N', entries: [{ id: 'a', md: 'x'.repeat(200_000), note: 'y'.repeat(9_000) }] }] })?.sections[0].entries[0]).toMatchObject({
      md: 'x'.repeat(100_000),
      note: 'y'.repeat(4_000),
    });
  });

  it('reads the days that have a digest, newest first', () => {
    expect(toDigestDays({ days: ['2026-11-12', '2026-11-13', 'soon', 7, '2026-11-12'], latest: '2026-11-13' })).toEqual({ days: ['2026-11-13', '2026-11-12'], latest: '2026-11-13', archived: [] });
    expect(toDigestDays({ days: ['2026-11-12'], latest: 'today' })).toEqual({ days: ['2026-11-12'], latest: '2026-11-12', archived: [] });
    expect(toDigestDays({ days: [] })).toEqual({ days: [], latest: null, archived: [] });
    // Which of them he archived: only days that have a digest, newest first, each once.
    expect(toDigestDays({ days: ['2026-11-11', '2026-11-12', '2026-11-13'], latest: '2026-11-13', archived: ['2026-11-11', '2026-11-13', '2026-11-11', '2026-10-01', 'soon', 7] })?.archived).toEqual(['2026-11-13', '2026-11-11']);
    expect(toDigestDays({ days: ['2026-11-13'], archived: 'all' })?.archived).toEqual([]);
    expect(toDigestDays({ latest: '2026-11-13' })).toBeNull();
    expect(toDigestDays(null)).toBeNull();
  });

  it('checks ids, cursors and message ids', () => {
    expect(validThreadId('82a494f21dd8')).toBe(true);
    expect(validThreadId('a.b')).toBe(false);
    expect(validCursor('6c1f7699.14')).toBe(true);
    expect(validCursor('6c1f7699.14&x=1')).toBe(false);
    expect(validCid('a1b2c3d4e5')).toBe(true);
    expect(validCid('a-1')).toBe(false);
    expect(validDate('2026-11-13')).toBe(true);
    expect(validDate('2026-11-13&x=1')).toBe(false);
    expect(validDate('13 Nov')).toBe(false);
    for (const id of ['item-3', 'text-yesterday-3d20bff3', 'meeting-1-1-with-the-club', 'a']) expect(validEntryId(id), id).toBe(true);
    for (const id of ['', '-item', 'Item-3', 'item_3', 'item 3', '../item-3', 'item-3/x', 'a'.repeat(121), 7, null]) expect(validEntryId(id), String(id)).toBe(false);
  });
});
