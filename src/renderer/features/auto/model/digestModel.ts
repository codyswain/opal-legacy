import type { AutoDigest, AutoDigestEntry } from '@/types/auto';

/*
 * A day's digest as a queue. "Left" holds the entries he has not dealt with;
 * "All" shows the day whole, with what became of each.
 */

export type QueueFilter = 'left' | 'all';

export interface QueueSection {
  title: string;
  /** The entries the filter shows. */
  entries: AutoDigestEntry[];
  /** What "Resolve all" resolves, whichever filter is on; empty where it is not offered. */
  resolveAll: string[];
}

export const allEntries = (digest: AutoDigest): AutoDigestEntry[] => digest.sections.flatMap((section) => section.entries);

/**
 * The sections in the file's order. A section with nothing to show under the
 * filter is left out. A section of reading with more than one entry left can
 * be cleared in one go; one that holds to-dos cannot, since each of those is
 * a thing to do.
 */
export function queueSections(digest: AutoDigest, filter: QueueFilter): QueueSection[] {
  return digest.sections.flatMap((section) => {
    const open = section.entries.filter((entry) => entry.state === 'open');
    const entries = filter === 'left' ? open : section.entries;
    const reading = !section.entries.some((entry) => entry.kind === 'item');
    const resolveAll = reading && open.length > 1 ? open.map((entry) => entry.id) : [];
    return entries.length > 0 ? [{ title: section.title, entries, resolveAll }] : [];
  });
}

/** The counts beside "Left" and "All". */
export function queueCounts(digest: AutoDigest): { left: number; all: number } {
  return { left: digest.left, all: allEntries(digest).length };
}

/** What the list's Digest row says at its right: how much is left, or that it is done. */
export function leftWord(digest: AutoDigest | null): string {
  if (!digest) return '';
  return digest.left === 0 ? 'Done' : `${digest.left} left`;
}

/** A day written out: "Saturday, November 14". */
export function dayTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const written = new Date(year, month - 1, day);
  if (Number.isNaN(written.getTime())) return date;
  return written.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** The day before or after `date` among the days that have a digest (newest first), or null at either end. */
export function stepDay(date: string, days: readonly string[], older: boolean): string | null {
  const sorted = [...new Set(days)].sort().reverse();
  const at = sorted.indexOf(date);
  if (at === -1) {
    // A day the list does not name: the nearest one on the side asked for.
    const beyond = older ? sorted.find((day) => day < date) : [...sorted].reverse().find((day) => day > date);
    return beyond ?? null;
  }
  return sorted[older ? at + 1 : at - 1] ?? null;
}

/** What the queue says when it has no row to show. */
export interface EmptyQueue {
  text: string;
  /** The count for "Show all N", when there is something to show under All. */
  showAll: number | null;
}

export function emptyQueue(digest: AutoDigest, filter: QueueFilter): EmptyQueue | null {
  const all = allEntries(digest).length;
  if (all === 0) return { text: 'This digest has no entries.', showAll: null };
  if (filter === 'left' && !allEntries(digest).some((entry) => entry.state === 'open')) {
    return { text: 'Nothing left in this digest.', showAll: all };
  }
  return null;
}

/** A piece of Markdown as its words alone: links by their text, and no marks. */
const plain = (text: string): string =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const plainWords = (text: string): string => plain(text).toLowerCase();

/** How far into an entry's first line its title may start: a meeting's line opens with its time. */
const TITLE_WITHIN = 12;

/**
 * The title to show above an entry's words, or null when they say it
 * already. A table is named by its section, which the label above it says.
 * A meeting, a person and a line of text open with their title in bold, so
 * the words alone read as title and detail; a to-do's words are its detail
 * only, and its title goes above them.
 */
export function rowTitle(entry: AutoDigestEntry): string | null {
  if (!entry.title || entry.title === entry.section) return null;
  const title = plainWords(entry.title);
  const first = plainWords(entry.md.split('\n', 1)[0] ?? '');
  if (title && first.slice(0, title.length + TITLE_WITHIN).includes(title)) return null;
  return entry.title;
}

/** The label above a drafted reply. */
export function draftLabel(entry: AutoDigestEntry): string {
  return entry.draft?.title ? `Reply drafted for ${entry.draft.title}` : 'Reply drafted';
}

