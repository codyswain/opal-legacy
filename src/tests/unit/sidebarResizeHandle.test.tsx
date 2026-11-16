import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SidebarResizeHandle } from '@/renderer/features/shell/components/SidebarResizeHandle';

function Harness({ edge, initial = 300 }: { edge?: 'start' | 'end'; initial?: number }) {
  const [width, setWidth] = React.useState(initial);
  return (
    <div data-testid="width" data-width={width}>
      <SidebarResizeHandle
        label="Resize sidebar"
        value={width}
        min={200}
        max={400}
        defaultValue={260}
        edge={edge}
        onChange={setWidth}
      />
    </div>
  );
}

const width = () => Number(screen.getByTestId('width').dataset.width);
const handle = () => screen.getByRole('separator', { name: 'Resize sidebar' });
const line = () => screen.getByTestId('sidebar-resize-line');

describe('SidebarResizeHandle', () => {
  it('covers the band from the sidebar to the card, as tall as the card', () => {
    render(<Harness />);
    const classes = handle().className;
    expect(classes).toContain('left-[calc(100%-2px)]');
    expect(classes).toContain('w-[calc(var(--page-inset)+4px)]');
    expect(classes).toContain('top-[var(--header-height)]');
    expect(classes).toContain('bottom-page');
    expect(classes).not.toContain('inset-y-0');
    // The line sits on the card's edge, clear of its rounded corners.
    expect(line().className).toContain('right-px');
    expect(line().className).toContain('inset-y-[var(--radius-card)]');
    expect(line().className).toContain('w-0.5');
  });

  it('sits on the other side for the right sidebar', () => {
    render(<Harness edge="start" />);
    expect(handle().className).toContain('right-[calc(100%-2px)]');
    expect(line().className).toContain('left-px');
  });

  it('resizes on a drag within its limits and shows the line for the whole drag', () => {
    render(<Harness />);
    fireEvent.pointerDown(handle(), { clientX: 100 });
    expect(handle()).toHaveAttribute('data-dragging', 'true');
    expect(line().className).toContain('bg-focus/40');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 140 }));
    });
    expect(width()).toBe(340);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900 }));
    });
    expect(width()).toBe(400);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'));
    });
    expect(handle()).not.toHaveAttribute('data-dragging');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }));
    });
    expect(width()).toBe(400);
  });

  it('drags the right sidebar wider toward the page', () => {
    render(<Harness edge="start" />);
    fireEvent.pointerDown(handle(), { clientX: 500 });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 460 }));
      window.dispatchEvent(new MouseEvent('pointerup'));
    });
    expect(width()).toBe(340);
  });

  it('resets on a double click and moves 8px on the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.doubleClick(handle());
    expect(width()).toBe(260);
    handle().focus();
    await user.keyboard('{ArrowRight}');
    expect(width()).toBe(268);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(width()).toBe(252);
    expect(handle()).toHaveAttribute('aria-valuenow', '252');
  });
});
