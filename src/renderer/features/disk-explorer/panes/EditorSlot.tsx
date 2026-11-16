import * as React from 'react';
import { pageName } from '@/common/fileKind';
import { cn } from '@/renderer/shared/utils';
import { selectPaneTab, tabLocation, useTabsStore } from '../store/tabsStore';
import { focusActivePane } from './focusPane';
import { useLiveEditors } from './liveEditors';
import { usePaneId } from './PaneContext';

/**
 * Whether this pane may draw a live editor for a path: no while the other
 * pane has one. While it may, it holds the path from mount to unmount.
 */
export function useEditorSlot(path: string): { elsewhere: boolean } {
  const paneId = usePaneId();
  const holder = useLiveEditors((state) => state.holders[path]);
  const elsewhere = !!holder && holder.paneId !== paneId;

  React.useLayoutEffect(() => {
    if (elsewhere) return;
    const { take, release } = useLiveEditors.getState();
    // Refused when the other pane took it in the same frame; the store's change draws the line here.
    if (!take(path, paneId)) return;
    return () => release(path, paneId);
  }, [path, paneId, elsewhere]);

  // A hand-over this pane never took up (it went first) is let go.
  React.useEffect(
    () => () => {
      const left = useLiveEditors.getState().holders[path];
      if (left && left.paneId === paneId && left.count === 0) useLiveEditors.getState().release(path, paneId);
    },
    [path, paneId]
  );

  return { elsewhere };
}

/**
 * Brings a page that is live in the other pane here: the other pane's tab
 * closes when it shows only this page, else its section of a stream shows
 * the line in turn. This pane becomes the active one with the keyboard in the page.
 */
export function showHere(path: string, paneId: string): void {
  const tabs = useTabsStore.getState();
  const other = tabs.panes.find((pane) => pane.id !== paneId);
  const otherTab = other ? selectPaneTab(tabs, other.id) : null;
  useLiveEditors.getState().handOver(path, paneId);
  if (otherTab) {
    const location = tabLocation(otherTab);
    if (location.mode !== 'stack' && location.mode !== 'browse' && location.file === path) tabs.close(otherTab.id);
  }
  useTabsStore.getState().focusPane(paneId);
  focusActivePane();
}

/**
 * A page's editor, or, while the other pane has it live, one quiet line in
 * its place: the page's name, "Open in the other pane" and Show it here.
 */
export function EditorSlot({
  path,
  className,
  onLine,
  children,
}: {
  path: string;
  className?: string;
  /** Called when the line is drawn in the editor's place, as the editor would call its own onLoaded. */
  onLine?: () => void;
  children: React.ReactNode;
}) {
  const paneId = usePaneId();
  const { elsewhere } = useEditorSlot(path);
  React.useEffect(() => {
    if (elsewhere) onLine?.();
  }, [elsewhere, onLine]);
  // `contents` keeps the editor's own layout; the mark names the file for checks and tools.
  if (!elsewhere) return <div className="contents" data-live-editor={path}>{children}</div>;
  return (
    <div
      role="status"
      data-testid="editor-elsewhere"
      data-path={path}
      className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui', className)}
    >
      <span className="font-medium text-foreground-secondary">{pageName(path)}</span>
      <span className="text-foreground-tertiary">Open in the other pane</span>
      <button
        type="button"
        data-testid="show-here"
        onClick={() => showHere(path, paneId)}
        className="rounded-control px-2 py-1 text-foreground-secondary transition-hover hover:bg-surface-hover hover:text-foreground"
      >
        Show it here
      </button>
    </div>
  );
}
