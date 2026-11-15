import { describe, expect, it } from 'vitest';
import {
  allEntries,
  dayTitle,
  draftLabel,
  emptyQueue,
  leftWord,
  queueCounts,
  queueSections,
  rowTitle,
  stepDay,
  wordsKey,
} from '@/renderer/features/auto/model/digestModel';
import { autoDigest, digestEntry } from '@/tests/helpers/autoApi';

const DAY = autoDigest('2026-11-13', [
  ['Meetings', [digestEntry('meeting-committee', { kind: 'meeting', title: 'Committee' })]],
  ['Top 3', [
    digestEntry('item-1', { kind: 'item', title: 'Order the trays', draft: { title: 'Garden centre', paste: 'Two trays, please.' } }),
    digestEntry('item-2', { kind: 'item', title: 'Book the inspection', priority: 'High', state: 'thread', thread: 'inspect' }),
  ]],
  ['Plots', [digestEntry('text-plots', { title: 'Plots', md: '| Plot | Bed |\n| --- | --- |\n| 4 | 2 |' })]],
  ['Yesterday', [
    digestEntry('text-a', { state: 'resolved' }),
    digestEntry('text-b'),
    digestEntry('text-c'),
  ]],
  ['Done', [digestEntry('text-d', { state: 'resolved' })]],
]);
const ids = (sections: ReturnType<typeof queueSections>) => sections.map((section) => [section.title, section.entries.map((entry) => entry.id)]);

describe('the queue of a day', () => {
  it('shows under Left the open entries, in the file’s order, and leaves out a section with none', () => {
    expect(ids(queueSections(DAY, 'left'))).toEqual([
      ['Meetings', ['meeting-committee']],
      ['Top 3', ['item-1']],
      ['Plots', ['text-plots']],
      ['Yesterday', ['text-b', 'text-c']],
    ]);
  });

  it('shows the day whole under All', () => {
    expect(ids(queueSections(DAY, 'all'))).toEqual([
      ['Meetings', ['meeting-committee']],
      ['Top 3', ['item-1', 'item-2']],
      ['Plots', ['text-plots']],
      ['Yesterday', ['text-a', 'text-b', 'text-c']],
      ['Done', ['text-d']],
    ]);
    expect(allEntries(DAY)).toHaveLength(8);
  });

  it('offers Resolve all for a section of reading with more than one entry left, whichever filter is on', () => {
    for (const filter of ['left', 'all'] as const) {
      const yesterday = queueSections(DAY, filter).find((section) => section.title === 'Yesterday');
      expect(yesterday?.resolveAll).toEqual(['text-b', 'text-c']);
    }
  });

  it('offers none for one entry left, for none, or for a section that holds to-dos', () => {
    const all = queueSections(DAY, 'all');
    expect(all.find((section) => section.title === 'Meetings')?.resolveAll).toEqual([]);
    expect(all.find((section) => section.title === 'Done')?.resolveAll).toEqual([]);
    const todos = autoDigest('2026-11-13', [['Top 3', [digestEntry('item-1', { kind: 'item' }), digestEntry('item-2', { kind: 'item' }), digestEntry('text-x')]]]);
    expect(queueSections(todos, 'left')[0].resolveAll).toEqual([]);
  });

  it('counts what is left as the service says, and all the entries', () => {
    expect(queueCounts(DAY)).toEqual({ left: 5, all: 8 });
    expect(queueCounts({ ...DAY, left: 3 })).toEqual({ left: 3, all: 8 });
  });

  it('says on the list’s row how much is left, Done at none, and nothing with no digest', () => {
    expect(leftWord(DAY)).toBe('5 left');
    expect(leftWord({ ...DAY, left: 1 })).toBe('1 left');
    expect(leftWord({ ...DAY, left: 0 })).toBe('Done');
    expect(leftWord(null)).toBe('');
  });
});

describe('the empty queue', () => {
  const done = autoDigest('2026-11-13', [['Yesterday', [digestEntry('a', { state: 'resolved' }), digestEntry('b', { state: 'thread', thread: 't1' })]]]);

  it('says nothing while a row shows', () => {
    expect(emptyQueue(DAY, 'left')).toBeNull();
    expect(emptyQueue(DAY, 'all')).toBeNull();
    expect(emptyQueue(done, 'all')).toBeNull();
  });

  it('says Nothing left with the count for Show all, when every entry is dealt with', () => {
    expect(emptyQueue(done, 'left')).toEqual({ text: 'Nothing left in this digest.', showAll: 2 });
  });

  it('says a digest has no entries, under either word', () => {
    const bare = autoDigest('2026-11-11', []);
    expect(emptyQueue(bare, 'left')).toEqual({ text: 'This digest has no entries.', showAll: null });
    expect(emptyQueue(bare, 'all')).toEqual({ text: 'This digest has no entries.', showAll: null });
  });
});

