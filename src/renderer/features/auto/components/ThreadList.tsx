import * as React from 'react';
import { Archive, Newspaper } from 'lucide-react';
import type { AutoThread } from '@/types/auto';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  IconButton,
} from '@/renderer/shared/ui';
import { useNow } from '@/renderer/shared/hooks/useNow';
import { cn } from '@/renderer/shared/utils';
import { emptyList, fromDigest, isMarked, isYours, listView, moveBy, moveTarget, needsLine, rowTime, type ListGroup } from '../model/listModel';
import { leftWord } from '../model/digestModel';
import { AWAY, DIGEST_QUEUE, NEW_THREAD } from '../model/pane';
import { LIST_PLACE, keepPlace, placeIn, placeOf } from '../model/places';
import { archiveThread, snoozeThread, type From } from '../store/actions';
import { useAutoStore } from '../store/autoStore';
import { useDigestStore } from '../store/digestStore';
import { TITLE_LIMIT, useThreadStore } from '../store/threadStore';
import { useVaultLinks } from '../useVaultLinks';
import { PAGE_FIRST, byKey, focusRowAfterClose, giveBack, keepFocus, rovingTarget, rowElement } from './focus';
import { fadeOf, revealIn, type Fade } from './listScroll';
import { SnoozeButton, SnoozeItems } from './SnoozeMenu';

const DRAG_TYPE = 'application/x-opal-auto-thread';

/** Option+click and "Open to the side" show it in the other pane. */
export type ShowHow = { side?: boolean };

interface RowProps {
  thread: AutoThread;
  now: number;
  current: boolean;
  /** This row is the list's one Tab stop. */
  tabStop: boolean;
  /** Shows the thread in the Auto tab. */
  show: (pane: string, how?: ShowHow) => void;
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
  'pointer-events-none absolute right-0 top-0 flex h-thread-row items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[[data-auto-row]:focus-visible]:pointer-events-auto group-has-[[data-auto-row]:focus-visible]:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100';
const timeHides =
  'group-hover:invisible group-has-[[data-auto-row]:focus-visible]:invisible group-has-[[data-state=open]]:invisible';
/** The second line starts under the title, past the slot the dot sits in. */
const underTitle = 'pl-[calc(var(--sidebar-icon-size)+var(--sidebar-icon-gap))]';
const rowFill = (current: boolean) => (current ? 'bg-sidebar-selected' : 'hover:bg-surface-hover');

/** By a key the keyboard stays with the row; after the pointer it goes back to where it was. */
const keepOnRow = (id: string): void => {
  if (byKey()) useAutoStore.getState().requestFocus(id);
  else giveBack();
};

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

/** Stops a pointer event at the field, so the row under it neither opens the thread, nor drags, nor opens its menu. */
const stayInField = (event: React.SyntheticEvent): void => event.stopPropagation();

/**
 * A row's title as a field, in the title's own place: the same left edge and
 * baseline, and the row no taller. Enter saves, Escape leaves the title as it
 * was; both put the keyboard back on the row. Leaving the field saves, as the
 * header's field does. Letters typed here are text, never a row's keys.
 */
function RowTitleField({ thread, className }: { thread: AutoThread; className: string }) {
  const [typed, setTyped] = React.useState(thread.title);
  const cancelled = React.useRef(false);
  const renaming = { id: thread.id, at: 'row' as const };
  return (
    <input
      autoFocus
      data-rename-field
      data-testid={`auto-row-title-field-${thread.id}`}
      aria-label="Thread title"
      value={typed}
      maxLength={TITLE_LIMIT}
      onChange={(event) => setTyped(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (!cancelled.current) void useThreadStore.getState().rename(typed, thread.id);
        useThreadStore.getState().endRename(renaming);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = event.key === 'Escape';
        event.currentTarget.blur();
        // Done with the keyboard: it goes back to the row, so the arrows and the row's keys work at once.
        useAutoStore.getState().requestFocus(thread.id);
      }}
      onPointerDown={stayInField}
      onMouseDown={stayInField}
      onClick={stayInField}
      onDoubleClick={stayInField}
      onContextMenu={stayInField}
      // The negative margins give the ring room round the words without moving them.
      className={cn('-mx-1 -my-px min-w-0 flex-1 rounded-sm bg-transparent px-1 py-px text-ui outline-none ring-1 ring-focus', className)}
    />
  );
}

function ThreadRow({ thread, now, current, tabStop, show, drop = null, dragging = false, drag }: RowProps) {
  const [snoozing, setSnoozing] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);
  const digestEntry = fromDigest(thread);
  // How far in from the first line's end the icons reach: two of 1.75rem, less the row's own 0.5rem padding.
  const icons = 2;
  const time = rowTime(thread, now);
  // The dot before the title, as on the phone: a reply he has not read, or a thread back from snooze. Not on the one he is reading.
  const dot = isMarked(thread) && !current;
  // The heavier title is for the rows the heading's count takes in: a question, unread, back from snooze, his move.
  const heavy = dot || thread.status === 'waiting' || isYours(thread);
  const title = thread.title || 'Untitled';
  const marked = thread.desk !== null;
  const renaming = useThreadStore((state) => state.renaming?.at === 'row' && state.renaming.id === thread.id);
  const titleClass = heavy ? 'font-semibold text-foreground' : current ? 'font-sidebar-active text-foreground' : 'font-sidebar-label text-sidebar-label';

