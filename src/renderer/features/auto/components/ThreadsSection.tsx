import * as React from 'react';
import { Plug, SquarePen } from 'lucide-react';
import { isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { selectCurrentLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { SidebarFold } from '@/renderer/features/shell/components/SidebarFold';
import { useShellStore } from '@/renderer/features/shell/store/shellStore';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, IconButton } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { attentionCount } from '../model/listModel';
import { NEW_THREAD } from '../model/pane';
import { openAutoTab, showInAuto } from '../openAutoTab';
import { useAutoStore } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';
import { SnoozeDateHost } from './SnoozeMenu';
import { ThreadList } from './ThreadList';

const UNREACHABLE = "Can't reach Auto.";

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

/**
 * Threads, the sidebar's first section: Auto's list, under a heading that
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
  const inFront = useTabsStore((state) => isAutoLocation(selectCurrentLocation(state)));
  const onNew = useThreadStore((state) => inFront && (state.openId === NEW_THREAD || state.openId === null));
  const libraryOpen = useShellStore((state) => state.libraryOpen);

  const show = React.useCallback(
    (pane: string) => {
      showInAuto(navigateFiles, pane);
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
        <span data-testid="auto-count" aria-label={`${needs} need you`} className="shrink-0 px-1 text-metadata tabular-nums text-foreground-tertiary">
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
        // With Library open, Threads takes the height its rows need up to about half the sidebar; folded, all of it.
        className={cn('shrink pt-2', libraryOpen && 'max-h-[50%]')}
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
          <>
            {!reachable || !loaded ? <OutOfReach /> : null}
            {loaded ? <ThreadList show={show} inFront={inFront} /> : null}
          </>
        )}
      </SidebarFold>
      {/* Outside the section, so a snooze picked from the Auto tab has its dialog while Threads is folded. */}
      <SnoozeDateHost />
    </>
  );
}
