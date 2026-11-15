import * as React from 'react';
import { Archive, ChevronRight, Newspaper, Undo2 } from 'lucide-react';
import type { AutoThread } from '@/types/auto';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  IconButton,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { emptyList, fromDigest, isMarked, isYours, listView, moveBy, moveTarget, needsLine, rowTime, snoozedUntil, type ListGroup } from '../model/listModel';
import { leftWord, shortDay } from '../model/digestModel';
import { DIGEST_QUEUE, NEW_THREAD } from '../model/pane';
import { LIST_PLACE, keepPlace, placeIn, placeOf } from '../model/places';
import { archiveThread, restoreThread, snoozeThread } from '../store/actions';
import { useAutoStore } from '../store/autoStore';
import { useDigestStore } from '../store/digestStore';
import { useThreadStore } from '../store/threadStore';
import { focusRowAfterClose, rovingTarget, rowElement } from './focus';
import { fadeOf, revealIn, type Fade } from './listScroll';
import { SnoozeButton, SnoozeItems } from './SnoozeMenu';
import { ThreadLine } from './ThreadLine';

const DRAG_TYPE = 'application/x-opal-auto-thread';
/** The places of the lines over what is put away, in the run of rows. */
const WAITING_LINE = ':waiting';
const SNOOZED_LINE = ':snoozed';
const ARCHIVED_LINE = ':archived';
const ARCHIVED_ALL = ':archived-all';
/** An archived digest's row, by its day. */
const digestRow = (date: string): string => `:digest:${date}`;

/** Re-renders so times and day names move on. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

interface RowProps {
  thread: AutoThread;
  now: number;
  current: boolean;
  /** This row is the list's one Tab stop. */
  tabStop: boolean;
  /** Shows the thread in the Auto tab. */
  show: (pane: string) => void;
  /**
   * The row is one of those put away. `snoozed`: its time slot says when it
   * comes back. `waiting`: put away until someone replies, and its line says
   * who it waits on. `archived`: it can only be opened and brought back.
   */
  away?: 'snoozed' | 'waiting' | 'archived';
  drop?: 'above' | 'below' | null;
  dragging?: boolean;
  drag?: {
    onStart: (event: React.DragEvent, id: string) => void;
    onOver: (event: React.DragEvent, id: string) => void;
    onEnd: () => void;
  };
}

const rowButton = 'rounded-sidebar-row text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus';
// Hidden by opacity, not display, so an open menu keeps the button it hangs from. They sit over the time, or over the
// end of the title when the time is shorter than they are; the line fades out under them (`.auto-row-line`).
const rowActions =
  'pointer-events-none absolute right-0 top-0 flex h-row-compact items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[[data-auto-row]:focus-visible]:pointer-events-auto group-has-[[data-auto-row]:focus-visible]:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100';
const timeHides =
  'group-hover:invisible group-has-[[data-auto-row]:focus-visible]:invisible group-has-[[data-state=open]]:invisible';
/** The second line starts under the title, past the slot the dot sits in. */
const underTitle = 'pl-[calc(var(--sidebar-icon-size)+var(--sidebar-icon-gap))]';
const rowFill = (current: boolean) => (current ? 'bg-sidebar-selected' : 'hover:bg-surface-hover');

/**
 * The line under a row's title in the sidebar, only when there is something
 * he must see: the question it asks, "Your move: ...", "Not started", why it
 * failed, or who replied to a wait. Words, never a button.
 */
function NeedsLine({ thread }: { thread: AutoThread }) {
  const line = needsLine(thread);
  if (!line) return null;
  const testId = line.kind === 'yours' ? 'auto-yours' : line.kind === 'idle' ? 'auto-not-started' : line.kind === 'back' ? 'auto-wait-back' : undefined;
  const quiet = line.kind === 'ask' || line.kind === 'failed';
  return (
    <span data-testid={testId} data-line={line.kind} className={cn('mt-0.5 line-clamp-2 break-words text-control', underTitle, quiet ? 'text-foreground-secondary' : 'text-foreground')}>
      {line.text}
    </span>
  );
}

