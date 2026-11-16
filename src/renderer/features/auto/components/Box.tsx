import * as React from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { IconButton } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';

/**
 * The message box, as a thread, a new thread and an open digest entry draw
 * it: one rounded box as wide as the column, its words on top, growing with
 * them, and a row of controls along its foot. A press on the box away from
 * its controls puts the caret in its words.
 */
export function BoxFrame({
  field,
  row,
  onSubmit,
  children,
}: {
  field: React.RefObject<HTMLTextAreaElement>;
  row: React.ReactNode;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      data-testid="auto-box-frame"
      className="auto-box flex cursor-text flex-col rounded-composer border border-border-default bg-surface shadow-composer transition-hover focus-within:border-border-strong"
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, a, textarea, input, [role="menu"]')) return;
        event.preventDefault();
        field.current?.focus();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="px-4 pt-3">{children}</div>
      <div data-testid="auto-box-row" className="flex cursor-default items-center gap-1.5 px-2.5 pb-2.5 pt-2">
        {row}
      </div>
    </form>
  );
}

/** A pane's header: one row the header's height on the reading column, with a hairline under it the width of the pane. */
export const paneHeader = 'auto-beside-talk shrink-0 border-b border-border-subtle';

/** The words in the box. */
export const boxField = 'block w-full min-w-0 resize-none bg-transparent text-reply text-foreground outline-none placeholder:text-icon';

/** Send: a filled dark circle with an arrow once there are words, grey while there are none. */
export function SendButton({ label, ready, disabled = false }: { label: string; ready: boolean; disabled?: boolean }) {
  return (
    <IconButton
      type="submit"
      label={label}
      shortcut="↩"
      data-testid="auto-send"
      data-ready={ready || undefined}
      disabled={!ready || disabled}
      className={cn(
        'h-7 w-7 rounded-full disabled:opacity-100',
        ready && !disabled ? 'bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground' : 'bg-surface-active text-foreground-tertiary',
      )}
    >
      <ArrowUp aria-hidden className="h-4 w-4" strokeWidth={2.25} />
    </IconButton>
  );
}

/** Stop, beside Send while a turn runs. */
export function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <IconButton label="Stop" shortcut="⌘." variant="outline" data-testid="auto-stop" className="h-7 w-7 rounded-full" onClick={onStop}>
      <Square aria-hidden className="h-2.5 w-2.5 fill-current" />
    </IconButton>
  );
}
