import * as React from 'react';
import { Archive, ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, MoreHorizontal, Square } from 'lucide-react';
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
import { clockTime, fromDigest } from '../model/listModel';
import { NEW_THREAD, paneThread } from '../model/pane';
import { keepPlace, placeIn, placeOf, threadPlace } from '../model/places';
import { failure, parseEntry, sentLine, showsNext, stepLines, stepsSummary, turnRuns, turnStart, waitingToGo } from '../model/threadModel';
import { archiveThread, snoozeThread } from '../store/actions';
import { modelChoices, useAutoStore } from '../store/autoStore';
import { draftKey, useThreadStore } from '../store/threadStore';
import { EntryCardView, GrantCard, PermissionCard, QuestionCard } from './Cards';
import { SaidBar } from './SaidBar';
import { SnoozeButton } from './SnoozeMenu';

const quiet = 'text-control text-foreground-tertiary';
const stepLink = 'rounded-sm underline decoration-foreground-tertiary/50 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus';

/** One of his messages. */
function Bubble({ text, faded = false }: { text: string; faded?: boolean }) {
  return (
    <div data-testid="auto-message" className={cn('ml-auto w-fit max-w-lg whitespace-pre-wrap break-words rounded-card bg-surface-active px-3 py-2 text-reply text-foreground', faded && 'opacity-60')}>
      {text}
    </div>
  );
}

/** What Auto did between messages: one grey line, which opens to every step. */
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
  // One step is its own line: there is nothing to open.
  if (lines.length === 1) return <div data-testid="auto-steps" className={quiet}>{line(0)}</div>;
  return (
    <div data-testid="auto-steps" className={cn(quiet, 'flex flex-col gap-0.5')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-fit max-w-full items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0 truncate">{stepsSummary(steps)}</span>
        <ChevronRight aria-hidden className={cn('h-3 w-3 shrink-0 transition-transform duration-quick', open && 'rotate-90')} />
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
        <p className={quiet}>
          {item.text} <span className="font-medium text-foreground-secondary">{item.answer || 'No answer'}</span>
        </p>
      );
    case 'note':
      return <p className={quiet}>{item.text}</p>;
  }
}

