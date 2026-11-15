import * as React from 'react';
import { Archive, Check, ChevronRight, Clock, MoreHorizontal, Newspaper, SquarePen } from 'lucide-react';
import type { AutoThread } from '@/types/auto';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import {
  emptyList,
  fromDigest,
  listView,
  moveTarget,
  rowLine,
  rowOptions,
  rowTime,
  snoozedUntil,
  type ListGroup,
} from '../model/listModel';
import { leftWord } from '../model/digestModel';
import { DIGEST_QUEUE, NEW_THREAD } from '../model/pane';
import { useAutoStore } from '../store/autoStore';
import { useDigestStore } from '../store/digestStore';
import { useThreadStore } from '../store/threadStore';
import { SnoozeDateDialog, SnoozeItems } from './SnoozeMenu';

const DRAG_TYPE = 'application/x-opal-auto-thread';

/** Re-renders so times and day names move on. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Up and Down move between rows, Home and End jump to the ends. */
function moveFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (!(event.target as HTMLElement).hasAttribute('data-auto-row')) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-auto-row]')];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'ArrowDown' ? at + 1
    : event.key === 'ArrowUp' ? at - 1
    : event.key === 'Home' ? 0
    : event.key === 'End' ? rows.length - 1
    : null;
  if (next === null || !rows[next]) return;
  event.preventDefault();
  rows[next].focus();
}

interface RowProps {
  thread: AutoThread;
  now: number;
  current: boolean;
  /** Shown under the Snoozed line: the time slot says when it comes back. */
  snoozed?: boolean;
  drop?: 'above' | 'below' | null;
  dragging?: boolean;
  drag?: {
    onStart: (event: React.DragEvent, id: string) => void;
    onOver: (event: React.DragEvent, id: string) => void;
    onEnd: () => void;
  };
  onPickDate: (thread: AutoThread) => void;
}

const lineStyle = 'mt-0.5 text-control text-foreground-tertiary';
// Hidden by opacity, not display, so an open menu keeps the button it hangs from.
const rowActions =
  'pointer-events-none absolute right-1 top-0.5 flex items-center opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100';

function RowLineView({ thread }: { thread: AutoThread }) {
  const line = rowLine(thread);
  if (!line.text) return null;
  if (line.kind === 'ask') return <span className={cn(lineStyle, 'line-clamp-3 text-foreground-secondary')}>{line.text}</span>;
  if (line.kind === 'live') {
    return (
      <span className={cn(lineStyle, 'flex items-center gap-1.5')}>
        <span aria-hidden className="auto-spin" />
        <span className="min-w-0 truncate">{line.text}</span>
      </span>
    );
  }
  return <span className={cn(lineStyle, 'line-clamp-2')}>{line.text}</span>;
}

