import * as React from 'react';
import { ArrowUp, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import type { AutoDigest, AutoDigestEntry } from '@/types/auto';
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { Markdown, MarkdownLinksContext } from '../markdown/Markdown';
import {
  closedRow,
  dayTitle,
  draftLabel,
  emptyQueue,
  queueCounts,
  queueSections,
  rowTitle,
  stepDay,
  wordsKey,
  type QueueFilter,
  type QueueSection,
} from '../model/digestModel';
import { DIGEST_QUEUE } from '../model/pane';
import { keepPlace, placeIn, placeOf, queuePlace } from '../model/places';
import { useAutoStore } from '../store/autoStore';
import { QUEUE_FIRST, QUEUE_TOP, selectDay, useDigestStore } from '../store/digestStore';
import { useThreadStore } from '../store/threadStore';
import { focusRowNow, keepFocus, rovingTarget } from './focus';
import { ThreadLine } from './ThreadLine';
import { useGrow } from './ThreadPane';

const quiet = 'text-control text-foreground-tertiary';
const field =
  'min-w-0 flex-1 resize-none bg-transparent text-reply text-foreground outline-none placeholder:text-icon';

/** Under this width of pane the actions go on a line under an entry's words, instead of in a column at its right. */
const ROOMY_WIDTH = 520;

/** The entry's own row in the page. */
const entryElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="auto-queue"] [data-entry-id="${id.replace(/["\\]/g, '')}"]`);

/** Escape in a field of an open entry: the keyboard goes back to the entry's row. */
const backToRow = (event: React.KeyboardEvent, id: string) => {
  if (event.key !== 'Escape' || event.nativeEvent.isComposing) return false;
  event.preventDefault();
  event.stopPropagation();
  entryElement(id)?.focus();
  return true;
};

