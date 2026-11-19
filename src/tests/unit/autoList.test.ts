import { describe, expect, it } from 'vitest';
import type { AutoThread } from '@/types/auto';
import {
  applyOrder,
  attentionCount,
  emptyList,
  fromDigest,
  isFresh,
  isYours,
  listSummary,
  isNested,
  listView,
  moveBy,
  moveTarget,
  moved,
  needsCount,
  rowLine,
  rowOptions,
  rowTime,
  shortUntil,
  snoozeChoices,
  snoozeDate,
  snoozeDateRange,
  snoozedUntil,
  topLevel,
  upsertThread,
} from '@/renderer/features/auto/model/listModel';

// A Saturday afternoon, in whatever zone the tests run in.
const NOW = new Date(2026, 10, 14, 15, 10, 0).getTime();
const at = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime() / 1000;

function thread(id: string, fields: Partial<AutoThread> = {}): AutoThread {
  return {
    id, title: `Thread ${id}`, status: 'idle', last: `Last of ${id}`, activity: '', ask: null, unread: false, model: '',
    created: at(2026, 11, 13, 9), updated: at(2026, 11, 14, 14, 0), error: null, queued: 0, archived: false, archivedAt: null, snoozed: null, snoozedAt: null, woke: null, wait: null,
    digest: null, waits: false, desk: null, yours: '', parent: null, mode: '', agentsModel: '', ...fields,
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

  it('puts the threads that wait on him first, then what is new to him, then the rest in the service’s order', () => {
    const view = listView(threads);
    expect(view.groups.map((group) => [group.key, ids(group.threads)])).toEqual([
      ['needs', ['b', 'e']],
      // Back from snooze: lifted under the questions until he opens it.
      ['fresh', ['d']],
      ['rest', ['a', 'g']],
    ]);
    expect(view.needs).toBe(2);
    expect(needsCount(threads)).toBe(2);
  });

  it('lifts a thread with an unread reply or back from snooze under the questions, newest first, as the phone does', () => {
    const lifted = [
      thread('old', { unread: true, updated: at(2026, 11, 14, 9) }),
      thread('rest'),
      thread('new', { unread: true, updated: at(2026, 11, 14, 14) }),
      thread('back', { woke: at(2026, 11, 14, 15), updated: at(2026, 11, 13, 9) }),
      thread('failed', { unread: true, status: 'failed', updated: at(2026, 11, 14, 12) }),
      // Still being worked on, or waiting on him, is not new: it has its own place.
      thread('working', { unread: true, status: 'working' }),
      thread('asks', { unread: true, status: 'waiting', ask }),
    ];
    expect(listView(lifted).groups.map((group) => [group.key, ids(group.threads)])).toEqual([
      ['needs', ['asks']],
      ['fresh', ['new', 'failed', 'old', 'back']],
      ['rest', ['rest', 'working']],
    ]);
    for (const each of lifted) expect(isFresh(each)).toBe(['old', 'new', 'back', 'failed'].includes(each.id));
    // Once he has opened it, it is back in its place in his order.
    expect(listView(lifted.map((each) => ({ ...each, unread: false, woke: null }))).groups.map((group) => group.key)).toEqual(['needs', 'rest']);
  });

  it('puts the questions newest first', () => {
    const asked = [thread('early', { status: 'waiting', ask, updated: at(2026, 11, 14, 9) }), thread('late', { status: 'waiting', ask, updated: at(2026, 11, 14, 14) })];
    expect(ids(listView(asked).groups[0].threads)).toEqual(['late', 'early']);
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
    expect(view.groups.map((group) => [group.key, group.movable, group.heading])).toEqual([['needs', false, null], ['fresh', false, null], ['rest', true, null]]);
  });

  it('leaves out a group with nothing in it', () => {
    expect(listView([thread('a')]).groups.map((group) => group.key)).toEqual(['rest']);
  });
});