function ThreadRow({ thread, now, current, tabStop, show, away, drop = null, dragging = false, drag }: RowProps) {
  const [snoozing, setSnoozing] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);
  const archived = away === 'archived';
  // Put away with a time on it: snoozed to a time, or until someone replies.
  const snoozed = away === 'snoozed' || away === 'waiting';
  const digestEntry = !archived && fromDigest(thread);
  // How far in from the first line's end the icons reach: each is 1.75rem, less the row's own 0.5rem padding.
  const icons = archived ? 1 : 2 + (snoozed ? 1 : 0);
  // A waiting row says its give-up time in its line, and an archived row says when it was archived there.
  const time = away === 'snoozed' && thread.snoozed ? snoozedUntil(thread.snoozed, now) : away ? '' : rowTime(thread, now);
  // The dot before the title, as on the phone: a reply he has not read, or a thread back from snooze. Not on the one he is
  // reading, and not on a row that is put away: the line it sits behind is quiet, and so are its rows.
  const dot = !away && isMarked(thread) && !current;
  // The rows that are his carry a heavier title.
  const heavy = !away && (dot || thread.status === 'waiting' || thread.waits || isYours(thread));
  const title = thread.title || 'Untitled';
  const marked = thread.desk !== null;

  const mark = () => {
    const { desk, requestFocus } = useAutoStore.getState();
    // The row moves to another group; the keyboard goes with it.
    void desk(thread, !marked).then(() => requestFocus(thread.id));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) return;
    if (archived) {
      // E put it away, and E on it here brings it back.
      if (!event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        void restoreThread(thread);
      }
      return;
    }
    const { move, requestFocus, threads } = useAutoStore.getState();
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      // The same post as a drag.
      event.preventDefault();
      const moving = moveBy(threads, thread.id, event.key === 'ArrowUp' ? -1 : 1);
      if (moving) void move(moving.id, moving.before).then(() => requestFocus(thread.id));
      return;
    }
    if (event.shiftKey && event.key === 'F10') {
      event.preventDefault();
      const box = container.current?.getBoundingClientRect();
      container.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (box?.left ?? 0) + 24, clientY: (box?.top ?? 0) + 24 }));
      return;
    }
    if (event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'e') void archiveThread(thread);
    else if (key === 'd' && digestEntry) void archiveThread(thread, { done: true });
    else if (key === 's') setSnoozing(true);
    else if (key === 'm') mark();
    else return;
    event.preventDefault();
  };

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={container}
            data-testid={`auto-row-${thread.id}`}
            data-thread-id={thread.id}
            data-status={thread.status}
            style={{ '--auto-row-hide': `${icons * 1.75 - 0.5}rem` } as React.CSSProperties}
            data-drop={drop ?? undefined}
            draggable={drag ? true : undefined}
            onDragStart={drag ? (event) => drag.onStart(event, thread.id) : undefined}
            onDragOver={drag ? (event) => drag.onOver(event, thread.id) : undefined}
            onDragEnd={drag?.onEnd}
            className={cn('auto-row group relative rounded-sidebar-row transition-hover', rowFill(current), dragging && 'opacity-50')}
          >
            <button
              type="button"
              data-auto-row
              data-row-id={thread.id}
              tabIndex={tabStop ? 0 : -1}
              aria-current={current || undefined}
              aria-keyshortcuts={archived ? 'E' : `E S M${digestEntry ? ' D' : ''}`}
              title={title}
              onClick={() => show(thread.id)}
              onKeyDown={onKeyDown}
              className={cn(rowButton, 'flex min-h-row-compact w-full min-w-0 flex-col justify-center px-2 py-1')}
            >
              <span className="auto-row-line flex w-full min-w-0 items-center gap-sidebar-icon-gap">
                <span className="flex w-sidebar-icon shrink-0 justify-center">
                  {dot ? <span role="img" aria-label={thread.unread ? 'Unread' : 'Back from snooze'} className="h-1.5 w-1.5 rounded-full bg-foreground" /> : null}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-ui', heavy ? 'font-semibold text-foreground' : current ? 'font-sidebar-active text-foreground' : 'font-sidebar-label text-sidebar-label')}>
                  {title}
                </span>
                <span className={cn('shrink-0 text-right text-metadata tabular-nums text-foreground-tertiary', timeHides)}>{time}</span>
              </span>
              {away === 'waiting' || archived ? (
                <ThreadLine thread={thread} className={cn('mt-0.5', underTitle)} away={away} now={now} />
              ) : (
                <NeedsLine thread={thread} />
              )}
            </button>
            {/* The row's actions take the time's place while the pointer is on the row, the keyboard is, or their menu is open. */}
            <div className={rowActions}>
              {archived ? (
                <IconButton label="Bring back" shortcut="E" tabIndex={-1} data-testid={`auto-restore-${thread.id}`} onClick={() => void restoreThread(thread)}>
                  <Undo2 aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
              ) : (
                <>
                  {snoozed ? (
                    <IconButton label="Bring back" tabIndex={-1} data-testid={`auto-back-${thread.id}`} onClick={() => void snoozeThread(thread, null)}>
                      <Undo2 aria-hidden className="h-3.5 w-3.5" />
                    </IconButton>
                  ) : null}
                  <SnoozeButton thread={thread} from="row" open={snoozing} onOpenChange={setSnoozing} tabIndex={-1} />
                  <IconButton label="Archive" shortcut="E" tabIndex={-1} data-testid={`auto-archive-${thread.id}`} onClick={() => void archiveThread(thread)}>
                    <Archive aria-hidden className="h-3.5 w-3.5" />
                  </IconButton>
                </>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          data-testid={`auto-row-menu-${thread.id}`}
          onCloseAutoFocus={(event) => {
            // Rename moves the keyboard to the title; anything else returns it to a row.
            if (useThreadStore.getState().renaming) event.preventDefault();
            else focusRowAfterClose(event, thread.id);
          }}
        >
          {archived ? (
            <ContextMenuItem onSelect={() => void restoreThread(thread)}>
              Bring back
              <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut>
            </ContextMenuItem>
          ) : (
            <RowMenuItems thread={thread} now={now} snoozed={snoozed} marked={marked} mark={mark} show={show} />
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

/** What a row's right-click menu offers for a thread that is not archived. */
function RowMenuItems({ thread, now, snoozed, marked, mark, show }: { thread: AutoThread; now: number; snoozed: boolean; marked: boolean; mark: () => void; show: (pane: string) => void }) {
  const digestEntry = fromDigest(thread);
  return (
    <>
          {snoozed ? <ContextMenuItem onSelect={() => void snoozeThread(thread, null)}>Bring back</ContextMenuItem> : null}
          <ContextMenuLabel className="flex items-center">
            {snoozed ? 'Snooze until another time' : 'Snooze'}
            <ContextMenuShortcut aria-hidden>S</ContextMenuShortcut>
          </ContextMenuLabel>
          <SnoozeItems menu="context" thread={thread} now={now} from="row" />
          <ContextMenuSeparator />
          {/* "I want this one on the Mac". It stays on every device; the service ends the mark. */}
          <ContextMenuItem onSelect={mark}>
            {marked ? 'Take off the Mac mark' : 'Mark for the Mac'}
            <ContextMenuShortcut aria-hidden>M</ContextMenuShortcut>
          </ContextMenuItem>
          {/* Radix runs onSelect while the menu still holds focus, so the title's field opens once it has closed. */}
          <ContextMenuItem
            onSelect={() =>
              window.setTimeout(() => {
                show(thread.id);
                useThreadStore.getState().startRename(thread.id);
              }, 0)
            }
          >
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          {digestEntry ? (
            <ContextMenuItem onSelect={() => void archiveThread(thread, { done: true })}>
              Done
              <ContextMenuShortcut aria-hidden>D</ContextMenuShortcut>
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={() => void archiveThread(thread)}>
            Archive
            <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut>
          </ContextMenuItem>
    </>
  );
}

interface AwayLineProps {
  id: string;
  label: string;
  /** How many it holds. The archive's line says none: only what is snoozed or waiting is counted. */
  count: number | null;
  open: boolean;
  tabStop: boolean;
  onToggle: () => void;
  testId: string;
}

/** One line over the rows of a kind that is put away. A click, Enter or Space opens and closes it. */
function AwayLine({ id, label, count, open, tabStop, onToggle, testId }: AwayLineProps) {
  return (
    <button
      type="button"
      data-auto-row
      data-row-id={id}
      data-testid={testId}
      tabIndex={tabStop ? 0 : -1}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(rowButton, 'flex h-row-compact w-full min-w-0 items-center gap-sidebar-icon-gap px-2 text-ui text-foreground-tertiary transition-hover hover:bg-surface-hover hover:text-foreground')}
    >
      <span className="flex w-sidebar-icon shrink-0 justify-center">
        <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 transition-transform duration-quick', open && 'rotate-90')} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {count !== null ? <span className="shrink-0 text-metadata tabular-nums">{count}</span> : null}
    </button>
  );
}

/** A digest he archived, in the archive: its day, a way to read it, and the way back to the list. */
function DigestAwayRow({ date, tabStop, show }: { date: string; tabStop: boolean; show: (pane: string) => void }) {
  const bringBack = () => {
    void useDigestStore.getState().archive(date, false);
  };
  const read = () => {
    show(DIGEST_QUEUE);
    void useDigestStore.getState().show(date);
  };
  return (
    <li>
      <div data-testid={`auto-archived-digest-${date}`} style={{ '--auto-row-hide': '1.25rem' } as React.CSSProperties} className="auto-row group relative rounded-sidebar-row transition-hover hover:bg-surface-hover">
        <button
          type="button"
          data-auto-row
          data-row-id={digestRow(date)}
          tabIndex={tabStop ? 0 : -1}
          aria-keyshortcuts="E"
          onClick={read}
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'e') return;
            event.preventDefault();
            bringBack();
          }}
          className={cn(rowButton, 'auto-row-line flex h-row-compact w-full min-w-0 items-center gap-sidebar-icon-gap px-2')}
        >
          <span className="flex w-sidebar-icon shrink-0 justify-center">
            <Newspaper aria-hidden className="h-3.5 w-3.5 text-icon" />
          </span>
          <span className="min-w-0 flex-1 truncate text-ui font-sidebar-label text-sidebar-label">Digest</span>
          <span className={cn('shrink-0 text-right text-metadata tabular-nums text-foreground-tertiary', timeHides)}>{shortDay(date)}</span>
        </button>
        <div className={rowActions}>
          <IconButton label="Bring back" shortcut="E" tabIndex={-1} data-testid={`auto-restore-digest-${date}`} onClick={bringBack}>
            <Undo2 aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

interface GroupProps {
  group: ListGroup;
  /** The group above this one has a heading and this one has none, so the usual gap between groups parts them. */
  apart: boolean;
  now: number;
  openId: string | null;
  tabStop: string;
  show: (pane: string) => void;
}

/** One group of rows. A movable group's rows drag to a new place among themselves. */
function GroupRows({ group, apart, now, openId, tabStop, show }: GroupProps) {
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [drop, setDrop] = React.useState<{ id: string; edge: 'above' | 'below' } | null>(null);
  const move = useAutoStore((state) => state.move);

  const drag = group.movable
    ? {
        onStart: (event: React.DragEvent, id: string) => {
          event.dataTransfer.setData(DRAG_TYPE, id);
          event.dataTransfer.effectAllowed = 'move';
          setDragging(id);
        },
        onOver: (event: React.DragEvent, id: string) => {
          if (!dragging && !event.dataTransfer.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const box = event.currentTarget.getBoundingClientRect();
          const edge = event.clientY < box.top + box.height / 2 ? 'above' : 'below';
          setDrop((current) => (current?.id === id && current.edge === edge ? current : { id, edge }));
        },
        onEnd: () => {
          setDragging(null);
          setDrop(null);
        },
      }
    : undefined;

  const onDrop = (event: React.DragEvent) => {
    const id = event.dataTransfer.getData(DRAG_TYPE) || dragging;
    const target = drop;
    setDragging(null);
    setDrop(null);
    if (!id || !target) return;
    event.preventDefault();
    const at = group.threads.findIndex((thread) => thread.id === target.id);
    if (at === -1) return;
    const moving = moveTarget(group.threads, id, target.edge === 'above' ? at : at + 1);
    if (moving) void move(moving.id, moving.before);
  };

  return (
    <section aria-label={group.heading ?? undefined} data-testid={`auto-group-${group.key}`} className={apart ? 'pt-2' : undefined}>
      {group.heading ? <h2 className="flex h-row-compact items-center px-2 text-label font-sidebar-group-label text-foreground-tertiary">{group.heading}</h2> : null}
      <ul
        className="flex flex-col gap-0.5"
        onDrop={drag ? onDrop : undefined}
        onDragLeave={drag ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null); } : undefined}
      >
        {group.threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            now={now}
            current={thread.id === openId}
            tabStop={tabStop === thread.id}
            show={show}
            drag={drag}
            dragging={dragging === thread.id}
            drop={drop?.id === thread.id && dragging !== thread.id ? drop.edge : null}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The threads in the sidebar: Digest, then the threads marked for the Mac,
 * the ones that wait on him, what is new, the rest in his order, and the
 * lines over what is put away. It is one Tab stop; the arrow keys move
 * between rows. A click shows the thread in the Auto tab.
 */
export function ThreadList({ show, inFront }: { show: (pane: string) => void; inFront: boolean }) {
  const threads = useAutoStore((state) => state.threads);
  const snoozedOpen = useAutoStore((state) => state.snoozedOpen);
  const waitingOpen = useAutoStore((state) => state.waitingOpen);
  const archive = useAutoStore((state) => state.archive);
  const loaded = useAutoStore((state) => state.loaded);
  const { toggleSnoozed, toggleWaiting, toggleArchive, loadArchive } = useAutoStore.getState();
  const archivedDays = useDigestStore((state) => state.archivedDays);
  const focusRow = useAutoStore((state) => state.focusRow);
  // A row is marked as open only while the Auto tab is the one in front, as a page's row is.
  const openId = useThreadStore((state) => (inFront ? state.openId : null));
  const digest = useDigestStore((state) => state.latest);
  const now = useNow();
  const view = React.useMemo(() => listView(threads), [threads]);
  const empty = loaded ? emptyList(view, now) : null;
  const scroller = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  // Which edge of the rows is cut: it fades, so a cut row does not read as the last one.
  const [fade, setFade] = React.useState<Fade>(null);
  React.useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => setFade(fadeOf(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  // A put-away line just opened: its first rows are brought into view once they are drawn.
  const [reveal, setReveal] = React.useState<string | null>(null);
  const opening = (id: string, open: boolean, toggle: () => void) => () => {
    if (!open) setReveal(id);
    toggle();
  };

  // An archived digest is off the list until the next one. It stays readable from the archive.
  const showsDigest = !digest?.archived;
  // The archive shows its newest few until he asks for the rest.
  const moreArchived = archive.total > archive.threads.length;

  // One row is the list's Tab stop. While the keyboard is in the list it is the row the keyboard is on;
  // coming into the list from outside, it is the open pane's row, else the first.
  const [active, setActive] = React.useState<string | null>(null);
  const order = React.useMemo(
    () => [
      ...(showsDigest ? [DIGEST_QUEUE] : []),
      ...view.groups.flatMap((group) => group.threads.map((thread) => thread.id)),
      ...(view.waiting.length > 0 ? [WAITING_LINE] : []),
      ...(waitingOpen ? view.waiting.map((thread) => thread.id) : []),
      ...(view.snoozed.length > 0 ? [SNOOZED_LINE] : []),
      ...(snoozedOpen ? view.snoozed.map((thread) => thread.id) : []),
      ...(loaded ? [ARCHIVED_LINE] : []),
      ...(archive.open ? [...archivedDays.map(digestRow), ...archive.threads.map((thread) => thread.id), ...(moreArchived ? [ARCHIVED_ALL] : [])] : []),
    ],
    [view, snoozedOpen, waitingOpen, showsDigest, loaded, archive, archivedDays, moreArchived]
  );
  const rows = React.useMemo(() => new Set(order), [order]);
  const tabStop = active && rows.has(active) ? active : openId && rows.has(openId) ? openId : (order[0] ?? '');

  // A request made while the sidebar was away is old by the time it is drawn again: it is dropped, not followed.
  const mounted = React.useRef(false);
  // A row an action asked to focus takes the keyboard once it is drawn. New thread is the heading's button.
  React.useLayoutEffect(() => {
    if (!focusRow) {
      mounted.current = true;
      return;
    }
    if (mounted.current) {
      const element = rowElement(rows.has(focusRow) ? focusRow : focusRow === NEW_THREAD ? NEW_THREAD : (order[0] ?? NEW_THREAD));
      element?.focus();
    }
    mounted.current = true;
    useAutoStore.getState().requestFocus(null);
  });

  // The keyboard stays with its row when the row is drawn again in another group: a thread that gains a reply,
  // a mark or a question moves, and the element the keyboard was on goes with the old place.
  const keyboardOn = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const was = keyboardOn.current;
    if (!was || was.isConnected || document.activeElement !== document.body) return;
    keyboardOn.current = null;
    const id = was.getAttribute('data-row-id');
    // A row that has left the list is not followed: the action that took it away says where the keyboard goes.
    if (id && rows.has(id)) rowElement(id)?.focus();
  });

  // The list is where he left it.
  const restored = React.useRef(false);
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || restored.current || threads.length === 0) return;
    restored.current = true;
    element.scrollTop = placeOf(LIST_PLACE)?.top ?? 0;
  }, [threads.length]);

  React.useLayoutEffect(() => {
    if (!reveal) return;
    const element = scroller.current;
    const section = rowElement(reveal)?.closest('section');
    // Clear of the top edge's fade, 1.5rem (auto.css).
    if (element && section) revealIn(element, section, 1.5 * parseFloat(getComputedStyle(document.documentElement).fontSize || '16'));
    // The archive's rows come with its read; the others are drawn at once.
    if (reveal !== ARCHIVED_LINE || archive.loaded || archive.problem) setReveal(null);
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-auto-row') || event.metaKey || event.ctrlKey || event.altKey) return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-auto-row]')];
    const to = rovingTarget(event.key, all.indexOf(target), all.length);
    if (to === null) return;
    event.preventDefault();
    all[to].focus();
  };

  return (
    <nav
      aria-label="Threads"
      data-testid="auto-list"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const id = (event.target as HTMLElement).getAttribute?.('data-row-id');
        if (id) {
          setActive(id);
          keyboardOn.current = event.target as HTMLElement;
        }
      }}
      onBlur={(event) => {
        // The keyboard has left the list: Tab back in lands on the open thread's row, not on the row it left from.
        // A menu or a dialog opened from a row gives the keyboard back to that row when it closes.
        const to = event.relatedTarget as HTMLElement | null;
        if (to && !event.currentTarget.contains(to) && !to.closest('[role="menu"], [role="dialog"]')) setActive(null);
        // He moved the keyboard somewhere, or put it down: only a row taken out from under it is followed.
        if (to || (event.target as HTMLElement).isConnected) keyboardOn.current = null;
      }}
      className="flex min-h-0 flex-col"
    >
      <div
        ref={scroller}
        data-testid="auto-list-rows"
        data-fade-y={fade ?? undefined}
        className="auto-threads-scroll min-h-0 flex-1 overflow-y-auto pb-1"
        onScroll={(event) => {
          keepPlace(LIST_PLACE, placeIn(event.currentTarget));
          setFade(fadeOf(event.currentTarget));
        }}
      >
        <div ref={content} className="ml-sidebar-inset flex flex-col gap-0.5">
          {/* The digest, as a queue. Not a thread: it does not drag or snooze. Archived, it is off the list until the next one. */}
          {showsDigest ? (
            <div className={cn('rounded-sidebar-row transition-hover', rowFill(openId === DIGEST_QUEUE))}>
              <button
                type="button"
                data-auto-row
                data-row-id={DIGEST_QUEUE}
                data-testid="auto-digest-row"
                tabIndex={tabStop === DIGEST_QUEUE ? 0 : -1}
                aria-current={openId === DIGEST_QUEUE || undefined}
                onClick={() => show(DIGEST_QUEUE)}
                className={cn(rowButton, 'flex h-row-compact w-full min-w-0 items-center gap-sidebar-icon-gap px-2 text-ui', openId === DIGEST_QUEUE ? 'font-sidebar-active text-foreground' : 'font-sidebar-label text-sidebar-label')}
              >
                <Newspaper aria-hidden className="stroke-sidebar-icon h-sidebar-icon w-sidebar-icon shrink-0 text-sidebar-icon" />
                <span className="min-w-0 flex-1 truncate">Digest</span>
                {digest ? <span data-testid="auto-digest-left" className="shrink-0 text-metadata font-normal tabular-nums text-foreground-tertiary">{leftWord(digest)}</span> : null}
              </button>
            </div>
          ) : null}

          {empty ? (
            <p data-testid="auto-empty" className="py-1 pr-2 pl-[calc(var(--sidebar-icon-size)+var(--sidebar-icon-gap)+0.5rem)] text-control text-foreground-tertiary">
              {empty.title}
              {empty.detail ? ` ${empty.detail}` : ''}
            </p>
          ) : null}

          {view.groups.map((group, at) => (
            <GroupRows
              key={group.key}
              group={group}
              apart={at > 0 && view.groups[at - 1].heading !== null && group.heading === null}
              now={now}
              openId={openId}
              tabStop={tabStop}
              show={show}
            />
          ))}

          {/* What is put away, each kind behind a line of its own: waiting on a reply, snoozed to a time, archived. */}
          <div className="mt-2 flex flex-col gap-0.5">
            {view.waiting.length > 0 ? (
              <section aria-label="Waiting on a reply">
                <AwayLine id={WAITING_LINE} label="Waiting on a reply" count={view.waiting.length} open={waitingOpen} tabStop={tabStop === WAITING_LINE} onToggle={opening(WAITING_LINE, waitingOpen, toggleWaiting)} testId="auto-waiting-line" />
                {waitingOpen ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-waiting">
                    {view.waiting.map((thread) => (
                      <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} tabStop={tabStop === thread.id} show={show} away="waiting" />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {view.snoozed.length > 0 ? (
              <section aria-label="Snoozed">
                <AwayLine id={SNOOZED_LINE} label="Snoozed" count={view.snoozed.length} open={snoozedOpen} tabStop={tabStop === SNOOZED_LINE} onToggle={opening(SNOOZED_LINE, snoozedOpen, toggleSnoozed)} testId="auto-snoozed-line" />
                {snoozedOpen ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-snoozed">
                    {view.snoozed.map((thread) => (
                      <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} tabStop={tabStop === thread.id} show={show} away="snoozed" />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {/* The archive only grows, so its line carries no count. It is read when the line is opened. */}
            {loaded ? (
              <section aria-label="Archived">
                <AwayLine id={ARCHIVED_LINE} label="Archived" count={null} open={archive.open} tabStop={tabStop === ARCHIVED_LINE} onToggle={opening(ARCHIVED_LINE, archive.open, toggleArchive)} testId="auto-archived-line" />
                {archive.open ? (
                  <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-archived">
                    {archivedDays.map((date) => (
                      <DigestAwayRow key={date} date={date} tabStop={tabStop === digestRow(date)} show={show} />
                    ))}
                    {archive.threads.map((thread) => (
                      <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} tabStop={tabStop === thread.id} show={show} away="archived" />
                    ))}
                    {moreArchived ? (
                      <li className="py-1 pr-2 pl-[calc(var(--sidebar-icon-size)+var(--sidebar-icon-gap)+0.5rem)]">
                        <Button
                          size="compact"
                          variant="outline"
                          data-auto-row
                          data-row-id={ARCHIVED_ALL}
                          data-testid="auto-archived-all"
                          tabIndex={tabStop === ARCHIVED_ALL ? 0 : -1}
                          disabled={archive.loading}
                          onClick={() => void loadArchive(true)}
                        >
                          Show all {archive.total}
                        </Button>
                      </li>
                    ) : null}
                    {archive.threads.length === 0 && archivedDays.length === 0 ? (
                      <li
                        data-testid="auto-archived-empty"
                        role={archive.problem ? 'alert' : undefined}
                        className="py-1 pr-2 pl-[calc(var(--sidebar-icon-size)+var(--sidebar-icon-gap)+0.5rem)] text-control text-foreground-tertiary"
                      >
                        {archive.problem ?? (archive.loaded ? 'Nothing is archived.' : 'Loading the archive.')}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </nav>
  );
}
