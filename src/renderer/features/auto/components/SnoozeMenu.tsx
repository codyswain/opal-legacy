import * as React from 'react';
import { Clock } from 'lucide-react';
import { WAIT_SAY_LIMIT } from '@/common/autoModel';
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
import { defaultGiveUp, giveUpChoices } from '../model/awayModel';
import { SNOOZE_TIME, snoozeChoices, snoozeDate, snoozeDateRange } from '../model/listModel';
import { snoozeThread, type From } from '../store/actions';
import { useAutoStore } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';
import { focusPageAfterClose, focusRowAfterClose, keepFocus } from './focus';

interface SnoozeItemsProps {
  /** Which menu the items sit in: the row's right-click menu or the clock's dropdown. */
  menu: 'context' | 'dropdown';
  thread: AutoThread;
  now: number;
  from: From;
}

/** Later today, Tomorrow, Next week, each with the time it means, then a day and a time of his own, then until someone replies. */
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
      {/* The second kind of snooze: it comes back when someone replies, or at the time the wait gives up. */}
      <Item onSelect={() => window.setTimeout(() => useAutoStore.getState().pickSnooze({ thread, from, reply: true }), 0)}>Until a reply…</Item>
    </>
  );
}

interface SnoozeButtonProps {
  thread: AutoThread;
  from: From;
  /** Set when a key opens the menu as well as a click. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tabIndex?: number;
}

/** The clock: a menu of times to snooze a thread until. The same on a row and on the open thread's header. */
export function SnoozeButton({ thread, from, open, onOpenChange, tabIndex }: SnoozeButtonProps) {
  // The times it offers are read from the clock when it opens, not when the row or the thread was drawn.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (open) setNow(Date.now());
  }, [open]);
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        if (next) setNow(Date.now());
        onOpenChange?.(next);
      }}
    >
      <MenuTrigger asChild>
        <IconButton label="Snooze" shortcut={from === 'pane' ? undefined : 'S'} tabIndex={tabIndex} data-testid={`auto-snooze-${from === 'pane' ? 'open' : thread.id}`} onMouseDown={keepFocus}>
          <Clock aria-hidden className="h-3.5 w-3.5" />
        </IconButton>
      </MenuTrigger>
      <MenuContent
        align="end"
        data-testid="auto-snooze-menu"
        onCloseAutoFocus={(event) => {
          if (from === 'row') focusRowAfterClose(event, thread.id);
          else if (from === 'page') focusPageAfterClose(event, thread.id);
          else {
            event.preventDefault();
            useThreadStore.getState().focusBox();
          }
        }}
      >
        {/* A snoozed thread's clock also brings it back, so a key reaches that too. */}
        {thread.snoozed !== null ? <MenuItem onSelect={() => void snoozeThread(thread, null, { from })}>Bring back</MenuItem> : null}
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
  const [date, setDate] = React.useState(range.start);
  const [time, setTime] = React.useState(SNOOZE_TIME);
  const [invalid, setInvalid] = React.useState(false);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Any time from now on, today included: measured against the clock when he presses Snooze.
        const until = snoozeDate(date, Date.now(), time);
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
          Choose a time from now on, within a year.
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

/** The give-up time that is a day and a time of his own, in the list of give-up times. */
const OWN_TIME = 'own';

/**
 * Until a reply: who or what he waits for, in his own words, and when the
 * wait gives up. The service works out the conversation and watches it; the
 * thread comes back when they reply, or at the give-up time.
 */
