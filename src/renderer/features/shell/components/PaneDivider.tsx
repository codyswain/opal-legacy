import * as React from 'react';
import { cn } from '@/renderer/shared/utils';

interface PaneDividerProps {
  /** Where the left pane's column ends, in px from the left of the page area. */
  value: number;
  min: number;
  max: number;
  onChange: (leftWidth: number) => void;
  /** A double-click makes the panes equal. */
  onReset: () => void;
}

/**
 * The band between the two page cards, as tall as the cards, that drags
 * where one pane ends and the other begins; arrow keys move it 8px. It is
 * the sidebar's resize handle turned to face two cards: the band is the grab
 * area, and on hover, during a drag and on keyboard focus one 2px line shows
 * on the right card's left edge, between its rounded corners.
 */
export function PaneDivider({ max, min, onChange, onReset, value }: PaneDividerProps) {
  const clamp = (width: number) => Math.min(max, Math.max(min, width));
  const [dragging, setDragging] = React.useState(false);
  const stopRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => () => stopRef.current?.(), []);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const onPointerMove = (moveEvent: PointerEvent) => {
      onChange(clamp(startWidth + moveEvent.clientX - startX));
    };
    const stop = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      stopRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    stopRef.current = stop;
    setDragging(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onChange(clamp(value + (event.key === 'ArrowLeft' ? -8 : 8)));
  };

  const line = cn(
    'pointer-events-none absolute inset-y-[var(--radius-card)] w-0.5 bg-transparent transition-hover group-hover:bg-focus/40 group-focus-visible:bg-focus',
    dragging && 'bg-focus/40',
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize panes"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-testid="pane-divider"
      data-dragging={dragging || undefined}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      onPointerDown={beginResize}
      // The 8px band between the cards and 2px into each, under the top row
      // and down to the cards' bottom edge.
      className="no-drag group absolute bottom-page top-[var(--header-height)] z-10 w-[calc(var(--page-inset)+4px)] -translate-x-1/2 cursor-col-resize outline-none"
      style={{ left: value }}
    >
      {/* One line, on the right card's left edge, as the sidebar's line sits on the page card's edge: over its 1px
          ring and 1px outside it, clear of the corners. */}
      <div aria-hidden data-testid="pane-divider-line" className={cn(line, 'right-px')} />
    </div>
  );
}

export type { PaneDividerProps };
