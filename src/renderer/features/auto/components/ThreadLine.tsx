import * as React from 'react';
import type { AutoThread } from '@/types/auto';
import { cn } from '@/renderer/shared/utils';
import { archivedWord, awayDetail, heardLine, waitLine } from '../model/awayModel';
import { rowLine } from '../model/listModel';

// A word longer than the row, such as a web address, breaks instead of running out of the row.
const lineStyle = 'break-words text-control text-foreground-tertiary';

interface ThreadLineProps {
  thread: AutoThread;
  className?: string;
  /** Leaves out the quiet line, where the entry's words are already above. */
  bare?: boolean;
  /**
   * The row is one of those put away. `waiting`: who it waits on and until
   * when, then what for and where, and what was last heard. `archived`: its
   * last line, then when it was archived.
   */
  away?: 'waiting' | 'archived';
  now?: number;
}

/**
 * The line under a thread's title, as the phone draws it. "Not started" for
 * one nobody has started, and "Your move: ..." when the next move is his,
 * both in the text's own colour with the last line quiet under them. Back
 * from a wait, who replied and what they said, or that nobody did. Its
 * question while it waits on him, the turning mark and the live line while
 * it works, why it failed, else the first line of its last reply. The
 * list's rows and the queue's entries that became threads draw it the same
 * way.
 */
export function ThreadLine({ thread, className, bare = false, away, now = Date.now() }: ThreadLineProps) {
  if (away === 'waiting') {
    const detail = [awayDetail(thread, now), thread.wait ? heardLine(thread.wait) : ''].filter(Boolean).join(' ');
    return (
      <span className={cn('flex w-full min-w-0 flex-col', className)}>
        <span data-testid="auto-wait-line" className="line-clamp-3 break-words text-control text-foreground">{waitLine(thread, now)}</span>
        {detail ? <span data-testid="auto-wait-detail" className={cn(lineStyle, 'line-clamp-3')}>{detail}</span> : null}
      </span>
    );
  }
  if (away === 'archived') {
    const rest = thread.status === 'stopped' ? 'Stopped' : thread.last;
    const when = archivedWord(thread, now);
    return (
      <span className={cn('flex w-full min-w-0 flex-col', className)}>
        {rest ? <span className={cn(lineStyle, 'truncate')}>{rest}</span> : null}
        {when ? <span data-testid="auto-archived-when" className={lineStyle}>{when}</span> : null}
      </span>
    );
  }
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
  // Back from a wait: said in the text's own colour, since it is what he was waiting for.
  if (line.kind === 'back') return <span data-testid="auto-wait-back" className={cn('line-clamp-3 break-words text-control text-foreground', className)}>{line.text}</span>;
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
