import * as React from 'react';
import { Plug, SquarePen } from 'lucide-react';
import { isAutoLocation, isDigestLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import type { OpenHow } from '@/renderer/features/disk-explorer/navigation/openHow';
import { selectCurrentLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { SidebarFold } from '@/renderer/features/shell/components/SidebarFold';
import { useShellStore } from '@/renderer/features/shell/store/shellStore';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, IconButton } from '@/renderer/shared/ui';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import { cn } from '@/renderer/shared/utils';
import { attentionCount } from '../model/listModel';
import { DIGEST_QUEUE, NEW_THREAD } from '../model/pane';
import { openAutoTab, showInAuto } from '../openAutoTab';
import { useAutoStore } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';
import { SnoozeDateHost } from './SnoozeMenu';
import { DigestRow, ThreadList } from './ThreadList';

const UNREACHABLE = "Can't reach Auto.";
/** Threads' height when the app last closed, in px: a number, never the list. */
const THREADS_HEIGHT = 'auto.threadsHeight';

/** Out of reach: one line and Retry, above the last list read. */
function OutOfReach() {
  const problem = useAutoStore((state) => state.problem);
  const loading = useAutoStore((state) => state.loading);
  const loaded = useAutoStore((state) => state.loaded);
  if (loading && !loaded && !problem) {
    return (
      <p role="status" className="px-sidebar-inset py-1 pl-sidebar-label text-control text-foreground-tertiary">
        Connecting…
      </p>
    );
  }
  return (
    <div
      role="status"
      data-testid="auto-out-of-reach"
      className="flex min-w-0 items-center gap-2 py-1 pl-sidebar-label pr-sidebar-inset text-control text-foreground-tertiary"
    >
      <span className="min-w-0 flex-1 truncate" title={problem ?? UNREACHABLE}>
        {problem ?? UNREACHABLE}
      </span>
      <button
        type="button"
        data-testid="auto-retry"
        disabled={loading}
        onClick={() => void useAutoStore.getState().refresh()}
        className="shrink-0 rounded-sm px-1 font-medium text-foreground-secondary underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40"
      >
        Retry
      </button>
    </div>
  );
}

/** Digest stays available in Primary navigation when Threads is folded. */
export function DigestNavItem({ onNavigate }: { onNavigate?: () => void }) {
  const { navigateFiles } = useShell();
  const available = useAutoStore((state) => Boolean(state.address && state.loaded));
  const inFront = useTabsStore((state) => isDigestLocation(selectCurrentLocation(state)));
  if (!available) return null;
  return <DigestRow inFront={inFront} show={(_pane, how) => {
    showInAuto(navigateFiles, DIGEST_QUEUE, how);
    onNavigate?.();
  }} />;
}

/**
 * Threads, the sidebar's foldable section: Auto's list, under a heading that
 * folds it, with the count of threads that need him and a button for a new
 * thread. A thread picked here shows in the Auto tab, which opens beside
 * the page when there is none; the page stays in its tab.
 */
export function ThreadsSection({ onNavigate }: { onNavigate?: () => void }) {
  const { navigateFiles } = useShell();
  const configured = useAutoStore((state) => state.configured);
  const address = useAutoStore((state) => state.address);
  const loaded = useAutoStore((state) => state.loaded);
  const reachable = useAutoStore((state) => state.reachable);
  const needs = useAutoStore((state) => attentionCount(state.threads));
  const location = useTabsStore(selectCurrentLocation);
  const inFront = isAutoLocation(location);
  const digestInFront = isDigestLocation(location);
  const onNew = useThreadStore((state) => inFront && (state.openId === NEW_THREAD || state.openId === null));
  const libraryOpen = useShellStore((state) => state.libraryOpen);
  const threadsOpen = useShellStore((state) => state.threadsOpen);
  const problem = useAutoStore((state) => state.problem);
  const section = React.useRef<HTMLDivElement>(null);
  // While the list is first read, Threads keeps the height it had when the app last closed, so Library does not move.
  const [kept] = React.useState(() => readPref<number | null>(THREADS_HEIGHT, null));
  const holding = threadsOpen && !!address && !loaded && !problem && typeof kept === 'number' && kept > 0;
  React.useEffect(() => {
    const element = section.current?.closest<HTMLElement>('[data-testid="sidebar-threads"]');
    if (!element || !loaded || !threadsOpen || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => writePref(THREADS_HEIGHT, Math.round(element.getBoundingClientRect().height)), 500);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [loaded, threadsOpen]);

  const show = React.useCallback(
    (pane: string, how: OpenHow = {}) => {
      showInAuto(navigateFiles, pane, how);
      onNavigate?.();
    },
    [navigateFiles, onNavigate],
  );

  const connect = () => {
    openAutoTab(navigateFiles);
    onNavigate?.();
  };

  const trailing = address ? (
    <>
      {needs > 0 ? (
        // Folded, the count is the only sign of what needs him: it is drawn in the text's own colour.
        <span data-testid="auto-count" aria-label={`${needs} need you`} className={cn('shrink-0 px-1 text-metadata tabular-nums', threadsOpen ? 'text-foreground-tertiary' : 'text-foreground')}>
          {needs}
        </span>
      ) : null}
      <IconButton
        label="New thread"
        data-testid="auto-new-thread"
        data-row-id={NEW_THREAD}
        aria-pressed={onNew || undefined}
        variant="frame"
        onClick={() => show(NEW_THREAD)}
        onKeyDown={(event) => {
          // Down, or j, goes on into the list, to its first row.
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || (event.key !== 'ArrowDown' && event.key !== 'j')) return;
          const first = document.querySelector<HTMLElement>('[data-testid="auto-list"] [data-auto-row]');
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
        className={cn('h-6 w-6', onNew && 'bg-sidebar-selected text-foreground')}
      >
        <SquarePen aria-hidden className="h-3.5 w-3.5" />
      </IconButton>
    </>
  ) : null;

  return (
    <>
      <SidebarFold
        fold="threads"
        label="Threads"
        trailing={trailing}
        marks={{ 'data-auto-list': true, 'data-auto-keys': true, 'data-palette-return': true }}
        // With Library open, Threads takes the height its rows need, up to 70% of the room the two sections share,
        // and Library the rest; with Library folded, all of it.
        className={cn('shrink pt-2', libraryOpen && 'max-h-[70%]')}
        style={holding ? { height: kept as number } : undefined}
        wrapHeading={(heading) =>
          address ? (
            <ContextMenu>
              <ContextMenuTrigger asChild>{heading}</ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    useAutoStore.getState().editAddress(true);
                    connect();
                  }}
                >
                  Change Auto address…
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ) : (
            heading
          )
        }
      >
        {!configured ? null : !address ? (
          <div className="px-sidebar-inset">
            <button
              type="button"
              data-testid="auto-connect"
              onClick={connect}
              className="flex h-row-compact w-full min-w-0 items-center gap-sidebar-icon-gap rounded-sidebar-row px-2 text-left text-ui font-sidebar-label text-sidebar-label outline-none transition-hover hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            >
              <Plug aria-hidden className="stroke-sidebar-icon h-sidebar-icon w-sidebar-icon shrink-0 text-sidebar-icon" />
              <span className="min-w-0 flex-1 truncate">Connect Auto…</span>
            </button>
          </div>
        ) : (
          <div ref={section} className="flex min-h-0 flex-col">
            {loaded ? <ThreadList show={show} inFront={inFront} digestInFront={digestInFront} /> : null}
            {/* Said once: with the Auto tab in front its own notice says it. Under the rows, so it does not move them. */}
            {(!reachable || !loaded) && !inFront && !digestInFront ? <OutOfReach /> : null}
          </div>
        )}
      </SidebarFold>
      {/* Outside the section, so a snooze picked from the Auto tab has its dialog while Threads is folded. */}
      <SnoozeDateHost />
    </>
  );
}
