import * as React from 'react';
import { Archive, ArrowDown, Check, ChevronDown, ChevronRight, Clock, Undo2 } from 'lucide-react';
import type { AutoItem, AutoStep, AutoThread } from '@/types/auto';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { Markdown, MarkdownLinksContext } from '../markdown/Markdown';
import { archivedWord, awayDetail, heardLine, isWaitingOnReply, returnsLine, waitLine, waitUrl } from '../model/awayModel';
import { clockTime, fromDigest, listView } from '../model/listModel';
import { AWAY, NEW_THREAD, paneThread } from '../model/pane';
import { keepPlace, placeIn, placeOf, threadPlace } from '../model/places';
import { failure, parseEntry, sentLine, showsNext, stepLines, stepsSummary, turnRuns, turnStart, waitingToGo } from '../model/threadModel';
import { archiveThread, restoreThread, snoozeThread } from '../store/actions';
import { modelChoices, useAutoStore } from '../store/autoStore';
import { TITLE_LIMIT, draftKey, useThreadStore } from '../store/threadStore';
import { BoxFrame, boxField, paneHeader, SendButton, StopButton } from './Box';
import { EntryCardView, GrantCard, PermissionCard, QuestionCard } from './Cards';
import { focusRowNow, rowElement } from './focus';
import { SnoozeButton } from './SnoozeMenu';
import { usePaneId } from '@/renderer/features/disk-explorer/panes';
import { useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { UsageRing } from './UsageRing';

const quiet = 'text-control text-foreground-tertiary';
/** A folded line of what Auto did: the reply's size, in grey. */
const folded = 'text-reply text-foreground-tertiary';
const stepLink = 'rounded-sm underline decoration-foreground-tertiary/50 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus';

/** One of his messages. */
function Bubble({ text, faded = false }: { text: string; faded?: boolean }) {
  return (
    <div data-testid="auto-message" className={cn('ml-auto w-fit max-w-lg whitespace-pre-wrap break-words rounded-2xl bg-surface-active px-3.5 py-2 text-reply text-foreground', faded && 'opacity-60')}>
      {text}
    </div>
  );
}

/** What Auto did between messages: one grey line ending in a chevron, which opens to every step. */
function Steps({ steps }: { steps: AutoStep[] }) {
  const { openVault } = React.useContext(MarkdownLinksContext);
  const [open, setOpen] = React.useState(false);
  const lines = stepLines(steps);
  if (lines.length === 0) return null;
  const line = (at: number) => {
    const { lead, text, path } = lines[at];
    return (
      <div key={at} className="truncate">
        {lead}
        {path ? (
          <button type="button" title={path} onClick={(event) => openVault(path, event.metaKey || event.ctrlKey)} className={stepLink}>
            {text}
          </button>
        ) : (
          text
        )}
      </div>
    );
  };
  // One step is its own line, and keeps its link: there is nothing to open, so its chevron is only drawn.
  if (lines.length === 1) {
    return (
      <div data-testid="auto-steps" className={cn(folded, 'flex min-w-0 items-center gap-1')}>
        <div className="min-w-0">{line(0)}</div>
        <ChevronRight aria-hidden data-testid="auto-steps-chevron" className="h-3.5 w-3.5 shrink-0" />
      </div>
    );
  }
  return (
    <div data-testid="auto-steps" className={cn(folded, 'flex flex-col gap-0.5')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-fit max-w-full items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0 truncate">{stepsSummary(steps)}</span>
        <ChevronRight aria-hidden data-testid="auto-steps-chevron" className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-quick', open && 'rotate-90')} />
      </button>
      {open ? <div className="flex flex-col gap-0.5 pl-0.5">{lines.map((_line, at) => line(at))}</div> : null}
    </div>
  );
}

function Item({ item, title }: { item: AutoItem; title: string | null }) {
  switch (item.role) {
    case 'user': {
      const entry = parseEntry(item.text);
      if (!entry) return <Bubble text={item.text} />;
      return (
        <>
          <EntryCardView entry={entry} title={title} />
          {/* The same gap as between any two rows of the thread. */}
          {entry.says ? <div className="mt-4 flex flex-col"><Bubble text={entry.says} /></div> : null}
        </>
      );
    }
    case 'assistant':
      return item.text ? <Markdown text={item.text} streaming={item.open} className="text-foreground" /> : null;
    case 'steps':
      return <Steps steps={item.steps} />;
    case 'asked':
      return (
        <p className={folded}>
          {item.text} <span className="font-medium text-foreground-secondary">{item.answer || 'No answer'}</span>
        </p>
      );
    case 'note':
      return <p className={folded}>{item.text}</p>;
  }
}

/** One row of the thread. Quiet rows (steps, a folded question, a note) sit close to each other. */
interface Row {
  key: string;
  quiet: boolean;
  /** His message: a new turn, with more room above it than the rows within a turn. */
  his?: boolean;
  /** The start of the newest reply: an unread thread opens here when the reply is taller than the pane. */
  anchor?: boolean;
  node: React.ReactNode;
}

const isQuiet = (item: AutoItem): boolean => item.role === 'steps' || item.role === 'asked' || item.role === 'note';
/** Whether an item draws anything. */
const draws = (item: AutoItem): boolean =>
  item.role === 'steps' ? stepLines(item.steps).length > 0 : item.role === 'assistant' ? item.text !== '' : true;

/** A follow-up: a click sends it; Option-click, or "Edit first" in its menu, puts it in the box to change. */
function NextLine({ line }: { line: string }) {
  const { send, editNext } = useThreadStore.getState();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          title="Option-click to change it first"
          onClick={(event) => (event.altKey ? editNext(line) : void send(line, false))}
          className="max-w-lg rounded-full border border-border-default px-3.5 py-1 text-left text-reply text-foreground-secondary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        >
          {line}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void send(line, false)}>Send</ContextMenuItem>
        <ContextMenuItem onSelect={() => window.setTimeout(() => editNext(line), 0)}>
          Edit first
          <ContextMenuShortcut aria-hidden>⌥ click</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The thread itself. It stays at the end while text arrives, unless he has
 * scrolled up; then it keeps his place and offers "Jump to the end". Each
 * thread comes back where he left it.
 */
function Talk({ scroller }: { scroller: React.RefObject<HTMLDivElement> }) {
  const own = useThreadStore((state) => state.view);
  // What the pane held before a thread never seen was opened: it stays until that thread arrives, or 300 ms.
  const ghost = useThreadStore((state) => state.ghost);
  const view = own ?? ghost;
  const pending = useThreadStore((state) => state.pending);
  const slow = useThreadStore((state) => state.slow);
  const problem = useThreadStore((state) => state.problem);
  const openedUnread = useThreadStore((state) => state.openedUnread);
  const loading = useThreadStore((state) => state.loading);
  const onEmpty = useThreadStore((state) => paneThread(state.openId) === null);
  const listEmpty = useAutoStore((state) => state.loaded && listView(state.threads).groups.length === 0) && onEmpty;
  const stuck = React.useRef(true);
  const placed = React.useRef<string | null>(null);
  // A thread with a reply he has not read is placed again once its fresh snapshot, which holds that reply, is drawn.
  const placedFresh = React.useRef<string | null>(null);
  const height = React.useRef(0);
  const [below, setBelow] = React.useState(false);
  const threadId = own?.thread.id ?? null;

  // The pane shrinks when the box grows, a notice shows or the width changes. At its end, the thread stays at
  // its end; scrolled up, the row at the top of the pane stays at the top.
  const anchor = React.useRef<{ key: string; gap: number } | null>(null);
  React.useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const hold = () => {
      if (stuck.current) {
        element.scrollTop = element.scrollHeight;
        return;
      }
      const kept = anchor.current;
      const row = kept ? element.querySelector<HTMLElement>(`[data-row="${kept.key}"]`) : null;
      if (kept && row) element.scrollTop = row.offsetTop - kept.gap;
    };
    const observer = new ResizeObserver(hold);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scroller]);

  // His own message always shows, wherever he had scrolled to.
  const sent = React.useRef(0);
  if (pending.length > sent.current) stuck.current = true;
  sent.current = pending.length;

  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const fresh = threadId !== null && !loading && openedUnread && placedFresh.current !== threadId;
    if (threadId && (placed.current !== threadId || fresh)) {
      // The thread has just been drawn: put it where he left it.
      placed.current = threadId;
      if (!loading) placedFresh.current = threadId;
      const kept = placeOf(threadPlace(threadId));
      const anchor = element.querySelector<HTMLElement>('[data-anchor]');
      if (kept && !kept.atEnd) {
        element.scrollTop = kept.top;
        stuck.current = false;
        // Text that arrived while he was away is below his place.
        setBelow(element.scrollHeight > kept.height + 1);
      } else if (openedUnread && anchor && element.scrollHeight - anchor.offsetTop > element.clientHeight) {
        // A reply he has not read, taller than the pane, is read from its start.
        element.scrollTop = Math.max(0, anchor.offsetTop - 8);
        stuck.current = false;
        setBelow(false);
      } else {
        element.scrollTop = element.scrollHeight;
        stuck.current = true;
        setBelow(false);
      }
    } else if (stuck.current) {
      element.scrollTop = element.scrollHeight;
    } else if (threadId && element.scrollHeight > height.current + 1) {
      setBelow(true);
    }
    height.current = element.scrollHeight;
    if (threadId) keepPlace(threadPlace(threadId), placeIn(element));
  });

  const rows: Row[] = [];
  if (!view) {
    if (problem) rows.push({ key: 'problem', quiet: false, node: <p role="alert" className="text-ui text-foreground-secondary">{problem}</p> });
    else if (slow) rows.push({ key: 'loading', quiet: false, node: <p role="status" className="text-ui text-foreground-tertiary">Loading…</p> });
    // A new thread shows his words at once, on their way, before the service has made the thread.
    for (const message of pending) rows.push({ key: `p${message.cid}`, quiet: false, his: true, node: <Bubble text={message.text} faded /> });
    // The empty thread, with every thread done or put away: it says so, as the list does.
    if (!problem && !slow && pending.length === 0 && listEmpty) rows.push({ key: 'nothing', quiet: false, node: <p data-testid="auto-nothing-left" className="text-ui text-foreground-tertiary">Nothing left.</p> });
  } else {
    const title = view.thread.title;
    const failed = failure(view);
    const entry = view.seed ? parseEntry(view.seed) : null;
    const start = turnStart(view);
    const { handOver } = useThreadStore.getState();
    let anchored = false;
    const items = (list: readonly AutoItem[], prefix: string, from: number | null = null) => {
      list.forEach((item, at) => {
        if (!draws(item)) return;
        const anchor = from !== null && at > from && !anchored;
        if (anchor) anchored = true;
        rows.push({ key: `${prefix}${at}`, quiet: isQuiet(item), his: item.role === 'user', anchor, node: <Item item={item} title={title} /> });
      });
    };
    items(view.history, 'h', start);
    if (view.seed) {
      rows.push({ key: 'seed', quiet: false, node: entry ? <EntryCardView entry={entry} title={title} /> : <Markdown text={view.seed} className="text-foreground" /> });
      rows.push({
        key: 'hand-over',
        quiet: false,
        node: (
          <Button variant="outline" className="w-fit" data-testid="auto-hand-over" onClick={() => void handOver()}>
            Hand to Auto
          </Button>
        ),
      });
    }
    items(view.live?.items ?? [], 'l');
    if (view.question?.kind === 'ask') rows.push({ key: view.question.id, quiet: false, node: <QuestionCard question={view.question} /> });
    if (view.question?.kind === 'permission') rows.push({ key: view.question.id, quiet: false, node: <PermissionCard question={view.question} /> });
    if (view.question?.kind === 'grant') rows.push({ key: view.question.id, quiet: false, node: <GrantCard question={view.question} /> });
    if (view.live && !view.question) {
      rows.push({
        key: 'activity',
        quiet: false,
        node: (
          <p role="status" data-testid="auto-activity" className={cn(quiet, 'flex items-center gap-2')}>
            <span aria-hidden className="auto-spin" />
            {view.live.activity || 'Working'}
          </p>
        ),
      });
    }
    if (failed) rows.push({ key: 'failed', quiet: false, node: <p role="alert" data-testid="auto-failed" className="text-ui text-foreground-secondary">{failed}</p> });
    // A message sent at rest shows at once; the turn it starts takes its place.
    if (!view.live) for (const message of pending) rows.push({ key: `p${message.cid}`, quiet: false, his: true, node: <Bubble text={message.text} faded /> });
    view.sent.forEach((sent, at) => {
      rows.push({
        key: `sent${at}`,
        quiet: true,
        node: (
          <p className={quiet}>
            {sentLine(sent)}
            {sent.at ? <span className="tabular-nums"> at {clockTime(sent.at)}</span> : null}
          </p>
        ),
      });
    });
    if (view.sendWaiting) rows.push({ key: 'send-waiting', quiet: true, node: <p data-testid="auto-send-waiting" className={quiet}>A send is waiting on your phone.</p> });
    if (showsNext(view, pending.length)) {
      rows.push({
        key: 'next',
        quiet: false,
        node: (
          <div data-testid="auto-next" className="flex flex-col items-end gap-1.5">
            {view.next.map((line) => (
              <NextLine key={line} line={line} />
            ))}
          </div>
        ),
      });
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        data-testid="auto-talk"
        className="auto-talk min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const element = event.currentTarget;
          const place = placeIn(element);
          stuck.current = place.atEnd;
          if (place.atEnd) setBelow(false);
          if (threadId) keepPlace(threadPlace(threadId), place);
          // The row at the top of the pane, and how far it is from the top: what a change of width keeps in place.
          const top = [...element.querySelectorAll<HTMLElement>('[data-row]')].find((row) => row.offsetTop + row.offsetHeight > element.scrollTop);
          anchor.current = top ? { key: top.getAttribute('data-row') ?? '', gap: top.offsetTop - element.scrollTop } : null;
        }}
      >
        {/* What the pane held before is only shown, never acted on: its cards and buttons belong to another thread. */}
        <div aria-hidden={own ? undefined : ghost ? true : undefined} className={cn('auto-column relative flex flex-col pb-6 pt-2', !own && ghost && 'pointer-events-none')}>
          {rows.map((row, at) => (
            <div key={row.key} data-row={row.key} data-anchor={row.anchor || undefined} className={cn('flex flex-col', at === 0 ? '' : row.his && !rows[at - 1].his ? 'mt-8' : row.quiet && rows[at - 1].quiet ? 'mt-1' : 'mt-4')}>
              {row.node}
            </div>
          ))}
        </div>
      </div>
      {below ? (
        <IconButton
          label="Jump to the end"
          variant="outline"
          size="default"
          data-testid="auto-jump"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface-raised shadow-control"
          onClick={() => {
            const element = scroller.current;
            if (!element) return;
            stuck.current = true;
            setBelow(false);
            element.scrollTop = element.scrollHeight;
          }}
        >
          <ArrowDown aria-hidden className="h-4 w-4" />
        </IconButton>
      ) : null}
    </div>
  );
}

