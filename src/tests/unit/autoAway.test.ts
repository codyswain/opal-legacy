import { describe, expect, it } from 'vitest';
import type { AutoThread, AutoWait } from '@/types/auto';
import {
  archivedWord,
  awayDetail,
  defaultGiveUp,
  elapsed,
  giveUpChoices,
  givesUp,
  heardLine,
  isOpenWait,
  isWaitingOnReply,
  lower,
  returns,
  returnsLine,
  sinceLine,
  stamp,
  waitBack,
  waitLine,
  waitUrl,
  workingDays,
} from '@/renderer/features/auto/model/awayModel';
import { listView, rowLine, rowTime, shownOrder } from '@/renderer/features/auto/model/listModel';

// A Saturday afternoon, in whatever zone the tests run in.
const NOW = new Date(2026, 10, 14, 15, 10, 0).getTime();
const at = (year: number, month: number, day: number, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime() / 1000;

function wait(fields: Partial<AutoWait> = {}): AutoWait {
  return {
    say: 'Sam, about the glass', state: 'watching', on: 'Sam', what: 'a reply about the glass', where: 'Gmail', link: 'https://mail.example/t/1',
    check: 'Sam answers about the glass', since: at(2026, 11, 14, 14, 10), expires: at(2026, 11, 17, 17), heard: '', reply: '', ...fields,
  };
}

function thread(id: string, fields: Partial<AutoThread> = {}): AutoThread {
  return {
    id, title: `Thread ${id}`, status: 'idle', last: `Last of ${id}`, activity: '', ask: null, unread: false, model: '',
    created: at(2026, 11, 13, 9), updated: at(2026, 11, 14, 14, 0), error: null, queued: 0, archived: false, archivedAt: null, snoozed: null, snoozedAt: null, woke: null, wait: null,
    digest: null, waits: false, desk: null, yours: '', ...fields,
  };
}

const ids = (threads: readonly AutoThread[]) => threads.map((each) => each.id);

describe('when something returns, and when it happened', () => {
  it('says a time ahead as the clock today, Tomorrow, the weekday within a week, else the date', () => {
    expect(returns(at(2026, 11, 14, 17, 40), NOW)).toBe('5:40 pm');
    expect(returns(at(2026, 11, 15, 9), NOW)).toBe('Tomorrow 9:00 am');
    expect(returns(at(2026, 11, 17, 17), NOW)).toBe('Tue 5:00 pm');
    expect(returns(at(2026, 11, 20, 9), NOW)).toBe('Fri 9:00 am');
    expect(returns(at(2026, 11, 23, 9), NOW)).toBe('Nov 23 9:00 am');
    expect(returns(at(2027, 1, 4, 9), NOW)).toBe('Jan 4, 2027 9:00 am');
  });

  it('says a time past as now, the clock today, Yesterday, the weekday within a week, else the date', () => {
    expect(stamp(NOW / 1000 - 20, NOW)).toBe('now');
    expect(stamp(at(2026, 11, 14, 9, 5), NOW)).toBe('9:05 am');
    expect(stamp(at(2026, 11, 13, 23, 50), NOW)).toBe('Yesterday');
    expect(stamp(at(2026, 11, 10, 12), NOW)).toBe('Tue');
    expect(stamp(at(2026, 11, 3, 12), NOW)).toBe('Nov 3');
    expect(stamp(at(2025, 11, 3, 12), NOW)).toBe('Nov 3, 2025');
  });

  it('lowers Tomorrow and Yesterday inside a sentence, and leaves a weekday or a month alone', () => {
    expect(lower('Tomorrow 9:00 am')).toBe('tomorrow 9:00 am');
    expect(lower('Yesterday')).toBe('yesterday');
    expect(lower('Tue 5:00 pm')).toBe('Tue 5:00 pm');
    expect(lower('Nov 23 9:00 am')).toBe('Nov 23 9:00 am');
    expect(lower('5:40 pm')).toBe('5:40 pm');
  });
});

describe('how long a thread has been working', () => {
  it('says now, then minutes, then hours with the minutes left over', () => {
    const since = NOW / 1000;
    expect(elapsed(since, NOW)).toBe('now');
    expect(elapsed(since - 59, NOW)).toBe('now');
    expect(elapsed(since - 60, NOW)).toBe('1 min');
    expect(elapsed(since - 12 * 60, NOW)).toBe('12 min');
    expect(elapsed(since - 59 * 60 - 59, NOW)).toBe('59 min');
    expect(elapsed(since - 60 * 60, NOW)).toBe('1 h');
    expect(elapsed(since - 65 * 60, NOW)).toBe('1 h 5 min');
    expect(elapsed(since - 26 * 60 * 60 - 3 * 60, NOW)).toBe('26 h 3 min');
  });

  it('never counts backwards when the service’s clock is ahead of this one', () => {
    expect(elapsed(NOW / 1000 + 90, NOW)).toBe('now');
  });

  it('is the row’s time while the thread works, in place of the clock', () => {
    expect(rowTime(thread('a', { status: 'working', updated: at(2026, 11, 14, 14, 5) }), NOW)).toBe('1 h 5 min');
    expect(rowTime(thread('a', { status: 'idle', updated: at(2026, 11, 14, 14, 5) }), NOW)).toBe('2:05 pm');
  });
});

describe('a thread put away until a reply', () => {
  const waiting = thread('a', { snoozed: at(2026, 11, 17, 17), snoozedAt: at(2026, 11, 14, 14, 10), wait: wait() });
  const finding = thread('b', { snoozed: at(2026, 11, 17, 17), snoozedAt: NOW / 1000 - 10, wait: wait({ state: 'finding', on: '', what: '', where: '', link: '', check: '', expires: null }) });

  it('is open while Auto looks for the conversation and while the service watches it, and over once met or expired', () => {
    expect(isOpenWait(null)).toBe(false);
    expect(isOpenWait(wait({ state: 'finding' }))).toBe(true);
    expect(isOpenWait(wait({ state: 'watching' }))).toBe(true);
    expect(isOpenWait(wait({ state: 'met' }))).toBe(false);
    expect(isOpenWait(wait({ state: 'expired' }))).toBe(false);
    expect(isWaitingOnReply(waiting)).toBe(true);
    expect(isWaitingOnReply(finding)).toBe(true);
    // Brought back, or snoozed to a time with no wait: not waiting on anyone.
    expect(isWaitingOnReply({ ...waiting, snoozed: null })).toBe(false);
    expect(isWaitingOnReply(thread('c', { snoozed: at(2026, 11, 15, 9) }))).toBe(false);
    expect(isWaitingOnReply({ ...waiting, wait: wait({ state: 'met' }) })).toBe(false);
  });

  it('says who it waits on and until when, in the phone’s words', () => {
    expect(waitLine(waiting, NOW)).toBe('Waiting on Sam until Tue 5:00 pm');
    expect(waitLine({ ...waiting, wait: wait({ expires: at(2026, 11, 15, 17) }) }, NOW)).toBe('Waiting on Sam until tomorrow 5:00 pm');
    expect(waitLine({ ...waiting, wait: wait({ on: '' }) }, NOW)).toBe('Waiting on a reply until Tue 5:00 pm');
    // No time of its own: the thread's return time stands in.
    expect(waitLine({ ...waiting, wait: wait({ expires: null }) }, NOW)).toBe('Waiting on Sam until Tue 5:00 pm');
    expect(waitLine({ ...waiting, snoozed: null, wait: wait({ expires: null }) }, NOW)).toBe('Waiting on Sam');
    expect(waitLine(finding, NOW)).toBe('Finding the conversation');
    expect(waitLine(thread('c'), NOW)).toBe('');
  });

  it('says under it what it waits for and where, or when it gives up while Auto still looks', () => {
    expect(awayDetail(waiting, NOW)).toBe('A reply about the glass. In Gmail.');
    expect(awayDetail({ ...waiting, wait: wait({ where: '' }) }, NOW)).toBe('A reply about the glass.');
    expect(awayDetail({ ...waiting, wait: wait({ what: 'A reply about the glass.', where: 'Slack' }) }, NOW)).toBe('A reply about the glass. In Slack.');
    // A text, and a place this app has no name for: the service's own word.
    expect(awayDetail({ ...waiting, wait: wait({ where: 'Messages', link: 'imessage:+15550100' }) }, NOW)).toBe('A reply about the glass. In Messages.');
    expect(awayDetail({ ...waiting, wait: wait({ where: 'Pigeon post' }) }, NOW)).toBe('A reply about the glass. In Pigeon post.');
    expect(awayDetail({ ...waiting, wait: wait({ what: '', where: '' }) }, NOW)).toBe('');
    expect(awayDetail(finding, NOW)).toBe('Gives up Tue 5:00 pm.');
    expect(givesUp(waiting, NOW)).toBe('Gives up Tue 5:00 pm');
    expect(givesUp(thread('c'), NOW)).toBe('');
  });

  it('says what was last heard when it did not answer, without the name the service puts first', () => {
    expect(heardLine(wait({ heard: 'Sam: Will check on Monday' }))).toBe('Last heard: Will check on Monday');
    expect(heardLine(wait({ heard: 'Will check on Monday' }))).toBe('Last heard: Will check on Monday');
    expect(heardLine(wait())).toBe('');
  });

  it('says who replied and what they said once it is met, and that nobody did once it expired', () => {
    expect(waitBack(wait({ state: 'met', reply: 'Sam: 12 mm is fine' }))).toBe('Sam replied: 12 mm is fine');
    expect(waitBack(wait({ state: 'met', reply: '12 mm is fine' }))).toBe('Sam replied: 12 mm is fine');
    expect(waitBack(wait({ state: 'met', reply: '' }))).toBe('Sam replied.');
    expect(waitBack(wait({ state: 'met', on: '', reply: '' }))).toBe('A reply came.');
    expect(waitBack(wait({ state: 'expired' }))).toBe('No reply from Sam.');
    expect(waitBack(wait({ state: 'expired', on: '' }))).toBe('No reply came.');
    expect(waitBack(wait())).toBeNull();
    expect(waitBack(wait({ state: 'finding' }))).toBeNull();
  });

  it('is not called over from the clock: past its time it still waits until the service says otherwise', () => {
    // The service can leave a wait `watching` for a few seconds after `expires` has passed.
    const late = { ...waiting, snoozed: NOW / 1000 - 5, wait: wait({ expires: NOW / 1000 - 5 }) };
    expect(isWaitingOnReply(late)).toBe(true);
    expect(waitBack(late.wait as AutoWait)).toBeNull();
    expect(waitLine(late, NOW)).toBe('Waiting on Sam until 3:09 pm');
    expect(ids(listView([late]).waiting)).toEqual(['a']);
    expect(listView([late]).groups).toEqual([]);
    expect(rowLine(late).kind).toBe('plain');
  });

  it('opens the conversation only for a web address', () => {
    expect(waitUrl(wait())).toBe('https://mail.example/t/1');
    expect(waitUrl(wait({ link: 'http://chat.example/c/1' }))).toBe('http://chat.example/c/1');
    for (const link of ['', 'whatsapp:1203', 'imessage:+15550100', 'imessage:sam@example.org', 'file:///etc/hosts', 'javascript:alert(1)', 'mailto:sam@example.org', ' https://mail.example', 'https://', 'httpx://mail.example', '//mail.example/t/1']) {
      expect(waitUrl(wait({ link })), link).toBeNull();
    }
    expect(waitUrl(null)).toBeNull();
  });
});

describe('a thread snoozed to a time, and the archive', () => {
  it('says when it returns, and when he snoozed it', () => {
    const snoozed = thread('a', { snoozed: at(2026, 11, 15, 9), snoozedAt: at(2026, 11, 14, 14, 10) });
    expect(returnsLine(snoozed, NOW)).toBe('Returns tomorrow 9:00 am');
    expect(returnsLine({ ...snoozed, snoozed: at(2026, 11, 14, 19) }, NOW)).toBe('Returns at 7:00 pm');
    expect(returnsLine({ ...snoozed, snoozed: at(2026, 11, 20, 9) }, NOW)).toBe('Returns Fri 9:00 am');
    expect(returnsLine(thread('b'), NOW)).toBe('');
    expect(sinceLine(snoozed, NOW)).toBe('Snoozed at 2:10 pm');
    expect(sinceLine({ ...snoozed, snoozedAt: NOW / 1000 - 5 }, NOW)).toBe('Snoozed just now');
    expect(sinceLine({ ...snoozed, snoozedAt: at(2026, 11, 13, 16) }, NOW)).toBe('Snoozed yesterday');
    expect(sinceLine({ ...snoozed, snoozedAt: at(2026, 11, 10, 16) }, NOW)).toBe('Snoozed Tue');
    expect(sinceLine({ ...snoozed, snoozedAt: null }, NOW)).toBe('');
    expect(awayDetail(snoozed, NOW)).toBe('Snoozed at 2:10 pm.');
    expect(awayDetail({ ...snoozed, snoozedAt: null }, NOW)).toBe('');
  });

  it('says when a thread was archived, as the phone does', () => {
    expect(archivedWord(thread('a', { archived: true, archivedAt: at(2026, 11, 12, 10) }), NOW)).toBe('Archived Thu.');
    expect(archivedWord(thread('a', { archived: true, archivedAt: at(2026, 11, 2, 10) }), NOW)).toBe('Archived Nov 2.');
    expect(archivedWord(thread('a', { archived: true, archivedAt: at(2026, 11, 13, 10) }), NOW)).toBe('Archived yesterday.');
    expect(archivedWord(thread('a', { archived: true, archivedAt: at(2026, 11, 14, 10) }), NOW)).toBe('Archived at 10:00 am.');
    expect(archivedWord(thread('a', { archived: true, archivedAt: NOW / 1000 - 5 }), NOW)).toBe('Archived just now.');
    expect(archivedWord(thread('a', { archived: true }), NOW)).toBe('');
  });
});

describe('when a wait gives up', () => {
  it('counts working days to 5:00 pm, skipping Saturday and Sunday', () => {
    // From a Saturday: Monday is the next working day, Tuesday the second.
    expect(workingDays(1, NOW)).toBe(at(2026, 11, 16, 17));
    expect(workingDays(2, NOW)).toBe(at(2026, 11, 17, 17));
    // From a Thursday: Friday, then Monday.
    const thursday = new Date(2026, 10, 12, 10, 0).getTime();
    expect(workingDays(1, thursday)).toBe(at(2026, 11, 13, 17));
    expect(workingDays(2, thursday)).toBe(at(2026, 11, 16, 17));
    // Never today, even early in the morning.
    expect(workingDays(0, new Date(2026, 10, 12, 6, 0).getTime())).toBe(at(2026, 11, 13, 17));
    expect(defaultGiveUp(NOW)).toBe(at(2026, 11, 17, 17));
  });

  it('offers the phone’s three times, each with the time it means', () => {
    expect(giveUpChoices(NOW)).toEqual([
      { label: 'Next working day', until: at(2026, 11, 16, 17), hint: 'Mon 5:00 pm' },
      { label: 'Two working days', until: at(2026, 11, 17, 17), hint: 'Tue 5:00 pm' },
      { label: 'A week', until: at(2026, 11, 21, 17), hint: 'Nov 21 5:00 pm' },
    ]);
  });
});

describe('what is put away, in the list', () => {
  const threads = [
    thread('a'),
    thread('late', { snoozed: at(2026, 11, 20, 17), wait: wait({ expires: at(2026, 11, 20, 17) }) }),
    thread('nap', { snoozed: at(2026, 11, 15, 9) }),
    thread('soon', { snoozed: at(2026, 11, 16, 17), wait: wait({ state: 'finding', expires: null }) }),
    thread('gone', { archived: true, archivedAt: at(2026, 11, 12, 10) }),
  ];

  it('keeps the threads waiting on a reply apart from the ones snoozed to a time, the soonest first', () => {
    const view = listView(threads);
    expect(ids(view.waiting)).toEqual(['soon', 'late']);
    expect(ids(view.snoozed)).toEqual(['nap']);
    expect(view.groups.flatMap((group) => ids(group.threads))).toEqual(['a']);
  });

  it('walks only the lines that are open', () => {
    expect(shownOrder(threads, { waiting: false, snoozed: false })).toEqual(['a']);
    expect(shownOrder(threads, { waiting: true, snoozed: false })).toEqual(['a', 'soon', 'late']);
    expect(shownOrder(threads, { waiting: false, snoozed: true })).toEqual(['a', 'nap']);
    expect(shownOrder(threads, { waiting: true, snoozed: true })).toEqual(['a', 'soon', 'late', 'nap']);
  });

  it('says on the row who replied, or that nobody did, once the thread is back and until he opens it', () => {
    const back = thread('a', { woke: at(2026, 11, 14, 15, 0), last: 'Sam: 12 mm is fine', wait: wait({ state: 'met', reply: 'Sam: 12 mm is fine' }) });
    expect(rowLine(back)).toEqual({ kind: 'back', text: 'Sam replied: 12 mm is fine', under: '' });
    expect(rowLine({ ...back, wait: wait({ state: 'expired' }) })).toEqual({ kind: 'back', text: 'No reply from Sam.', under: '' });
    // Opened (`woke` cleared), at work, or asking him something: the row says that instead.
    expect(rowLine({ ...back, woke: null }).kind).toBe('plain');
    expect(rowLine({ ...back, status: 'working', activity: 'Reading' }).kind).toBe('live');
    // Still waiting: the list keeps it behind its line, and the row keeps its last line.
    expect(rowLine({ ...back, woke: null, snoozed: at(2026, 11, 17, 17), wait: wait() }).kind).toBe('plain');
  });
});
