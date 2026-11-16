import React, { useRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoUsage } from '@/types/auto';
import { UsageRing } from '@/renderer/features/auto/components/UsageRing';
import { useUsageStore } from '@/renderer/features/auto/store/usageStore';

// Wed Nov 18 2026, 12:00 local.
const NOW = new Date(2026, 10, 18, 12, 0);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

const USAGE: AutoUsage = {
  plan: 'Pro',
  limits: [
    { key: 'seven_day', label: 'Weekly, all models', used: 0.45, resetsAt: seconds(new Date(2026, 10, 20, 22, 0)), status: 'allowed', seenAt: seconds(NOW) - 60 },
    { key: 'seven_day_large', label: 'Weekly, Large', used: 0.73, resetsAt: seconds(new Date(2026, 10, 20, 22, 0)), status: 'allowed', seenAt: seconds(new Date(2026, 10, 18, 9, 12)) },
  ],
  asOf: seconds(NOW) - 60,
};

/** A box's foot row as the thread and the queue draw it: the field, the ring, and something else to click. */
function Box() {
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <textarea ref={field} aria-label="Message" />
      <div data-testid="row">
        <UsageRing field={field} />
      </div>
      <button type="button">Elsewhere</button>
    </div>
  );
}

const ring = () => screen.getByTestId('auto-usage-ring');
const popover = () => screen.queryByTestId('auto-usage-popover');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => useUsageStore.setState({ usage: null }));
});

describe('the usage ring', () => {
  it('draws nothing while the store holds nothing, or no limits', () => {
    useUsageStore.setState({ usage: null });
    const { rerender } = render(<Box />);
    expect(screen.queryByTestId('auto-usage-ring')).toBeNull();
    expect(screen.getByTestId('row').childElementCount).toBe(0);
    act(() => useUsageStore.setState({ usage: { plan: 'Pro', limits: [], asOf: null } }));
    rerender(<Box />);
    expect(screen.queryByTestId('auto-usage-ring')).toBeNull();
    expect(screen.getByTestId('row').childElementCount).toBe(0);
  });

  it('fills as far as the fullest limit and names it', () => {
    useUsageStore.setState({ usage: USAGE });
    render(<Box />);
    expect(ring().getAttribute('data-fill')).toBe('0.73');
    expect(ring().getAttribute('aria-label')).toBe('Plan usage, Weekly · Large 73% used');
    expect(screen.getByTestId('auto-usage-arc')).toBeTruthy();
  });

  it('shows the track alone when every window has reset', () => {
    useUsageStore.setState({ usage: { ...USAGE, limits: USAGE.limits.map((limit) => ({ ...limit, resetsAt: seconds(NOW) - 3600 })) } });
    render(<Box />);
    expect(ring().getAttribute('data-fill')).toBe('0');
    expect(screen.queryByTestId('auto-usage-arc')).toBeNull();
    expect(ring().getAttribute('aria-label')).toBe('Plan usage, limits reset');
  });

  it('opens one row and bar per limit under the plan, with when each was seen when it is old', () => {
    useUsageStore.setState({ usage: USAGE });
    render(<Box />);
    fireEvent.click(ring());
    const open = popover() as HTMLElement;
    expect(open).toBeTruthy();
    expect(open.textContent).toContain('Plan usage limits · Pro');
    const rows = within(open).getAllByTestId('auto-usage-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Weekly · all models');
    expect(within(rows[0]).getByTestId('auto-usage-when').textContent).toBe('Resets Fri 10:00 pm');
    expect(within(rows[0]).getByTestId('auto-usage-percent').textContent).toBe('45%');
    expect(within(rows[0]).getByTestId('auto-usage-bar').style.width).toBe('45%');
    expect(within(rows[0]).queryByTestId('auto-usage-as-of')).toBeNull();
    expect(within(rows[1]).getByTestId('auto-usage-percent').textContent).toBe('73%');
    expect(within(rows[1]).getByTestId('auto-usage-bar').style.width).toBe('73%');
    expect(within(rows[1]).getByTestId('auto-usage-as-of').textContent).toBe('as of 9:12 am');
  });

  it('says a window that has reset as over, with an empty bar', () => {
    useUsageStore.setState({ usage: { ...USAGE, limits: [{ ...USAGE.limits[0], resetsAt: seconds(new Date(2026, 10, 16, 22, 0)) }, USAGE.limits[1]] } });
    render(<Box />);
    fireEvent.click(ring());
    const [over] = within(popover() as HTMLElement).getAllByTestId('auto-usage-row');
    expect(within(over).getByTestId('auto-usage-when').textContent).toBe('Reset Mon 10:00 pm, not seen since');
    expect(within(over).queryByTestId('auto-usage-percent')).toBeNull();
    expect(within(over).getByTestId('auto-usage-bar').style.width).toBe('0%');
  });

  it('closes on Escape and gives the keyboard back to the box', async () => {
    useUsageStore.setState({ usage: USAGE });
    render(<Box />);
    const user = userEvent.setup();
    ring().focus();
    await user.keyboard('{Enter}');
    expect(popover()).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message' }));
  });

  it('closes on a click outside, and on a second click on the ring', async () => {
    useUsageStore.setState({ usage: USAGE });
    render(<Box />);
    const user = userEvent.setup();
    await user.click(ring());
    expect(popover()).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(popover()).toBeNull();
    await user.click(ring());
    expect(popover()).toBeTruthy();
    await user.click(ring());
    expect(popover()).toBeNull();
  });
});
