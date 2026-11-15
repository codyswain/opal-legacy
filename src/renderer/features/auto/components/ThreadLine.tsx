import * as React from 'react';
import type { AutoThread } from '@/types/auto';
import { cn } from '@/renderer/shared/utils';
import { rowLine } from '../model/listModel';

const lineStyle = 'text-control text-foreground-tertiary';

/**
 * The line under a thread's title, as the phone draws it. "Not started" for
 * one nobody has started, and "Your move: ..." when the next move is his,
 * both in the text's own colour with the last line quiet under them. Its
 * question while it waits on him, the turning mark and the live line while
 * it works, why it failed, else the first line of its last reply. The
 * list's rows and the queue's entries that became threads draw it the same
 * way; `bare` leaves out the quiet line, where the entry's words are
 * already above.
 */
export function ThreadLine({ thread, className, bare = false }: { thread: AutoThread; className?: string; bare?: boolean }) {
  const line = rowLine(thread);
  if (!line.text) return null;
  if (line.kind === 'idle' || line.kind === 'yours') {
    return (
      // As wide as the row and no wider, so the quiet line is cut with an ellipsis and never runs past the row.
      <span className={cn('flex w-full min-w-0 flex-col', className)}>
        {/* Words, never a button: what is his to do is his to do. */}
        <span data-testid={line.kind === 'yours' ? 'auto-yours' : 'auto-not-started'} className={cn('text-control text-foreground', line.kind === 'yours' && 'line-clamp-2')}>{line.text}</span>
        {line.under && !bare ? <span className={cn(lineStyle, 'truncate')}>{line.under}</span> : null}
      </span>
    );
  }
  if (line.kind === 'ask') return <span className={cn(lineStyle, 'line-clamp-3 text-foreground-secondary', className)}>{line.text}</span>;
  if (line.kind === 'live') {
    return (
      <span className={cn(lineStyle, 'flex items-center gap-1.5', className)}>
        <span aria-hidden className="auto-spin" />
        <span className="min-w-0 truncate">{line.text}</span>
      </span>
    );
  }
  // A failure is one step darker than a line he has read.
  return <span className={cn(lineStyle, 'line-clamp-2', line.kind === 'failed' && 'text-foreground-secondary', className)}>{line.text}</span>;
}