/** One row of the thread. Quiet rows (steps, a folded question, a note) sit close to each other. */
interface Row {
  key: string;
  quiet: boolean;
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
          className="max-w-lg rounded-card border border-border-strong px-3 py-1.5 text-left text-ui text-foreground-secondary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
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
function Talk({ scroller, onScrolled }: { scroller: React.RefObject<HTMLDivElement>; onScrolled: (scrolled: boolean) => void }) {
  const own = useThreadStore((state) => state.view);
  // What the pane held before a thread never seen was opened: it stays until that thread arrives, or 300 ms.
  const ghost = useThreadStore((state) => state.ghost);
  const view = own ?? ghost;
  const pending = useThreadStore((state) => state.pending);
  const slow = useThreadStore((state) => state.slow);
  const problem = useThreadStore((state) => state.problem);
  const openedUnread = useThreadStore((state) => state.openedUnread);
  const loading = useThreadStore((state) => state.loading);
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
    onScrolled(element.scrollTop > 0);
  });

  const rows: Row[] = [];
  if (!view) {
    if (problem) rows.push({ key: 'problem', quiet: false, node: <p role="alert" className="text-ui text-foreground-secondary">{problem}</p> });
    else if (slow) rows.push({ key: 'loading', quiet: false, node: <p role="status" className="text-ui text-foreground-tertiary">Loading…</p> });
    // A new thread shows his words at once, on their way, before the service has made the thread.
    for (const message of pending) rows.push({ key: `p${message.cid}`, quiet: false, node: <Bubble text={message.text} faded /> });
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
        rows.push({ key: `${prefix}${at}`, quiet: isQuiet(item), anchor, node: <Item item={item} title={title} /> });
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
    if (!view.live) for (const message of pending) rows.push({ key: `p${message.cid}`, quiet: false, node: <Bubble text={message.text} faded /> });
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
          onScrolled(element.scrollTop > 0);
        }}
      >
        {/* What the pane held before is only shown, never acted on: its cards and buttons belong to another thread. */}
        <div aria-hidden={own ? undefined : ghost ? true : undefined} className={cn('auto-column relative flex flex-col pb-6 pt-2', !own && ghost && 'pointer-events-none')}>
          {rows.map((row, at) => (
            <div key={row.key} data-row={row.key} data-anchor={row.anchor || undefined} className={cn('flex flex-col', at === 0 ? '' : row.quiet && rows[at - 1].quiet ? 'mt-1' : 'mt-4')}>
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

/** The title; a click turns it into a field. Enter or leaving the field renames, Escape does not. */
function Title({ title, canRename, editing, setEditing }: { title: string; canRename: boolean; editing: boolean; setEditing: (editing: boolean) => void }) {
  const [typed, setTyped] = React.useState(title);
  const cancelled = React.useRef(false);
  React.useEffect(() => {
    if (editing) {
      cancelled.current = false;
      setTyped(title);
    }
    // Only when the field opens: the title may change under it.
  }, [editing]);
  if (!canRename) return <h1 className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">{title}</h1>;
  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Thread title"
        value={typed}
        maxLength={120}
        onChange={(event) => setTyped(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          if (!cancelled.current) void useThreadStore.getState().rename(typed);
          setEditing(false);
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
  return (
    <h1 className="-ml-1.5 min-w-0 flex-1">
      <button
        type="button"
        title="Rename"
        data-testid="auto-title"
        onClick={() => setEditing(true)}
        className="block max-w-full truncate rounded-control px-1.5 py-1 text-ui font-medium text-foreground outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus"
      >
        {title || 'Untitled'}
      </button>
    </h1>
  );
}

/** Snooze, Done, Archive and a "…" menu for the open thread: the same as its row offers. */
function ThreadActions({ thread, onRename }: { thread: AutoThread; onRename: () => void }) {
  const [now] = React.useState(() => Date.now());
  const marked = thread.desk !== null;
  return (
    <>
      <SnoozeButton thread={thread} now={now} from="pane" />
      {fromDigest(thread) ? (
        <IconButton label="Done" data-testid="auto-done-open" onClick={() => void archiveThread(thread, { done: true, from: 'pane' })}>
          <Check aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
      <IconButton label="Archive" data-testid="auto-archive-open" onClick={() => void archiveThread(thread, { from: 'pane' })}>
        <Archive aria-hidden className="h-3.5 w-3.5" />
      </IconButton>
      <Menu>
        <MenuTrigger asChild>
          <IconButton label="Thread menu" data-testid="auto-thread-menu" className="-mr-1.5">
            <MoreHorizontal aria-hidden className="h-3.5 w-3.5" />
          </IconButton>
        </MenuTrigger>
        <MenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Rename moves the keyboard to the title; anything else returns it to the box.
            if (!(document.activeElement instanceof HTMLInputElement)) useThreadStore.getState().focusBox();
          }}
        >
          {thread.snoozed !== null ? <MenuItem onSelect={() => void snoozeThread(thread, null, { from: 'pane' })}>Bring back</MenuItem> : null}
          <MenuItem onSelect={() => void useAutoStore.getState().desk(thread, !marked)}>{marked ? 'Take off the Mac mark' : 'Mark for the Mac'}</MenuItem>
          <MenuItem onSelect={() => window.setTimeout(onRename, 0)}>Rename</MenuItem>
        </MenuContent>
      </Menu>
    </>
  );
}

function ThreadHeader({ narrow, scrolled }: { narrow: boolean; scrolled: boolean }) {
  const openId = useThreadStore((state) => state.openId);
  const view = useThreadStore((state) => state.view);
  const newModel = useThreadStore((state) => state.newModel);
  const status = useAutoStore((state) => state.status);
  // The list's own entry: the title shows from it while the thread loads, or cannot be read.
  const entry = useAutoStore((state) => state.threads.find((thread) => thread.id === openId));
  const renaming = useThreadStore((state) => state.renaming);
  // While the pane still holds the thread before, its header does too.
  const ghost = useThreadStore((state) => (state.view ? null : state.ghost));
  const { setModel, setRenaming } = useThreadStore.getState();
  const isNew = paneThread(openId) === null;
  const thread = isNew ? null : ghost?.thread ?? entry ?? view?.thread ?? null;
  const models = modelChoices(status);
  const model = isNew ? newModel : thread?.model ?? '';
  const label = models.find(([key]) => key === model)?.[1] ?? model;

  /** Back to the list, with the keyboard on the row he came from. */
  const back = () => {
    useAutoStore.getState().requestFocus(openId ?? NEW_THREAD);
    useThreadStore.getState().open(null);
  };

  return (
    <header className={cn('auto-beside-talk shrink-0 border-b', scrolled ? 'border-border-subtle' : 'border-transparent')}>
      <div className="auto-column flex h-header items-center gap-1">
        {narrow ? (
          <IconButton label="All threads" data-testid="auto-back" className="-ml-2" onClick={back}>
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </IconButton>
        ) : null}
        {isNew ? (
          <Title title="New thread" canRename={false} editing={false} setEditing={setRenaming} />
        ) : (
          <Title key={openId} title={thread?.title ?? ''} canRename={thread !== null && !ghost} editing={renaming && !ghost} setEditing={setRenaming} />
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {isNew || thread ? (
            <Menu>
              <MenuTrigger asChild>
                <Button size="compact" variant="ghost" aria-label={`Model: ${label}`} data-testid="auto-model" className={cn('font-normal text-foreground-tertiary', isNew && '-mr-2')}>
                  {label}
                  <ChevronDown aria-hidden className="h-3 w-3" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuRadioGroup value={model} onValueChange={(value) => void setModel(value)}>
                  {models.map(([key, name]) => (
                    <MenuRadioItem key={key} value={key}>{name}</MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
          ) : null}
          {thread && !ghost ? <ThreadActions thread={thread} onRename={() => setRenaming(true)} /> : null}
        </div>
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

/**
 * The box. Enter sends, Shift+Enter adds a line. While a question waits it
 * is the answer field. What waits behind a running turn shows above it, and
 * Stop sits beside Send while a turn runs.
 */
function Composer({ narrow, talk }: { narrow: boolean; talk: React.RefObject<HTMLDivElement> }) {
  const openId = useThreadStore((state) => state.openId);
  const view = useThreadStore((state) => state.view);
  const pending = useThreadStore((state) => state.pending);
  const boxFocus = useThreadStore((state) => state.boxFocus);
  const key = draftKey(openId);
  const draft = useThreadStore((state) => state.box.drafts[key] ?? '');
  const notSent = useThreadStore((state) => (state.notSent?.thread === key ? state.notSent.text : null));
  const { send, setDraft, stop } = useThreadStore.getState();
  const box = React.useRef<HTMLTextAreaElement>(null);
  const queue = view?.live ? waitingToGo(view, pending) : [];
  const answering = view?.question != null;
  // A send he is asked to allow: words here are a "no" with a reason, and nothing here is a yes.
  const refusing = view?.question?.kind === 'grant';
  const running = turnRuns(view);
  useGrow(box, draft);

  // A thread opens with the caret in its box, and the keyboard comes back to it after an answer, Stop or a rename.
  React.useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, [boxFocus]);

  const submit = () => {
    if (draft.trim()) void send(draft);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      // Out of the box, onto the open thread's row. Narrow, that is back in the list. A turn is never stopped this way.
      event.preventDefault();
      useAutoStore.getState().requestFocus(openId ?? NEW_THREAD);
      if (narrow) useThreadStore.getState().open(null);
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
        {/* With the list hidden, what the last action did shows here, above the box and never over it. */}
        {narrow ? <SaidBar className="mb-2" /> : null}
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
        <form
          className="flex items-end gap-1.5 rounded-card border border-border-strong bg-surface py-1.5 pl-3 pr-1.5 focus-within:border-foreground-tertiary"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
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
            className="my-1 min-w-0 flex-1 resize-none bg-transparent text-reply text-foreground outline-none placeholder:text-icon"
          />
          {running ? (
            <IconButton label="Stop" shortcut="⌘." variant="outline" data-testid="auto-stop" onClick={() => void stop()}>
              <Square aria-hidden className="h-2.5 w-2.5 fill-current" />
            </IconButton>
          ) : null}
          <IconButton type="submit" label={refusing ? 'Say no' : answering ? 'Answer' : 'Send to Auto'} shortcut="↩" variant="subtle" disabled={!draft.trim()}>
            <ArrowUp aria-hidden className="h-4 w-4" />
          </IconButton>
        </form>
      </div>
    </div>
  );
}

/** The open thread: its header, the thread and the box, on one reading column. */
export function ThreadPane({ narrow }: { narrow: boolean }) {
  // Once the thread is scrolled, a hairline parts it from the header it passes under.
  const [scrolled, setScrolled] = React.useState(false);
  const talk = React.useRef<HTMLDivElement>(null);
  return (
    <section data-testid="auto-thread" aria-label="Thread" className="flex min-w-0 flex-1 flex-col">
      <ThreadHeader narrow={narrow} scrolled={scrolled} />
      <Talk scroller={talk} onScrolled={setScrolled} />
      <Composer narrow={narrow} talk={talk} />
    </section>
  );
}
