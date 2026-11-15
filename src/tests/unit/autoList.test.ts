import { describe, expect, it } from 'vitest';
import type { AutoThread } from '@/types/auto';
import {
  applyOrder,
  emptyList,
  fromDigest,
  listView,
  moveTarget,
  moved,
  needsCount,
  rowLine,
  rowOptions,
  rowTime,
  snoozeChoices,
  snoozeDate,
  snoozeDateRange,
  snoozedUntil,
  upsertThread,
} from '@/renderer/features/auto/model/listModel';

// A Saturday afternoon, in whatever zone the tests run in.
const NOW = new Date(2026, 10, 14, 15, 10, 0).getTime();
const at = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime() / 1000;

function thread(id: string, fields: Partial<AutoThread> = {}): AutoThread {
  return {
    id, title: `Thread ${id}`, status: 'idle', last: `Last of ${id}`, activity: '', ask: null, unread: false, model: '',
    created: at(2026, 11, 13, 9), updated: at(2026, 11, 14, 14, 0), error: null, queued: 0, archived: false, snoozed: null, woke: null,
    digest: null, waits: false, desk: null, ...fields,
  };
}

const ids = (threads: readonly AutoThread[]) => threads.map((each) => each.id);
const ask = { id: 'q1', kind: 'ask' as const, text: 'Which wood?', options: ['Cedar', 'Larch'], question: 'Which wood?' };

describe('the list', () => {
  const threads = [
    thread('a'),
    thread('b', { status: 'waiting', ask }),
    thread('c', { snoozed: at(2026, 11, 20, 8) }),
    thread('d', { woke: at(2026, 11, 14, 15, 0) }),
    thread('e', { status: 'waiting', ask: { ...ask, kind: 'permission', options: [], question: null } }),
    thread('f', { snoozed: at(2026, 11, 15, 8) }),
    thread('g', { waits: true }),
  ];

  it('puts the threads that wait on him first, then the rest, both in the service’s order', () => {
    const view = listView(threads);
    expect(view.groups.map((group) => [group.key, ids(group.threads)])).toEqual([
      ['needs', ['b', 'e']],
      ['rest', ['a', 'd', 'g']],
    ]);
    expect(view.needs).toBe(2);
    expect(needsCount(threads)).toBe(2);
  });

  it('hides snoozed threads behind the Snoozed line, the first to return first', () => {
    const view = listView(threads);
    expect(ids(view.snoozed)).toEqual(['f', 'c']);
    expect(view.groups.flatMap((group) => ids(group.threads))).not.toContain('c');
  });

  it('keeps a snoozed thread that waits out of the count, and an archived one out of everything', () => {
    const view = listView([thread('a', { status: 'waiting', ask, snoozed: at(2026, 11, 20) }), thread('b', { archived: true })]);
    expect(view.needs).toBe(0);
    expect(view.groups).toEqual([]);
    expect(ids(view.snoozed)).toEqual(['a']);
  });

  it('only lets the rest be dragged, and gives neither of the two a heading', () => {
    const view = listView(threads);
    expect(view.groups.map((group) => [group.key, group.movable, group.heading])).toEqual([['needs', false, null], ['rest', true, null]]);
  });

  it('leaves out a group with nothing in it', () => {
    expect(listView([thread('a')]).groups.map((group) => group.key)).toEqual(['rest']);
  });
});