/** The key his unsent words for an entry are kept under. */
export const wordsKey = (date: string, id: string): string => `${date}/${id}`;

/** A line of an entry as its words: no list mark, box, heading or quote mark; a table's row as its cells; a rule or a fence as nothing. */
function lineWords(line: string): string {
  const trimmed = line.trim();
  if (/^(`{3,}|~{3,})/.test(trimmed) || /^\|?[\s:|-]*-[\s:|-]*\|?$/.test(trimmed)) return '';
  const cells = /^\|(.*)\|$/.exec(trimmed);
  if (cells) return cells[1].split('|').map(plain).filter(Boolean).join(', ');
  return plain(trimmed.replace(/^(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+(?:\[[ xX]\]\s+)?)?/, ''));
}

/** A closed entry's row: a title line, then its words in the quiet colour, cut to two lines by the page. */
export interface ClosedRow {
  /** The entry's own title, or null: its words then read as the entry itself. */
  title: string | null;
  /** A meeting's time, set at the row's right. */
  time: string;
  /** Its words without their marks, and without the title they open with; each line of the entry on a line. */
  words: string;
}

export function closedRow(entry: AutoDigestEntry): ClosedRow {
  const lines = entry.md.split('\n').map(lineWords);
  const titled = entry.title !== '' && entry.title !== entry.section;
  let time = '';
  const first = lines.findIndex((line) => line !== '');
  if (titled && first !== -1) {
    // A meeting, a person and a line of text open with their title: it is said once, on the title line.
    const title = plain(entry.title);
    const at = lines[first].toLowerCase().indexOf(title.toLowerCase());
    if (title && at !== -1 && at <= TITLE_WITHIN) {
      const before = lines[first].slice(0, at).trim();
      const after = lines[first].slice(at + title.length).replace(/^[\s:.,;]+/, '');
      if (entry.kind === 'meeting' && /^\d{1,2}[:.]\d{2}(?:\s?[ap]m)?$/i.test(before)) {
        time = before;
        lines[first] = after;
      } else {
        lines[first] = [before, after].filter(Boolean).join(' ');
      }
    }
  }
  return { title: titled ? entry.title : null, time, words: lines.filter(Boolean).join('\n') };
}

/** The second line of the list's Digest row: the day, how many entries it has and how many are resolved. */
export function homeLine(digest: AutoDigest): string {
  const all = allEntries(digest);
  const resolved = all.filter((entry) => entry.state === 'resolved').length;
  const [year, month, day] = digest.date.split('-').map(Number);
  const written = new Date(year, month - 1, day);
  const short = Number.isNaN(written.getTime())
    ? digest.date
    : written.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  return `${short}. ${all.length === 1 ? '1 entry' : `${all.length} entries`}, ${resolved} resolved.`;
}

/** The entries' ids in the order the queue shows them. */
export const queueOrder = (sections: readonly QueueSection[]): string[] => sections.flatMap((section) => section.entries.map((entry) => entry.id));

/**
 * The entry that takes the keyboard focus when some leave the queue: the
 * first one left after the last of them, else the last one before the first
 * of them, else none.
 */
export function afterLeaving(order: readonly string[], leaving: readonly string[]): string | null {
  const gone = new Set(leaving);
  const places = order.map((id, at) => (gone.has(id) ? at : -1)).filter((at) => at !== -1);
  if (places.length === 0) return null;
  const after = order.slice(places[places.length - 1] + 1).find((id) => !gone.has(id));
  if (after) return after;
  return order.slice(0, places[0]).reverse().find((id) => !gone.has(id)) ?? null;
}

/** A day with some entries' state changed and what is left counted again, as it shows before the service answers. */
export function withState(digest: AutoDigest, ids: readonly string[], state: (entry: AutoDigestEntry) => AutoDigestEntry['state']): AutoDigest {
  const sections = digest.sections.map((section) => ({
    ...section,
    entries: section.entries.map((entry) => (ids.includes(entry.id) ? { ...entry, state: state(entry) } : entry)),
  }));
  return { ...digest, sections, left: sections.reduce((sum, section) => sum + section.entries.filter((entry) => entry.state === 'open').length, 0) };
}

/** What an entry is called in a line about it: its title, else its first words. */
export function entryName(entry: AutoDigestEntry): string {
  const row = closedRow(entry);
  const name = row.title ?? row.words.split('\n')[0] ?? '';
  return name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
}