/**
 * The title. With a menu, a double-click on its words turns it into a field,
 * and the chevron beside them opens the thread's menu, Rename first, which
 * does the same. The words are not the menu's trigger: the menu opens on the
 * press, so a double-click on them would open it and shut it again. Enter or
 * leaving the field renames, Escape does not.
 */
function Title({ id, title, menu, editing }: { id: string | null; title: string; menu: React.ReactNode; editing: boolean }) {
  const [typed, setTyped] = React.useState(title);
  const [wasEditing, setWasEditing] = React.useState(editing);
  const cancelled = React.useRef(false);
  // The field opens holding the title as it is now, in its first render, so the whole of it is selected when the field
  // takes the caret; set later, the new value would drop the selection and his typing would land after the old title.
  // Only when the field opens: the title may change under it.
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setTyped(title);
  }
  React.useEffect(() => {
    if (editing) cancelled.current = false;
  }, [editing]);
  if (!menu || !id) return <h1 data-testid="auto-title" className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{title}</h1>;
  if (editing) {
    return (
      <input
        autoFocus
        data-rename-field
        aria-label="Thread title"
        value={typed}
        maxLength={TITLE_LIMIT}
        onChange={(event) => setTyped(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          if (!cancelled.current) void useThreadStore.getState().rename(typed, id);
          useThreadStore.getState().endRename({ id, at: 'header' });
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'Escape') return;
          // The key ends here: the keyboard moves to the box in this same press, and the Enter must not follow it there as a new line.
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = event.key === 'Escape';
          event.currentTarget.blur();
          // Done with the keyboard: it goes back to the box.
          useThreadStore.getState().focusBox();
        }}
        className="-ml-2 h-control-compact min-w-0 flex-1 rounded-control border border-border-strong bg-canvas px-2 text-ui font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
    );
  }
  // The heading is the title alone, so a screen reader reads the thread's name; the chevron beside it is its own button, reached by Tab.
  return (
    <div className="-ml-2 flex min-w-0 flex-1 items-center">
      <h1
        data-testid="auto-title"
        className="min-w-0 cursor-default select-none truncate py-1 pl-2 text-ui font-medium text-foreground"
        onDoubleClick={() => useThreadStore.getState().startRename(id, 'header')}
      >
        {title || 'Untitled'}
      </h1>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label="Thread menu"
            title="Thread menu"
            data-testid="auto-thread-menu"
            className="ml-1 flex h-6 w-5 shrink-0 items-center justify-center rounded-control text-foreground-tertiary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-surface-active"
          >
            <ChevronDown aria-hidden data-testid="auto-title-chevron" className="h-3.5 w-3.5 shrink-0" />
          </button>
        </MenuTrigger>
        {menu}
      </Menu>
    </div>
  );
}

