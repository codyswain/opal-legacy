import * as React from 'react';
import type { AutoThread } from '@/types/auto';
import { Button, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuShortcut, ContextMenuTrigger } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { awayDetail, returnsLine } from '../model/awayModel';
import { dayTitle } from '../model/digestModel';
import { listView } from '../model/listModel';
import { AWAY, DIGEST_QUEUE } from '../model/pane';
import { keepPlace, placeIn, placeOf } from '../model/places';
import { restoreThread, snoozeThread } from '../store/actions';
import { useAutoStore } from '../store/autoStore';
import { useDigestStore } from '../store/digestStore';
import { useThreadStore } from '../store/threadStore';
import { PAGE_FIRST, PAGE_TOP, byKey, focusPageAfterClose, focusRowNow, keepFocus, pageNext, pageRowElement, rovingTarget, setPageOrder } from './focus';
import { paneHeader } from './Box';
import { SnoozeButton } from './SnoozeMenu';
import { ThreadLine } from './ThreadLine';
import { RowMenuItems, useNow } from './ThreadList';

/** Where the page was scrolled to, and the row that was its Tab stop: coming back to it finds both. */
const AWAY_PLACE = 'away';
let lastActive: string | null = null;
const ARCHIVED_ALL = ':archived-all';
/** An archived digest's row, by its day. */
const digestRow = (date: string): string => `:digest:${date}`;

const quiet = 'text-control text-foreground-tertiary';

/** Opens a thread or a digest from the page; the sidebar's Put away row stays marked and leads back here. */
const openFromPage = (pane: string): void => useThreadStore.getState().open(pane, { fromAway: true });

interface RowProps {
  id: string;
  /** The thread's id, for a thread's row; a digest's row has none. */
  threadId?: string;
  title: string;
  tabStop: boolean;
  /** What is said under the title. */
  line: React.ReactNode;
  bringBack: () => void;
  /** The row's own words for its Bring back button's test. */
  backTestId: string;
  testId: string;
  onOpen: () => void;
  /** S on the row: the snooze menu. Only for what is snoozed or waiting. */
  snooze?: AutoThread;
  menu: (close: { snooze: () => void }) => React.ReactNode;
}

/**
 * One row of the page: the title, what it waits for or when it returns or
 * when it was archived, and "Bring back" at its right. A click opens it to
 * read. E brings it back, S snoozes it to another time.
 */
