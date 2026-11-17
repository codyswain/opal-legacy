import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { fileLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { EditorSlot } from '@/renderer/features/disk-explorer/panes/EditorSlot';
import { PaneProvider } from '@/renderer/features/disk-explorer/panes/PaneContext';
import { liveEditorPane, useLiveEditors } from '@/renderer/features/disk-explorer/panes/liveEditors';
import { tabFile, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { resetTabs } from '@/tests/helpers/tabs';

const PAGE = '/V/Garden plan.md';

beforeEach(() => {
  resetTabs();
  useLiveEditors.setState({ holders: {} });
});

describe('the record of live editors', () => {
  it('is taken by one pane, refused to the other, and counts holds inside one pane', () => {
    const { take, release } = useLiveEditors.getState();
    expect(take(PAGE, 'left')).toBe(true);
    expect(take(PAGE, 'right')).toBe(false);
    expect(take(PAGE, 'left')).toBe(true);
    release(PAGE, 'left');
    expect(liveEditorPane(PAGE)).toBe('left');
    release(PAGE, 'right');
    expect(liveEditorPane(PAGE)).toBe('left');
    release(PAGE, 'left');
    expect(liveEditorPane(PAGE)).toBeNull();
    expect(take(PAGE, 'right')).toBe(true);
  });

  it('is handed over whoever holds it', () => {
    useLiveEditors.getState().take(PAGE, 'left');
    useLiveEditors.getState().handOver(PAGE, 'right');
    expect(liveEditorPane(PAGE)).toBe('right');
    // The old holder's release comes late and changes nothing.
    useLiveEditors.getState().release(PAGE, 'left');
    expect(liveEditorPane(PAGE)).toBe('right');
  });
});

/** Two panes, each drawing the page in a slot when asked. */
function Panes({ left, right }: { left: boolean; right: boolean }) {
  const leftId = useTabsStore((state) => state.panes[0].id);
  const rightId = useTabsStore((state) => state.panes[1]?.id);
  return (
    <>
      {left ? (
        <PaneProvider paneId={leftId}>
          <div data-testid="left">
            <EditorSlot path={PAGE}>
              <div data-testid="editor-left">editor</div>
            </EditorSlot>
          </div>
        </PaneProvider>
      ) : null}
      {right && rightId ? (
        <PaneProvider paneId={rightId}>
          <div data-testid="right">
            <EditorSlot path={PAGE}>
              <div data-testid="editor-right">editor</div>
            </EditorSlot>
          </div>
        </PaneProvider>
      ) : null}
    </>
  );
}

describe('the slot a page editor is drawn in', () => {
  const twoPanes = () => {
    useTabsStore.getState().open(fileLocation(PAGE));
    useTabsStore.getState().splitRight();
    useTabsStore.getState().open(fileLocation('/V/Other.md'));
    // A page reached in the right pane some other way: its tab shows the page too.
    act(() => {
      const right = useTabsStore.getState().panes[1];
      useTabsStore.setState((state) => ({
        panes: state.panes.map((pane) =>
          pane.id === right.id ? { ...pane, tabs: pane.tabs.map((tab) => ({ ...tab, history: [{ location: fileLocation(PAGE) }], index: 0 })) } : pane
        ),
      }));
    });
  };

  it('draws one editor, and a line with Show it here in the other pane', () => {
    twoPanes();
    render(<Panes left right />);
    expect(screen.getByTestId('editor-left')).toBeTruthy();
    expect(screen.queryByTestId('editor-right')).toBeNull();
    const line = screen.getByTestId('editor-elsewhere');
    expect(line.textContent).toContain('Garden plan');
    expect(line.textContent).toContain('Open in the other pane');
    expect(screen.getByRole('button', { name: 'Show it here' })).toBeTruthy();
  });

  it('lets the page go when the editor unmounts, so the other pane draws it', () => {
    twoPanes();
    const { rerender } = render(<Panes left right />);
    rerender(<Panes left={false} right />);
    expect(screen.getByTestId('editor-right')).toBeTruthy();
    expect(liveEditorPane(PAGE)).toBe(useTabsStore.getState().panes[1].id);
    rerender(<Panes left={false} right={false} />);
    expect(liveEditorPane(PAGE)).toBeNull();
  });

  it('Show it here closes the tab that shows only the page there, and draws the editor here in the active pane', () => {
    twoPanes();
    useTabsStore.getState().focusPane(useTabsStore.getState().panes[0].id);
    useTabsStore.getState().open(fileLocation('/V/Kept.md'), { newTab: true });
    useTabsStore.getState().activate(useTabsStore.getState().panes[0].tabs[0].id);
    render(<Panes left right />);
    const rightId = useTabsStore.getState().panes[1].id;
    fireEvent.click(screen.getByRole('button', { name: 'Show it here' }));
    expect(liveEditorPane(PAGE)).toBe(rightId);
    expect(screen.getByTestId('editor-right')).toBeTruthy();
    expect(useTabsStore.getState().panes[0].tabs.map(tabFile)).toEqual(['/V/Kept.md']);
    expect(useTabsStore.getState().activePaneId).toBe(rightId);
  });

  it('Show it here in a stream leaves the other pane its tab, and its section shows the line in turn', () => {
    twoPanes();
    render(<Panes left right />);
    // The left pane's tab is not the page alone: mark it as a stream.
    act(() => {
      useTabsStore.setState((state) => ({
        panes: state.panes.map((pane, index) =>
          index === 0 ? { ...pane, tabs: pane.tabs.map((tab) => ({ ...tab, history: [{ location: { mode: 'stack', kind: 'daily', file: PAGE } as never }], index: 0 })) } : pane
        ),
      }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show it here' }));
    expect(useTabsStore.getState().panes).toHaveLength(2);
    expect(screen.getByTestId('editor-right')).toBeTruthy();
    expect(screen.queryByTestId('editor-left')).toBeNull();
    expect(screen.getByTestId('left').querySelector('[data-testid="editor-elsewhere"]')).toBeTruthy();
  });
});
