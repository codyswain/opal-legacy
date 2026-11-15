import * as React from 'react';
import { Archive, Check, ChevronRight, Monitor, MoreHorizontal, Newspaper, SquarePen, Undo2 } from 'lucide-react';
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
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { emptyList, fromDigest, isMarked, isYours, listSummary, listView, moveBy, moveTarget, rowOptions, rowTime, snoozedUntil, type ListGroup } from '../model/listModel';
import { homeLine, leftWord, shortDay } from '../model/digestModel';
import { DIGEST_QUEUE, NEW_THREAD } from '../model/pane';
import { LIST_PLACE, keepPlace, placeIn, placeOf } from '../model/places';
import { answerFromRow, archiveThread, restoreThread, snoozeThread } from '../store/actions';
import { useAutoStore } from '../store/autoStore';
import { useDigestStore } from '../store/digestStore';
import { useThreadStore } from '../store/threadStore';
import { focusRowAfterClose, rovingTarget, rowElement } from './focus';
import { SaidBar } from './SaidBar';
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

const rowButton = 'rounded-row text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus';
// Hidden by opacity, not display, so an open menu keeps the button it hangs from.
const rowActions =
  'pointer-events-none absolute right-1 top-0.5 flex items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[[data-auto-row]:focus-visible]:pointer-events-auto group-has-[[data-auto-row]:focus-visible]:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100';
const timeHides =
  'group-hover:invisible group-has-[[data-auto-row]:focus-visible]:invisible group-has-[[data-state=open]]:invisible';