describe('the days', () => {
  const days = ['2026-11-13', '2026-11-12', '2026-11-10'];

  it('writes a day out', () => {
    expect(dayTitle('2026-11-14')).toBe('Saturday, November 14');
    expect(dayTitle('2026-11-13')).toBe('Friday, November 13');
    expect(dayTitle('2026-01-01')).toBe('Thursday, January 1');
  });

  it('steps to the earlier and the later day that has a digest, and stops at either end', () => {
    expect(stepDay('2026-11-13', days, true)).toBe('2026-11-12');
    expect(stepDay('2026-11-12', days, true)).toBe('2026-11-10');
    expect(stepDay('2026-11-10', days, true)).toBeNull();
    expect(stepDay('2026-11-10', days, false)).toBe('2026-11-12');
    expect(stepDay('2026-11-13', days, false)).toBeNull();
  });

  it('reads the days in any order, once each', () => {
    expect(stepDay('2026-11-12', ['2026-11-10', '2026-11-13', '2026-11-12', '2026-11-12'], true)).toBe('2026-11-10');
    expect(stepDay('2026-11-12', ['2026-11-10', '2026-11-13', '2026-11-12', '2026-11-12'], false)).toBe('2026-11-13');
  });

  it('steps from a day the list does not name to the nearest one on that side', () => {
    expect(stepDay('2026-11-11', days, true)).toBe('2026-11-10');
    expect(stepDay('2026-11-11', days, false)).toBe('2026-11-12');
    expect(stepDay('2026-11-09', days, true)).toBeNull();
    expect(stepDay('2026-11-14', days, false)).toBeNull();
    expect(stepDay('2026-11-13', [], true)).toBeNull();
  });
});

describe('an entry', () => {
  it('shows a to-do’s title above its detail, and none when the title only repeats the section', () => {
    expect(rowTitle(allEntries(DAY)[1])).toBe('Order the trays');
    expect(rowTitle(allEntries(DAY)[3])).toBeNull();
    expect(rowTitle(digestEntry('x'))).toBeNull();
  });

  it('shows no title above words that already open with it', () => {
    const meeting = digestEntry('m', { kind: 'meeting', title: 'Allotment committee', md: '**10:00 [Allotment committee](https://example.com/meet)** (in the hall)\n- Agree the date' });
    const person = digestEntry('p', { kind: 'person', title: 'Robin (seed swap)', md: '**Robin (seed swap):** quiet since the spring list.' });
    const line = digestEntry('t', { title: 'Ready to plant', md: '**Ready to plant.** The seedlings have four leaves.' });
    const draft = digestEntry('d', { kind: 'draft', title: 'Garden club', md: '**Garden club**, newsletter, email.' });
    const linked = digestEntry('w', { title: 'Seed list', md: 'The [[Projects/Seeds|seed list]] is ready.' });
    for (const entry of [meeting, person, line, draft, linked]) expect(rowTitle(entry)).toBeNull();
    // The title further into the line, or on a later line, is not its opening.
    expect(rowTitle(digestEntry('f', { title: 'The shed', md: 'Somebody should look at the roof of the shed.' }))).toBe('The shed');
    expect(rowTitle(digestEntry('l', { title: 'The shed', md: 'Notes.\n\n**The shed** leaks.' }))).toBe('The shed');
  });

  it('labels a drafted reply with who it is for, when the service says', () => {
    expect(draftLabel(allEntries(DAY)[1])).toBe('Reply drafted for Garden centre');
    expect(draftLabel(digestEntry('x', { draft: { title: '', paste: 'Words' } }))).toBe('Reply drafted');
    expect(draftLabel(digestEntry('x'))).toBe('Reply drafted');
  });

  it('keeps his unsent words under the day and the entry', () => {
    expect(wordsKey('2026-11-13', 'item-1')).toBe('2026-11-13/item-1');
    expect(wordsKey('2026-11-12', 'item-1')).not.toBe(wordsKey('2026-11-13', 'item-1'));
  });
});