function ReplyForm({ thread, from, onClose }: { thread: AutoThread; from: From; onClose: () => void }) {
  const now = React.useMemo(() => Date.now(), []);
  const choices = React.useMemo(() => giveUpChoices(now), [now]);
  const range = snoozeDateRange(now);
  const [say, setSay] = React.useState('');
  // Two working days on, at 5 in the afternoon, unless he says otherwise.
  const [gives, setGives] = React.useState(() => String(defaultGiveUp(now)));
  const [date, setDate] = React.useState(range.start);
  const [time, setTime] = React.useState('17:00');
  const [invalid, setInvalid] = React.useState(false);
  const words = say.trim();
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!words) return;
        const until = gives === OWN_TIME ? snoozeDate(date, Date.now(), time) : Number(gives);
        if (until === null || !(until * 1000 > Date.now())) {
          setInvalid(true);
          return;
        }
        onClose();
        void snoozeThread(thread, until, { from, wait: { say: words } });
      }}
    >
      <DialogHeader>
        <DialogTitle>Until a reply</DialogTitle>
        <DialogDescription className="truncate" data-testid="auto-snooze-name">{thread.title || 'Untitled'}</DialogDescription>
      </DialogHeader>
      <p className="mt-2 text-ui text-foreground-secondary">It comes back when they reply.</p>
      {/* The dialog puts the caret in its first field itself. `autoFocus` would do it before the dialog
          has begun to hold the keyboard, and the menu's close would then take it to the row. */}
      <input
        value={say}
        maxLength={WAIT_SAY_LIMIT}
        onChange={(event) => setSay(event.target.value)}
        aria-label="Who you are waiting on"
        placeholder="Say who you are waiting on"
        data-testid="auto-wait-say"
        className={`${field} mt-3 w-full font-sans`}
      />
      <label className="mt-3 flex items-center gap-2 text-ui text-foreground">
        <span className="shrink-0">Gives up</span>
        <select
          value={gives}
          onChange={(event) => {
            setGives(event.target.value);
            setInvalid(false);
          }}
          data-testid="auto-wait-gives"
          className={`${field} flex-1`}
        >
          {choices.map((choice) => (
            <option key={choice.label} value={String(choice.until)}>
              {choice.label}, {choice.hint}
            </option>
          ))}
          <option value={OWN_TIME}>Pick a time…</option>
        </select>
      </label>
      {gives === OWN_TIME ? (
        <div className="mt-2 flex gap-2">
          <input
            type="date"
            value={date}
            min={range.min}
            max={range.max}
            onChange={(event) => {
              setDate(event.target.value);
              setInvalid(false);
            }}
            aria-label="Gives up on"
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
            aria-label="Gives up at"
            aria-invalid={invalid || undefined}
            className={field}
          />
        </div>
      ) : null}
      {invalid ? (
        <p role="alert" className="mt-2 text-ui font-medium text-foreground">
          Choose a time from now on, within a year.
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!words}>Wait</Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The dialog behind a snooze that needs more than a click: a day and a time
 * of his own, which starts at tomorrow, 9:00 in the morning, or until a
 * reply. It names the thread.
 */
export function SnoozeDateDialog() {
  const picking = useAutoStore((state) => state.picking);
  // What is being picked for stays while the dialog closes, so it knows where the keyboard came from.
  const last = React.useRef(picking);
  if (picking) last.current = picking;
  const close = () => useAutoStore.getState().pickSnooze(null);
  return (
    <Dialog open={picking !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        data-testid={picking?.reply ? 'auto-snooze-reply' : 'auto-snooze-date'}
        className={picking?.reply ? 'max-w-sm' : 'max-w-xs'}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          const from = last.current;
          if (from?.from === 'row') focusRowAfterClose(event, from.thread.id);
          else if (from?.from === 'page') focusPageAfterClose(event, from.thread.id);
          else {
            event.preventDefault();
            useThreadStore.getState().focusBox();
          }
        }}
      >
        {picking?.reply ? <ReplyForm thread={picking.thread} from={picking.from} onClose={close} /> : picking ? <DateForm thread={picking.thread} from={picking.from} onClose={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/*
 * The dialog is drawn once, by the first of its hosts to be mounted: the
 * sidebar's Threads, else the Auto tab. A snooze is picked from either, and
 * either can be away (the sidebar hidden, or no Auto tab).
 */
const hosts: symbol[] = [];
const hostListeners = new Set<() => void>();
const subscribeHosts = (listener: () => void) => {
  hostListeners.add(listener);
  return () => hostListeners.delete(listener);
};

export function SnoozeDateHost() {
  const [me] = React.useState(() => Symbol('snooze-host'));
  React.useLayoutEffect(() => {
    hosts.push(me);
    hostListeners.forEach((listener) => listener());
    return () => {
      hosts.splice(hosts.indexOf(me), 1);
      hostListeners.forEach((listener) => listener());
    };
  }, [me]);
  const first = React.useSyncExternalStore(subscribeHosts, () => hosts[0] === me);
  return first ? <SnoozeDateDialog /> : null;
}