function ThreadRow({ thread, now, current, tabStop, away, drop = null, dragging = false, drag }: RowProps) {
  const [snoozing, setSnoozing] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);
  // An answer picked here is held a few seconds before it is posted: the row shows the pick meanwhile.
  const held = useAutoStore((state) => state.held[thread.id]);
  const archived = away === 'archived';
  // Put away with a time on it: snoozed to a time, or until someone replies.
  const snoozed = away === 'snoozed' || away === 'waiting';
  const options = away ? [] : rowOptions(thread);
  const digestEntry = !archived && fromDigest(thread);
  // The icons that take the time's place: the slot is at least as wide as they are, so they never sit on the title.
  const icons = archived ? 1 : 2 + (digestEntry ? 1 : 0) + (snoozed ? 1 : 0);
  // A waiting row says its give-up time in its line, and an archived row says when it was archived there.
  const time = away === 'snoozed' && thread.snoozed ? snoozedUntil(thread.snoozed, now) : away ? '' : rowTime(thread, now);
  // The dot before the title, as on the phone: a reply he has not read, or a thread back from snooze. Not on the one he is reading.
  const dot = !archived && isMarked(thread) && !current;
  // The rows that are his carry a heavier title.
  const heavy = !archived && (dot || thread.status === 'waiting' || thread.waits || isYours(thread));
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
    // 1 to 3 pick an option of a waiting row, held with Undo as a click is.
    const picked = options[Number(key) - 1];
    if (picked && Number(key) <= 3) answerFromRow(thread, picked);
    else if (key === 'e') void archiveThread(thread);
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
            data-drop={drop ?? undefined}
            draggable={drag ? true : undefined}
            onDragStart={drag ? (event) => drag.onStart(event, thread.id) : undefined}
            onDragOver={drag ? (event) => drag.onOver(event, thread.id) : undefined}
            onDragEnd={drag?.onEnd}
            className={cn(
              'auto-row group relative rounded-row transition-hover',
              current ? 'bg-surface-selected' : 'hover:bg-surface-hover',
              dragging && 'opacity-50'
            )}
          >
            <button
              type="button"
              data-auto-row
              data-row-id={thread.id}
              tabIndex={tabStop ? 0 : -1}
              aria-current={current || undefined}
              aria-keyshortcuts={archived ? 'E' : `E S M${digestEntry ? ' D' : ''}${options.slice(0, 3).map((_label, at) => ` ${at + 1}`).join('')}`}
              onClick={() => useThreadStore.getState().open(thread.id)}
              onKeyDown={onKeyDown}
              className={cn(rowButton, 'flex w-full min-w-0 flex-col px-2 py-1.5')}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                {dot ? <span role="img" aria-label={thread.unread ? 'Unread' : 'Back from snooze'} className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> : null}
                <span className={cn('min-w-0 flex-1 truncate text-ui text-foreground', heavy ? 'font-semibold' : 'font-medium')}>
                  {title}
                </span>
                {marked ? (
                  <span role="img" aria-label="Marked for the Mac" data-testid="auto-desk-sign" className={cn('flex shrink-0 text-icon', timeHides)}>
                    <Monitor aria-hidden className="h-3 w-3" />
                  </span>
                ) : null}
                <span style={{ minWidth: `${icons * 1.75 - 0.25}rem` }} className={cn('shrink-0 text-right text-metadata tabular-nums text-foreground-tertiary', timeHides)}>{time}</span>
              </span>
              <ThreadLine thread={thread} className="mt-0.5" away={away === 'snoozed' ? undefined : away} now={now} />
            </button>
            {held !== undefined ? (
              // As tall as the buttons it stands in for, so the rows under it stay where they are.
              <div className="px-2 pb-2 pt-0.5">
                <p data-testid="auto-row-held" className="flex h-control-compact items-center gap-1.5 text-control font-medium text-foreground">
                  <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 truncate">{held}</span>
                </p>
              </div>
            ) : options.length > 0 ? (
              // No option is filled: a filled button reads as already chosen. The open thread's row keeps their
              // room, so the rows under it do not jump when it is opened and left, but the card beside it has them.
              <div aria-hidden={current || undefined} className={cn('flex flex-wrap gap-1.5 px-2 pb-2 pt-0.5', current && 'invisible')}>
                {options.map((label, at) => (
                  <Button key={label} size="compact" tabIndex={-1} variant="outline" title={at < 3 ? `${label} (${at + 1})` : undefined} onClick={() => answerFromRow(thread, label)}>
                    {label}
                    {/* Its number shows only while the keyboard is on the row, which is when the number picks it. */}
                    {at < 3 ? <span aria-hidden data-testid="auto-row-key" className="ml-1.5 hidden font-mono text-metadata text-foreground-tertiary group-has-[[data-auto-row]:focus-visible]:inline">{at + 1}</span> : null}
                  </Button>
                ))}
              </div>
            ) : null}
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
                  {digestEntry ? (
                    <IconButton label="Done" shortcut="D" tabIndex={-1} data-testid={`auto-done-${thread.id}`} onClick={() => void archiveThread(thread, { done: true })}>
                      <Check aria-hidden className="h-3.5 w-3.5" />
                    </IconButton>
                  ) : null}
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
            <RowMenuItems thread={thread} now={now} snoozed={snoozed} marked={marked} mark={mark} />
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

/** What a row's right-click menu offers for a thread that is not archived. */
function RowMenuItems({ thread, now, snoozed, marked, mark }: { thread: AutoThread; now: number; snoozed: boolean; marked: boolean; mark: () => void }) {
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
          <ContextMenuItem onSelect={() => window.setTimeout(() => useThreadStore.getState().startRename(thread.id), 0)}>Rename</ContextMenuItem>
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
      className={cn(rowButton, 'flex h-row-compact w-full items-center gap-1 px-2 text-ui text-foreground-tertiary transition-hover hover:bg-surface-hover hover:text-foreground')}
    >
      <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-quick', open && 'rotate-90')} />
      <span className="flex-1 text-left">{label}</span>
      {count !== null ? <span className="text-metadata tabular-nums">{count}</span> : null}
    </button>
  );
}

