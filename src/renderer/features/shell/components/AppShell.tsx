import * as React from 'react';
import { useAutoTabName } from '@/renderer/features/auto/useAutoTabName';
import { locationName } from '@/renderer/features/disk-explorer/components/tabLabels';
import { useDiskSync } from '@/renderer/features/disk-explorer/hooks/useDiskSync';
import { usePinsSync } from '@/renderer/features/disk-explorer/hooks/usePinsSync';
import { useHiddenSync } from '@/renderer/features/disk-explorer/hooks/useHiddenSync';
import { namesHidden, useHiddenStore } from '@/renderer/features/disk-explorer/store/hiddenStore';
import { locationPath } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import {
  selectCurrentLocation,
  useTabsStore,
  type Pane,
} from '@/renderer/features/disk-explorer/store/tabsStore';
import { AddressProvider, PaneProvider } from '@/renderer/features/disk-explorer/panes/PaneContext';
import {
  MIN_PANE_COLUMN,
  fitsTwoPanes,
  leftPaneWidth,
  splitFor,
} from '@/renderer/features/disk-explorer/panes/paneLayout';
import { TAB_DRAG_TYPE } from '@/renderer/features/disk-explorer/components/TabStrip';
import { useShell } from '../context/ShellContext';
import {
  DEFAULT_SHELL_PREFERENCES,
  SHELL_LIMITS,
  useShellStore,
} from '../store/shellStore';
import {
  DaySidebar,
  daySidebarMaxWidth,
  daySidebarShown,
  daySidebarWidth,
  DAY_SIDEBAR_LIMITS,
  useDaySidebarStore,
} from '@/renderer/features/day-sidebar';
import { cn } from '@/renderer/shared/utils';
import { PaneDivider } from './PaneDivider';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { Titlebar } from './Titlebar';
import { WorkspaceSidebar } from './WorkspaceSidebar';

export const SHELL_BREAKPOINTS = {
  medium: 800,
  wide: 1200,
} as const;

export type ShellLayout = 'narrow' | 'medium' | 'wide';

export function shellLayoutForWidth(width: number): ShellLayout {
  if (width >= SHELL_BREAKPOINTS.wide) return 'wide';
  if (width >= SHELL_BREAKPOINTS.medium) return 'medium';
  return 'narrow';
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? SHELL_BREAKPOINTS.wide : window.innerWidth;
}

