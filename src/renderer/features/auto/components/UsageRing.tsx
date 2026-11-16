import * as React from 'react';
import { useNow } from '@/renderer/shared/hooks/useNow';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/shared/ui';
import { ringFill, ringLabel, usageHeader, usageRows } from '../model/usageModel';
import { useUsageStore } from '../store/usageStore';
import './usagePalette.css';

/** The ring's size and stroke, in px. */
const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const AROUND = 2 * Math.PI * RADIUS;

/** A full track and, over it, an arc from the top running clockwise for the fill. */
function Ring({ fill }: { fill: number }) {
  const length = Math.min(1, Math.max(0, fill)) * AROUND;
  return (
    <svg aria-hidden width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block">
      <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} style={{ stroke: 'hsl(var(--usage-track))' }} />
      {length > 0 ? (
        <circle
          data-testid="auto-usage-arc"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${length} ${AROUND}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ stroke: 'var(--usage)' }}
        />
      ) : null}
    </svg>
  );
}

/**
 * How much of the plan the service's agent has used: a small ring in the
 * foot row of a message box, filled as far as the fullest limit, that opens
 * one row and bar per limit. Nothing at all while the service has said
 * nothing of it. Opening it moves nothing and sends nothing; when it closes
 * the keyboard goes back to the box's own field, unless he clicked elsewhere.
 */
export function UsageRing({ field }: { field: React.RefObject<HTMLTextAreaElement> }) {
  const usage = useUsageStore((state) => state.usage);
  const now = useNow();
  const [open, setOpen] = React.useState(false);
  /** The popover closed by a click elsewhere: the keyboard stays where that click put it. */
  const outside = React.useRef(false);
  const ring = React.useRef<HTMLButtonElement>(null);
  if (!usage || usage.limits.length === 0) return null;
  const fill = ringFill(usage, now);
  const rows = usageRows(usage, now);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) outside.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={ring}
          type="button"
          data-testid="auto-usage-ring"
          data-fill={fill}
          aria-label={ringLabel(usage, now)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md outline-none transition-hover hover:bg-surface-active focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-surface-active"
        >
          <Ring fill={fill} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="auto-usage-popover"
        side="top"
        align="start"
        sideOffset={8}
        className="min-w-0 max-w-none p-4"
        style={{ width: 'min(360px, calc(100vw - 16px))' }}
        // The keyboard stays on the ring, so Enter or Space closes it again.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // A second click on the ring closes it as Escape does.
          if (!ring.current?.contains(event.target as Node)) outside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!outside.current) field.current?.focus({ preventScroll: true });
        }}
      >
        <p className="mb-3.5 truncate text-ui text-foreground-secondary">{usageHeader(usage)}</p>
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} data-testid="auto-usage-row" className="flex flex-col">
              <div className="flex min-w-0 items-baseline gap-3 text-ui">
                <span className="min-w-0 flex-1 truncate text-foreground">{row.label}</span>
                {row.percent ? (
                  <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums text-foreground-secondary">
                    {row.when ? <span data-testid="auto-usage-when">{row.when}</span> : null}
                    <span data-testid="auto-usage-percent">{row.percent}</span>
                  </span>
                ) : null}
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: 'hsl(var(--usage-bar-track))' }}>
                <div
                  data-testid="auto-usage-bar"
                  data-fill={row.fill}
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(1, Math.max(0, row.fill)) * 100}%`, background: 'var(--usage)' }}
                />
              </div>
              {/* A window that is over says so under its empty bar, where a stale row says when it was seen: the label keeps its room. */}
              {row.percent === null && row.when ? (
                <span data-testid="auto-usage-when" className="mt-1 self-end text-metadata tabular-nums text-foreground-tertiary">
                  {row.when}
                </span>
              ) : null}
              {row.asOf ? (
                <span data-testid="auto-usage-as-of" className="mt-1 self-end text-metadata tabular-nums text-foreground-tertiary">
                  {row.asOf}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
