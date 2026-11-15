import * as React from 'react';
import { ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AutoDigest, AutoDigestEntry } from '@/types/auto';
import { Button, IconButton } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { Markdown, MarkdownLinksContext } from '../markdown/Markdown';
import {
  draftLabel,
  emptyQueue,
  queueCounts,
  queueSections,
  rowTitle,
  stepDay,
  dayTitle,
  wordsKey,
  type QueueFilter,
  type QueueSection,
} from '../model/digestModel';
import { useAutoStore } from '../store/autoStore';
import { selectDay, useDigestStore } from '../store/digestStore';
import { useThreadStore } from '../store/threadStore';

const quiet = 'text-control text-foreground-tertiary';
const field =
  'min-w-0 flex-1 resize-none bg-transparent text-reply text-foreground outline-none placeholder:text-icon';

/** Grows a text area with its words, to a part of the window's height. */
function useGrow(element: React.RefObject<HTMLTextAreaElement>, text: string): void {
  React.useLayoutEffect(() => {
    const area = element.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, Math.round(window.innerHeight * 0.3))}px`;
  }, [element, text]);
}

/** His note on an entry: a field, and one button once what is typed differs from what is saved. */
function NoteField({ entry }: { entry: AutoDigestEntry }) {
  const [typed, setTyped] = React.useState(entry.note);
  const [saving, setSaving] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);
  useGrow(area, typed);
  // The saved note changed somewhere else while this one was not being edited.
  const saved = React.useRef(entry.note);
  React.useEffect(() => {
    if (saved.current !== entry.note) {
      setTyped((current) => (current.trim() === saved.current ? entry.note : current));
      saved.current = entry.note;
    }
  }, [entry.note]);
  const changed = typed.trim() !== entry.note;
  return (
    <div className="flex flex-col items-start gap-2">
      <div className={cn('flex w-full border-l-2 pl-3', typed.trim() ? 'border-foreground' : 'border-border-strong')}>
        <textarea
          ref={area}
          rows={1}
          aria-label="Your note"
          placeholder="Add a note"
          maxLength={4000}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className={field}
        />
      </div>
      {changed ? (
        <Button
          size="compact"
          variant="outline"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void useDigestStore.getState().setNote(entry.id, typed).then((took) => {
              setSaving(false);
              if (took) setTyped(typed.trim());
            });
          }}
        >
          {typed.trim() ? 'Save the note' : 'Remove the note'}
        </Button>
      ) : null}
    </div>
  );
}

/** A reply drafted for the entry: its words, to copy and paste somewhere himself. Nothing here sends them. */
function DraftedReply({ entry }: { entry: AutoDigestEntry }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  if (!entry.draft) return null;
  const paste = entry.draft.paste;
  return (
    <div data-testid="auto-entry-draft" className="flex flex-col items-start gap-2">
      <p className={quiet}>{draftLabel(entry)}</p>
      <div className="auto-md-block w-full" data-paste>
        <pre className="text-reply text-foreground">{paste}</pre>
      </div>
      <Button
        size="compact"
        variant="outline"
        onClick={() => {
          void navigator.clipboard?.writeText(paste);
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** The box under an open entry. Enter starts a thread with the entry and these words, and opens it. */
function EntryBox({ entry, date }: { entry: AutoDigestEntry; date: string }) {
  const key = wordsKey(date, entry.id);
  const words = useDigestStore((state) => state.words[key] ?? '');
  const notSent = useDigestStore((state) => state.notSent === key);
  const [sending, setSending] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);
  useGrow(area, words);
  const submit = () => {
    if (!words.trim() || sending) return;
    setSending(true);
    void useDigestStore.getState().say(entry.id, words).then(() => setSending(false));
  };
  return (
    <div>
      {notSent ? <p role="status" data-testid="auto-entry-not-sent" className="mb-1 text-control font-medium text-foreground">Not sent</p> : null}
      <form
        className="flex items-end gap-2 rounded-card border border-border-strong bg-surface py-1.5 pl-3 pr-1.5 focus-within:border-foreground-tertiary"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={area}
          rows={1}
          aria-label="What to do with it"
          data-testid="auto-entry-box"
          placeholder="Say what to do with it"
          value={words}
          onChange={(event) => useDigestStore.getState().setWords(entry.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className={cn(field, 'my-1')}
        />
        <IconButton type="submit" label="Start a thread with it" variant="subtle" disabled={!words.trim() || sending}>
          <ArrowUp aria-hidden className="h-4 w-4" />
        </IconButton>
      </form>
    </div>
  );
}

// A small bar at the row's corner. Hidden by opacity, so it keeps its place; it stays while the row is open.
const rowActions =
  'absolute right-1 top-1 flex items-center gap-0.5 rounded-control border border-border-subtle bg-surface-raised p-0.5 shadow-control';
const hiddenActions =
  'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100';

/** One entry: a row cut to three lines, which a click opens in place. */
function EntryRow({ entry, date, open }: { entry: AutoDigestEntry; date: string; open: boolean }) {
  const inList = useAutoStore((state) => entry.thread !== null && state.threads.some((thread) => thread.id === entry.thread));
  const { resolve, makeThread } = useDigestStore.getState();
  const title = rowTitle(entry);
  const resolved = entry.state === 'resolved';
  const toggle = () => useDigestStore.getState().open(open ? null : entry.id);
  // Whether the closed row cuts its words: a table or a code block then fades out at the cut.
  const clip = React.useRef<HTMLDivElement>(null);
  const [cut, setCut] = React.useState(false);
  React.useLayoutEffect(() => {
    const words = clip.current;
    setCut(!open && words !== null && words.scrollHeight > words.clientHeight + 1);
  }, [open, entry.md]);

  return (
    <li
      data-testid={`auto-entry-${entry.id}`}
      data-state={entry.state}
      data-open={open || undefined}
      className={cn('group relative rounded-row transition-hover', open ? 'bg-surface-sunken' : 'hover:bg-surface-hover')}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-auto-entry
        onClick={(event) => {
          // A link in the entry's words is followed, and selected words stay selected.
          if ((event.target as HTMLElement).closest('a, [role="link"], button') || window.getSelection()?.toString()) return;
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          toggle();
        }}
        className={cn('cursor-default rounded-row px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', resolved && !open && 'opacity-60')}
      >
        {title || entry.priority ? (
          <p className="text-reply font-medium text-foreground">
            {entry.priority ? <span className="font-normal text-foreground-tertiary">{entry.priority} </span> : null}
            {title}
          </p>
        ) : null}
        {entry.md ? (
          <div ref={clip} data-cut={cut || undefined} className={cn(title && 'mt-0.5', !open && 'auto-clip')}>
            <Markdown text={entry.md} className={title ? 'text-foreground-secondary' : 'text-foreground'} />
          </div>
        ) : null}
        {!open && entry.note ? (
          <p data-testid="auto-entry-note" className="mt-1.5 line-clamp-2 border-l-2 border-foreground pl-3 text-reply text-foreground">{entry.note}</p>
        ) : null}
        {resolved ? <p className={cn(quiet, 'mt-1')}>Resolved</p> : entry.state === 'thread' ? <p className={cn(quiet, 'mt-1')}>A thread</p> : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-4 px-3 pb-3 pt-1">
          <NoteField entry={entry} />
          <DraftedReply entry={entry} />
          {entry.state === 'open' ? <EntryBox entry={entry} date={date} /> : null}
        </div>
      ) : null}

      <div className={cn(rowActions, !open && hiddenActions)}>
        {resolved ? (
          <Button size="compact" variant="ghost" onClick={() => void resolve([entry.id], false)}>Reopen</Button>
        ) : entry.state === 'thread' ? (
          <>
            {inList && entry.thread ? (
              <Button size="compact" variant="ghost" onClick={() => useThreadStore.getState().open(entry.thread)}>Open the thread</Button>
            ) : null}
            <Button size="compact" variant="ghost" onClick={() => void resolve([entry.id], true)}>Resolve</Button>
          </>
        ) : (
          <>
            <Button size="compact" variant="ghost" onClick={() => void resolve([entry.id], true)}>Resolve</Button>
            <Button size="compact" variant="ghost" onClick={() => void makeThread(entry.id)}>Thread</Button>
          </>
        )}
      </div>
    </li>
  );
}

function SectionRows({ section, date, opened }: { section: QueueSection; date: string; opened: string | null }) {
  const { resolve } = useDigestStore.getState();
  return (
    <section aria-label={section.title || 'Digest'} data-testid="auto-queue-section">
      <div className="flex min-h-control items-center gap-2 px-3 pt-3">
        <h2 className="min-w-0 flex-1 truncate text-label text-foreground-tertiary">{section.title || 'Digest'}</h2>
        {section.resolveAll.length > 0 ? (
          <Button size="compact" variant="ghost" className="text-control text-foreground-tertiary" onClick={() => void resolve(section.resolveAll, true)}>
            Resolve all
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5">
        {section.entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} date={date} open={opened === entry.id} />
        ))}
      </ul>
    </section>
  );
}

function FilterWord({ label, count, filter, on }: { label: string; count: number; filter: QueueFilter; on: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={`auto-queue-${filter}`}
      onClick={() => useDigestStore.getState().setFilter(filter)}
      className={cn(
        'flex h-control-compact items-center gap-1.5 rounded-control px-2 text-ui outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus',
        on ? 'font-medium text-foreground' : 'text-foreground-tertiary'
      )}
    >
      {label}
      <span className="text-metadata font-normal tabular-nums text-foreground-tertiary">{count}</span>
    </button>
  );
}

function Queue({ day }: { day: AutoDigest }) {
  const filter = useDigestStore((state) => state.filter);
  const opened = useDigestStore((state) => state.opened);
  const sections = queueSections(day, filter);
  const empty = emptyQueue(day, filter);
  if (empty) {
    return (
      <div data-testid="auto-queue-empty" className="flex flex-col items-start gap-3 px-3 py-6">
        <p className="text-ui text-foreground-secondary">{empty.text}</p>
        {empty.showAll !== null ? (
          <Button size="compact" variant="outline" onClick={() => useDigestStore.getState().setFilter('all')}>
            Show all {empty.showAll}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {sections.map((section, at) => (
        <SectionRows key={`${at}:${section.title}`} section={section} date={day.date} opened={opened} />
      ))}
    </>
  );
}

/**
 * The digest as a queue, beside the list where a thread would be. Every
 * entry can be resolved, made a thread, noted, or answered with words that
 * start a thread. Nothing here sends anything to anyone.
 */
export function QueuePane({ narrow }: { narrow: boolean }) {
  const day = useDigestStore(selectDay);
  const status = useDigestStore((state) => state.status);
  const days = useDigestStore((state) => state.days);
  const filter = useDigestStore((state) => state.filter);
  const { openVault } = React.useContext(MarkdownLinksContext);
  const [scrolled, setScrolled] = React.useState(false);
  const { step } = useDigestStore.getState();
  const older = day ? stepDay(day.date, days, true) : null;
  const newer = day ? stepDay(day.date, days, false) : null;
  const counts = day ? queueCounts(day) : null;

  return (
    <section data-testid="auto-queue-pane" aria-label="Digest" className="flex min-w-0 flex-1 flex-col">
      <header className={cn('auto-beside-talk shrink-0 border-b pl-6', scrolled ? 'border-border-subtle' : 'border-transparent')}>
        <div className="flex h-header items-center gap-1">
          {narrow ? (
            <IconButton label="All threads" data-testid="auto-back" className="-ml-2" onClick={() => useThreadStore.getState().open(null)}>
              <ChevronLeft aria-hidden className="h-4 w-4" />
            </IconButton>
          ) : null}
          <h1 data-testid="auto-queue-day" className="mr-1 min-w-0 truncate text-ui font-medium text-foreground">{day ? dayTitle(day.date) : 'Digest'}</h1>
          {day ? (
            <>
              <IconButton label="Earlier day" disabled={!older} onClick={() => void step(true)}>
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </IconButton>
              <IconButton label="Later day" disabled={!newer} onClick={() => void step(false)}>
                <ChevronRight aria-hidden className="h-4 w-4" />
              </IconButton>
              <Button size="compact" variant="ghost" className="ml-auto font-normal text-foreground-tertiary" onClick={() => openVault(day.path, false)}>
                Open the digest
              </Button>
            </>
          ) : null}
        </div>
        {counts ? (
          <div className="-ml-2 flex items-center gap-1 pb-1">
            <FilterWord label="Left" count={counts.left} filter="left" on={filter === 'left'} />
            <FilterWord label="All" count={counts.all} filter="all" on={filter === 'all'} />
          </div>
        ) : null}
      </header>
      <div
        data-testid="auto-queue"
        className="auto-talk min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        <div className="mx-auto flex max-w-reading flex-col px-3 pb-6">
          {day ? (
            <Queue day={day} />
          ) : status === 'none' ? (
            <p data-testid="auto-queue-empty" className="px-3 py-6 text-ui text-foreground-secondary">No digest yet.</p>
          ) : status === 'unknown' ? (
            <p role="status" className="px-3 py-6 text-ui text-foreground-tertiary">Loading…</p>
          ) : (
            <div data-testid="auto-queue-failed" className="flex flex-col items-start gap-3 px-3 py-6">
              <p className="text-ui text-foreground-secondary">{"Can't read the digest."}</p>
              <Button size="compact" variant="outline" onClick={() => void useDigestStore.getState().refresh()}>Retry</Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
