import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoAnswer, AutoQuestion, AutoThread } from '@/types/auto';
import { afterLeaving, closedRow, entryName, homeLine, queueOrder, queueSections, withState } from '@/renderer/features/auto/model/digestModel';
import { SNOOZE_TIME, attentionCount, moveBy, nextAfter, putBack, shownOrder, snoozeDate, snoozeDateRange } from '@/renderer/features/auto/model/listModel';
import { END_SLACK, LIST_PLACE, forgetPlaces, keepPlace, placeIn, placeOf, queuePlace, threadPlace } from '@/renderer/features/auto/model/places';
import { answerDeny, answerNo, answerTyped, keyOptions, mayAnswer } from '@/renderer/features/auto/model/questionModel';
import { unconfirmed } from '@/renderer/features/auto/model/unconfirmed';
import { NOTICE_MS, UNDO_DEPTH, UNDO_MS, selectMore, selectSaid, useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { autoDigest, autoThread, digestEntry } from '@/tests/helpers/autoApi';

const ids = (threads: readonly AutoThread[]) => threads.map((each) => each.id);
const ask = { id: 'q1', kind: 'ask' as const, text: 'Which wood?', options: ['Cedar'], question: 'Which wood?' };

describe('the sidebar’s count', () => {
  it('is the threads that wait on him and the ones with an unread reply', () => {
    expect(attentionCount([autoThread('a'), autoThread('b', { status: 'waiting', ask }), autoThread('c', { unread: true })])).toBe(2);
    // One that waits and is unread is one thread.
    expect(attentionCount([autoThread('a', { status: 'waiting', ask, unread: true })])).toBe(1);
    expect(attentionCount([])).toBe(0);
  });

  it('leaves out snoozed and archived threads', () => {
    expect(attentionCount([
      autoThread('a', { unread: true, snoozed: 4_000_000_000 }),
      autoThread('b', { status: 'waiting', ask, snoozed: 4_000_000_000 }),
      autoThread('c', { unread: true, archived: true }),
      autoThread('d', { unread: true }),
    ])).toBe(1);
  });
});

describe('the rows in the order they show', () => {
  const threads = [
    autoThread('a'),
    autoThread('b', { status: 'waiting', ask }),
    autoThread('c', { desk: { at: 1, by: 'phone' } }),
    autoThread('d', { snoozed: 4_000_000_100 }),
    autoThread('e', { snoozed: 4_000_000_000 }),
    autoThread('f'),
  ];

  it('is each group in turn, then the snoozed ones when their line is open', () => {
    expect(shownOrder(threads, false)).toEqual(['c', 'b', 'a', 'f']);
    expect(shownOrder(threads, true)).toEqual(['c', 'b', 'a', 'f', 'e', 'd']);
  });

  it('gives a leaving row’s place to the one below, else the one above, else nobody', () => {
    const order = shownOrder(threads, false);
    expect(nextAfter(order, 'c')).toBe('b');
    expect(nextAfter(order, 'a')).toBe('f');
    expect(nextAfter(order, 'f')).toBe('a');
    expect(nextAfter(['only'], 'only')).toBeNull();
    expect(nextAfter(order, 'missing')).toBeNull();
  });
});

describe('a row moved with the keyboard', () => {
  const threads = [autoThread('w', { status: 'waiting', ask }), autoThread('a'), autoThread('b'), autoThread('c')];

  it('goes one place down or up among the rest, as a drag would', () => {
    expect(moveBy(threads, 'a', 1)).toEqual({ id: 'a', before: 'c' });
    expect(moveBy(threads, 'b', 1)).toEqual({ id: 'b', before: null });
    expect(moveBy(threads, 'b', -1)).toEqual({ id: 'b', before: 'a' });
    expect(moveBy(threads, 'c', -1)).toEqual({ id: 'c', before: 'b' });
  });

  it('does not go past either end, and a thread that waits or is marked does not move', () => {
    expect(moveBy(threads, 'a', -1)).toBeNull();
    expect(moveBy(threads, 'c', 1)).toBeNull();
    expect(moveBy(threads, 'w', 1)).toBeNull();
    expect(moveBy(threads, 'missing', 1)).toBeNull();
  });
});

describe('a thread put back', () => {
  const earlier = [autoThread('a'), autoThread('b'), autoThread('c'), autoThread('d')];

  it('goes above the first thread that followed it and is still there', () => {
    expect(ids(putBack([earlier[0], earlier[2], earlier[3]], earlier, earlier[1]))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(putBack([earlier[0], earlier[3]], earlier, earlier[1]))).toEqual(['a', 'b', 'd']);
    expect(ids(putBack([autoThread('new'), earlier[1], earlier[2]], earlier, earlier[0]))).toEqual(['new', 'a', 'b', 'c']);
  });

  it('goes to the end when nothing that followed it is left, and a list that holds it is left alone', () => {
    expect(ids(putBack([earlier[0]], earlier, earlier[3]))).toEqual(['a', 'd']);
    expect(ids(putBack(earlier, earlier, earlier[1]))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('a snooze until a picked day and time', () => {
  const NOW = new Date(2026, 10, 14, 15, 10, 0).getTime();
  const at = (hour: number, minute: number) => new Date(2026, 10, 20, hour, minute).getTime() / 1000;

  it('starts at 9:00 in the morning, as the phone’s choices do', () => {
    expect(SNOOZE_TIME).toBe('09:00');
    expect(snoozeDate('2026-11-20', NOW)).toBe(at(9, 0));
  });

  it('takes the time he picks', () => {
    expect(snoozeDate('2026-11-20', NOW, '14:30')).toBe(at(14, 30));
    expect(snoozeDate('2026-11-20', NOW, '00:05')).toBe(at(0, 5));
  });

  it('refuses a time that is not one, a time that has passed, and a day past the next year', () => {
    expect(snoozeDate('2026-11-20', NOW, '')).toBeNull();
    expect(snoozeDate('2026-11-20', NOW, '25:00')).toBeNull();
    expect(snoozeDate('2026-11-20', NOW, '8:00')).toBeNull();
    expect(snoozeDate(snoozeDateRange(NOW).max, NOW, '09:00')).not.toBeNull();
    expect(snoozeDate('2026-11-14', NOW, '18:00')).not.toBeNull();
    expect(snoozeDate('2026-11-14', NOW, '12:00')).toBeNull();
    expect(snoozeDate('2028-01-01', NOW, '09:00')).toBeNull();
  });
});

describe('a closed entry’s row', () => {
  it('is a to-do’s title and its detail as plain words', () => {
    expect(closedRow(digestEntry('item-1', { kind: 'item', title: 'Order the trays', md: 'Two trays of **40** cells. See [Beds](Projects/Beds.md) and [[Notes/Seeds|the seed list]].' }))).toEqual({
      title: 'Order the trays', time: '', words: 'Two trays of 40 cells. See Beds and the seed list.',
    });
  });

  it('says a title once when the words open with it, and sets a meeting’s time apart', () => {
    expect(closedRow(digestEntry('m', { kind: 'meeting', title: 'Allotment committee', md: '**10:00 [Allotment committee](https://example.com/meet)** (in the hall)\n- Agree the date\n- Who brings the keys' }))).toEqual({
      title: 'Allotment committee', time: '10:00', words: '(in the hall)\nAgree the date\nWho brings the keys',
    });
    expect(closedRow(digestEntry('p', { kind: 'person', title: 'Robin (seed swap)', md: '**Robin (seed swap):** quiet since the spring list.' }))).toEqual({
      title: 'Robin (seed swap)', time: '', words: 'quiet since the spring list.',
    });
    expect(closedRow(digestEntry('t', { title: 'Ready to plant', md: '**Ready to plant.** The seedlings have four leaves.' })).words).toBe('The seedlings have four leaves.');
    expect(closedRow(digestEntry('d', { kind: 'draft', title: 'Garden club', md: '**Garden club**, newsletter, email.' })).words).toBe('newsletter, email.');
    // Only a meeting's leading time is a time.
    expect(closedRow(digestEntry('n', { title: 'Committee', md: '10:00 Committee meets' }))).toEqual({ title: 'Committee', time: '', words: '10:00 meets' });
  });

  it('has no title for a line with none, or one that only repeats its section: the words are the entry', () => {
    expect(closedRow(digestEntry('x', { md: 'The shed roof let water in again.' }))).toEqual({ title: null, time: '', words: 'The shed roof let water in again.' });
    const table = { ...digestEntry('plots', { title: 'Plots', md: '| Plot | Bed |\n| --- | :-: |\n| 14 | 2 |\n| 15 | 4 |' }), section: 'Plots' };
    expect(closedRow(table)).toEqual({ title: null, time: '', words: 'Plot, Bed\n14, 2\n15, 4' });
  });

  it('drops list marks, boxes, headings, quote marks, rules and fences', () => {
    const md = '## Today\n- [ ] Water the beans\n1. [x] Net the peas\n> A note\n\n---\n```\ncode line\n```';
    expect(closedRow(digestEntry('x', { md })).words).toBe('Today\nWater the beans\nNet the peas\nA note\ncode line');
  });

  it('names an entry by its title, else its first words, cut short', () => {
    expect(entryName(digestEntry('a', { kind: 'item', title: 'Order the trays', md: 'Detail.' }))).toBe('Order the trays');
    expect(entryName(digestEntry('b', { md: 'Sowed the beans.\nAnd the peas.' }))).toBe('Sowed the beans.');
    expect(entryName(digestEntry('c', { md: 'word '.repeat(40) })).length).toBeLessThanOrEqual(60);
    expect(entryName(digestEntry('c', { md: 'word '.repeat(40) }))).toMatch(/…$/);
  });
});

describe('the Digest row’s second line', () => {
  it('is the day, how many entries it has and how many are resolved', () => {
    const digest = autoDigest('2026-11-14', [['Top 3', [digestEntry('a'), digestEntry('b', { state: 'resolved' }), digestEntry('c', { state: 'thread', thread: 't1' })]]]);
    expect(homeLine(digest)).toBe('Sat Nov 14. 3 entries, 1 resolved.');
    expect(homeLine(autoDigest('2026-11-13', [['Top 3', [digestEntry('a')]]]))).toBe('Fri Nov 13. 1 entry, 0 resolved.');
    expect(homeLine(autoDigest('2026-11-13', []))).toBe('Fri Nov 13. 0 entries, 0 resolved.');
  });
});

describe('what leaves the queue', () => {
  const day = autoDigest('2026-11-13', [
    ['Top 3', [digestEntry('a', { kind: 'item' }), digestEntry('b', { kind: 'item' })]],
    ['Yesterday', [digestEntry('c'), digestEntry('d'), digestEntry('e', { state: 'resolved' })]],
  ]);
  const order = queueOrder(queueSections(day, 'left'));

  it('hands the keyboard to the first entry after it, else the last one before, else nobody', () => {
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(afterLeaving(order, ['b'])).toBe('c');
    expect(afterLeaving(order, ['d'])).toBe('c');
    expect(afterLeaving(order, ['c', 'd'])).toBe('b');
    expect(afterLeaving(order, ['a', 'b'])).toBe('c');
    expect(afterLeaving(order, order)).toBeNull();
    expect(afterLeaving(order, ['missing'])).toBeNull();
  });

  it('shows at once as resolved, reopened or a thread, with what is left counted again', () => {
    const resolved = withState(day, ['a', 'c'], () => 'resolved');
    expect(resolved.left).toBe(2);
    expect(queueOrder(queueSections(resolved, 'left'))).toEqual(['b', 'd']);
    expect(withState(resolved, ['a'], () => 'open').left).toBe(3);
    expect(withState(day, ['d'], () => 'thread').left).toBe(3);
    // The day he was given is not changed.
    expect(day.left).toBe(4);
  });
});

describe('his place', () => {
  beforeEach(forgetPlaces);

  it('is kept for each thread, the list and each day of the queue', () => {
    keepPlace(threadPlace('bread'), { top: 120, atEnd: false, height: 2000 });
    keepPlace(LIST_PLACE, { top: 40, atEnd: false, height: 900 });
    keepPlace(queuePlace('2026-11-13'), { top: 300, atEnd: false, height: 1200 });
    expect(placeOf(threadPlace('bread'))).toEqual({ top: 120, atEnd: false, height: 2000 });
    expect(placeOf(LIST_PLACE)?.top).toBe(40);
    expect(placeOf(queuePlace('2026-11-13'))?.top).toBe(300);
    expect(placeOf(threadPlace('seeds'))).toBeNull();
    expect(placeOf(queuePlace('2026-11-12'))).toBeNull();
  });

  it('says whether a scroller is at its end, where a thread follows new text', () => {
    expect(placeIn({ scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 })).toEqual({ top: 1500, atEnd: true, height: 2000 });
    expect(placeIn({ scrollTop: 1500 - END_SLACK, scrollHeight: 2000, clientHeight: 500 }).atEnd).toBe(false);
    expect(placeIn({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 }).atEnd).toBe(true);
  });

  it('forgets the oldest once there are many', () => {
    for (let at = 0; at < 230; at += 1) keepPlace(threadPlace(String(at)), { top: at, atEnd: false, height: 1 });
    expect(placeOf(threadPlace('0'))).toBeNull();
    expect(placeOf(threadPlace('229'))?.top).toBe(229);
    // A place kept again counts as new.
    keepPlace(threadPlace('31'), { top: 1, atEnd: false, height: 1 });
    for (let at = 300; at < 400; at += 1) keepPlace(threadPlace(String(at)), { top: at, atEnd: false, height: 1 });
    expect(placeOf(threadPlace('31'))).not.toBeNull();
  });
});

describe('what his last actions did, and the way back from each', () => {
  const state = () => useSaidStore.getState();
  const shown = () => selectSaid(state());

  beforeEach(() => {
    vi.useFakeTimers();
    state().clear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the newest and says how many more Undo can reach', () => {
    state().offer({ name: 'Rain barrel', text: 'archived', undo: () => undefined });
    expect(selectMore(state())).toBe(0);
    state().offer({ name: 'Compost bin', text: 'archived', undo: () => undefined });
    state().offer({ name: 'Seed order', text: 'until Sun 9:00 am', undo: () => undefined });
    expect(shown()).toMatchObject({ name: 'Seed order', text: 'until Sun 9:00 am', problem: false });
    expect(selectMore(state())).toBe(2);
  });

  it('takes them back newest first', () => {
    const order: string[] = [];
    for (const name of ['one', 'two', 'three']) state().offer({ name, text: 'archived', undo: () => order.push(name) });
    expect(state().undo()).toBe(true);
    expect(shown()?.name).toBe('two');
    expect(state().undo()).toBe(true);
    expect(state().undo()).toBe(true);
    expect(order).toEqual(['three', 'two', 'one']);
    expect(state().undo()).toBe(false);
    expect(shown()).toBeNull();
  });

  it('keeps each on offer for 30 seconds from its own start', () => {
    state().offer({ name: 'one', text: 'archived', undo: () => undefined });
    vi.advanceTimersByTime(20_000);
    state().offer({ name: 'two', text: 'archived', undo: () => undefined });
    vi.advanceTimersByTime(UNDO_MS - 20_000 - 1);
    expect(state().stack.map((each) => each.name)).toEqual(['one', 'two']);
    vi.advanceTimersByTime(3);
    expect(state().stack.map((each) => each.name)).toEqual(['two']);
    vi.advanceTimersByTime(20_000);
    expect(shown()).toBeNull();
  });

  it('keeps the last ten of this session', () => {
    for (let at = 1; at <= UNDO_DEPTH + 3; at += 1) state().offer({ name: String(at), text: 'archived', undo: () => undefined });
    expect(state().stack).toHaveLength(UNDO_DEPTH);
    expect(state().stack[0].name).toBe('4');
    expect(selectMore(state())).toBe(UNDO_DEPTH - 1);
  });

  it('drops an offer whose post failed without running it, and every offer about one thread', () => {
    const undo = vi.fn();
    const failed = state().offer({ name: 'one', text: 'archived', subject: 't1', undo });
    state().offer({ name: 'two', text: 'archived', subject: 't2', undo });
    state().offer({ name: 'two again', text: 'until Fri 9:00 am', subject: 't2', undo });
    state().drop(failed);
    expect(state().stack.map((each) => each.name)).toEqual(['two', 'two again']);
    state().dropSubject('t2');
    expect(shown()).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });

  it('holds an offer for less than the usual time when asked, as for an answer held before it is posted', () => {
    state().offer({ name: 'Raised bed plan', text: 'Cedar', undo: () => undefined, lasts: 4_000 });
    vi.advanceTimersByTime(3_999);
    expect(shown()?.text).toBe('Cedar');
    vi.advanceTimersByTime(2);
    expect(shown()).toBeNull();
  });

  it('shows a refusal as the service’s own sentence, with nothing to undo, and keeps what is still on offer behind it', () => {
    const undo = vi.fn();
    state().offer({ name: 'Compost bin', text: 'archived', undo });
    state().refuse('That thread is gone.', 'Rain barrel');
    expect(shown()).toMatchObject({ text: 'That thread is gone.', name: 'Rain barrel', problem: true, undo: null, open: null });
    expect(selectMore(state())).toBe(0);
    vi.advanceTimersByTime(NOTICE_MS + 1);
    expect(shown()).toMatchObject({ name: 'Compost bin', problem: false });
    // Undo reaches past a refusal to the action behind it.
    state().refuse('Auto is busy.');
    expect(state().undo()).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(shown()).toBeNull();
  });

  it('gives way to a newer action: a refusal does not sit on top of it', () => {
    state().refuse('Auto is busy.');
    state().offer({ name: 'Seed order', text: 'archived', undo: () => undefined });
    expect(shown()).toMatchObject({ name: 'Seed order', problem: false });
  });

  it('goes on to what the newest action made, and the offer goes with it', () => {
    const open = vi.fn();
    state().offer({ name: 'Committee', text: 'made a thread', open, undo: () => undefined });
    expect(state().open()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(shown()).toBeNull();
    state().offer({ name: 'Rain barrel', text: 'archived', undo: () => undefined });
    expect(state().open()).toBe(false);
    expect(shown()).not.toBeNull();
  });
});

describe('an answer before it is posted', () => {
  const grant: Extract<AutoQuestion, { kind: 'grant' }> = { id: 'g1', kind: 'grant', title: 'Send this Slack message to Robin?', detail: '', text: 'Hello.' };
  const permission: Extract<AutoQuestion, { kind: 'permission' }> = { id: 'p1', kind: 'permission', tool: 'Bash', title: 'Run it?', detail: '', reason: '' };
  const ask: AutoQuestion = { id: 'q1', kind: 'ask', questions: [{ question: 'Which bed?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 1', description: '' }, { label: 'Bed 2', description: '' }, { label: 'Bed 3', description: '' }, { label: 'Bed 4', description: '' }] }] };

  it('lets only the plain no through for a send he is asked to allow, whatever built the answer', () => {
    expect(mayAnswer(grant, { id: 'g1', allow: false })).toBe(true);
    // Words sent with the no would be dropped by the service unread: they are not sent that way.
    expect(mayAnswer(grant, { id: 'g1', allow: false, message: 'Not today' })).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', allow: false, signature: 'abc' } as unknown as AutoAnswer)).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', allow: false, answers: undefined })).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', allow: true })).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', allow: true, signature: 'abc' } as unknown as AutoAnswer)).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', allow: true, message: 'yes' })).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', answers: { 'Send it?': 'Yes' } })).toBe(false);
    expect(mayAnswer(grant, { id: 'other', allow: false })).toBe(false);
    expect(mayAnswer(grant, { id: 'g1', allow: 'true' } as unknown as AutoAnswer)).toBe(false);
    expect(mayAnswer(grant, { id: 'g1' } as unknown as AutoAnswer)).toBe(false);
  });

  it('leaves a permission request and a question as they were', () => {
    expect(mayAnswer(permission, { id: 'p1', allow: true })).toBe(true);
    expect(mayAnswer(ask, { id: 'q1', answers: { 'Which bed?': 'Bed 2' } })).toBe(true);
    expect(mayAnswer(null, { id: 'q1', allow: true })).toBe(true);
  });

  it('builds the one answer to a send to allow, a no with nothing else, and keeps typed words for a permission request', () => {
    expect(answerNo(grant)).toEqual({ id: 'g1', allow: false });
    expect(mayAnswer(grant, answerNo(grant))).toBe(true);
    expect(answerTyped(permission, 'Use the trash')).toEqual({ id: 'p1', allow: false, message: 'Use the trash' });
    expect(answerDeny(permission, '')).toEqual({ id: 'p1', allow: false });
    expect(answerDeny(permission, ' Not now ')).toEqual({ id: 'p1', allow: false, message: 'Not now' });
  });

  it('gives the keys 1 to 3 the first three options of one question with one choice, and nothing else', () => {
    expect(keyOptions(ask)).toEqual(['Bed 1', 'Bed 2', 'Bed 3']);
    expect(keyOptions(grant)).toEqual([]);
    expect(keyOptions(permission)).toEqual([]);
    expect(keyOptions(null)).toEqual([]);
    expect(keyOptions({ id: 'q2', kind: 'ask', questions: [ask.kind === 'ask' ? { ...ask.questions[0], multiSelect: true } : null].filter(Boolean) as never })).toEqual([]);
  });
});

