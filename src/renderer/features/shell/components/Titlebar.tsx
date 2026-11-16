import * as React from "react";
import { PanelRight } from "lucide-react";
import { toggleDaySidebar } from "@/renderer/features/day-sidebar/store/daySidebarStore";
import { TabStrip } from "@/renderer/features/disk-explorer/components/TabStrip";
import { IconButton } from "@/renderer/shared/ui";
import { FrameControls, SearchButton, TrafficLightInset } from "./FrameControls";

interface TitlebarProps {
  /** The pane whose tabs this row holds; the active pane when not given. */
  paneId?: string;
  /** The row over the leftmost pane, which holds the left sidebar's controls while it is hidden. */
  first?: boolean;
  /** The row over the rightmost pane, which holds the right sidebar's toggle while it is closed. */
  last?: boolean;
  sidebarOpen: boolean;
  /** With the right sidebar open, its own top row holds its toggle. */
  rightSidebarOpen?: boolean;
  onToggleSidebar: () => void;
  sidebarToggleRef?: React.Ref<HTMLButtonElement>;
  rightSidebarToggleRef?: React.Ref<HTMLButtonElement>;
}

/**
 * A pane's 40px row over its card: the tabs and New Tab, then the right
 * sidebar's toggle while that sidebar is closed. While the left sidebar is
 * hidden, its top row's controls (the toggle, Back, Forward and Search) come
 * first. The tabs have the rest of the row, and shrink and scroll once they
 * fill it. Empty space drags the window; every control is no-drag. With two
 * panes each has its own row, as wide as its card; the left sidebar's
 * controls go in the first and the right sidebar's toggle in the last.
 */
export function Titlebar({
  first = true,
  last = true,
  onToggleSidebar,
  paneId,
  rightSidebarOpen = false,
  rightSidebarToggleRef,
  sidebarOpen,
  sidebarToggleRef,
}: TitlebarProps) {
  return (
    <header
      data-testid="titlebar"
      className="drag-handle flex h-header shrink-0 items-center gap-2 bg-chrome px-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {/* With the sidebar open, its own top row holds these. */}
        {!sidebarOpen && first ? (
          <>
            <TrafficLightInset />
            <FrameControls
              sidebarOpen={false}
              toggleRef={sidebarToggleRef}
              onToggleSidebar={onToggleSidebar}
            />
            <div className="no-drag flex shrink-0 items-center">
              <SearchButton />
            </div>
          </>
        ) : null}
        <TabStrip paneId={paneId} />
      </div>
      {!rightSidebarOpen && last ? (
        <div className="flex shrink-0 justify-end">
          <IconButton
            ref={rightSidebarToggleRef}
            label="Show right sidebar"
            shortcut="⌘⇧\"
            aria-controls="day-sidebar"
            aria-expanded={false}
            onClick={() => toggleDaySidebar()}
            variant="frame"
          >
            <PanelRight aria-hidden className="frame-icon" />
          </IconButton>
        </div>
      ) : null}
    </header>
  );
}

export type { TitlebarProps };
