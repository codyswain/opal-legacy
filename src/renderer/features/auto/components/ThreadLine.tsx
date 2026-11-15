import * as React from 'react';
import type { AutoThread } from '@/types/auto';
import { cn } from '@/renderer/shared/utils';
import { rowLine } from '../model/listModel';

const lineStyle = 'text-control text-foreground-tertiary';

/**
 * The line under a thread's title: its question while it waits on him, the
 * turning mark and the live line while it works, why it failed, else the
 * first line of its last reply. The list's rows and the queue's entries
 * that became threads draw it the same way.
 */
export function ThreadLine({ thread, className }: { thread: AutoThread; className?: string }) {
  const line = rowLine(thread);
  if (!line.text) return null;
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
