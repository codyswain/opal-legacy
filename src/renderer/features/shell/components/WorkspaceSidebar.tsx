import * as React from "react";
import { ChevronsDownUp, Settings } from "lucide-react";
import { SaidBar, ThreadsSection } from "@/renderer/features/auto";
import { useDiskStore } from "@/renderer/features/disk-explorer/store/diskStore";
import { canCollapseTree } from "@/renderer/features/disk-explorer/store/treeExpansion";
import { useSettingsStore } from "@/renderer/features/settings/store/settingsStore";
import { UpdateRow } from "@/renderer/features/updates";
import { IconButton } from "@/renderer/shared/ui";
import { cn } from "@/renderer/shared/utils";
import { useShellStore } from "../store/shellStore";
import { DailyItem } from "./DailyItem";
import { FileTree } from "./FileTree";
import { FrameControls, SearchButton, TrafficLightInset } from "./FrameControls";
import { PinnedSection, usePinnedShown } from "./PinnedSection";
import { SidebarFold } from "./SidebarFold";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";

interface WorkspaceSidebarProps {
  onNavigate?: () => void;
  /** Hides the sidebar, or closes it in the narrow layout. */
  onToggleSidebar?: () => void;
}

/**
 * Collapse all folders, beside Search. It shows only while the pointer is
 * over the sidebar or focus is in it, and only when a folder is open, so the
 * row stays quiet. View > Collapse All Folders does the same.
 */
function CollapseFoldersButton() {
  const shown = useDiskStore((state) => canCollapseTree(state.roots, state.expanded));
  if (!shown) return null;
  return (
    <IconButton
      label="Collapse all folders"
      shortcut="⌥⌘←"
      data-testid="collapse-all-folders"
      onClick={() => useDiskStore.getState().collapseAll()}
      variant="frame"
      className="sidebar-collapse-all opacity-0 focus-visible:opacity-100 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100"
    >
      <ChevronsDownUp aria-hidden className="frame-icon" />
    </IconButton>
  );
}

export function WorkspaceSidebar({
  onNavigate,
  onToggleSidebar,
}: WorkspaceSidebarProps) {
  const libraryOpen = useShellStore((state) => state.libraryOpen);
  const pins = usePinnedShown();

  const openSettings = () => {
    onNavigate?.();
    useSettingsStore.getState().show();
  };

  return (
    <aside
      data-testid="workspace-sidebar"
      aria-label="Workspace"
      className="group/sidebar flex h-full min-h-0 w-full flex-col bg-chrome text-foreground"
    >
      <div className="sidebar-top-row drag-handle flex h-header shrink-0 items-center gap-1 px-2">
        <TrafficLightInset />
        <FrameControls sidebarOpen onToggleSidebar={() => onToggleSidebar?.()} />
        <div className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
          <CollapseFoldersButton />
          <SearchButton />
        </div>
      </div>

      <nav aria-label="Primary" className="shrink-0 pt-1">
        <SidebarSection>
          <DailyItem onNavigate={onNavigate} />
        </SidebarSection>
      </nav>

      {/* Threads, then Library. Threads takes the height its rows need, up to about half; Library the rest. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ThreadsSection onNavigate={onNavigate} />
        <SidebarFold
          fold="library"
          label="Library"
          className={cn("pt-2", libraryOpen ? "flex-1" : "shrink-0")}
          // Open, Library keeps room for its heading, every pin it shows and two rows of the tree: Threads gives way first.
          style={
            libraryOpen
              ? { minHeight: `calc(0.5rem + ${pins + 3} * var(--row-height-compact) + ${pins + 2} * 0.125rem${pins > 0 ? " + 0.5rem" : ""})` }
              : undefined
          }
          bodyClassName="flex-1"
        >
          <PinnedSection onNavigate={onNavigate} />
          <div className="min-h-0 flex-1">
            <FileTree onNavigate={onNavigate} />
          </div>
        </SidebarFold>
      </div>

      <div className="shrink-0 px-sidebar-inset py-2">
        {/* What the last Auto action did, and the way back: here, whether or not an Auto tab is open. */}
        <SaidBar className="mb-1.5" />
        <UpdateRow />
        <SidebarItem icon={Settings} label="Settings" onActivate={openSettings} />
      </div>
    </aside>
  );
}

export type { WorkspaceSidebarProps };
