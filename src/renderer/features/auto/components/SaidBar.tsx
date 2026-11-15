import * as React from 'react';
import { cn } from '@/renderer/shared/utils';
import { selectMore, selectSaid, useSaidStore } from '../store/saidStore';

const word =
  'shrink-0 rounded-sm px-1 font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary-foreground';

/**
 * What the last action did, with the way back: at the foot of the list, or
 * above the box when the list is hidden. The thread's or entry's name comes
 * first; what happened stays whole, on a second line when the list is too
 * narrow for both. It says how many more actions Undo can reach. A refusal is
 * the service's own sentence.
 */
export function SaidBar({ className }: { className?: string }) {
  const said = useSaidStore(selectSaid);
  const more = useSaidStore(selectMore);
  if (!said) return null;
  const { undo, open } = useSaidStore.getState();
  return (
    <div
      role="status"
      data-testid="auto-said"
      data-problem={said.problem || undefined}
      className={cn('flex min-h-control shrink-0 items-center gap-1.5 rounded-card bg-primary px-3 py-1.5 text-ui text-primary-foreground', className)}
    >
      {said.problem ? (
        <p className="min-w-0 flex-1 truncate">
          {said.name ? <span className="font-medium">{said.name}: </span> : null}
          {said.text}
        </p>
      ) : (
        // On one line when both fit. When they do not, what happened goes under the name, so the name is cut
        // only if it is longer than the whole line.
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1">
          {said.name ? <span className="min-w-0 max-w-full truncate font-medium">{said.name}, </span> : null}
          <span className="shrink-0 opacity-75">{said.text}</span>
        </p>
      )}
      {said.open ? (
        <button type="button" className={word} title="Open (O)" onClick={() => void open()}>
          Open
        </button>
      ) : null}
      {said.undo ? (
        <button type="button" className={word} title="Undo (⌘Z)" onClick={() => void undo()}>
          Undo
        </button>
      ) : null}
      {more > 0 ? <span data-testid="auto-said-more" className="shrink-0 text-control opacity-75">{more} more</span> : null}
    </div>
  );
}
