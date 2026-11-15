import * as React from 'react';
import { cn } from '@/renderer/shared/utils';
import { useSaidStore } from '../store/saidStore';

const word =
  'shrink-0 rounded-sm px-1 font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary-foreground';

/**
 * What the last action did, with the way back: at the foot of the list, or
 * above the box when the list is hidden. It names the thread or entry, and
 * a newer line takes its place. A refusal is the service's own sentence.
 */
export function SaidBar({ className }: { className?: string }) {
  const said = useSaidStore((state) => state.said);
  if (!said) return null;
  const { undo, open } = useSaidStore.getState();
  return (
    <div
      role="status"
      data-testid="auto-said"
      data-problem={said.problem || undefined}
      className={cn('flex min-h-control shrink-0 items-center gap-2 rounded-card bg-primary px-3 py-1.5 text-ui text-primary-foreground', className)}
    >
      <p className="min-w-0 flex-1 truncate">
        {said.problem ? (
          <>
            {said.name ? <span className="font-medium">{said.name}: </span> : null}
            {said.text}
          </>
        ) : (
          <>
            <span className="opacity-75">{said.text}</span>
            {said.name ? <span className="font-medium"> {said.name}</span> : null}
          </>
        )}
      </p>
      {said.open ? (
        <button type="button" className={word} onClick={open}>
          Open
        </button>
      ) : null}
      {said.undo ? (
        <button type="button" className={word} title="Undo (⌘Z)" onClick={() => void undo()}>
          Undo
        </button>
      ) : null}
    </div>
  );
}