/** What the title's chevron opens: the thread's menu, Rename first, as its row offers it less what the header shows. */
function ThreadMenu({ thread }: { thread: AutoThread }) {
  const marked = thread.desk !== null;
  return (
    <MenuContent
      align="start"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        // Rename moves the keyboard to the title; anything else returns it to the box.
        if (!(document.activeElement instanceof HTMLInputElement)) useThreadStore.getState().focusBox();
      }}
    >
      {/* Radix runs onSelect while the menu still holds focus, so the title's field opens once it has closed. */}
      <MenuItem onSelect={() => window.setTimeout(() => useThreadStore.getState().startRename(thread.id, 'header'), 0)}>Rename</MenuItem>
      {thread.snoozed !== null ? <MenuItem onSelect={() => void snoozeThread(thread, null, { from: 'pane' })}>Bring back</MenuItem> : null}
      <MenuItem onSelect={() => void useAutoStore.getState().desk(thread, !marked)}>{marked ? 'Take off the Mac mark' : 'Mark for the Mac'}</MenuItem>
    </MenuContent>
  );
}

/** Snooze, Done and Archive for the open thread, at the header's right. An archived thread has Bring back in their place. */
function ThreadActions({ thread }: { thread: AutoThread }) {
  if (thread.archived) {
    return (
      <IconButton label="Bring back" data-testid="auto-restore-open" className="-mr-1.5" onClick={() => void restoreThread(thread, { from: 'pane' })}>
        <Undo2 aria-hidden className="h-3.5 w-3.5" />
      </IconButton>
    );
  }
  return (
    <>
      <SnoozeButton thread={thread} from="pane" />
      {fromDigest(thread) ? (
        <IconButton label="Done" data-testid="auto-done-open" onClick={() => void archiveThread(thread, { done: true, from: 'pane' })}>
          <Check aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
      <IconButton label="Archive" data-testid="auto-archive-open" className="-mr-1.5" onClick={() => void archiveThread(thread, { from: 'pane' })}>
        <Archive aria-hidden className="h-3.5 w-3.5" />
      </IconButton>
    </>
  );
}

/** The open thread, or the list's or the archive's entry for it, as the header and the box show it. */
function useShownThread(): { isNew: boolean; thread: AutoThread | null; ghost: boolean } {
  const openId = useThreadStore((state) => state.openId);
  const view = useThreadStore((state) => state.view);
  // The list's own entry, or the archive's: the title shows from it while the thread loads, or cannot be read.
  const entry = useAutoStore((state) => state.threads.find((thread) => thread.id === openId) ?? state.archive.threads.find((thread) => thread.id === openId));
  // While the pane still holds the thread before, its header does too.
  const ghost = useThreadStore((state) => (state.view ? null : state.ghost));
  const isNew = paneThread(openId) === null;
  return { isNew, thread: isNew ? null : ghost?.thread ?? entry ?? view?.thread ?? null, ghost: ghost !== null };
}

/** The model, at the left of the box's foot. */
function ModelPicker() {
  const newModel = useThreadStore((state) => state.newModel);
  const status = useAutoStore((state) => state.status);
  const { isNew, thread } = useShownThread();
  if (!isNew && !thread) return null;
  const models = modelChoices(status);
  const model = isNew ? newModel : thread?.model ?? '';
  const label = models.find(([key]) => key === model)?.[1] ?? model;
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="compact" variant="ghost" aria-label={`Model: ${label}`} data-testid="auto-model" className="gap-1 rounded-full px-2.5 font-normal text-foreground-tertiary">
          {label}
          <ChevronDown aria-hidden className="h-3 w-3" />
        </Button>
      </MenuTrigger>
      <MenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          useThreadStore.getState().focusBox();
        }}
      >
        <MenuRadioGroup value={model} onValueChange={(value) => void useThreadStore.getState().setModel(value)}>
          {models.map(([key, name]) => (
            <MenuRadioItem key={key} value={key}>{name}</MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function ThreadHeader() {
  const openId = useThreadStore((state) => state.openId);
  const renaming = useThreadStore((state) => (state.renaming?.at === 'header' ? state.renaming.id : null));
  const { isNew, thread, ghost } = useShownThread();
  const menu = thread && !ghost && !thread.archived ? <ThreadMenu thread={thread} /> : null;

  return (
    <header data-testid="auto-thread-header" className={paneHeader}>
      <div className="auto-column flex h-header items-center gap-1">
        {isNew ? (
          <Title id={null} title="New thread" menu={null} editing={false} />
        ) : (
          <Title key={openId} id={thread?.id ?? null} title={thread?.title ?? ''} menu={menu} editing={renaming !== null && renaming === thread?.id && menu !== null} />
        )}
        <div className="flex shrink-0 items-center gap-0.5">{thread && !ghost ? <ThreadActions thread={thread} /> : null}</div>
      </div>
    </header>
  );
}

/** Sets a text area's height to its words, to a part of the window's; one line when empty. Measured again when its width changes. */
export function useGrow(area: React.RefObject<HTMLTextAreaElement>, text: string, share = 0.4): void {
  const measure = React.useCallback(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    // Empty, it is one line whatever its placeholder would take.
    element.style.height = text ? `${Math.min(element.scrollHeight, Math.round(window.innerHeight * share))}px` : '';
  }, [area, text, share]);
  React.useLayoutEffect(measure, [measure]);
  React.useEffect(() => {
    const element = area.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [area, measure]);
}

/** Put away: archived, snoozed to a time, or waiting on a reply. */
const isAway = (thread: AutoThread): boolean => thread.archived || thread.snoozed !== null;

/**
 * Above the box of a thread that is put away: what it waits for, and the
 * way back into the list. Archived, it says so. Snoozed, when it returns
 * and when he snoozed it. Waiting on a reply, who it waits on and until
 * when, what for and where, and what was last heard. The conversation
 * opens from the place's name, when the service gave a web address for it.
 */
function AwayBar({ thread }: { thread: AutoThread }) {
  const now = Date.now();
  const waiting = isWaitingOnReply(thread);
  const lead = thread.archived ? 'Archived' : waiting ? waitLine(thread, now) : returnsLine(thread, now);
  const detail = thread.archived ? archivedWord(thread, now).replace(/^Archived /, '').replace(/\.$/, '') : awayDetail(thread, now);
  const heard = waiting && thread.wait ? heardLine(thread.wait) : '';
  const url = waiting ? waitUrl(thread.wait) : null;
  return (
    <div data-testid="auto-away" className="mb-2 flex items-center gap-3 border-t border-border-subtle pt-2">
      <div className="min-w-0 flex-1">
        <p data-testid="auto-away-lead" className="text-ui text-foreground">{lead}</p>
        {detail || heard || url ? (
          <p data-testid="auto-away-detail" className="text-control text-foreground-tertiary">
            {[thread.archived ? capital(detail) : detail, heard].filter(Boolean).join(' ')}
            {url ? (
              <>
                {' '}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={url}
                  data-testid="auto-away-link"
                  className="underline decoration-foreground-tertiary/50 underline-offset-2 hover:text-foreground"
                  onClick={(event) => {
                    // It leaves the app the way every other web link in Opal does: the main process decides.
                    event.preventDefault();
                    window.open(url, '_blank');
                  }}
                >
                  Open the conversation
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <Button
        size="compact"
        variant="outline"
        data-testid="auto-bring-back"
        onClick={() => void (thread.archived ? restoreThread(thread, { from: 'pane' }) : snoozeThread(thread, null, { from: 'pane' }))}
      >
        Bring back
      </Button>
    </div>
  );
}

const capital = (words: string): string => (words ? words.charAt(0).toUpperCase() + words.slice(1) : '');

/**
 * The box. Enter sends, Shift+Enter adds a line. While a question waits it
 * is the answer field. What waits behind a running turn shows above it. Its
 * foot holds the model at the left, and Stop, while a turn runs, and Send
 * at the right.
 */
function Composer({ talk }: { talk: React.RefObject<HTMLDivElement> }) {
  const openId = useThreadStore((state) => state.openId);
  const view = useThreadStore((state) => state.view);
  const pending = useThreadStore((state) => state.pending);
  const boxFocus = useThreadStore((state) => state.boxFocus);
  const paneId = usePaneId();
  const key = draftKey(openId);
  const draft = useThreadStore((state) => state.box.drafts[key] ?? '');
  const notSent = useThreadStore((state) => (state.notSent?.thread === key ? state.notSent.text : null));
  const { send, setDraft, stop } = useThreadStore.getState();
  const box = React.useRef<HTMLTextAreaElement>(null);
  const queue = view?.live ? waitingToGo(view, pending) : [];
  // Words begun before the card arrived stay a message: the box is the card's answer field once it has been emptied.
  const begunBefore = useThreadStore((state) => state.view?.question != null && state.earlier[key] === state.view.question.id);
  const answering = view?.question != null && !begunBefore;
  // A send he is asked to allow, or a tool that needs his yes: words here are a "no" with a reason, and nothing here is a yes.
  const refusing = answering && (view?.question?.kind === 'grant' || view?.question?.kind === 'permission');
  // The open thread's own entry, as the list or the archive has it: it says whether the thread is put away.
  const entry = useAutoStore((state) => state.threads.find((thread) => thread.id === openId) ?? state.archive.threads.find((thread) => thread.id === openId));
  const thread = entry ?? view?.thread ?? null;
  const running = turnRuns(view);
  useGrow(box, draft);

  // A thread opens with the caret in its box, and the keyboard comes back to it after an answer, Stop or a rename.
  // A box drawn while the title is being renamed leaves the caret in the title's field, and a
  // thread in the pane he is not using leaves the keyboard where it is.
  React.useEffect(() => {
    if (useTabsStore.getState().activePaneId !== paneId) return;
    if (!useThreadStore.getState().renaming) box.current?.focus({ preventScroll: true });
  }, [boxFocus]);

  const submit = () => {
    if (draft.trim()) void send(draft);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      // Out of the box, onto the open thread's row in the sidebar, or the Put away row for one opened from there.
      // A turn is never stopped this way.
      event.preventDefault();
      const fromAway = useThreadStore.getState().fromAway;
      focusRowNow(fromAway && !(openId && rowElement(openId)) ? AWAY : openId ?? NEW_THREAD);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const element = talk.current;
      if (!element) return;
      event.preventDefault();
      element.scrollTop += (event.key === 'PageUp' ? -1 : 1) * Math.max(40, element.clientHeight - 48);
    }
  };

  return (
    <div className="auto-beside-talk shrink-0 pb-4">
      <div className="auto-column">
        {thread && isAway(thread) ? <AwayBar thread={thread} /> : null}
        {queue.length > 0 ? (
          <ul data-testid="auto-queue" aria-label="Waiting to go" className="mb-2 flex flex-col gap-1">
            {queue.map((message) => (
              <li key={message.cid} className={cn(quiet, 'flex items-center gap-1.5')}>
                <Clock aria-hidden className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">{message.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {notSent ? (
          <p role="status" data-testid="auto-not-sent" className="mb-1 flex items-center gap-1 text-control font-medium text-foreground">
            {notSent}
            <Button size="compact" variant="ghost" className="text-control" disabled={!draft.trim()} onClick={submit}>
              Retry
            </Button>
          </p>
        ) : null}
        <BoxFrame
          field={box}
          onSubmit={submit}
          row={
            <>
              <ModelPicker />
              <UsageRing field={box} />
              <div className="flex-1" />
              {running ? <StopButton onStop={() => void stop()} /> : null}
              <SendButton label={refusing ? 'Say no' : answering ? 'Answer' : 'Send to Auto'} ready={draft.trim() !== ''} />
            </>
          }
        >
          <textarea
            ref={box}
            rows={1}
            aria-label={refusing ? 'Why not' : answering ? 'Your answer' : 'Message'}
            data-testid="auto-box"
            placeholder={refusing ? 'Say no, with a reason' : answering ? 'Your answer' : view?.seed ? 'Say what to do with it' : 'Message Auto'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className={boxField}
          />
        </BoxFrame>
      </div>
    </div>
  );
}

/** The open thread: its header, the thread and the box, on one reading column. */
export function ThreadPane() {
  const talk = React.useRef<HTMLDivElement>(null);
  return (
    <section data-testid="auto-thread" aria-label="Thread" className="auto-ink flex min-w-0 flex-1 flex-col">
      <ThreadHeader />
      <Talk scroller={talk} />
      <Composer talk={talk} />
    </section>
  );
}
