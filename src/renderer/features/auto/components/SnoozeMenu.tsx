import * as React from 'react';
import {
  Button,
  ContextMenuItem,
  ContextMenuShortcut,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MenuItem,
  MenuShortcut,
} from '@/renderer/shared/ui';
import { snoozeChoices, snoozeDate, snoozeDateRange } from '../model/listModel';

interface SnoozeItemsProps {
  /** Which menu the items sit in: the row's right-click menu or the clock's dropdown. */
  menu: 'context' | 'dropdown';
  now: number;
  onSnooze: (until: number) => void;
  onPickDate: () => void;
}

/** Later today, Tomorrow, Next week, each with the time it means, then a date of his own. */
export function SnoozeItems({ menu, now, onSnooze, onPickDate }: SnoozeItemsProps) {
  const Item = menu === 'context' ? ContextMenuItem : MenuItem;
  const Hint = menu === 'context' ? ContextMenuShortcut : MenuShortcut;
  return (
    <>
      {snoozeChoices(now).map((choice) => (
        <Item key={choice.label} onSelect={() => onSnooze(choice.until)}>
          {choice.label}
          <Hint className="font-sans tabular-nums">{choice.hint}</Hint>
        </Item>
      ))}
      {/* Radix runs onSelect while the menu still holds focus, so the dialog opens once it has closed. */}
      <Item onSelect={() => window.setTimeout(onPickDate, 0)}>Pick a date…</Item>
    </>
  );
}

interface SnoozeDateDialogProps {
  /** The thread's title, or null while the dialog is closed. */
  title: string | null;
  onClose: () => void;
  onSnooze: (until: number) => void;
}

function DateForm({ onClose, onSnooze }: Pick<SnoozeDateDialogProps, 'onClose' | 'onSnooze'>) {
  const now = React.useMemo(() => Date.now(), []);
  const range = snoozeDateRange(now);
  const [date, setDate] = React.useState(range.min);
  const [invalid, setInvalid] = React.useState(false);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const until = snoozeDate(date, now);
        if (until === null) setInvalid(true);
        else onSnooze(until);
      }}
    >
      <DialogHeader>
        <DialogTitle>Snooze until</DialogTitle>
        <DialogDescription className="sr-only">Choose the day it comes back, at 8 in the morning.</DialogDescription>
      </DialogHeader>
      <input
        type="date"
        value={date}
        min={range.min}
        max={range.max}
        onChange={(event) => {
          setDate(event.target.value);
          setInvalid(false);
        }}
        aria-label="Date"
        aria-invalid={invalid || undefined}
        className="mt-3 h-control w-full rounded-control border border-border-strong bg-canvas px-2 text-ui tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      {invalid ? (
        <p role="alert" className="mt-2 text-ui font-medium text-foreground">
          Choose a day in the next year.
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Snooze</Button>
      </DialogFooter>
    </form>
  );
}

/** A day of his own for a snooze: the thread comes back that morning. */
export function SnoozeDateDialog({ title, onClose, onSnooze }: SnoozeDateDialogProps) {
  return (
    <Dialog open={title !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="auto-snooze-date" className="max-w-xs" showCloseButton={false}>
        {title !== null ? <DateForm onClose={onClose} onSnooze={onSnooze} /> : null}
      </DialogContent>
    </Dialog>
  );
}
