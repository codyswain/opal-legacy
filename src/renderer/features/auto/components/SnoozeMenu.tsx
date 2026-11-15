import * as React from 'react';
import { Clock } from 'lucide-react';
import type { AutoThread } from '@/types/auto';
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
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuShortcut,
  MenuTrigger,
} from '@/renderer/shared/ui';
import { SNOOZE_TIME, snoozeChoices, snoozeDate, snoozeDateRange } from '../model/listModel';
import { snoozeThread, type From } from '../store/actions';
import { useAutoStore } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';
import { focusRowAfterClose } from './focus';

interface SnoozeItemsProps {
  /** Which menu the items sit in: the row's right-click menu or the clock's dropdown. */
  menu: 'context' | 'dropdown';
  thread: AutoThread;
  now: number;
  from: From;
}

/** Later today, Tomorrow, Next week, each with the time it means, then a day and a time of his own. */
export function SnoozeItems({ menu, thread, now, from }: SnoozeItemsProps) {
  const Item = menu === 'context' ? ContextMenuItem : MenuItem;
  const Hint = menu === 'context' ? ContextMenuShortcut : MenuShortcut;
  return (
    <>
      {snoozeChoices(now).map((choice) => (
        <Item key={choice.label} onSelect={() => void snoozeThread(thread, choice.until, { from })}>
          {choice.label}
          <Hint className="font-sans tabular-nums">{choice.hint}</Hint>
        </Item>
      ))}
      {/* Radix runs onSelect while the menu still holds focus, so the dialog opens once it has closed. */}
      <Item onSelect={() => window.setTimeout(() => useAutoStore.getState().pickSnooze({ thread, from }), 0)}>Pick a time…</Item>
    </>
  );
}

interface SnoozeButtonProps {
  thread: AutoThread;
  now: number;
  from: From;
  /** Set when a key opens the menu as well as a click. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tabIndex?: number;
}

/** The clock: a menu of times to snooze a thread until. The same on a row and on the open thread's header. */
export function SnoozeButton({ thread, now, from, open, onOpenChange, tabIndex }: SnoozeButtonProps) {
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger asChild>
        <IconButton label="Snooze" shortcut={from === 'row' ? 'S' : undefined} tabIndex={tabIndex} data-testid={`auto-snooze-${from === 'row' ? thread.id : 'open'}`}>
          <Clock aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      </MenuTrigger>
      <MenuContent
        align="end"
        data-testid="auto-snooze-menu"
        onCloseAutoFocus={(event) => {
          if (from === 'row') focusRowAfterClose(event, thread.id);
          else {
            event.preventDefault();
            useThreadStore.getState().focusBox();
          }
        }}
      >
        <MenuLabel>{thread.snoozed === null ? 'Snooze' : 'Snooze until another time'}</MenuLabel>
        <SnoozeItems menu="dropdown" thread={thread} now={now} from={from} />
      </MenuContent>
    </Menu>
  );
}

const field =
  'h-control min-w-0 rounded-control border border-border-strong bg-canvas px-2 text-ui tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus';

function DateForm({ thread, from, onClose }: { thread: AutoThread; from: From; onClose: () => void }) {
  const now = React.useMemo(() => Date.now(), []);
  const range = snoozeDateRange(now);
  const [date, setDate] = React.useState(range.min);
  const [time, setTime] = React.useState(SNOOZE_TIME);
  const [invalid, setInvalid] = React.useState(false);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const until = snoozeDate(date, now, time);
        if (until === null) {
          setInvalid(true);
          return;
        }
        onClose();
        void snoozeThread(thread, until, { from });
      }}
    >
      <DialogHeader>
        <DialogTitle>Snooze until</DialogTitle>
        <DialogDescription className="truncate" data-testid="auto-snooze-name">{thread.title || 'Untitled'}</DialogDescription>
      </DialogHeader>
      <div className="mt-3 flex gap-2">
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
          className={`${field} flex-1`}
        />
        <input
          type="time"
          value={time}
          onChange={(event) => {
            setTime(event.target.value);
            setInvalid(false);
          }}
          aria-label="Time"
          aria-invalid={invalid || undefined}
          className={field}
        />
      </div>
      {invalid ? (
        <p role="alert" className="mt-2 text-ui font-medium text-foreground">
          Choose a day in the next year, and a time.
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

/** A day and a time of his own for a snooze. It names the thread, and starts at 8:00 in the morning. */
export function SnoozeDateDialog() {
  const picking = useAutoStore((state) => state.picking);
  // What is being picked for stays while the dialog closes, so it knows where the keyboard came from.
  const last = React.useRef(picking);
  if (picking) last.current = picking;
  const close = () => useAutoStore.getState().pickSnooze(null);
  return (
    <Dialog open={picking !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        data-testid="auto-snooze-date"
        className="max-w-xs"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          const from = last.current;
          if (from?.from === 'row') focusRowAfterClose(event, from.thread.id);
          else {
            event.preventDefault();
            useThreadStore.getState().focusBox();
          }
        }}
      >
        {picking ? <DateForm thread={picking.thread} from={picking.from} onClose={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}