/** His note on an entry: a field, and one button once what is typed differs from what is saved. Cmd+Enter saves it too. */
function NoteField({ entry }: { entry: AutoDigestEntry }) {
  const [typed, setTyped] = React.useState(entry.note);
  const [saving, setSaving] = React.useState(false);
  const wanted = useDigestStore((state) => state.noteWanted === entry.id);
  const area = React.useRef<HTMLTextAreaElement>(null);
  useGrow(area, typed, 0.3);
  // The saved note changed somewhere else while this one was not being edited.
  const saved = React.useRef(entry.note);
  React.useEffect(() => {
    if (saved.current !== entry.note) {
      setTyped((current) => (current.trim() === saved.current ? entry.note : current));
      saved.current = entry.note;
    }
  }, [entry.note]);
  // `n` on the entry's row puts the caret here.
  React.useEffect(() => {
    if (!wanted) return;
    area.current?.focus();
    useDigestStore.setState({ noteWanted: null });
  }, [wanted]);
  const changed = typed.trim() !== entry.note;
  const save = (fromButton = false) => {
    if (!changed || saving) return;
    setSaving(true);
    void useDigestStore.getState().setNote(entry.id, typed).then((took) => {
      setSaving(false);
      if (took) setTyped(typed.trim());
      // The button goes once the note is saved: the keyboard goes to the entry it belongs to.
      if (took && fromButton) entryElement(entry.id)?.focus();
    });
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <div className={cn('flex w-full border-l-2 pl-3', typed.trim() ? 'border-foreground' : 'border-border-strong')}>
        <textarea
          ref={area}
          rows={1}
          aria-label="Your note"
          aria-keyshortcuts="Meta+Enter"
          placeholder="Add a note"
          maxLength={4000}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (backToRow(event, entry.id)) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            }
          }}
          className={field}
        />
      </div>
      {changed ? (
        <Button size="compact" variant="outline" disabled={saving} onClick={() => save(true)}>
          {typed.trim() ? 'Save the note' : 'Remove the note'}
          <span aria-hidden className="ml-1 font-mono text-metadata text-foreground-tertiary">⌘↩</span>
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

/**
 * The box under an open entry: the one way to make a thread of it. Enter
 * starts a thread with the entry and these words, and opens it. With no
 * words Enter does nothing, and "Make it without words" makes a thread that
 * waits in the list, not started. Nothing is made if he leaves the box.
 */
function EntryBox({ entry, date }: { entry: AutoDigestEntry; date: string }) {
  const key = wordsKey(date, entry.id);
  const words = useDigestStore((state) => state.words[key] ?? '');
  const notSent = useDigestStore((state) => state.notSent === key);
  const wanted = useDigestStore((state) => state.boxWanted === entry.id);
  const [sending, setSending] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);
  useGrow(area, words, 0.3);
  // "Thread" on the entry, or T on its row, puts the caret here.
  React.useEffect(() => {
    if (!wanted) return;
    area.current?.focus();
    useDigestStore.setState({ boxWanted: null });
  }, [wanted]);
  const submit = () => {
    if (!words.trim() || sending) return;
    setSending(true);
    void useDigestStore.getState().say(entry.id, words).then(() => setSending(false));
  };
  return (
    <div>
      {/* Enter was taken: his words leave the box and show on their way, until the thread opens. */}
      {sending ? (
        <div data-testid="auto-entry-pending" className="mb-2 ml-auto w-fit max-w-lg whitespace-pre-wrap break-words rounded-card bg-surface-active px-3 py-2 text-reply text-foreground opacity-60">
          {words.trim()}
        </div>
      ) : null}
      {notSent ? (
        <p role="status" data-testid="auto-entry-not-sent" className="mb-1 flex items-center gap-1 text-control font-medium text-foreground">
          Not sent
          <Button size="compact" variant="ghost" className="text-control" disabled={!words.trim() || sending} onClick={submit}>
            Retry
          </Button>
        </p>
      ) : null}
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
          aria-label="What you want done"
          data-testid="auto-entry-box"
          placeholder="Say what you want done"
          value={sending ? '' : words}
          readOnly={sending}
          onChange={(event) => useDigestStore.getState().setWords(entry.id, event.target.value)}
          onKeyDown={(event) => {
            if (backToRow(event, entry.id)) return;
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className={cn(field, 'my-1')}
        />
        <IconButton type="submit" label="Start a thread with it" shortcut="↩" variant="subtle" disabled={!words.trim() || sending}>
          <ArrowUp aria-hidden className="h-4 w-4" />
        </IconButton>
      </form>
      {/* The one-step thread, one step further in. It leaves once he has words. */}
      {!words.trim() && !sending ? (
        <Button
          size="compact"
          variant="ghost"
          data-testid="auto-entry-wordless"
          title="Puts it in the list, not started"
          className="-ml-2 mt-1 font-normal text-foreground-tertiary"
          onClick={() => void useDigestStore.getState().makeThread(entry.id)}
        >
          Make it without words
        </Button>
      ) : null}
    </div>
  );
}

/** A word on an entry's row, with its key in the tooltip. It is out of the Tab order: the row's keys do the same. */
function Act({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="compact" variant="ghost" tabIndex={-1} onMouseDown={keepFocus} onClick={onClick}>
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
        <span aria-hidden className="ml-2 font-mono text-metadata text-foreground-tertiary">{hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}

interface EntryProps {
  entry: AutoDigestEntry;
  date: string;
  open: boolean;
  /** This entry is the queue's one Tab stop. */
  tabStop: boolean;
  /** The pane has room for a column of actions at the row's right. */
  roomy: boolean;
}

/**
 * One entry. Closed, it is a title line and at most two quiet lines. A click
 * opens it in place to its whole text, his note, a drafted reply and a box.
 * "Thread" opens it with the caret in that box: a thread is made only once
 * he says what he wants done. One that became a thread shows that thread's
 * line, and opens the thread.
 */
function EntryRow({ entry, date, open, tabStop, roomy }: EntryProps) {
  const thread = useAutoStore((state) => (entry.thread === null ? undefined : state.threads.find((candidate) => candidate.id === entry.thread)));
  const { resolve, openBox } = useDigestStore.getState();
  const resolved = entry.state === 'resolved';
  const became = entry.state === 'thread';
  const row = closedRow(entry);
  const title = open ? rowTitle(entry) : row.title;

  /** Opens the entry in place, or the thread it became. */
  const activate = () => {
    if (became && thread) useThreadStore.getState().open(thread.id);
    else useDigestStore.getState().open(open ? null : entry.id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'enter' || key === ' ') activate();
    else if (key === 'e') void resolve([entry.id], !resolved);
    // A thread starts with his words: T opens the entry with the caret in its box, and makes nothing yet.
    else if (key === 't' && entry.state === 'open') openBox(entry.id);
    else if (key === 'n') useDigestStore.getState().openNote(entry.id);
    else if (key === 'escape' && open) useDigestStore.getState().open(null);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const actions = resolved ? (
    <Act label="Reopen" hint="E" onClick={() => void resolve([entry.id], false)} />
  ) : (
    <>
      <Act label="Resolve" hint="E" onClick={() => void resolve([entry.id], true)} />
      {became ? null : <Act label="Thread" hint="T" onClick={() => openBox(entry.id)} />}
    </>
  );
  // An entry that opens is brought into view whole, its box included: the last one would open under the fold.
  const item = React.useRef<HTMLLIElement>(null);
  React.useLayoutEffect(() => {
    if (open) item.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  // Shown while the pointer or the keyboard is on the row, or the entry is open; not left up by a click once the pointer has gone.
  const shows = open ? '' : 'group-hover:opacity-100 group-has-[[data-auto-entry]:focus-visible]:opacity-100';

  return (
    <li
      ref={item}
      data-testid={`auto-entry-${entry.id}`}
      data-state={entry.state}
      data-open={open || undefined}
      className={cn(
        // The keyboard's ring goes round the whole row, its actions included.
        // Brought into view, it keeps a little air from the pane's edge.
        'group relative -mx-3 scroll-my-3 rounded-row transition-hover has-[[data-auto-entry]:focus-visible]:ring-2 has-[[data-auto-entry]:focus-visible]:ring-inset has-[[data-auto-entry]:focus-visible]:ring-focus',
        open ? 'bg-surface-sunken' : 'hover:bg-surface-hover'
      )}
    >
      <div className="flex items-start">
        <div
          role="button"
          tabIndex={tabStop ? 0 : -1}
          aria-expanded={became && thread ? undefined : open}
          aria-keyshortcuts={`E N${entry.state === 'open' ? ' T' : ''}`}
          data-auto-entry
          data-entry-id={entry.id}
          onClick={(event) => {
            // A link in the entry's words is followed, and selected words stay selected.
            if ((event.target as HTMLElement).closest('a, [role="link"], button') || window.getSelection()?.toString()) return;
            activate();
          }}
          onKeyDown={onKeyDown}
          className={cn('min-w-0 flex-1 cursor-default rounded-row px-3 py-2 outline-none', resolved && !open && 'opacity-60')}
        >
          {title || entry.priority || row.time ? (
            <p className="flex items-baseline gap-2 text-reply font-medium text-foreground">
              <span className="min-w-0 flex-1">
                {entry.priority ? <span className="font-normal text-foreground-tertiary">{entry.priority} </span> : null}
                {title}
              </span>
              {/* Too narrow for the column at the right: the time ends the title line. */}
              {row.time && !open && !roomy ? <span className="shrink-0 text-metadata font-normal tabular-nums text-foreground-tertiary">{row.time}</span> : null}
            </p>
          ) : null}
          {open ? (
            entry.md ? (
              <div className={cn(title && 'mt-0.5')}>
                <Markdown text={entry.md} className={title ? 'text-foreground-secondary' : 'text-foreground'} />
              </div>
            ) : null
          ) : row.words ? (
            // With a title, at most two quiet lines at the smaller size. With none, its words are the entry itself.
            <p
              data-testid="auto-entry-words"
              className={cn('whitespace-pre-line break-words', row.title ? 'mt-0.5 line-clamp-2 text-ui text-foreground-tertiary' : 'line-clamp-3 text-reply text-foreground')}
            >
              {row.words}
            </p>
          ) : null}
          {!open && entry.note ? (
            <p data-testid="auto-entry-note" className="mt-1.5 line-clamp-2 border-l-2 border-foreground pl-3 text-ui text-foreground">{entry.note}</p>
          ) : null}
          {resolved ? (
            <p className={cn(quiet, 'mt-1')}>Resolved</p>
          ) : became ? (
            // Its words are above already: the thread's line is said bare, "Not started" for one nobody has started.
            thread ? <ThreadLine thread={thread} bare className="mt-1" /> : <p className={cn(quiet, 'mt-1')}>A thread</p>
          ) : null}
        </div>
        {/* A column of its own at the row's right, so the actions never sit on the words. */}
        {roomy ? (
          <div className="relative flex w-36 shrink-0 justify-end py-1.5 pr-1.5">
            {/* A meeting's time ends at the row's right edge, where "Resolve all" ends; the actions take its place while they show. */}
            {row.time && !open ? (
              <span data-testid="auto-entry-time" className={cn('absolute right-3 top-2.5 text-metadata tabular-nums text-foreground-tertiary', 'group-hover:invisible group-has-[[data-auto-entry]:focus-visible]:invisible')}>{row.time}</span>
            ) : null}
            <div className={cn('flex items-center gap-0.5 opacity-0', shows, open && 'opacity-100')}>{actions}</div>
          </div>
        ) : null}
      </div>

      {/* Too narrow for the column: a line under the words of the entry the pointer or the keyboard is on, or that is open. */}
      {roomy ? null : (
        <div className={cn('items-center gap-0.5 px-1.5 pb-1.5', open ? 'flex' : 'hidden group-hover:flex group-has-[[data-auto-entry]:focus-visible]:flex')}>{actions}</div>
      )}

      {open ? (
        <div className="flex flex-col gap-4 px-3 pb-3 pt-1">
          <NoteField entry={entry} />
          <DraftedReply entry={entry} />
          {entry.state === 'open' ? <EntryBox entry={entry} date={date} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function SectionRows({ section, date, opened, tabStop, roomy }: { section: QueueSection; date: string; opened: string | null; tabStop: string | null; roomy: boolean }) {
  const { resolve } = useDigestStore.getState();
  return (
    <section aria-label={section.title || 'Digest'} data-testid="auto-queue-section">
      <div className="flex min-h-control items-center gap-2 pt-3">
        <h2 className="min-w-0 flex-1 truncate text-label text-foreground-tertiary">{section.title || 'Digest'}</h2>
        {section.resolveAll.length > 0 ? (
          <Button size="compact" variant="ghost" className="-mr-2 text-control text-foreground-tertiary" onClick={() => void resolve(section.resolveAll, true, section.title)}>
            Resolve all
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-0.5">
        {section.entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} date={date} open={opened === entry.id} tabStop={tabStop === entry.id} roomy={roomy} />
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

function Queue({ day, roomy }: { day: AutoDigest; roomy: boolean }) {
  const filter = useDigestStore((state) => state.filter);
  const opened = useDigestStore((state) => state.opened);
  const [active, setActive] = React.useState<string | null>(null);
  const sections = queueSections(day, filter);
  const empty = emptyQueue(day, filter);
  if (empty) {
    return (
      <div data-testid="auto-queue-empty" className="flex flex-col items-start gap-3 py-6">
        <p className="text-ui text-foreground-secondary">{empty.text}</p>
        {empty.showAll !== null ? (
          <Button size="compact" variant="outline" onClick={() => useDigestStore.getState().setFilter('all')}>
            Show all {empty.showAll}
          </Button>
        ) : null}
        {/* Worked through, it can be put away: off the list until the next one. */}
        {filter === 'left' && !day.archived ? (
          <Button size="compact" variant="outline" data-testid="auto-digest-archive-done" onClick={() => void useDigestStore.getState().archive(day.date, true)}>
            Archive the digest
          </Button>
        ) : null}
      </div>
    );
  }
  // One entry is the queue's Tab stop: the one the keyboard was last on, else the open one, else the first.
  const ids = sections.flatMap((section) => section.entries.map((entry) => entry.id));
  const tabStop = active && ids.includes(active) ? active : opened && ids.includes(opened) ? opened : ids[0] ?? null;
  return (
    <div
      onFocus={(event) => {
        const id = (event.target as HTMLElement).getAttribute?.('data-entry-id');
        if (id) setActive(id);
      }}
    >
      {sections.map((section, at) => (
        <SectionRows key={`${at}:${section.title}`} section={section} date={day.date} opened={opened} tabStop={tabStop} roomy={roomy} />
      ))}
    </div>
  );
}

/**
 * The digest as a queue, beside the list where a thread would be. Every
 * entry can be resolved, made a thread, noted, or answered with words that
 * start a thread. Nothing here sends anything to anyone. Its header, its
 * section labels and its entries share the reading column's edges.
 */
export function QueuePane() {
  const day = useDigestStore(selectDay);
  const status = useDigestStore((state) => state.status);
  const days = useDigestStore((state) => state.days);
  const filter = useDigestStore((state) => state.filter);
  const focusEntry = useDigestStore((state) => state.focusEntry);
  const { openVault } = React.useContext(MarkdownLinksContext);
  const [scrolled, setScrolled] = React.useState(false);
  const [roomy, setRoomy] = React.useState(true);
  const pane = React.useRef<HTMLElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const { step } = useDigestStore.getState();
  const earlier = React.useRef<HTMLButtonElement>(null);
  const later = React.useRef<HTMLButtonElement>(null);
  /** Steps a day. At the last day that way its arrow goes dead, so the keyboard moves to the other one. */
  const stepTo = (back: boolean) => {
    const held = document.activeElement === (back ? earlier : later).current;
    void step(back).then(() => {
      const shown = selectDay(useDigestStore.getState());
      if (held && shown && stepDay(shown.date, useDigestStore.getState().days, back) === null) (back ? later : earlier).current?.focus();
    });
  };
  const older = day ? stepDay(day.date, days, true) : null;
  const newer = day ? stepDay(day.date, days, false) : null;
  const counts = day ? queueCounts(day) : null;
  const date = day?.date ?? null;

  React.useLayoutEffect(() => {
    const target = pane.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const measure = (width: number) => setRoomy(width === 0 || width >= ROOMY_WIDTH);
    measure(target.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => measure(entries[entries.length - 1].contentRect.width));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  // The queue opens with the keyboard on its first entry, as a thread opens with the caret in its box.
  React.useEffect(() => {
    useDigestStore.getState().requestFocus(QUEUE_FIRST);
  }, []);

  // An entry an action asked to focus takes the keyboard once it is drawn; with none left, the queue's first word does.
  React.useLayoutEffect(() => {
    if (!focusEntry) return;
    // Not read yet: the request waits for the day.
    if (focusEntry === QUEUE_FIRST && !day && status === 'unknown') return;
    const element =
      focusEntry === QUEUE_FIRST ? pane.current?.querySelector<HTMLElement>('[data-auto-entry][tabindex="0"]')
      : focusEntry === QUEUE_TOP ? null
      : entryElement(focusEntry);
    (element ?? pane.current?.querySelector<HTMLElement>('[data-testid="auto-queue-left"]'))?.focus();
    useDigestStore.getState().requestFocus(null);
  });

  // Each day is where he left it.
  const restored = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !date || restored.current === date) return;
    restored.current = date;
    element.scrollTop = placeOf(queuePlace(date))?.top ?? 0;
  }, [date]);

  /** Back to the sidebar, with the keyboard on the Digest row. */
  const back = () => focusRowNow(DIGEST_QUEUE);

  /** The queue's own keys, from anywhere in it but a field: [ and ] step a day, A switches between Left and All. */
  const onPaneKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !day) return;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.closest('[role="menu"]')) return;
    const key = event.key.toLowerCase();
    if (key === '[' || key === ']') {
      const back = key === '[';
      if (!(back ? older : newer)) return;
      event.preventDefault();
      // The keyboard goes to the day's first entry, as when the queue opens.
      void step(back).then(() => useDigestStore.getState().requestFocus(QUEUE_FIRST));
    } else if (key === 'a' && !event.shiftKey) {
      event.preventDefault();
      useDigestStore.getState().setFilter(filter === 'left' ? 'all' : 'left');
      useDigestStore.getState().requestFocus(QUEUE_FIRST);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-auto-entry') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      // An open entry closes on its own row's Escape; from a closed one the keyboard goes back to the list.
      event.preventDefault();
      back();
      return;
    }
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-auto-entry]')];
    const to = rovingTarget(event.key, all.indexOf(target), all.length);
    if (to === null) return;
    event.preventDefault();
    all[to].focus();
  };

  return (
    <section ref={pane} data-testid="auto-queue-pane" aria-label="Digest" onKeyDown={onPaneKeyDown} className="flex min-w-0 flex-1 flex-col">
      <header className={cn('auto-beside-talk shrink-0 border-b', scrolled ? 'border-border-subtle' : 'border-transparent')}>
        <div className="auto-column">
          <div className="flex h-header items-center gap-1">
            <h1 data-testid="auto-queue-day" className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
              {day ? dayTitle(day.date) : 'Digest'}
            </h1>
            {/* At the far right, as on the phone: they stay put whatever the day is called, and sit away from the back arrow. */}
            {day ? (
              <div className="-mr-1.5 flex shrink-0 items-center">
                <IconButton ref={earlier} label="Earlier day" shortcut="[" disabled={!older} onClick={() => stepTo(true)}>
                  <ChevronLeft aria-hidden className="h-4 w-4" />
                </IconButton>
                <IconButton ref={later} label="Later day" shortcut="]" disabled={!newer} onClick={() => stepTo(false)}>
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </IconButton>
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label="Digest menu" data-testid="auto-digest-menu">
                      <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent align="end">
                    {/* Archived, the digest is off the list until the next one. It stays readable here and in the archive. */}
                    <MenuItem onSelect={() => void useDigestStore.getState().archive(day.date, !day.archived)}>{day.archived ? 'Bring back' : 'Archive the digest'}</MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            ) : null}
          </div>
          {counts && day ? (
            <div className="flex items-center gap-1 pb-1">
              <div className="-ml-2 flex items-center gap-1">
                <FilterWord label="Left" count={counts.left} filter="left" on={filter === 'left'} />
                <FilterWord label="All" count={counts.all} filter="all" on={filter === 'all'} />
              </div>
              <Button size="compact" variant="ghost" className="-mr-2 ml-auto font-normal text-foreground-tertiary" onClick={() => openVault(day.path, false)}>
                Open the digest
              </Button>
            </div>
          ) : null}
        </div>
      </header>
      <div
        ref={scroller}
        data-testid="auto-queue"
        className="auto-talk min-h-0 flex-1 overflow-y-auto"
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          setScrolled(event.currentTarget.scrollTop > 0);
          if (date) keepPlace(queuePlace(date), placeIn(event.currentTarget));
        }}
      >
        <div className="auto-column flex flex-col pb-6">
          {day ? (
            // Each day has its own Tab stop: entries of different days share ids such as "item-1".
            <Queue key={day.date} day={day} roomy={roomy} />
          ) : status === 'none' ? (
            <p data-testid="auto-queue-empty" className="py-6 text-ui text-foreground-secondary">No digest yet.</p>
          ) : status === 'unknown' ? (
            <p role="status" className="py-6 text-ui text-foreground-tertiary">Loading…</p>
          ) : (
            <div data-testid="auto-queue-failed" className="flex flex-col items-start gap-3 py-6">
              <p className="text-ui text-foreground-secondary">{"Can't read the digest."}</p>
              <Button size="compact" variant="outline" onClick={() => void useDigestStore.getState().refresh()}>Retry</Button>
            </div>
          )}
        </div>
      </div>
      {/* An archived digest says so at its foot, as an archived thread does, with the same way back. */}
      {day?.archived ? (
        <div className="auto-beside-talk shrink-0 pb-3">
          <div data-testid="auto-queue-archived" className="auto-column">
            <div className="flex items-center gap-3 border-t border-border-subtle pt-2">
              <div className="min-w-0 flex-1">
                <p className="text-ui text-foreground">Archived</p>
                <p className="text-control text-foreground-tertiary">It is off the list until the next digest.</p>
              </div>
              <Button size="compact" variant="outline" data-testid="auto-digest-back" onClick={() => void useDigestStore.getState().archive(day.date, false)}>
                Bring back
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
