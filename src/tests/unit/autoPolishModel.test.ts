import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoThread } from '@/types/auto';
import { afterLeaving, closedRow, entryName, homeLine, queueOrder, queueSections, withState } from '@/renderer/features/auto/model/digestModel';
import { SNOOZE_TIME, attentionCount, moveBy, nextAfter, putBack, shownOrder, snoozeDate, snoozeDateRange } from '@/renderer/features/auto/model/listModel';
import { END_SLACK, LIST_PLACE, forgetPlaces, keepPlace, placeIn, placeOf, queuePlace, threadPlace } from '@/renderer/features/auto/model/places';
import { SAID_MS, useSaidStore } from '@/renderer/features/auto/store/saidStore';
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

  it('starts at 8:00 in the morning', () => {
    expect(SNOOZE_TIME).toBe('08:00');
    expect(snoozeDate('2026-11-20', NOW)).toBe(at(8, 0));
  });

  it('takes the time he picks', () => {
    expect(snoozeDate('2026-11-20', NOW, '14:30')).toBe(at(14, 30));
    expect(snoozeDate('2026-11-20', NOW, '00:05')).toBe(at(0, 5));
  });

  it('refuses a time that is not one, and a day outside the next year', () => {
    expect(snoozeDate('2026-11-20', NOW, '')).toBeNull();
    expect(snoozeDate('2026-11-20', NOW, '25:00')).toBeNull();
    expect(snoozeDate('2026-11-20', NOW, '8:00')).toBeNull();
    expect(snoozeDate(snoozeDateRange(NOW).max, NOW, '09:00')).not.toBeNull();
    expect(snoozeDate('2026-11-14', NOW, '18:00')).toBeNull();
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

describe('the line that says what the last action did', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSaidStore.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it('holds one line at a time, the newest, and goes after a few seconds', () => {
    const { say } = useSaidStore.getState();
    say({ text: 'Archived', name: 'Rain barrel', undo: () => undefined });
    say({ text: 'Archived', name: 'Compost bin', undo: () => undefined });
    expect(useSaidStore.getState().said).toMatchObject({ text: 'Archived', name: 'Compost bin', problem: false });
    vi.advanceTimersByTime(SAID_MS - 1);
    expect(useSaidStore.getState().said).not.toBeNull();
    vi.advanceTimersByTime(2);
    expect(useSaidStore.getState().said).toBeNull();
  });

  it('gives a newer line its full time, whatever was left of the older one’s', () => {
    const { say } = useSaidStore.getState();
    say({ text: 'Archived', name: 'One' });
    vi.advanceTimersByTime(SAID_MS - 100);
    say({ text: 'Archived', name: 'Two' });
    vi.advanceTimersByTime(SAID_MS - 100);
    expect(useSaidStore.getState().said?.name).toBe('Two');
  });

  it('undoes once, and says whether there was anything to undo', () => {
    const undo = vi.fn();
    useSaidStore.getState().say({ text: 'Resolved', name: 'The beans', undo });
    expect(useSaidStore.getState().undo()).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(useSaidStore.getState().said).toBeNull();
    expect(useSaidStore.getState().undo()).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('has nothing to undo after a refusal, which is the service’s sentence', () => {
    useSaidStore.getState().refuse('That thread is gone.', 'Rain barrel');
    expect(useSaidStore.getState().said).toMatchObject({ text: 'That thread is gone.', name: 'Rain barrel', problem: true, undo: null, open: null });
    expect(useSaidStore.getState().undo()).toBe(false);
    expect(useSaidStore.getState().said).not.toBeNull();
  });

  it('goes on to what was made, and the line goes with it', () => {
    const open = vi.fn();
    useSaidStore.getState().say({ text: 'Made a thread', name: 'Committee', open, undo: () => undefined });
    useSaidStore.getState().open();
    expect(open).toHaveBeenCalledTimes(1);
    expect(useSaidStore.getState().said).toBeNull();
  });
});
