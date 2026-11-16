import * as React from 'react';
import { cn } from '@/renderer/shared/utils';

interface SidebarResizeHandleProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Double-click goes back to it. */
  defaultValue: number;
  /** The sidebar edge the handle sits on: "end" for the left sidebar, "start" for the right one. */
  edge?: 'start' | 'end';
  onChange: (width: number) => void;
  /** Called on a double-click instead of going to `defaultValue`. */
  onReset?: () => void;
}

/**
 * The band between a sidebar and the page card, as tall as the card, that
 * drags the sidebar's width; arrow keys move it 8px. On hover, during a drag
 * and on keyboard focus it shows a 2px line on the card's nearest edge,
 * between the card's rounded corners: the edge the eye sees is the card's.
 */
export function SidebarResizeHandle({
  defaultValue,
  edge = 'end',
  label,
  max,
  min,
  onChange,
  onReset,
  value,
}: SidebarResizeHandleProps) {
  // Dragging toward the page widens a sidebar, which is right for the left one and left for the right one.
  const direction = edge === 'end' ? 1 : -1;
  const clamp = (width: number) => Math.min(max, Math.max(min, width));
  const [dragging, setDragging] = React.useState(false);
  const stopRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => () => stopRef.current?.(), []);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = value;
    const onPointerMove = (moveEvent: PointerEvent) => {
      onChange(clamp(startWidth + direction * (moveEvent.clientX - startX)));
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
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    onChange(clamp(value + direction * step * 8));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-dragging={dragging || undefined}
      onDoubleClick={() => (onReset ? onReset() : onChange(defaultValue))}
      onKeyDown={onKeyDown}
      onPointerDown={beginResize}
      // From 2px inside the sidebar to 2px inside the card, under the top row
      // and down to the card's bottom edge.
      className={cn(
        'no-drag group absolute bottom-page top-[var(--header-height)] z-10 w-[calc(var(--page-inset)+4px)] cursor-col-resize outline-none',
        edge === 'end' ? 'left-[calc(100%-2px)]' : 'right-[calc(100%-2px)]',
      )}
    >
      {/* Over the card's 1px ring and 1px outside it, clear of the corners. */}
      <div
        aria-hidden
        data-testid="sidebar-resize-line"
        className={cn(
          'pointer-events-none absolute inset-y-[var(--radius-card)] w-0.5 bg-transparent transition-hover group-hover:bg-focus/40 group-focus-visible:bg-focus',
          edge === 'end' ? 'right-px' : 'left-px',
          dragging && 'bg-focus/40',
        )}
      />
    </div>
  );
}

export type { SidebarResizeHandleProps };