/** A digest he archived, in the archive: its day, a way to read it, and the way back to the list. */
function DigestAwayRow({ date, tabStop }: { date: string; tabStop: boolean }) {
  const bringBack = () => {
    void useDigestStore.getState().archive(date, false);
  };
  const read = () => {
    useThreadStore.getState().open(DIGEST_QUEUE);
    void useDigestStore.getState().show(date);
  };
  return (
    <li>
      <div data-testid={`auto-archived-digest-${date}`} className="auto-row group relative rounded-row transition-hover hover:bg-surface-hover">
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
          className={cn(rowButton, 'flex w-full min-w-0 flex-col px-2 py-1.5')}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">Digest</span>
            <span style={{ minWidth: '1.5rem' }} className="shrink-0" />
          </span>
          <span className="mt-0.5 text-control text-foreground-tertiary">{shortDay(date)}</span>
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
}

/** One group of rows. A movable group's rows drag to a new place among themselves. */
function GroupRows({ group, apart, now, openId, tabStop }: GroupProps) {
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
    <section aria-label={group.heading ?? undefined} data-testid={`auto-group-${group.key}`} className={apart ? 'pt-sidebar-group' : undefined}>
      {group.heading ? <h2 className="px-2 pb-1 pt-2 text-label text-foreground-tertiary">{group.heading}</h2> : null}
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
 * The list: New thread and Digest, which stay above it, then the threads
 * marked for the Mac, the ones that wait on him, the rest in his order, and
 * the Snoozed line. It is one Tab stop; the arrow keys move between rows.
 */
export function ThreadList({ narrow }: { narrow: boolean }) {
  const threads = useAutoStore((state) => state.threads);
  const snoozedOpen = useAutoStore((state) => state.snoozedOpen);
  const waitingOpen = useAutoStore((state) => state.waitingOpen);
  const archive = useAutoStore((state) => state.archive);
  const loaded = useAutoStore((state) => state.loaded);
  const { toggleSnoozed, toggleWaiting, toggleArchive, loadArchive } = useAutoStore.getState();
  const archivedDays = useDigestStore((state) => state.archivedDays);
  const editAddress = useAutoStore((state) => state.editAddress);
  const focusRow = useAutoStore((state) => state.focusRow);
  const openId = useThreadStore((state) => state.openId);
  const open = useThreadStore((state) => state.open);
  const digest = useDigestStore((state) => state.latest);
  const now = useNow();
  const view = React.useMemo(() => listView(threads), [threads]);
  const empty = emptyList(view, now);
  const nav = React.useRef<HTMLElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = React.useState(false);
  const summary = React.useMemo(() => listSummary(threads), [threads]);
  // Beside the thread, with no thread open, the empty thread is the one in view.
  const onNew = openId === NEW_THREAD || (openId === null && !narrow);

  // An archived digest is off the list until the next one. It stays readable from the archive.
  const showsDigest = !digest?.archived;
  // The archive shows its newest few until he asks for the rest.
  const moreArchived = archive.total > archive.threads.length;

  // One row is the list's Tab stop. While the keyboard is in the list it is the row the keyboard is on;
  // coming into the list from outside, it is the open pane's row.
  const [active, setActive] = React.useState<string | null>(null);
  const rows = React.useMemo(
    () =>
      new Set([
        NEW_THREAD,
        ...(showsDigest ? [DIGEST_QUEUE] : []),
        ...view.groups.flatMap((group) => group.threads.map((thread) => thread.id)),
        ...(view.waiting.length > 0 ? [WAITING_LINE] : []),
        ...(waitingOpen ? view.waiting.map((thread) => thread.id) : []),
        ...(view.snoozed.length > 0 ? [SNOOZED_LINE] : []),
        ...(snoozedOpen ? view.snoozed.map((thread) => thread.id) : []),
        ...(loaded ? [ARCHIVED_LINE] : []),
        ...(archive.open ? [...archivedDays.map(digestRow), ...archive.threads.map((thread) => thread.id), ...(moreArchived ? [ARCHIVED_ALL] : [])] : []),
      ]),
    [view, snoozedOpen, waitingOpen, showsDigest, loaded, archive, archivedDays, moreArchived]
  );
  const tabStop = active && rows.has(active) ? active : openId && rows.has(openId) ? openId : NEW_THREAD;

  // A row an action asked to focus takes the keyboard once it is drawn.
  React.useLayoutEffect(() => {
    if (!focusRow) return;
    const element = rowElement(rows.has(focusRow) ? focusRow : NEW_THREAD);
    element?.focus();
    useAutoStore.getState().requestFocus(null);
  });

  // The list is where he left it.
  const restored = React.useRef(false);
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || restored.current || threads.length === 0) return;
    restored.current = true;
    element.scrollTop = placeOf(LIST_PLACE)?.top ?? 0;
  }, [threads.length]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-auto-row') || event.metaKey || event.ctrlKey || event.altKey) return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-auto-row]')];
    const to = rovingTarget(event.key, all.indexOf(target), all.length);
    if (to === null) return;
    event.preventDefault();
    all[to].focus();
  };

  const plain = cn(rowButton, 'flex w-full gap-2 px-2 text-ui font-medium text-foreground');

  return (
    <nav
      ref={nav}
      aria-label="Threads"
      data-testid="auto-list"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const id = (event.target as HTMLElement).getAttribute?.('data-row-id');
        if (id) setActive(id);
      }}
      onBlur={(event) => {
        // The keyboard has left the list: Tab back in lands on the open thread's row, not on the row it left from.
        // A menu or a dialog opened from a row gives the keyboard back to that row when it closes.
        const to = event.relatedTarget as HTMLElement | null;
        if (to && !event.currentTarget.contains(to) && !to.closest('[role="menu"], [role="dialog"]')) setActive(null);
      }}
      className={cn('flex min-h-0 shrink-0 flex-col', narrow ? 'w-full' : 'w-auto-list border-r border-border-subtle')}
    >
      {/* New thread and Digest stay put above the list. Once it has scrolled, a hairline parts them from the row that passes under. */}
      <div className={cn('auto-beside-list shrink-0 border-b pl-2 pt-2', scrolled ? 'border-border-subtle' : 'border-transparent')}>
        <div className={cn('group relative mb-0.5 rounded-row transition-hover', onNew ? 'bg-surface-selected' : 'hover:bg-surface-hover')}>
          <button
            type="button"
            data-auto-row
            data-row-id={NEW_THREAD}
            data-testid="auto-new-thread"
            tabIndex={tabStop === NEW_THREAD ? 0 : -1}
            aria-current={onNew || undefined}
            onClick={() => open(NEW_THREAD)}
            className={cn(plain, 'h-row items-center')}
          >
            <SquarePen aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon" />
            New thread
          </button>
          <div className={cn(rowActions, 'top-1/2 -translate-y-1/2')}>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Auto settings" tabIndex={-1} data-testid="auto-settings">
                  <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => editAddress(true)}>Change address…</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>

        {/* The digest, as a queue. Not a thread: it does not drag or snooze. Archived, it is off the list until the next one. */}
        {showsDigest ? (
        <div className={cn('rounded-row transition-hover', openId === DIGEST_QUEUE ? 'bg-surface-selected' : 'hover:bg-surface-hover')}>
          <button
            type="button"
            data-auto-row
            data-row-id={DIGEST_QUEUE}
            data-testid="auto-digest-row"
            tabIndex={tabStop === DIGEST_QUEUE ? 0 : -1}
            aria-current={openId === DIGEST_QUEUE || undefined}
            onClick={() => open(DIGEST_QUEUE)}
            className={cn(plain, 'min-h-row py-1.5')}
          >
            <Newspaper aria-hidden className="mt-[0.1875rem] h-3.5 w-3.5 shrink-0 text-icon" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">Digest</span>
                {digest ? <span className="shrink-0 text-metadata font-normal tabular-nums text-foreground-tertiary">{leftWord(digest)}</span> : null}
              </span>
              {digest ? <span data-testid="auto-digest-line" className="mt-0.5 truncate text-control font-normal text-foreground-tertiary">{homeLine(digest)}</span> : null}
            </span>
          </button>
        </div>
        ) : null}
        {/* What the list holds, so a glance is enough. Left out when there is nothing to count. */}
        {summary ? <p data-testid="auto-summary" className="truncate px-2 pb-1 pt-2 text-metadata text-foreground-tertiary">{summary}</p> : <div className="h-0.5" />}
      </div>

      <div
        ref={scroller}
        data-testid="auto-list-rows"
        className="auto-list-rows min-h-0 flex-1 overflow-y-auto pb-2 pl-2 pt-0.5"
        onScroll={(event) => {
          keepPlace(LIST_PLACE, placeIn(event.currentTarget));
          setScrolled(event.currentTarget.scrollTop > 0);
        }}
      >
        {empty ? (
          <div data-testid="auto-empty" className="px-2 py-6">
            <p className="text-ui text-foreground-secondary">{empty.title}</p>
            {empty.detail ? <p className="mt-1 text-ui text-foreground-tertiary">{empty.detail}</p> : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-0.5">
          {view.groups.map((group, at) => (
            <GroupRows
              key={group.key}
              group={group}
              apart={at > 0 && view.groups[at - 1].heading !== null && group.heading === null}
              now={now}
              openId={openId}
              tabStop={tabStop}
            />
          ))}
        </div>

        {/* What is put away, each kind behind a line of its own: waiting on a reply, snoozed to a time, archived. */}
        <div className="mt-3 flex flex-col gap-0.5">
          {view.waiting.length > 0 ? (
            <section aria-label="Waiting on a reply">
              <AwayLine id={WAITING_LINE} label="Waiting on a reply" count={view.waiting.length} open={waitingOpen} tabStop={tabStop === WAITING_LINE} onToggle={toggleWaiting} testId="auto-waiting-line" />
              {waitingOpen ? (
                <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-waiting">
                  {view.waiting.map((thread) => (
                    <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} tabStop={tabStop === thread.id} away="waiting" />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {view.snoozed.length > 0 ? (
            <section aria-label="Snoozed">
              <AwayLine id={SNOOZED_LINE} label="Snoozed" count={view.snoozed.length} open={snoozedOpen} tabStop={tabStop === SNOOZED_LINE} onToggle={toggleSnoozed} testId="auto-snoozed-line" />
              {snoozedOpen ? (
                <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-snoozed">
                  {view.snoozed.map((thread) => (
                    <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} tabStop={tabStop === thread.id} away="snoozed" />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* The archive only grows, so its line carries no count. It is read when the line is opened. */}
          {loaded ? (
            <section aria-label="Archived">
              <AwayLine
                id={ARCHIVED_LINE}
                label="Archived"
                count={null}
                open={archive.open}
                tabStop={tabStop === ARCHIVED_LINE}
                onToggle={toggleArchive}
                testId="auto-archived-line"
              />
              {archive.open ? (
                <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-archived">
                  {archivedDays.map((date) => (
                    <DigestAwayRow key={date} date={date} tabStop={tabStop === digestRow(date)} />
                  ))}
                  {archive.threads.map((thread) => (
                    <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} tabStop={tabStop === thread.id} away="archived" />
                  ))}
                  {moreArchived ? (
                    <li className="px-2 py-1.5">
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
                    <li data-testid="auto-archived-empty" role={archive.problem ? 'alert' : undefined} className="px-2 py-1.5 text-control text-foreground-tertiary">
                      {archive.problem ?? (archive.loaded ? 'Nothing is archived.' : 'Loading the archive.')}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      {/* What the last action did, and the way back. */}
      <div className="auto-beside-list shrink-0 pl-2">
        <SaidBar className="mb-2" />
      </div>
    </nav>
  );
}
