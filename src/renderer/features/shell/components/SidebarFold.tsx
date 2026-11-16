import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/renderer/shared/utils';
import { useShellStore, type SidebarFold as Fold } from '../store/shellStore';

interface SidebarFoldProps {
  fold: Fold;
  label: string;
  /** Beside the heading, at its right: a count, a button. */
  trailing?: React.ReactNode;
  /** Wraps the heading, as a context menu does. */
  wrapHeading?: (heading: React.ReactElement) => React.ReactElement;
  className?: string;
  /** Inline style for the section, as a height kept while its rows are read. */
  style?: React.CSSProperties;
  /** The section's own element when it is open. */
  bodyClassName?: string;
  /** Data attributes for the section's element. */
  marks?: Record<`data-${string}`, string | boolean | undefined>;
  children: React.ReactNode;
}

/**
 * A section of the sidebar under a heading that folds it: open at first,
 * and kept open or folded across launches. Enter, Space and a click fold
 * and open it, Left folds it and Right opens it.
 */
export function SidebarFold({ fold, label, trailing, wrapHeading, className, style, bodyClassName, marks, children }: SidebarFoldProps) {
  const open = useShellStore((state) => (fold === 'threads' ? state.threadsOpen : state.libraryOpen));
  const setOpen = (next: boolean) => useShellStore.getState().setFoldOpen(fold, next);
  const bodyId = React.useId();

  const heading = (
    <div className="group/fold flex h-row-compact shrink-0 items-center gap-1 pl-sidebar-inset pr-sidebar-inset">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        data-testid={`sidebar-fold-${fold}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          if (event.key === 'ArrowLeft' && open) setOpen(false);
          else if (event.key === 'ArrowRight' && !open) setOpen(true);
          else return;
          event.preventDefault();
        }}
        className={cn(
          // One step stronger than the labels inside the section ("For the Mac"), so the column reads as two sections.
          'flex h-full min-w-0 flex-1 items-center gap-1 rounded-sidebar-row px-2 text-left text-label font-medium text-foreground-secondary outline-none',
          'transition-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus'
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown aria-hidden className={cn('h-3 w-3 shrink-0 transition-transform duration-quick', !open && '-rotate-90')} />
      </button>
      {trailing}
    </div>
  );

  return (
    <section {...marks} aria-label={label} data-testid={`sidebar-${fold}`} data-open={open || undefined} className={cn('flex min-h-0 flex-col', className)} style={style}>
      {wrapHeading ? wrapHeading(heading) : heading}
      {open ? (
        <div id={bodyId} className={cn('flex min-h-0 flex-col', bodyClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export type { SidebarFoldProps };