function useShellViewport(): { layout: ShellLayout; width: number } {
  const [width, setWidth] = React.useState(viewportWidth);

  React.useEffect(() => {
    const update = () => setWidth(viewportWidth());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return { layout: shellLayoutForWidth(width), width };
}

/** The medium layout keeps at least about 560px for the page. */
const MEDIUM_SIDEBAR_MAX = 240;

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Escape closes an overlay, and Tab stays inside it. */
function overlayKeyDown(
  overlay: React.RefObject<HTMLElement>,
  close: () => void
): (event: React.KeyboardEvent<HTMLDivElement>) => void {
  return (event) => {
    // A menu opened from the overlay portals out of it and closes on its own Escape.
    if (!overlay.current?.contains(event.target as Node)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...overlay.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

interface AppShellProps {
  children: React.ReactNode;
}

const EMPTY_PANES: Pane[] = [];

/**
 * The panes the page area draws: both when they fit side by side, else only
 * the active one, full width. The other keeps its tabs for when the window
 * widens.
 */
export function shownPanes(panes: readonly Pane[], activePaneId: string, room: number): Pane[] {
  if (panes.length < 2 || fitsTwoPanes(room)) return [...panes];
  return panes.filter((pane) => pane.id === activePaneId);
}

/** Whether a drag carries a tab from a row of tabs. */
const carriesTab = (event: React.DragEvent) => event.dataTransfer.types.includes(TAB_DRAG_TYPE);

export function AppShell({ children }: AppShellProps) {
  const persistedSidebarOpen = useShellStore((state) => state.sidebarOpen);
  const sidebarWidth = useShellStore((state) => state.sidebarWidth);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const narrowSidebarOpen = useShellStore(
    (state) => state.narrowSidebarOpen
  );
  const setNarrowLayout = useShellStore((state) => state.setNarrowLayout);
  const closeNarrowSidebarState = useShellStore(
    (state) => state.closeNarrowSidebar
  );
  const setSidebarWidth = useShellStore((state) => state.setSidebarWidth);
  const { location } = useShell();
  const shownLocation = useTabsStore(selectCurrentLocation);
  // A hidden file never names the window.
  const titleHidden = useHiddenStore((state) => namesHidden(state, shownLocation ? locationPath(shownLocation) : null));
  const autoName = useAutoTabName();
  const pageName = shownLocation && !titleHidden ? locationName(shownLocation, undefined, autoName) : null;
  const { layout, width: viewport } = useShellViewport();
  const narrowSidebarRef = React.useRef<HTMLDivElement>(null);
  const sidebarToggleRef = React.useRef<HTMLButtonElement>(null);
  const workspaceRef = React.useRef<HTMLElement>(null);
  const workspaceMainRef = React.useRef<HTMLElement>(null);
  const daySidebarRef = React.useRef<HTMLDivElement>(null);
  const locationKey = `${location.pathname}${location.search}`;
  const previousLocationKey = React.useRef(locationKey);
  const isNarrow = layout === 'narrow';
  const sidebarOpen = isNarrow
    ? narrowSidebarOpen
    : persistedSidebarOpen;
  const effectiveSidebarWidth = isNarrow
    ? Math.min(sidebarWidth, Math.max(0, viewport - 48))
    : layout === 'medium'
      ? Math.min(sidebarWidth, MEDIUM_SIDEBAR_MAX)
      : sidebarWidth;
  const sidebarMax =
    layout === 'medium' ? MEDIUM_SIDEBAR_MAX : SHELL_LIMITS.sidebar.max;
  const daySidebarOpen = useDaySidebarStore((state) => state.open);
  const daySidebarNarrowOpen = useDaySidebarStore((state) => state.narrowOpen);
  const daySidebarPreferredWidth = useDaySidebarStore((state) => state.width);
  const setDaySidebarWidth = useDaySidebarStore((state) => state.setWidth);
  const rightOpen = daySidebarShown(
    { open: daySidebarOpen, narrowOpen: daySidebarNarrowOpen },
    sidebarOpen,
    isNarrow,
    viewport
  );
  const rightWidth = isNarrow
    ? Math.min(daySidebarWidth(daySidebarPreferredWidth, viewport), Math.max(0, viewport - 48))
    : daySidebarWidth(daySidebarPreferredWidth, viewport);
  const rightToggleRef = React.useRef<HTMLButtonElement>(null);
  const panes = useTabsStore((state) => state.panes) ?? EMPTY_PANES;
  const activePaneId = useTabsStore((state) => state.activePaneId);
  const split = useTabsStore((state) => state.split);
  // The page area's width: the window less the sidebars beside it. In the
  // narrow layout both sidebars lie over the page.
  const room = Math.max(
    0,
    viewport -
      (sidebarOpen && !isNarrow ? effectiveSidebarWidth : 0) -
      (rightOpen && !isNarrow ? rightWidth : 0)
  );
  const shown = shownPanes(panes, activePaneId, room);
  const twoShown = shown.length === 2;
  const leftWidth = twoShown ? leftPaneWidth(split, room) : room;
  // With one tab-filled pane, a tab dragged over the card's right half splits there.
  const [dropZone, setDropZone] = React.useState(false);
  const canDropToSplit = panes.length === 1 && fitsTwoPanes(room);

  useDiskSync();
  usePinsSync();
  useHiddenSync();

  // The window menu, Mission Control and Cmd+` name the window by its page.
  React.useEffect(() => {
    document.title = pageName ?? 'Opal';
  }, [pageName]);

  React.useEffect(() => {
    const { setFullScreen } = useShellStore.getState();
    void window.systemAPI?.isFullScreen?.().then(setFullScreen);
    return window.systemAPI?.onFullScreenChange?.(setFullScreen);
  }, []);

  const closeNarrowSidebar = React.useCallback(
    (focusTarget: 'toggle' | 'workspace' | 'none' = 'toggle') => {
      closeNarrowSidebarState();
      if (focusTarget !== 'none') {
        window.requestAnimationFrame(() => {
          const target =
            focusTarget === 'workspace'
              ? workspaceMainRef.current
              : sidebarToggleRef.current;
          target?.focus();
        });
      }
    },
    [closeNarrowSidebarState]
  );

  const closeDayOverlay = React.useCallback((focusWorkspace = false) => {
    useDaySidebarStore.getState().setNarrowOpen(false);
    if (focusWorkspace) {
      window.requestAnimationFrame(() => workspaceMainRef.current?.focus());
    }
  }, []);

  // However the right overlay closes, focus that was in it goes back to its toggle.
  const wasDayOverlay = React.useRef(false);
  React.useEffect(() => {
    const overlay = isNarrow && rightOpen;
    if (wasDayOverlay.current && !overlay && document.activeElement === document.body) {
      rightToggleRef.current?.focus();
    }
    wasDayOverlay.current = overlay;
  }, [isNarrow, rightOpen]);

  React.useEffect(() => {
    setNarrowLayout(isNarrow);
  }, [isNarrow, setNarrowLayout]);

  React.useEffect(() => {
    const routeChanged = previousLocationKey.current !== locationKey;
    previousLocationKey.current = locationKey;
    if (!routeChanged || !isNarrow) return;
    if (useShellStore.getState().narrowSidebarOpen) {
      closeNarrowSidebar('workspace');
    }
    if (useDaySidebarStore.getState().narrowOpen) {
      closeDayOverlay(true);
    }
  }, [closeDayOverlay, closeNarrowSidebar, isNarrow, locationKey]);

  React.useLayoutEffect(() => {
    // An overlay shuts everything beside it; the right sidebar sits outside
    // the page column, so the left overlay shuts it too.
    const overlay = !isNarrow
      ? null
      : narrowSidebarOpen
        ? narrowSidebarRef.current
        : rightOpen
          ? daySidebarRef.current
          : null;
    const behind = [workspaceRef.current, daySidebarRef.current].filter(
      (element): element is HTMLElement =>
        element !== null && element !== overlay
    );
    const release = () => {
      for (const element of behind) {
        element.removeAttribute('inert');
        element.removeAttribute('aria-hidden');
      }
    };
    if (behind.length === 0) return;

    if (!overlay) {
      release();
      return;
    }

    overlay.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    for (const element of behind) {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    }

    return release;
  }, [isNarrow, narrowSidebarOpen, rightOpen]);

  const handleToggleSidebar = () => {
    toggleSidebar();
  };

  return (
    <div
      data-testid="app-shell"
      data-layout={layout}
      className="relative flex h-screen w-screen overflow-hidden bg-chrome text-foreground"
    >
      {isNarrow && (sidebarOpen || rightOpen) ? (
        <div
          aria-hidden
          onClick={() => (sidebarOpen ? closeNarrowSidebar() : closeDayOverlay())}
          className="fixed inset-0 z-30 bg-black/20 animate-in fade-in-0 duration-disclosure"
        />
      ) : null}

      {sidebarOpen ? (
        <div
          ref={isNarrow ? narrowSidebarRef : undefined}
          role={isNarrow ? 'dialog' : undefined}
          aria-modal={isNarrow ? true : undefined}
          aria-label={isNarrow ? 'Workspace navigation' : undefined}
          onKeyDown={isNarrow ? overlayKeyDown(narrowSidebarRef, () => closeNarrowSidebar()) : undefined}
          className={cn(
            'relative h-full shrink-0',
            isNarrow
              ? 'fixed inset-y-0 left-0 z-40 shadow-dialog animate-in slide-in-from-left-2 duration-disclosure ease-emphasized'
              : 'z-10'
          )}
          style={{ width: effectiveSidebarWidth }}
        >
          <WorkspaceSidebar
            // Only the narrow overlay closes on a pick and hands focus to the
            // page; beside the page, focus stays where the user put it.
            onNavigate={isNarrow ? () => closeNarrowSidebar('workspace') : undefined}
            onToggleSidebar={
              isNarrow ? () => closeNarrowSidebar() : handleToggleSidebar
            }
          />
          {!isNarrow ? (
            <SidebarResizeHandle
              label="Resize workspace sidebar"
              value={effectiveSidebarWidth}
              min={SHELL_LIMITS.sidebar.min}
              max={sidebarMax}
              defaultValue={DEFAULT_SHELL_PREFERENCES.sidebarWidth}
              onChange={setSidebarWidth}
            />
          ) : null}
        </div>
      ) : null}

      {/* The top row is chrome, as both sidebars are. Below it each page is a
          card with a hairline ring, in a band of the lighter ground on its
          left, right and bottom. Two panes are two columns, each its own row
          of tabs over its own card, with the band between the cards. */}
      <section
        ref={workspaceRef}
        className="relative flex min-w-0 flex-1 overflow-hidden bg-ground"
      >
        <AddressProvider>
          {shown.map((pane, index) => {
            const active = pane.id === activePaneId;
            return (
              <div
                key={pane.id}
                data-pane-column={pane.id}
                data-pane-active={twoShown ? active : undefined}
                className="flex min-w-0 flex-col"
                style={twoShown && index === 0 ? { width: leftWidth, flex: 'none' } : { flex: '1 1 0%' }}
                // The pane last clicked or typed in is the active one.
                onPointerDownCapture={() => useTabsStore.getState().focusPane(pane.id)}
                onFocusCapture={() => useTabsStore.getState().focusPane(pane.id)}
              >
                <Titlebar
                  paneId={pane.id}
                  first={index === 0}
                  last={index === shown.length - 1}
                  sidebarOpen={sidebarOpen}
                  rightSidebarOpen={rightOpen}
                  sidebarToggleRef={index === 0 ? sidebarToggleRef : undefined}
                  rightSidebarToggleRef={index === shown.length - 1 ? rightToggleRef : undefined}
                  onToggleSidebar={handleToggleSidebar}
                />
                <main
                  ref={active ? workspaceMainRef : undefined}
                  tabIndex={-1}
                  data-testid="workspace-surface"
                  data-pane-id={pane.id}
                  aria-label="Page"
                  className={cn(
                    'relative mb-page min-h-0 min-w-0 flex-1 overflow-hidden rounded-card border border-page-ring bg-canvas outline-none',
                    !twoShown ? 'mx-page' : index === 0 ? 'ml-page mr-[calc(var(--page-inset)/2)]' : 'ml-[calc(var(--page-inset)/2)] mr-page'
                  )}
                  // Capture, so a page's editor never takes a tab dragged over it.
                  onDragOverCapture={canDropToSplit ? (event) => {
                    if (!carriesTab(event)) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    const over = event.clientX >= box.left + box.width / 2 && panes[0].tabs.length > 1;
                    event.stopPropagation();
                    if (over) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }
                    setDropZone(over);
                  } : undefined}
                  onDragLeave={canDropToSplit ? (event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropZone(false);
                  } : undefined}
                  onDropCapture={canDropToSplit ? (event) => {
                    if (!carriesTab(event)) return;
                    event.stopPropagation();
                    event.preventDefault();
                    const id = event.dataTransfer.getData(TAB_DRAG_TYPE);
                    if (dropZone && id) useTabsStore.getState().moveToPane(id);
                    setDropZone(false);
                  } : undefined}
                >
                  <PaneProvider paneId={pane.id}>{children}</PaneProvider>
                  {dropZone && canDropToSplit ? (
                    <div
                      aria-hidden
                      data-testid="pane-drop-zone"
                      className="pointer-events-none absolute inset-y-0 right-0 z-20 w-1/2 rounded-r-card border-l-2 border-focus/40 bg-surface-hover"
                    />
                  ) : null}
                </main>
              </div>
            );
          })}
        </AddressProvider>
        {twoShown ? (
          <PaneDivider
            value={leftWidth}
            min={MIN_PANE_COLUMN}
            max={room - MIN_PANE_COLUMN}
            onChange={(width) => useTabsStore.getState().setSplit(splitFor(width, room))}
            onReset={() => useTabsStore.getState().setSplit(0.5)}
          />
        ) : null}
      </section>

      {rightOpen ? (
        <div
          ref={daySidebarRef}
          role={isNarrow ? 'dialog' : undefined}
          aria-modal={isNarrow ? true : undefined}
          aria-label={isNarrow ? 'Day sidebar' : undefined}
          onKeyDown={isNarrow ? overlayKeyDown(daySidebarRef, () => closeDayOverlay()) : undefined}
          className={cn(
            'relative h-full shrink-0',
            isNarrow
              ? 'fixed inset-y-0 right-0 z-40 shadow-dialog animate-in slide-in-from-right-2 duration-disclosure ease-emphasized'
              : 'z-10'
          )}
          style={{ width: rightWidth }}
        >
          {!isNarrow ? (
            <SidebarResizeHandle
              edge="start"
              label="Resize right sidebar"
              value={rightWidth}
              min={DAY_SIDEBAR_LIMITS.min}
              max={daySidebarMaxWidth(viewport)}
              defaultValue={daySidebarWidth(null, viewport)}
              onChange={setDaySidebarWidth}
              onReset={() => setDaySidebarWidth(null)}
            />
          ) : null}
          <DaySidebar width={rightWidth} />
        </div>
      ) : null}
    </div>
  );
}

export type { AppShellProps };