function ThreadRow({ thread, now, current, snoozed = false, drop = null, dragging = false, drag, onPickDate }: RowProps) {
  const open = useThreadStore((state) => state.open);
  const { snooze, archive, answer, desk } = useAutoStore.getState();
  const options = snoozed ? [] : rowOptions(thread);
  const digestEntry = fromDigest(thread);
  const time = snoozed && thread.snoozed ? snoozedUntil(thread.snoozed, now) : rowTime(thread, now);
  const unread = thread.unread && !current;
  const title = thread.title || 'Untitled';

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
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
              aria-current={current || undefined}
              onClick={() => open(thread.id)}
              className="flex w-full min-w-0 flex-col rounded-row px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            >
              <span className="flex w-full min-w-0 items-center gap-1.5">
                {unread ? <span role="img" aria-label="Unread" className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" /> : null}
                <span className={cn('min-w-0 flex-1 truncate text-ui text-foreground', unread || thread.status === 'waiting' ? 'font-semibold' : 'font-medium')}>
                  {title}
                </span>
                {time ? (
                  <span className="shrink-0 text-metadata tabular-nums text-foreground-tertiary group-focus-within:invisible group-hover:invisible group-has-[[data-state=open]]:invisible">
                    {time}
                  </span>
                ) : null}
              </span>
              <RowLineView thread={thread} />
            </button>
            {options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-0.5">
                {options.map((label, at) => (
                  <Button key={label} size="compact" variant={at === 0 ? 'default' : 'outline'} onClick={() => void answer(thread, label)}>
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
            {/* The row's actions take the time's place while the pointer or focus is on the row, or their menu is open. */}
            <div className={rowActions}>
              {snoozed ? (
                <Button size="compact" variant="ghost" className="text-control" onClick={() => void snooze(thread.id, null)}>
                  Bring back
                </Button>
              ) : (
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton label="Snooze" data-testid={`auto-snooze-${thread.id}`}>
                      <Clock aria-hidden className="h-3.5 w-3.5" />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent align="end" data-testid="auto-snooze-menu">
                    <MenuLabel>Snooze</MenuLabel>
                    <SnoozeItems menu="dropdown" now={now} onSnooze={(until) => void snooze(thread.id, until)} onPickDate={() => onPickDate(thread)} />
                  </MenuContent>
                </Menu>
              )}
              {digestEntry ? (
                <IconButton label="Done" data-testid={`auto-done-${thread.id}`} onClick={() => void archive(thread, true)}>
                  <Check aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
              ) : null}
              <IconButton label="Archive" data-testid={`auto-archive-${thread.id}`} onClick={() => void archive(thread)}>
                <Archive aria-hidden className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid={`auto-row-menu-${thread.id}`}>
          {snoozed ? (
            <ContextMenuItem onSelect={() => void snooze(thread.id, null)}>Bring back</ContextMenuItem>
          ) : (
            <>
              <ContextMenuLabel>Snooze</ContextMenuLabel>
              <SnoozeItems menu="context" now={now} onSnooze={(until) => void snooze(thread.id, until)} onPickDate={() => onPickDate(thread)} />
            </>
          )}
          <ContextMenuSeparator />
          {/* "I want this one on the Mac". It stays on every device; the service ends the mark. */}
          <ContextMenuItem onSelect={() => void desk(thread, thread.desk === null)}>
            {thread.desk === null ? 'Mark for the Mac' : 'Take off the Mac mark'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          {digestEntry ? <ContextMenuItem onSelect={() => void archive(thread, true)}>Done</ContextMenuItem> : null}
          <ContextMenuItem onSelect={() => void archive(thread)}>Archive</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

interface GroupProps {
  group: ListGroup;
  /** The group above this one has a heading and this one has none, so a gap parts them. */
  apart: boolean;
  now: number;
  openId: string | null;
  onPickDate: (thread: AutoThread) => void;
}

/** One group of rows. A movable group's rows drag to a new place among themselves. */
function GroupRows({ group, apart, now, openId, onPickDate }: GroupProps) {
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
    <section aria-label={group.heading ?? undefined} data-testid={`auto-group-${group.key}`} className={apart ? 'pt-3' : undefined}>
      {group.heading ? <h2 className="px-2 pb-1 pt-3 text-label text-foreground-tertiary">{group.heading}</h2> : null}
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
            drag={drag}
            dragging={dragging === thread.id}
            drop={drop?.id === thread.id && dragging !== thread.id ? drop.edge : null}
            onPickDate={onPickDate}
          />
        ))}
      </ul>
    </section>
  );
}

/** The list: New thread, the threads that wait on him, the rest in his order, and the Snoozed line. */
export function ThreadList({ narrow }: { narrow: boolean }) {
  const threads = useAutoStore((state) => state.threads);
  const snoozedOpen = useAutoStore((state) => state.snoozedOpen);
  const toggleSnoozed = useAutoStore((state) => state.toggleSnoozed);
  const editAddress = useAutoStore((state) => state.editAddress);
  const snooze = useAutoStore((state) => state.snooze);
  const openId = useThreadStore((state) => state.openId);
  const open = useThreadStore((state) => state.open);
  const left = useDigestStore((state) => leftWord(state.latest));
  const now = useNow();
  const view = React.useMemo(() => listView(threads), [threads]);
  const empty = emptyList(view, now);
  const [picking, setPicking] = React.useState<AutoThread | null>(null);
  // Beside the thread, with no thread open, the empty thread is the one in view.
  const onNew = openId === NEW_THREAD || (openId === null && !narrow);

  return (
    <nav
      aria-label="Threads"
      data-testid="auto-list"
      className={cn('flex min-h-0 shrink-0 flex-col', narrow ? 'w-full' : 'w-auto-list border-r border-border-subtle')}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2" onKeyDown={moveFocus}>
        <div className={cn('group relative mb-0.5 rounded-row transition-hover', onNew ? 'bg-surface-selected' : 'hover:bg-surface-hover')}>
          <button
            type="button"
            data-auto-row
            data-testid="auto-new-thread"
            aria-current={onNew || undefined}
            onClick={() => open(NEW_THREAD)}
            className="flex h-row w-full items-center gap-2 rounded-row px-2 text-left text-ui font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
          >
            <SquarePen aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon" />
            New thread
          </button>
          <div className={cn(rowActions, 'top-1/2 -translate-y-1/2')}>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Auto settings" data-testid="auto-settings">
                  <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
                </IconButton>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => editAddress(true)}>Change address…</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>

        {/* The digest, as a queue. Not a thread: it does not drag, snooze or archive. */}
        <div className={cn('mb-0.5 rounded-row transition-hover', openId === DIGEST_QUEUE ? 'bg-surface-selected' : 'hover:bg-surface-hover')}>
          <button
            type="button"
            data-auto-row
            data-testid="auto-digest-row"
            aria-current={openId === DIGEST_QUEUE || undefined}
            onClick={() => open(DIGEST_QUEUE)}
            className="flex h-row w-full items-center gap-2 rounded-row px-2 text-left text-ui font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
          >
            <Newspaper aria-hidden className="h-3.5 w-3.5 shrink-0 text-icon" />
            <span className="min-w-0 flex-1 truncate">Digest</span>
            {left ? <span className="shrink-0 text-metadata font-normal tabular-nums text-foreground-tertiary">{left}</span> : null}
          </button>
        </div>

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
              onPickDate={setPicking}
            />
          ))}
        </div>

        {view.snoozed.length > 0 ? (
          <section aria-label="Snoozed" className="mt-3">
            <button
              type="button"
              data-auto-row
              data-testid="auto-snoozed-line"
              aria-expanded={snoozedOpen}
              onClick={toggleSnoozed}
              className="flex h-row-compact w-full items-center gap-1 rounded-row px-2 text-left text-ui text-foreground-tertiary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            >
              <ChevronRight aria-hidden className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-quick', snoozedOpen && 'rotate-90')} />
              <span className="flex-1">Snoozed</span>
              <span className="text-metadata tabular-nums">{view.snoozed.length}</span>
            </button>
            {snoozedOpen ? (
              <ul className="mt-0.5 flex flex-col gap-0.5" data-testid="auto-snoozed">
                {view.snoozed.map((thread) => (
                  <ThreadRow key={thread.id} thread={thread} now={now} current={thread.id === openId} snoozed onPickDate={setPicking} />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>

      <SnoozeDateDialog
        title={picking ? picking.title : null}
        onClose={() => setPicking(null)}
        onSnooze={(until) => {
          if (picking) void snooze(picking.id, until);
          setPicking(null);
        }}
      />
    </nav>
  );
}