function AwayRow({ id, threadId, title, tabStop, line, bringBack, backTestId, testId, onOpen, snooze, menu }: RowProps) {
  const [snoozing, setSnoozing] = React.useState(false);
  const container = React.useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.shiftKey && event.key === 'F10') {
      event.preventDefault();
      const box = container.current?.getBoundingClientRect();
      container.current?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: (box?.left ?? 0) + 24, clientY: (box?.top ?? 0) + 24 }));
      return;
    }
    if (event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'e') bringBack();
    else if (key === 's' && snooze) setSnoozing(true);
    else return;
    event.preventDefault();
  };
  const shows = 'opacity-0 group-hover:opacity-100 group-has-[[data-away-row]:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100';
  return (
    <li data-testid={testId}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={container}
            data-thread-id={threadId}
            className="group relative -mx-3 flex items-start rounded-row transition-hover hover:bg-surface-hover has-[[data-away-row]:focus-visible]:ring-2 has-[[data-away-row]:focus-visible]:ring-inset has-[[data-away-row]:focus-visible]:ring-focus"
          >
            <button
              type="button"
              data-away-row
              data-row-id={id}
              tabIndex={tabStop ? 0 : -1}
              aria-keyshortcuts={snooze ? 'E S' : 'E'}
              title={title}
              onClick={onOpen}
              onKeyDown={onKeyDown}
              className="flex min-w-0 flex-1 flex-col items-start rounded-row px-3 py-2 text-left outline-none"
            >
              <span className="w-full truncate text-reply font-medium text-foreground">{title}</span>
              {line}
            </button>
            <div className="flex shrink-0 items-center gap-0.5 py-1.5 pr-1.5">
              {snooze ? (
                <span className={shows}>
                  <SnoozeButton thread={snooze} from="page" open={snoozing} onOpenChange={setSnoozing} tabIndex={-1} />
                </span>
              ) : null}
              <Button size="compact" variant="outline" tabIndex={-1} data-testid={backTestId} onMouseDown={keepFocus} onClick={bringBack}>
                Bring back
              </Button>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid={`auto-row-menu-${id}`} onCloseAutoFocus={(event) => focusPageAfterClose(event, id)}>
          {menu({ snooze: () => setSnoozing(true) })}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

function Group({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="flex min-h-control items-center pt-3 text-label text-foreground-tertiary">{label}</h2>
      <ul data-testid={testId} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </section>
  );
}

/**
 * What is put away, in the Auto tab: the threads waiting on a reply, the
 * snoozed ones and the archive, under a heading each, as the phone's Put
 * away screen has them. The archive is read each time the page opens, its
 * newest ten and then all of it. Every row can be read and brought back.
 */
export function AwayPane() {
  const threads = useAutoStore((state) => state.threads);
  const archive = useAutoStore((state) => state.archive);
  const pageFocus = useAutoStore((state) => state.pageFocus);
  const archivedDays = useDigestStore((state) => state.archivedDays);
  const now = useNow();
  const view = React.useMemo(() => listView(threads), [threads]);
  const pane = React.useRef<HTMLElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState<string | null>(lastActive);
  const moreArchived = archive.total > archive.threads.length;

  const order = [
    ...view.waiting.map((thread) => thread.id),
    ...view.snoozed.map((thread) => thread.id),
    ...archivedDays.map(digestRow),
    ...archive.threads.map((thread) => thread.id),
    ...(moreArchived ? [ARCHIVED_ALL] : []),
  ];
  setPageOrder(order);
  const tabStop = active && order.includes(active) ? active : (order[0] ?? null);

  // Read on every opening. By a key, the keyboard goes onto the page; by the pointer it stays where it was.
  React.useEffect(() => {
    useAutoStore.getState().openAway();
    if (byKey()) useAutoStore.getState().requestPageFocus(PAGE_FIRST);
  }, []);

  // Where he left it.
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = placeOf(AWAY_PLACE)?.top ?? 0;
  }, []);

  // A row an action asked to focus takes the keyboard once it is drawn. One still being read waits for the archive.
  React.useLayoutEffect(() => {
    if (!pageFocus) return;
    const element =
      pageFocus === PAGE_FIRST ? pane.current?.querySelector<HTMLElement>('[data-away-row][tabindex="0"]')
      : pageFocus === PAGE_TOP ? null
      : pageRowElement(pageFocus);
    if (!element && pageFocus !== PAGE_TOP && archive.loading) return;
    (element ?? pane.current?.querySelector<HTMLElement>('[data-away-row][tabindex="0"]') ?? pane.current)?.focus();
    useAutoStore.getState().requestPageFocus(null);
  });

  // The keyboard stays with a row drawn again in another group, as a thread put to wait or snoozed again moves.
  const keyboardOn = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const was = keyboardOn.current;
    if (!was || was.isConnected || document.activeElement !== document.body) return;
    keyboardOn.current = null;
    const id = was.getAttribute('data-row-id');
    if (!id || !byKey()) return;
    // A row that left the page by a key hands the keyboard to the one in its place.
    (pageRowElement(id) ?? pageRowElement(pageNext(id, (row) => order.includes(row)) ?? ''))?.focus();
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute('data-away-row') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') {
      // Back to the sidebar, with the keyboard on its Put away row.
      event.preventDefault();
      focusRowNow(AWAY);
      return;
    }
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-away-row]')];
    const to = rovingTarget(event.key, all.indexOf(target), all.length);
    if (to === null) return;
    event.preventDefault();
    all[to].focus();
  };

  const threadRow = (thread: AutoThread, kind: 'waiting' | 'snoozed' | 'archived') => {
    const title = thread.title || 'Untitled';
    const bringBack = (): void => void (kind === 'archived' ? restoreThread(thread, { from: 'page' }) : snoozeThread(thread, null, { from: 'page' }));
    const line =
      kind === 'snoozed' ? (
        <span className="flex w-full min-w-0 flex-col">
          <span data-testid="auto-returns" className="text-control text-foreground">{returnsLine(thread, now)}</span>
          {awayDetail(thread, now) ? <span className={cn(quiet, 'truncate')}>{awayDetail(thread, now)}</span> : null}
        </span>
      ) : (
        <ThreadLine thread={thread} away={kind} now={now} className="mt-0.5" />
      );
    return (
      <AwayRow
        key={thread.id}
        id={thread.id}
        threadId={thread.id}
        title={title}
        tabStop={tabStop === thread.id}
        line={line}
        bringBack={bringBack}
        backTestId={kind === 'archived' ? `auto-restore-${thread.id}` : `auto-back-${thread.id}`}
        testId={`auto-row-${thread.id}`}
        onOpen={() => openFromPage(thread.id)}
        snooze={kind === 'archived' ? undefined : thread}
        menu={() =>
          kind === 'archived' ? (
            <ContextMenuItem onSelect={bringBack}>
              Bring back
              <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut>
            </ContextMenuItem>
          ) : (
            <RowMenuItems thread={thread} now={now} snoozed marked={thread.desk !== null} from="page" mark={() => void useAutoStore.getState().desk(thread, thread.desk === null)} show={openFromPage} />
          )
        }
      />
    );
  };

  const digestAwayRow = (date: string) => {
    const id = digestRow(date);
    const bringBack = () => {
      if (byKey()) useAutoStore.getState().requestPageFocus(pageNext(id) ?? PAGE_TOP);
      void useDigestStore.getState().archive(date, false);
    };
    return (
      <AwayRow
        key={id}
        id={id}
        title="Digest"
        tabStop={tabStop === id}
        line={<span className={cn(quiet, 'mt-0.5')}>{dayTitle(date)}</span>}
        bringBack={bringBack}
        backTestId={`auto-restore-digest-${date}`}
        testId={`auto-archived-digest-${date}`}
        onOpen={() => {
          openFromPage(DIGEST_QUEUE);
          void useDigestStore.getState().show(date);
        }}
        menu={() => (
          <ContextMenuItem onSelect={bringBack}>
            Bring back
            <ContextMenuShortcut aria-hidden>E</ContextMenuShortcut>
          </ContextMenuItem>
        )}
      />
    );
  };

  const archiveEmpty = archive.threads.length === 0 && archivedDays.length === 0;

  return (
    <section
      ref={pane}
      tabIndex={-1}
      data-testid="auto-away-page"
      aria-label="Put away"
      className="auto-ink flex min-w-0 flex-1 flex-col outline-none"
      onFocus={(event) => {
        const id = (event.target as HTMLElement).getAttribute?.('data-row-id');
        if (id && (event.target as HTMLElement).hasAttribute('data-away-row')) {
          setActive(id);
          lastActive = id;
          keyboardOn.current = event.target as HTMLElement;
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget || (event.target as HTMLElement).isConnected) keyboardOn.current = null;
      }}
    >
      <header className={paneHeader}>
        <div className="auto-column">
          <div className="flex h-header items-center">
            <h1 className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">Put away</h1>
          </div>
        </div>
      </header>
      <div
        ref={scroller}
        data-testid="auto-away-scroll"
        className="auto-talk min-h-0 flex-1 overflow-y-auto"
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          keepPlace(AWAY_PLACE, placeIn(event.currentTarget));
        }}
      >
        <div className="auto-column flex flex-col pb-6">
          {view.waiting.length > 0 ? (
            <Group label="Waiting on a reply" testId="auto-waiting">
              {view.waiting.map((thread) => threadRow(thread, 'waiting'))}
            </Group>
          ) : null}
          {view.snoozed.length > 0 ? (
            <Group label="Snoozed" testId="auto-snoozed">
              {view.snoozed.map((thread) => threadRow(thread, 'snoozed'))}
            </Group>
          ) : null}
          <Group label="Archived" testId="auto-archived">
            {archivedDays.map(digestAwayRow)}
            {archive.threads.map((thread) => threadRow(thread, 'archived'))}
            {moreArchived ? (
              <li className="py-2">
                <Button
                  size="compact"
                  variant="outline"
                  data-away-row
                  data-row-id={ARCHIVED_ALL}
                  data-testid="auto-archived-all"
                  tabIndex={tabStop === ARCHIVED_ALL ? 0 : -1}
                  disabled={archive.loading}
                  onClick={() => void useAutoStore.getState().loadArchive(true)}
                >
                  Show all {archive.total}
                </Button>
              </li>
            ) : null}
            {archiveEmpty ? (
              <li data-testid="auto-archived-empty" role={archive.problem ? 'alert' : undefined} className={cn(quiet, 'py-2')}>
                {archive.problem ?? (archive.loaded ? 'Nothing is archived.' : 'Loading the archive.')}
              </li>
            ) : null}
          </Group>
        </div>
      </div>
    </section>
  );
}