describe('what he did and the service has yet to confirm', () => {
  it('is laid over whatever arrives of the same thing, until it is ended', () => {
    const changes = unconfirmed<{ id: string; archived: boolean; title: string }>();
    const bread = { id: 'bread', archived: false, title: 'Bread' };
    expect(changes.lay('bread', bread)).toBe(bread);
    const archived = changes.keep('bread', (now) => ({ ...now, archived: true }));
    expect(changes.has('bread')).toBe(true);
    // The rest of what arrives is taken as it is.
    expect(changes.lay('bread', { ...bread, title: 'Bread, timed' })).toEqual({ id: 'bread', archived: true, title: 'Bread, timed' });
    expect(changes.lay('seeds', { ...bread, id: 'seeds' }).archived).toBe(false);
    changes.end('bread', archived);
    expect(changes.has('bread')).toBe(false);
    expect(changes.lay('bread', bread)).toBe(bread);
  });

  it('gives way to a later change to the same thing, whose end is the only one that counts', () => {
    const changes = unconfirmed<{ archived: boolean }>();
    const archived = changes.keep('bread', () => ({ archived: true }));
    const back = changes.keep('bread', () => ({ archived: false }));
    expect(changes.lay('bread', { archived: true })).toEqual({ archived: false });
    // The archive's own post lands and ends its change: the undo's is the one in place, and stays.
    changes.end('bread', archived);
    expect(changes.lay('bread', { archived: true })).toEqual({ archived: false });
    changes.end('bread', back);
    expect(changes.lay('bread', { archived: true })).toEqual({ archived: true });
    changes.keep('bread', () => ({ archived: false }));
    changes.clear();
    expect(changes.has('bread')).toBe(false);
  });
});