  const mark = () => {
    // The row moves to another group; the keyboard goes with it, when a key did it.
    void useAutoStore.getState().desk(thread, !marked).then(() => keepOnRow(thread.id));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) return;
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
            data-renaming={renaming || undefined}
            // While its title is a field the row does not drag: a press in the field selects text.
            draggable={drag && !renaming ? true : undefined}
            onDragStart={drag && !renaming ? (event) => drag.onStart(event, thread.id) : undefined}
            onDragOver={drag ? (event) => drag.onOver(event, thread.id) : undefined}
            onDragEnd={drag?.onEnd}
            className={cn('auto-row group relative rounded-sidebar-row transition-hover', rowFill(current), dragging && 'opacity-50')}
          >
            {renaming ? (
              // The same box as the row's button, so nothing on the row moves; it is not a row the keys or the arrows reach.
              <div className={cn(rowButton, 'flex min-h-thread-row w-full min-w-0 flex-col justify-center px-2 py-1')}>
                <span className="auto-row-line flex w-full min-w-0 items-center gap-sidebar-icon-gap">
                  <span className="flex w-sidebar-icon shrink-0 justify-center" />
                  <RowTitleField thread={thread} className={titleClass} />
                  <span className="shrink-0 text-right text-metadata tabular-nums text-sidebar-time">{time}</span>
                </span>
                <NeedsLine thread={thread} />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  data-auto-row
                  data-row-id={thread.id}
                  tabIndex={tabStop ? 0 : -1}
                  aria-current={current || undefined}
                  aria-keyshortcuts={`E S M${digestEntry ? ' D' : ''}`}
                  title={title}
                  // The first click of a double-click opens the thread; the second leaves it as it is.
                  onClick={(event) => {
                    if (event.detail < 2) show(thread.id, { side: event.altKey });
                  }}
                  onDoubleClick={() => useThreadStore.getState().startRename(thread.id, 'row')}
                  onKeyDown={onKeyDown}
                  className={cn(rowButton, 'flex min-h-thread-row w-full min-w-0 flex-col justify-center px-2 py-1')}
                >
                  <span className="auto-row-line flex w-full min-w-0 items-center gap-sidebar-icon-gap">
                    <span className="flex w-sidebar-icon shrink-0 justify-center">
                      {dot ? <span role="img" aria-label={thread.unread ? 'Unread' : 'Back from snooze'} className="h-1.5 w-1.5 rounded-full bg-foreground" /> : null}
                    </span>
                    <span data-heavy={heavy || undefined} data-testid={`auto-row-title-${thread.id}`} className={cn('min-w-0 flex-1 truncate text-ui', titleClass)}>
                      {title}
                    </span>
                    <span className={cn('shrink-0 text-right text-metadata tabular-nums text-sidebar-time', timeHides)}>{time}</span>
                  </span>
                  <NeedsLine thread={thread} />
                </button>
                {/* The row's actions take the time's place while the pointer is on the row, the keyboard is, or their menu is open.
                    A press on one leaves the keyboard where it is. */}
                <div className={rowActions}>
                  <SnoozeButton thread={thread} from="row" open={snoozing} onOpenChange={setSnoozing} tabIndex={-1} />
                  <IconButton label="Archive" shortcut="E" tabIndex={-1} data-testid={`auto-archive-${thread.id}`} onMouseDown={keepFocus} onClick={() => void archiveThread(thread)}>
                    <Archive aria-hidden className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          data-testid={`auto-row-menu-${thread.id}`}
          onCloseAutoFocus={(event) => {
            // Rename moves the keyboard to the title; anything else returns it to a row, or after the pointer to where it was.
            if (useThreadStore.getState().renaming) event.preventDefault();
            else focusRowAfterClose(event, thread.id);
          }}
        >
          <RowMenuItems thread={thread} now={now} snoozed={false} marked={marked} mark={mark} show={show} from="row" />
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

/** What a row's right-click menu offers for a thread that is not archived, in the sidebar or on the Put away page. */
export function RowMenuItems({ thread, now, snoozed, marked, mark, show, from }: { thread: AutoThread; now: number; snoozed: boolean; marked: boolean; mark: () => void; show: (pane: string, how?: ShowHow) => void; from: From }) {
  const digestEntry = fromDigest(thread);
  return (
    <>
      {/* Only a row of the sidebar is renamed in place; a row of the Put away page is not renamed.
          Radix runs onSelect while the menu still holds focus, so the row's field opens once it has closed. */}
      {from === 'row' ? (
        <>
          <ContextMenuItem
            onSelect={() =>
              window.setTimeout(() => {
                show(thread.id);
                useThreadStore.getState().startRename(thread.id, 'row');
              }, 0)
            }
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => show(thread.id, { side: true })}>Open to the side</ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      {snoozed ? (
        <ContextMenuItem onSelect={() => void snoozeThread(thread, null, { from })}>
          Bring back
          {from === 'page' ? <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut> : null}
        </ContextMenuItem>
      ) : null}
      <ContextMenuLabel className="flex items-center">
        {snoozed ? 'Snooze until another time' : 'Snooze'}
        <ContextMenuShortcut aria-hidden>S</ContextMenuShortcut>
      </ContextMenuLabel>
      <SnoozeItems menu="context" thread={thread} now={now} from={from} />
      <ContextMenuSeparator />
      {/* "I want this one on the Mac". It stays on every device; the service ends the mark. */}
      <ContextMenuItem onSelect={mark}>
        {marked ? 'Take off the Mac mark' : 'Mark for the Mac'}
        {from === 'row' ? <ContextMenuShortcut aria-hidden>M</ContextMenuShortcut> : null}
      </ContextMenuItem>
      <ContextMenuSeparator />
      {digestEntry ? (
        <ContextMenuItem onSelect={() => void archiveThread(thread, { done: true, from })}>
          Done
          {from === 'row' ? <ContextMenuShortcut aria-hidden>D</ContextMenuShortcut> : null}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => void archiveThread(thread, { from })}>
        Archive
        {from === 'row' ? <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut> : null}
      </ContextMenuItem>
    </>
  );
}

interface GroupProps {
  group: ListGroup;
  /** The group above this one has a heading and this one has none, so the usual gap between groups parts them. */
  apart: boolean;
  now: number;
  openId: string | null;
  tabStop: string;
  show: (pane: string, how?: ShowHow) => void;
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

/** The rem the fade at a cut edge takes (auto.css), in px: a row brought into view clears it. */
const fadeClear = (): number => 1.5 * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');

/** The digest, as a queue. Not a thread: it does not drag or snooze. Its menu and E archive it, with Undo. */
function DigestRow({ current, tabStop, show, next }: { current: boolean; tabStop: boolean; show: (pane: string, how?: ShowHow) => void; next: () => string | null }) {
  const digest = useDigestStore((state) => state.latest);
  const { openVault } = useVaultLinks();
  const archive = () => {
    if (!digest) return;
    // The row leaves: by a key, the keyboard takes the row below.
    if (byKey()) useAutoStore.getState().requestFocus(next() ?? NEW_THREAD);
    void useDigestStore.getState().archive(digest.date, true);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn('rounded-sidebar-row transition-hover', rowFill(current))}>
          <button
            type="button"
            data-auto-row
            data-row-id={DIGEST_QUEUE}
            data-testid="auto-digest-row"
            tabIndex={tabStop ? 0 : -1}
            aria-current={current || undefined}
            aria-keyshortcuts={digest ? 'E' : undefined}
            onClick={(event) => show(DIGEST_QUEUE, { side: event.altKey })}
            onKeyDown={(event) => {
              if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'e' || !digest) return;
              event.preventDefault();
              archive();
            }}
            className={cn(rowButton, 'flex h-thread-row w-full min-w-0 items-center gap-sidebar-icon-gap px-2 text-ui', current ? 'font-sidebar-active text-foreground' : 'font-sidebar-label text-sidebar-label')}
          >
            <Newspaper aria-hidden className="stroke-sidebar-icon h-sidebar-icon w-sidebar-icon shrink-0 text-sidebar-icon" />
            <span className="min-w-0 flex-1 truncate">Digest</span>
            {digest ? <span data-testid="auto-digest-left" className="shrink-0 text-metadata font-normal tabular-nums text-sidebar-time">{leftWord(digest)}</span> : null}
          </button>
        </div>
      </ContextMenuTrigger>
      {digest ? (
        <ContextMenuContent data-testid="auto-digest-menu-row" onCloseAutoFocus={(event) => focusRowAfterClose(event, DIGEST_QUEUE)}>
          <ContextMenuItem onSelect={archive}>
            Archive the digest
            <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut>
          </ContextMenuItem>
          {digest.path ? <ContextMenuItem onSelect={() => openVault(digest.path, false)}>Open the digest</ContextMenuItem> : null}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => show(DIGEST_QUEUE, { side: true })}>Open to the side</ContextMenuItem>
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}

/**
 * The threads in the sidebar: Digest, then the threads marked for the Mac,
 * the ones that wait on him, what is new, and the rest in his order. Under
 * them, outside the part that scrolls, one row leads to what is put away.
 * It is one Tab stop; the arrow keys move between rows. A click shows the
 * thread in the Auto tab.
 */
export function ThreadList({ show, inFront }: { show: (pane: string, how?: ShowHow) => void; inFront: boolean }) {
  const threads = useAutoStore((state) => state.threads);
  const focusRow = useAutoStore((state) => state.focusRow);
  const openNow = useThreadStore((state) => state.openId);
  const fromAway = useThreadStore((state) => state.fromAway);
  const hold = useThreadStore((state) => state.hold);
  // A row is marked as open only while the Auto tab is the one in front, as a page's row is.
  const openId = inFront ? openNow : null;
  const digest = useDigestStore((state) => state.latest);
  const now = useNow();
  // The open thread keeps its place while it is open; leaving the tab lets it go to its place.
  const view = React.useMemo(() => listView(threads, inFront ? hold : null), [threads, hold, inFront]);
  React.useEffect(() => {
    if (!inFront) useThreadStore.getState().releaseHold();
  }, [inFront]);
  const empty = emptyList(view, now);
  const awayCount = view.waiting.length + view.snoozed.length;
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

  // An archived digest is off the list until the next one. It stays readable from the Put away page.
  const showsDigest = !digest?.archived;

  // One row is the list's Tab stop. While the keyboard is in the list it is the row the keyboard is on;
  // coming into the list from outside, it is the open pane's row, else the first.
  const [active, setActive] = React.useState<string | null>(null);
  const order = React.useMemo(
    () => [...(showsDigest ? [DIGEST_QUEUE] : []), ...view.groups.flatMap((group) => group.threads.map((thread) => thread.id)), AWAY],
    [view, showsDigest]
  );
  const rows = React.useMemo(() => new Set(order), [order]);
  // The Put away row is marked while its page shows, or something opened from it that is not a row here.
  const awayMarked = openId === AWAY || (openId !== null && fromAway && !rows.has(openId));
  const marked = awayMarked ? AWAY : openId;
  const tabStop = active && rows.has(active) ? active : marked && rows.has(marked) ? marked : (order[0] ?? '');

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

  // A thread opened from the palette or by a key is brought into view, clear of the faded edges.
  React.useLayoutEffect(() => {
    const element = scroller.current;
    const row = openId && rows.has(openId) ? rowElement(openId)?.closest('li') : null;
    if (!element || !row) return;
    const clear = fadeClear();
    const view = element.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (box.top < view.top + clear) element.scrollTop -= view.top + clear - box.top;
    else if (box.bottom > view.bottom - clear) revealIn(element, row, clear);
  }, [openId]);

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
        if (id && (event.target as HTMLElement).hasAttribute('data-auto-row')) {
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
        className="auto-threads-scroll sidebar-fade min-h-0 flex-1 overflow-y-auto pb-1"
        onScroll={(event) => {
          keepPlace(LIST_PLACE, placeIn(event.currentTarget));
          setFade(fadeOf(event.currentTarget));
        }}
      >
        <div ref={content} className="ml-sidebar-inset flex flex-col gap-0.5">
          {showsDigest ? <DigestRow current={openId === DIGEST_QUEUE && !fromAway} tabStop={tabStop === DIGEST_QUEUE} show={show} next={() => order[1] ?? null} /> : null}

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
        </div>
      </div>

      {/* What is put away, one row that is always in view: its page holds the threads waiting on a reply, the snoozed ones and the archive.
          The count is of what comes back by itself, never of the archive. */}
      <div className="shrink-0 px-sidebar-inset pt-0.5">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              data-auto-row
              data-row-id={AWAY}
              data-testid="auto-away-row"
              tabIndex={tabStop === AWAY ? 0 : -1}
              aria-current={awayMarked || undefined}
              onClick={(event) => {
                // By a key the keyboard goes onto the page's first row, also when the page already shows.
                if (byKey()) useAutoStore.getState().requestPageFocus(PAGE_FIRST);
                show(AWAY, { side: event.altKey });
              }}
              className={cn(
                rowButton,
                'flex h-thread-row w-full min-w-0 items-center gap-sidebar-icon-gap px-2 text-ui transition-hover',
                awayMarked ? 'bg-sidebar-selected font-sidebar-active text-foreground' : 'font-sidebar-label text-foreground-tertiary hover:bg-surface-hover hover:text-foreground'
              )}
            >
              <span className="flex w-sidebar-icon shrink-0 justify-center">
                <Archive aria-hidden className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">Put away</span>
              {awayCount > 0 ? <span data-testid="auto-away-count" className="shrink-0 text-metadata tabular-nums text-sidebar-time">{awayCount}</span> : null}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent data-testid="auto-away-menu-row" onCloseAutoFocus={(event) => focusRowAfterClose(event, AWAY)}>
            <ContextMenuItem onSelect={() => show(AWAY, { side: true })}>Open to the side</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </nav>
  );
}