describe('the line over the list', () => {
  it('counts what needs him, what is new, what has not started and what is working, in the phone’s words', () => {
    expect(listSummary([
      thread('q', { status: 'waiting', ask }),
      thread('new1', { unread: true }),
      thread('new2', { woke: at(2026, 11, 14, 15) }),
      thread('work', { status: 'working' }),
      thread('rest'),
    ])).toBe('1 needs you, 2 new, 1 working');
    expect(listSummary([thread('a', { waits: true }), thread('b', { waits: true }), thread('c', { status: 'queued' }), thread('d', { status: 'working' })])).toBe('2 not started, 2 working');
  });

  it('counts a move that is his as needing him, whether or not he has read the reply', () => {
    const his = { yours: 'Send the draft' };
    expect(listSummary([thread('q', { status: 'waiting', ask }), thread('a', his)])).toBe('2 need you');
    expect(listSummary([thread('a', { ...his, unread: true })])).toBe('1 needs you, 1 new');
    expect(listSummary([thread('a', { ...his, status: 'working' })])).toBe('1 working');
  });

  it('is empty when every count is zero, and leaves out snoozed and archived threads', () => {
    expect(listSummary([])).toBe('');
    expect(listSummary([thread('a'), thread('b', { status: 'stopped' })])).toBe('');
    expect(listSummary([thread('a', { status: 'waiting', ask, snoozed: at(2026, 11, 20) }), thread('b', { unread: true, archived: true })])).toBe('');
  });

  it('counts for the sidebar the threads that wait, the unread ones and the ones whose move is his', () => {
    expect(attentionCount([thread('q', { status: 'waiting', ask }), thread('u', { unread: true }), thread('y', { yours: 'Send the draft' }), thread('rest')])).toBe(3);
    // One thread is one, however many reasons it has; a snoozed one is none.
    expect(attentionCount([thread('y', { yours: 'Send the draft', unread: true })])).toBe(1);
    expect(attentionCount([thread('y', { yours: 'Send the draft', snoozed: at(2026, 11, 20) })])).toBe(0);
    // A thread back from snooze counts, as it does in the line over the list.
    expect(attentionCount([thread('w', { woke: at(2026, 11, 14) }), thread('rest')])).toBe(1);
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
    expect(rowLine(view.groups[0].threads[1])).toEqual({ kind: 'ask', text: 'Which wood?', under: '' });
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

  it('says Nothing left and when the next snoozed one returns, and leaves the count to the Snoozed line', () => {
    const view = listView([thread('c', { snoozed: at(2026, 11, 20, 8) }), thread('f', { snoozed: at(2026, 11, 15, 8) })]);
    expect(emptyList(view, NOW)).toEqual({ title: 'Nothing left.', detail: 'The next snoozed one returns tomorrow at 8:00 am.' });
    expect(ids(view.snoozed)).toEqual(['f', 'c']);
  });

  it('reads right for one snoozed thread, and for none', () => {
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 11, 14, 18, 30) })]), NOW)).toEqual({ title: 'Nothing left.', detail: 'The snoozed one returns today at 6:30 pm.' });
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 11, 18, 8) })]), NOW)?.detail).toBe('The snoozed one returns Wednesday at 8:00 am.');
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 12, 24, 8) })]), NOW)?.detail).toBe('The snoozed one returns Dec 24 at 8:00 am.');
    expect(emptyList(listView([]), NOW)).toEqual({ title: 'Nothing left.', detail: null });
    // The count is never in this line: the Snoozed line under it has it.
    expect(emptyList(listView([thread('c', { snoozed: at(2026, 11, 20, 8) }), thread('f', { snoozed: at(2026, 11, 15, 8) })]), NOW)?.detail).not.toMatch(/\d snoozed/);
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
    expect(rowLine(thread('a', { status: 'waiting', ask }))).toEqual({ kind: 'ask', text: 'Which wood?', under: '' });
    expect(rowLine(thread('a', { status: 'working', activity: 'Reading plan.md' }))).toEqual({ kind: 'live', text: 'Reading plan.md', under: '' });
    expect(rowLine(thread('a', { status: 'queued' }))).toEqual({ kind: 'live', text: 'Working', under: '' });
    expect(rowLine(thread('a', { status: 'failed', error: 'It broke.' }))).toEqual({ kind: 'failed', text: 'Failed: It broke.', under: '' });
    expect(rowLine(thread('a', { status: 'failed' })).text).toBe('Failed: the turn did not finish');
    expect(rowLine(thread('a', { status: 'stopped', last: 'An older reply' }))).toEqual({ kind: 'plain', text: 'Stopped', under: '' });
    expect(rowLine(thread('a'))).toEqual({ kind: 'plain', text: 'Last of a', under: '' });
  });

  it('says Not started for a thread nobody has started, with its entry’s first words under it', () => {
    expect(rowLine(thread('a', { waits: true, last: 'The committee walks the plots' }))).toEqual({ kind: 'idle', text: 'Not started', under: 'The committee walks the plots' });
    expect(rowLine(thread('a', { waits: true, last: '' }))).toEqual({ kind: 'idle', text: 'Not started', under: '' });
  });

  it('says Your move in the phone’s words when the next move is his, with the reply’s first line under it', () => {
    const his = thread('a', { yours: 'Read and send the draft to the club', last: 'The draft is in Ideas.' });
    expect(isYours(his)).toBe(true);
    expect(rowLine(his)).toEqual({ kind: 'yours', text: 'Your move: Read and send the draft to the club', under: 'The draft is in Ideas.' });
    // Only at rest: not while it works, waits on a question, has not started, or failed.
    for (const fields of [{ status: 'working' as const }, { status: 'queued' as const }, { status: 'waiting' as const, ask }, { waits: true }, { status: 'failed' as const }]) {
      expect(isYours({ ...his, ...fields })).toBe(false);
      expect(rowLine({ ...his, ...fields }).kind).not.toBe('yours');
    }
    expect(isYours(thread('a'))).toBe(false);
    // Words on the row, never something to press.
    expect(rowOptions(his)).toEqual([]);
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

  it('says how long a thread has been working, and shows no time for an entry nobody has started', () => {
    // It began at 2:00 and it is 3:10: the phone's words.
    expect(rowTime(thread('a', { status: 'working' }), NOW)).toBe('1 h 10 min');
    expect(rowTime(thread('a', { status: 'working', updated: at(2026, 11, 14, 15, 9) + 30 }), NOW)).toBe('now');
    expect(rowTime(thread('a', { status: 'queued', updated: at(2026, 11, 14, 14, 58) }), NOW)).toBe('12 min');
    expect(rowTime(thread('a', { status: 'working', updated: at(2026, 11, 14, 13, 10) }), NOW)).toBe('2 h');
    // Working wins over "Back": it says what is happening now.
    expect(rowTime(thread('a', { status: 'working', updated: at(2026, 11, 14, 15, 5), woke: at(2026, 11, 14, 15, 0) }), NOW)).toBe('5 min');
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

describe('sub-agents in the list', () => {
  const threads = [thread('a'), thread('b'), thread('a1', { parent: 'a', status: 'working' }), thread('c', { status: 'waiting', ask }), thread('a2', { parent: 'a', unread: true })];

  it('puts each child under its parent, in the service’s order, whatever group it alone would fall in', () => {
    const view = listView(threads);
    expect(view.groups.map((group) => [group.key, ids(group.threads)])).toEqual([
      ['needs', ['c']],
      ['rest', ['a', 'a1', 'a2', 'b']],
    ]);
    expect(isNested(threads, threads[2])).toBe(true);
    expect(isNested(threads, threads[0])).toBe(false);
    // A child whose parent is put away stands on its own.
    expect(isNested([thread('p', { snoozed: at(2026, 11, 20, 8) }), thread('k', { parent: 'p' })], thread('k', { parent: 'p' }))).toBe(false);
    expect(ids(listView([thread('k', { parent: 'gone' })]).groups[0].threads)).toEqual(['k']);
  });

  it('moves a parent among the top-level rows, with its children, and never a child on its own', () => {
    expect(ids(topLevel(listView(threads).groups[1].threads))).toEqual(['a', 'b']);
    expect(moveBy(threads, 'a', 1)).toEqual({ id: 'a', before: null });
    expect(moveBy(threads, 'b', -1)).toEqual({ id: 'b', before: 'a' });
    expect(moveBy(threads, 'a1', 1)).toBeNull();
    expect(moveBy(threads, 'a2', -1)).toBeNull();
  });

  it('counts a child that asks him, and reads nothing else of it as his', () => {
    expect(attentionCount(threads)).toBe(2);
    expect(listSummary(threads)).toBe('1 needs you, 1 new, 1 working');
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
  const labels = (now: number) => snoozeChoices(now).map((choice) => choice.label);

  it('offers the phone’s choices with the times they mean, in the order of their times', () => {
    // A Saturday afternoon: the weekend has begun, so there is no "this weekend" left to pick.
    const choices = snoozeChoices(NOW);
    expect(choices.map((choice) => [choice.label, choice.hint])).toEqual([
      ['Later today', '6:10 pm'],
      ['Tonight', '7:00 pm'],
      ['Tomorrow', 'Sun 9:00 am'],
      ['Next week', 'Mon 9:00 am'],
    ]);
    expect(choices.map((choice) => choice.until)).toEqual([at(2026, 11, 14, 18, 10), at(2026, 11, 14, 19), at(2026, 11, 15, 9), at(2026, 11, 16, 9)]);
    expect(choices.every((choice) => choice.until * 1000 > NOW)).toBe(true);
  });

  it('offers This weekend from Monday to Friday, and on a Saturday before 9', () => {
    const wednesday = new Date(2026, 10, 11, 10, 0).getTime();
    expect(snoozeChoices(wednesday).map((choice) => [choice.label, choice.until])).toEqual([
      ['Later today', at(2026, 11, 11, 13)],
      ['Tonight', at(2026, 11, 11, 19)],
      ['Tomorrow', at(2026, 11, 12, 9)],
      ['This weekend', at(2026, 11, 14, 9)],
      ['Next week', at(2026, 11, 16, 9)],
    ]);
    const early = new Date(2026, 10, 14, 7, 30).getTime();
    expect(snoozeChoices(early).find((choice) => choice.label === 'This weekend')?.until).toBe(at(2026, 11, 14, 9));
    expect(labels(new Date(2026, 10, 15, 10, 0).getTime())).not.toContain('This weekend');
  });

  it('leaves out Later today once three hours on is tomorrow, and Tonight from 6 pm', () => {
    expect(labels(new Date(2026, 10, 14, 22, 0).getTime())).toEqual(['Tomorrow', 'Next week']);
    expect(labels(new Date(2026, 10, 14, 18, 0).getTime())).toEqual(['Later today', 'Tomorrow', 'Next week']);
    // Late in the afternoon Tonight comes before Later today, since it is sooner.
    expect(labels(new Date(2026, 10, 14, 17, 0).getTime()).slice(0, 2)).toEqual(['Tonight', 'Later today']);
  });

  it('shows one choice for one time: on a Sunday Next week is tomorrow, and on a Monday it is a week on', () => {
    const sunday = new Date(2026, 10, 15, 10, 0).getTime();
    expect(snoozeChoices(sunday).filter((choice) => choice.until === at(2026, 11, 16, 9)).map((choice) => choice.label)).toEqual(['Tomorrow']);
    expect(labels(sunday)).not.toContain('Next week');
    const monday = new Date(2026, 10, 16, 10, 0).getTime();
    expect(snoozeChoices(monday).at(-1)).toMatchObject({ label: 'Next week', until: at(2026, 11, 23, 9) });
  });

  it('writes a time short: the clock today, the weekday within a week, else the date', () => {
    expect(shortUntil(at(2026, 11, 14, 19), NOW)).toBe('7:00 pm');
    expect(shortUntil(at(2026, 11, 15, 9), NOW)).toBe('Sun 9:00 am');
    expect(shortUntil(at(2026, 11, 20, 14, 30), NOW)).toBe('Fri 2:30 pm');
    expect(shortUntil(at(2026, 11, 21, 9), NOW)).toBe('Nov 21 9:00 am');
  });

  it('takes any time from now on for a time of his own, today included, to a year on', () => {
    expect(snoozeDateRange(NOW)).toEqual({ min: '2026-11-14', max: '2027-11-14', start: '2026-11-15' });
    expect(snoozeDate('2026-12-01', NOW)).toBe(at(2026, 12, 1, 9));
    // Later today is a time from now on.
    expect(snoozeDate('2026-11-14', NOW, '23:30')).toBe(at(2026, 11, 14, 23, 30));
    expect(snoozeDate('2026-11-14', NOW, '15:11')).toBe(at(2026, 11, 14, 15, 11));
    // Now, and earlier today, are not.
    expect(snoozeDate('2026-11-14', NOW, '15:10')).toBeNull();
    expect(snoozeDate('2026-11-14', NOW, '09:00')).toBeNull();
    expect(snoozeDate('2026-11-13', NOW, '23:00')).toBeNull();
    expect(snoozeDate('2027-11-15', NOW)).toBeNull();
    expect(snoozeDate('next week', NOW)).toBeNull();
    expect(snoozeDate('', NOW)).toBeNull();
  });

});