describe('the mark for the Mac', () => {
  const mark = { at: at(2026, 11, 14, 14, 30), by: 'phone' };
  const threads = [
    thread('a'),
    thread('b', { status: 'waiting', ask }),
    thread('c', { desk: mark }),
    thread('d', { status: 'waiting', ask, desk: mark }),
    thread('e', { desk: mark, snoozed: at(2026, 11, 20, 8) }),
    thread('f', { desk: mark, archived: true }),
  ];

  it('puts marked threads first under "For the Mac", in the service’s order, and they cannot be dragged', () => {
    const view = listView(threads);
    expect(view.groups.map((group) => [group.key, group.heading, group.movable, ids(group.threads)])).toEqual([
      ['desk', 'For the Mac', false, ['c', 'd']],
      ['needs', null, false, ['b']],
      ['rest', null, true, ['a']],
    ]);
  });

  it('keeps a marked thread that waits in that group, and still counts it', () => {
    const view = listView(threads);
    expect(view.groups[0].threads.find((each) => each.id === 'd')?.status).toBe('waiting');
    expect(view.needs).toBe(2);
    expect(needsCount(threads)).toBe(2);
    expect(rowLine(view.groups[0].threads[1])).toEqual({ kind: 'ask', text: 'Which wood?' });
    expect(rowOptions(view.groups[0].threads[1])).toEqual(['Cedar', 'Larch']);
  });

  it('lets snoozed win: a marked thread that is snoozed is behind the Snoozed line', () => {
    const view = listView(threads);
    expect(ids(view.snoozed)).toEqual(['e']);
    expect(view.groups.flatMap((group) => ids(group.threads))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('shows no heading once no thread is marked', () => {
    expect(listView(threads.map((each) => ({ ...each, desk: null }))).groups.map((group) => group.heading)).toEqual([null, null]);
  });
});

describe('the empty list', () => {
  it('says nothing while a thread is left', () => {
    expect(emptyList(listView([thread('a')]), NOW)).toBeNull();
  });

  it('says Nothing left, how many are snoozed and when the next one returns', () => {
    const view = listView([thread('c', { snoozed: at(2026, 11, 20, 8) }), thread('f', { snoozed: at(2026, 11, 15, 8) })]);
    expect(emptyList(view, NOW)).toEqual({ title: 'Nothing left.', detail: '2 snoozed. The next one returns tomorrow at 8:00 am.' });
    expect(ids(view.snoozed)).toEqual(['f', 'c']);
  });

  it('reads right for one snoozed thread, and for none', () => {
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 11, 14, 18, 30) })]), NOW)).toEqual({ title: 'Nothing left.', detail: '1 snoozed. It returns today at 6:30 pm.' });
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 11, 18, 8) })]), NOW)?.detail).toBe('1 snoozed. It returns Wednesday at 8:00 am.');
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 12, 24, 8) })]), NOW)?.detail).toBe('1 snoozed. It returns Dec 24 at 8:00 am.');
    expect(emptyList(listView([]), NOW)).toEqual({ title: 'Nothing left.', detail: null });
  });
});

