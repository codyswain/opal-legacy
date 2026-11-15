import * as React from 'react';
import { ArrowUp, ChevronDown, ChevronLeft, Clock, Square } from 'lucide-react';
import type { AutoItem, AutoStep } from '@/types/auto';
import { Button, IconButton, Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { Markdown, MarkdownLinksContext } from '../markdown/Markdown';
import { clockTime } from '../model/listModel';
import { NEW_THREAD } from '../model/outbox';
import {
  STEPS_SHOWN,
  failure,
  foldSteps,
  parseEntry,
  sentLine,
  showsNext,
  stepLines,
  turnRuns,
  waitingToGo,
} from '../model/threadModel';
import { modelChoices, useAutoStore } from '../store/autoStore';
import { draftKey, useThreadStore } from '../store/threadStore';
import { EntryCardView, PermissionCard, QuestionCard } from './Cards';

const quiet = 'text-control text-foreground-tertiary';

/** One of his messages. */
function Bubble({ text, faded = false }: { text: string; faded?: boolean }) {
  return (
    <div data-testid="auto-message" className={cn('ml-auto w-fit max-w-lg whitespace-pre-wrap break-words rounded-card bg-surface-active px-3 py-2 text-reply text-foreground', faded && 'opacity-60')}>
      {text}
    </div>
  );
}

/** What Auto did between messages: one grey line per step, folded to the last three. */
function Steps({ steps }: { steps: AutoStep[] }) {
  const { openVault } = React.useContext(MarkdownLinksContext);
  const [open, setOpen] = React.useState(false);
  const lines = stepLines(steps);
  if (lines.length === 0) return null;
  const { earlier, shown } = foldSteps(lines, open);
  const fold = 'w-fit rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus';
  return (
    <div data-testid="auto-steps" className={cn(quiet, 'flex flex-col gap-0.5')}>
      {earlier > 0 ? (
        <button type="button" className={fold} onClick={() => setOpen(true)}>
          {earlier} earlier {earlier === 1 ? 'step' : 'steps'}
        </button>
      ) : open && lines.length > STEPS_SHOWN ? (
        <button type="button" className={fold} onClick={() => setOpen(false)}>
          Show the last {STEPS_SHOWN}
        </button>
      ) : null}
      {shown.map((line, at) => {
        const path = line.path;
        return (
          <div key={at} className="truncate">
            {line.lead}
            {path ? (
              <button
                type="button"
                title={path}
                onClick={(event) => openVault(path, event.metaKey || event.ctrlKey)}
                className="rounded-sm underline decoration-foreground-tertiary/50 underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
              >
                {line.text}
              </button>
            ) : (
              line.text
            )}
          </div>
        );
      })}
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
          {entry.says ? <Bubble text={entry.says} /> : null}
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
  node: React.ReactNode;
}

const isQuiet = (item: AutoItem): boolean => item.role === 'steps' || item.role === 'asked' || item.role === 'note';
/** Whether an item draws anything. */
const draws = (item: AutoItem): boolean =>
  item.role === 'steps' ? stepLines(item.steps).length > 0 : item.role === 'assistant' ? item.text !== '' : true;

/** The thread itself. It stays at the end while text arrives, unless he has scrolled up. */
function Talk({ onScrolled }: { onScrolled: (scrolled: boolean) => void }) {
  const view = useThreadStore((state) => state.view);
  const pending = useThreadStore((state) => state.pending);
  const loading = useThreadStore((state) => state.loading);
  const problem = useThreadStore((state) => state.problem);
  const scroller = React.useRef<HTMLDivElement>(null);
  const stuck = React.useRef(true);
  const threadId = view?.thread.id ?? null;

  React.useEffect(() => {
    stuck.current = true;
  }, [threadId]);
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (stuck.current) element.scrollTop = element.scrollHeight;
    onScrolled(element.scrollTop > 0);
  });

  const rows: Row[] = [];
  if (!view) {
    if (problem) rows.push({ key: 'problem', quiet: false, node: <p role="alert" className="text-ui text-foreground-secondary">{problem}</p> });
    else if (loading) rows.push({ key: 'loading', quiet: false, node: <p role="status" className="text-ui text-foreground-tertiary">Loading…</p> });
  } else {
    const title = view.thread.title;
    const failed = failure(view);
    const entry = view.seed ? parseEntry(view.seed) : null;
    const { send, handOver } = useThreadStore.getState();
    const items = (list: readonly AutoItem[], prefix: string) => {
      list.forEach((item, at) => {
        if (draws(item)) rows.push({ key: `${prefix}${at}`, quiet: isQuiet(item), node: <Item item={item} title={title} /> });
      });
    };
    items(view.history, 'h');
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
              <button
                key={line}
                type="button"
                onClick={() => void send(line, false)}
                className="max-w-lg rounded-card border border-border-strong px-3 py-1.5 text-left text-ui text-foreground-secondary outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
              >
                {line}
              </button>
            ))}
          </div>
        ),
      });
    }
  }

  return (
    <div
      ref={scroller}
      data-testid="auto-talk"
      className="auto-talk min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget;
        stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        onScrolled(element.scrollTop > 0);
      }}
    >
      <div className="mx-auto flex max-w-reading flex-col px-6 pb-6 pt-2">
        {rows.map((row, at) => (
          <div key={row.key} className={cn('flex flex-col', at === 0 ? '' : row.quiet && rows[at - 1].quiet ? 'mt-1' : 'mt-4')}>
            {row.node}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The title; a click turns it into a field. Enter or leaving the field renames, Escape does not. */
function Title({ title, canRename }: { title: string; canRename: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [typed, setTyped] = React.useState(title);
  const cancelled = React.useRef(false);
  if (!canRename) return <h1 className="min-w-0 truncate text-ui font-medium text-foreground">{title}</h1>;
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
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
        className="h-control-compact min-w-0 flex-1 rounded-control border border-border-strong bg-canvas px-2 text-ui font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
    );
  }
  return (
    <h1 className="-ml-1.5 min-w-0">
      <button
        type="button"
        title="Rename"
        data-testid="auto-title"
        onClick={() => {
          cancelled.current = false;
          setTyped(title);
          setEditing(true);
        }}
        className="block max-w-full truncate rounded-control px-1.5 py-1 text-ui font-medium text-foreground outline-none transition-hover hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus"
      >
        {title || 'Untitled'}
      </button>
    </h1>
  );
}

function ThreadHeader({ narrow, scrolled }: { narrow: boolean; scrolled: boolean }) {
  const openId = useThreadStore((state) => state.openId);
  const view = useThreadStore((state) => state.view);
  const newModel = useThreadStore((state) => state.newModel);
  const status = useAutoStore((state) => state.status);
  const { open, stop, setModel } = useThreadStore.getState();
  const isNew = openId === null || openId === NEW_THREAD;
  const models = modelChoices(status);
  const model = isNew ? newModel : view?.thread.model ?? '';
  const label = models.find(([key]) => key === model)?.[1] ?? model;
  return (
    <header className={cn('auto-beside-talk flex h-header shrink-0 items-center gap-2 border-b pl-6', scrolled ? 'border-border-subtle' : 'border-transparent')}>
      {narrow ? (
        <IconButton label="All threads" data-testid="auto-back" className="-ml-2" onClick={() => open(null)}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </IconButton>
      ) : null}
      {isNew ? <Title title="New thread" canRename={false} /> : view ? <Title key={view.thread.id} title={view.thread.title} canRename /> : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {isNew || view ? (
          <Menu>
            <MenuTrigger asChild>
              <Button size="compact" variant="ghost" aria-label={`Model: ${label}`} data-testid="auto-model" className="font-normal text-foreground-tertiary">
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
        {turnRuns(view) ? (
          <Button size="compact" variant="outline" data-testid="auto-stop" onClick={() => void stop()}>
            <Square aria-hidden className="h-2.5 w-2.5 fill-current" />
            Stop
          </Button>
        ) : null}
      </div>
    </header>
  );
}

/** The box. Enter sends, Shift+Enter adds a line. What waits behind a running turn shows above it. */
function Composer() {
  const openId = useThreadStore((state) => state.openId);
  const view = useThreadStore((state) => state.view);
  const pending = useThreadStore((state) => state.pending);
  const key = draftKey(openId);
  const draft = useThreadStore((state) => state.box.drafts[key] ?? '');
  const notSent = useThreadStore((state) => (state.notSent?.thread === key ? state.notSent.text : null));
  const { send, setDraft } = useThreadStore.getState();
  const box = React.useRef<HTMLTextAreaElement>(null);
  const queue = view?.live ? waitingToGo(view, pending) : [];

  // The box grows with its text, to a part of the window's height.
  React.useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [draft]);
  // A thread opens with the caret in its box.
  React.useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, [key]);

  const submit = () => {
    if (draft.trim()) void send(draft);
  };

  return (
    <div className="auto-beside-talk shrink-0 pb-4 pl-6">
      <div className="mx-auto max-w-reading">
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
          <p role="status" data-testid="auto-not-sent" className="mb-1 text-control font-medium text-foreground">{notSent}</p>
        ) : null}
        <form
          className="flex items-end gap-2 rounded-card border border-border-strong bg-surface py-1.5 pl-3 pr-1.5 focus-within:border-foreground-tertiary"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={box}
            rows={1}
            aria-label="Message"
            data-testid="auto-box"
            placeholder={view?.seed ? 'Say what to do with it' : 'Message Auto'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="my-1 min-w-0 flex-1 resize-none bg-transparent text-reply text-foreground outline-none placeholder:text-icon"
          />
          <IconButton type="submit" label="Send to Auto" variant="subtle" disabled={!draft.trim()}>
            <ArrowUp aria-hidden className="h-4 w-4" />
          </IconButton>
        </form>
      </div>
    </div>
  );
}

/** The open thread: its header, the thread and the box. */
export function ThreadPane({ narrow }: { narrow: boolean }) {
  // Once the thread is scrolled, a hairline parts it from the header it passes under.
  const [scrolled, setScrolled] = React.useState(false);
  return (
    <section data-testid="auto-thread" aria-label="Thread" className="flex min-w-0 flex-1 flex-col">
      <ThreadHeader narrow={narrow} scrolled={scrolled} />
      <Talk onScrolled={setScrolled} />
      <Composer />
    </section>
  );
}