describe('changes from the service', () => {
  const list = [thread('a'), thread('b'), thread('c')];

  it('replaces an entry where it is, and adds a new one on top', () => {
    expect(upsertThread(list, thread('b', { title: 'Renamed' })).map((each) => each.title)).toEqual(['Thread a', 'Renamed', 'Thread c']);
    expect(ids(upsertThread(list, thread('z')))).toEqual(['z', 'a', 'b', 'c']);
  });

  it('takes an archived entry out', () => {
    expect(ids(upsertThread(list, thread('b', { archived: true })))).toEqual(['a', 'c']);
    expect(ids(upsertThread(list, thread('z', { archived: true })))).toEqual(['a', 'b', 'c']);
  });

  it('sorts to the service’s order, keeping a thread it does not name on top', () => {
    expect(ids(applyOrder(list, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
    expect(ids(applyOrder([thread('new'), ...list], ['c', 'b', 'a', 'gone']))).toEqual(['new', 'c', 'b', 'a']);
  });
});

describe('a row', () => {
  it('shows the question while it waits, the live line while it works, and the last reply at rest', () => {
    expect(rowLine(thread('a', { status: 'waiting', ask }))).toEqual({ kind: 'ask', text: 'Which wood?' });
    expect(rowLine(thread('a', { status: 'working', activity: 'Reading plan.md' }))).toEqual({ kind: 'live', text: 'Reading plan.md' });
    expect(rowLine(thread('a', { status: 'queued' }))).toEqual({ kind: 'live', text: 'Working' });
    expect(rowLine(thread('a', { status: 'failed', error: 'It broke.' }))).toEqual({ kind: 'failed', text: 'Failed: It broke.' });
    expect(rowLine(thread('a', { status: 'failed' })).text).toBe('Failed: the turn did not finish');
    expect(rowLine(thread('a', { status: 'stopped', last: 'An older reply' }))).toEqual({ kind: 'plain', text: 'Stopped' });
    expect(rowLine(thread('a'))).toEqual({ kind: 'plain', text: 'Last of a' });
    expect(rowLine(thread('a', { waits: true, last: 'The committee walks the plots' })).text).toBe('The committee walks the plots');
  });

  it('offers answer buttons only when the service gives options for a question', () => {
    expect(rowOptions(thread('a', { status: 'waiting', ask }))).toEqual(['Cedar', 'Larch']);
    expect(rowOptions(thread('a', { status: 'waiting', ask: { ...ask, options: [], question: null } }))).toEqual([]);
    expect(rowOptions(thread('a', { status: 'waiting', ask: { ...ask, kind: 'permission' } }))).toEqual([]);
    expect(rowOptions(thread('a', { status: 'idle', ask }))).toEqual([]);
  });

  it('shows the clock today, then Yesterday, the weekday, or the date', () => {
    expect(rowTime(thread('a', { updated: NOW / 1000 - 20 }), NOW)).toBe('now');
    expect(rowTime(thread('a', { updated: at(2026, 11, 14, 9, 5) }), NOW)).toBe('9:05 am');
    expect(rowTime(thread('a', { updated: at(2026, 11, 13, 23, 50) }), NOW)).toBe('Yesterday');
    expect(rowTime(thread('a', { updated: at(2026, 11, 10, 12) }), NOW)).toBe('Tuesday');
    expect(rowTime(thread('a', { updated: at(2026, 11, 3, 12) }), NOW)).toBe('Nov 3');
    expect(rowTime(thread('a', { updated: at(2025, 11, 3, 12) }), NOW)).toBe('Nov 3, 2025');
  });

  it('says Back and when for a thread back from snooze, until it is opened', () => {
    expect(rowTime(thread('a', { woke: at(2026, 11, 14, 15, 0), updated: at(2026, 11, 3, 12) }), NOW)).toBe('Back 3:00 pm');
    expect(rowTime(thread('a', { woke: null, updated: at(2026, 11, 3, 12) }), NOW)).toBe('Nov 3');
  });

  it('shows no time while it works, or for an entry nobody has started', () => {
    expect(rowTime(thread('a', { status: 'working' }), NOW)).toBe('');
    expect(rowTime(thread('a', { waits: true }), NOW)).toBe('');
  });

  it('says when a snoozed thread returns', () => {
    expect(snoozedUntil(at(2026, 11, 15, 8), NOW)).toBe('Tomorrow 8:00 am');
    expect(snoozedUntil(at(2026, 11, 20, 8), NOW)).toBe('Friday 8:00 am');
  });

  it('knows a thread that came from a digest entry, of any kind', () => {
    expect(fromDigest(thread('a', { digest: { date: '2026-11-13', id: 'item-3' } }))).toBe(true);
    expect(fromDigest(thread('a', { digest: { date: '2026-11-13', id: 'text-garden-3d20bff3' } }))).toBe(true);
    expect(fromDigest(thread('a'))).toBe(false);
  });
});

describe('dragging a row', () => {
  const group = [thread('a'), thread('b'), thread('c'), thread('d')];

  it('names the thread the row now sits above, or the end', () => {
    expect(moveTarget(group, 'd', 0)).toEqual({ id: 'd', before: 'a' });
    expect(moveTarget(group, 'a', 2)).toEqual({ id: 'a', before: 'c' });
    expect(moveTarget(group, 'a', 4)).toEqual({ id: 'a', before: null });
  });

  it('moves nothing for a drop where the row already is', () => {
    expect(moveTarget(group, 'b', 1)).toBeNull();
    expect(moveTarget(group, 'b', 2)).toBeNull();
    expect(moveTarget(group, 'zz', 0)).toBeNull();
  });

  it('shows the move at once', () => {
    expect(ids(moved(group, 'd', 'a'))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(moved(group, 'a', 'c'))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(moved(group, 'a', null))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(moved(group, 'a', 'gone'))).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('snooze', () => {
  it('offers Later today, Tomorrow and Next week, with the times they mean', () => {
    const choices = snoozeChoices(NOW);
    expect(choices.map((choice) => [choice.label, choice.hint])).toEqual([
      ['Later today', '6:30 pm'],
      ['Tomorrow', 'Sun 8:00 am'],
      ['Next week', 'Nov 16 8:00 am'],
    ]);
    expect(choices.map((choice) => choice.until)).toEqual([at(2026, 11, 14, 18, 30), at(2026, 11, 15, 8), at(2026, 11, 16, 8)]);
    expect(choices.every((choice) => choice.until * 1000 > NOW)).toBe(true);
  });

  it('leaves out Later today once three hours on is tomorrow', () => {
    expect(snoozeChoices(new Date(2026, 10, 14, 22, 0).getTime()).map((choice) => choice.label)).toEqual(['Tomorrow', 'Next week']);
  });

  it('means the Monday after next when tomorrow is Monday', () => {
    const sunday = new Date(2026, 10, 15, 10, 0).getTime();
    expect(snoozeChoices(sunday).map((choice) => choice.until).slice(-2)).toEqual([at(2026, 11, 16, 8), at(2026, 11, 23, 8)]);
    const monday = new Date(2026, 10, 16, 10, 0).getTime();
    expect(snoozeChoices(monday).at(-1)?.until).toBe(at(2026, 11, 23, 8));
  });

  it('takes a picked day inside the next year, at 8 in the morning', () => {
    expect(snoozeDateRange(NOW)).toEqual({ min: '2026-11-15', max: '2027-11-14' });
    expect(snoozeDate('2026-12-01', NOW)).toBe(at(2026, 12, 1, 8));
    expect(snoozeDate('2026-11-14', NOW)).toBeNull();
    expect(snoozeDate('2027-11-15', NOW)).toBeNull();
    expect(snoozeDate('next week', NOW)).toBeNull();
    expect(snoozeDate('', NOW)).toBeNull();
  });
});
