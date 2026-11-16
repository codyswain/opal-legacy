import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { USAGE_LIMITS, toListEvent, toUsage } from '@/common/autoModel';
import type { AutoLimit, AutoUsage } from '@/types/auto';
import {
  DOT,
  fullest,
  isReset,
  ringFill,
  ringLabel,
  usageHeader,
  usageLabel,
  usagePercent,
  usageRows,
} from '@/renderer/features/auto/model/usageModel';
import { useAutoStore } from '@/renderer/features/auto/store/autoStore';
import { useUsageStore } from '@/renderer/features/auto/store/usageStore';
import { dispatchStream } from '@/renderer/features/auto/store/streams';
import { installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';

/** The service's answer, with an account email that must never be read. */
const ANSWER = {
  account: { email: 'someone@example.com', plan: 'Pro' },
  limits: [
    { key: 'seven_day', label: 'Weekly, all models', used: 0.01, resets_at: 1795460400, status: 'allowed', seen_at: 1794860400, model: 'large' },
    { key: 'seven_day_large', label: 'Weekly, Large', used: 0.0, resets_at: 1795460400, status: 'allowed', seen_at: 1794860400, model: 'large' },
  ],
  extra_usage: { status: 'rejected', reason: 'out_of_credits' },
  as_of: 1794860400,
};

const limit = (key: string, fields: Partial<AutoLimit> = {}): AutoLimit => ({
  key, label: `Weekly, ${key}`, used: 0.5, resetsAt: null, status: 'allowed', seenAt: null, ...fields,
});
const usage = (limits: AutoLimit[], plan = 'Pro'): AutoUsage => ({ plan, limits, asOf: null });

describe('reading the plan usage', () => {
  it('keeps the plan, the limits in the order sent and the time, and never the email', () => {
    const read = toUsage(ANSWER);
    expect(read).toEqual({
      plan: 'Pro',
      limits: [
        { key: 'seven_day', label: 'Weekly, all models', used: 0.01, resetsAt: 1795460400, status: 'allowed', seenAt: 1794860400 },
        { key: 'seven_day_large', label: 'Weekly, Large', used: 0, resetsAt: 1795460400, status: 'allowed', seenAt: 1794860400 },
      ],
      asOf: 1794860400,
    });
    const text = JSON.stringify(read);
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('email');
    expect(text).not.toContain('credits');
  });

  it('reads a service that has seen nothing yet as no limits', () => {
    expect(toUsage({ account: { plan: 'Pro' }, limits: [], as_of: null })).toEqual({ plan: 'Pro', limits: [], asOf: null });
    expect(toUsage({ limits: [] })).toEqual({ plan: '', limits: [], asOf: null });
  });

  it('takes no answer without a list of limits', () => {
    for (const junk of [null, 'usage', 42, [], {}, { limits: 'many' }, { limits: {} }]) expect(toUsage(junk)).toBeNull();
  });

  it('leaves out limits without a key or a label, or with a used that is not a number', () => {
    const read = toUsage({
      limits: [
        null, 'seven_day', { label: 'No key', used: 0.2 }, { key: 'no_label', used: 0.2 }, { key: ' ', label: 'Blank', used: 0.2 },
        { key: 'text', label: 'Text', used: '0.2' }, { key: 'nan', label: 'NaN', used: Number.NaN }, { key: 'inf', label: 'Inf', used: Infinity },
        { key: 'ok', label: 'Kept', used: 0.3 },
      ],
    });
    expect(read?.limits.map((each) => each.key)).toEqual(['ok']);
  });

  it('clamps used to 0..1, and keeps times only when they are positive numbers', () => {
    const read = toUsage({
      limits: [
        { key: 'over', label: 'Over', used: 1.7, resets_at: -1, seen_at: 'now' },
        { key: 'under', label: 'Under', used: -0.2, resets_at: 0, seen_at: Number.NaN },
      ],
      as_of: 'yesterday',
    });
    expect(read?.limits).toEqual([
      { key: 'over', label: 'Over', used: 1, resetsAt: null, status: '', seenAt: null },
      { key: 'under', label: 'Under', used: 0, resetsAt: null, status: '', seenAt: null },
    ]);
    expect(read?.asOf).toBeNull();
  });

  it('drops a second limit with a key already seen', () => {
    const read = toUsage({ limits: [{ key: 'five_hour', label: 'First', used: 0.1 }, { key: 'five_hour', label: 'Second', used: 0.9 }] });
    expect(read?.limits).toHaveLength(1);
    expect(read?.limits[0].label).toBe('First');
  });

  it('keeps at most eight limits, and cuts long or broken text to one plain line', () => {
    const many = Array.from({ length: 20 }, (_, at) => ({ key: `k${at}`, label: `Limit ${at}`, used: 0.1 }));
    expect(toUsage({ limits: many })?.limits.map((each) => each.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']);
    expect(USAGE_LIMITS).toBe(8);
    const read = toUsage({ account: { plan: `Pro${'x'.repeat(200)}` }, limits: [{ key: 'k', label: `Weekly,\n\tall\u0000models ${'y'.repeat(100)}`, used: 0.1, status: 'allowed\nnow' }] });
    expect(read?.limits[0].label).toMatch(/^Weekly, all models y+$/);
    expect(read?.limits[0].label.length).toBeLessThanOrEqual(60);
    expect(read?.limits[0].status).toBe('allowed now');
    expect(read?.plan.length).toBeLessThanOrEqual(60);
  });

  it('reads the usage event on the list stream, whatever its body', () => {
    expect(toListEvent('usage', {})).toEqual({ kind: 'usage' });
    expect(toListEvent('usage', null)).toEqual({ kind: 'usage' });
    expect(toListEvent('usage', { email: 'someone@example.com' })).toEqual({ kind: 'usage' });
  });
});

describe('the words for the plan usage', () => {
  // Wed Nov 18 2026, 12:00 local.
  const NOW = new Date(2026, 10, 18, 12, 0).getTime();
  const at = (hours: number) => Math.floor(NOW / 1000 + hours * 3600);

  it('says the percent, 100 only at the limit', () => {
    expect([0, 0.004, 0.895, 0.995, 1].map(usagePercent)).toEqual([0, 0, 90, 99, 100]);
  });

  it('writes a label’s comma as the middle dot, and a label without one whole', () => {
    expect(DOT).toBe(' · ');
    expect(usageLabel('Weekly, all models')).toBe('Weekly · all models');
    expect(usageLabel('Five hours')).toBe('Five hours');
  });

  it('says when each window resets, then its percent', () => {
    const rows = usageRows(usage([
      limit('all', { label: 'Weekly, all models', used: 0.45, resetsAt: Math.floor(new Date(2026, 10, 20, 22, 0).getTime() / 1000), seenAt: at(-0.1) }),
      limit('large', { label: 'Weekly, Large', used: 0.73, resetsAt: Math.floor(new Date(2026, 10, 19, 9, 0).getTime() / 1000), seenAt: at(-0.1) }),
      limit('none', { used: 0.2 }),
    ]), NOW);
    expect(rows.map(({ label, when, percent, fill }) => ({ label, when, percent, fill }))).toEqual([
      { label: 'Weekly · all models', when: 'Resets Fri 10:00 pm', percent: '45%', fill: 0.45 },
      { label: 'Weekly · Large', when: 'Resets tomorrow 9:00 am', percent: '73%', fill: 0.73 },
      { label: 'Weekly · none', when: '', percent: '20%', fill: 0.2 },
    ]);
  });

  it('says a window that has reset as over, with an empty bar, and leaves it out of the ring', () => {
    const over = limit('over', { label: 'Weekly, all models', used: 0.95, resetsAt: Math.floor(new Date(2026, 10, 18, 11, 0).getTime() / 1000) - 7 * 3600 });
    const reset = Math.floor(new Date(2026, 10, 16, 22, 0).getTime() / 1000);
    const weekday = limit('weekday', { used: 0.8, resetsAt: reset });
    const open = limit('open', { used: 0.3, resetsAt: at(48) });
    const now = usage([over, weekday, open]);
    expect(isReset(over, NOW)).toBe(true);
    expect(isReset(limit('edge', { resetsAt: NOW / 1000 }), NOW)).toBe(true);
    expect(isReset(open, NOW)).toBe(false);
    const rows = usageRows(now, NOW);
    expect(rows[0]).toMatchObject({ when: 'Reset 4:00 am, not seen since', percent: null, fill: 0, asOf: null });
    expect(rows[1]).toMatchObject({ when: 'Reset Mon 10:00 pm, not seen since', percent: null, fill: 0 });
    expect(ringFill(now, NOW)).toBe(0.3);
    expect(fullest(now, NOW)?.key).toBe('open');
    expect(ringFill(usage([over, weekday]), NOW)).toBe(0);
    expect(ringFill(usage([]), NOW)).toBe(0);
  });

  it('fills the ring as far as the fullest limit, and names it to a screen reader', () => {
    const now = usage([limit('all', { label: 'Weekly, all models', used: 0.73 }), limit('large', { label: 'Weekly, Large', used: 0.45 }), limit('tie', { used: 0.73 })]);
    expect(ringFill(now, NOW)).toBe(0.73);
    expect(ringLabel(now, NOW)).toBe('Plan usage, Weekly · all models 73% used');
    expect(ringLabel(usage([limit('gone', { resetsAt: at(-1) })]), NOW)).toBe('Plan usage, limits reset');
  });

  it('says when a number was seen only once it is more than an hour old', () => {
    const rows = usageRows(usage([
      limit('fresh', { seenAt: Math.floor(NOW / 1000) - 3600 + 30 }),
      limit('stale', { seenAt: Math.floor(new Date(2026, 10, 18, 9, 12).getTime() / 1000) }),
      limit('hour', { seenAt: Math.floor(NOW / 1000) - 3601 }),
      limit('yesterday', { seenAt: Math.floor(new Date(2026, 10, 17, 20, 0).getTime() / 1000) }),
      limit('monday', { seenAt: Math.floor(new Date(2026, 10, 16, 20, 0).getTime() / 1000) }),
      limit('never', { seenAt: null }),
    ]), NOW);
    expect(rows.map((row) => row.asOf)).toEqual([null, 'as of 9:12 am', 'as of 10:59 am', 'as of yesterday', 'as of Mon', null]);
  });

  it('heads the popover with the plan when the service names one', () => {
    expect(usageHeader(usage([], 'Pro'))).toBe('Plan usage limits · Pro');
    expect(usageHeader(usage([], ''))).toBe('Plan usage limits');
  });
});

describe('the usage store', () => {
  let auto: FakeAuto;
  const USAGE = toUsage(ANSWER) as AutoUsage;

  const connect = async () => {
    await useAutoStore.getState().start();
    await useUsageStore.getState().read();
  };
  const settle = async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
    await useUsageStore.getState().read();
  };

  beforeEach(() => {
    useAutoStore.setState({ configured: false, address: null, reachable: false, problem: null, threads: [], status: null, listToken: null, refreshedAt: 0, loaded: false });
    useUsageStore.setState({ usage: null });
  });

  afterEach(() => {
    useAutoStore.setState({ address: null, reachable: false });
  });

  it('reads the usage once the list has been read', async () => {
    auto = installAutoApi({ usage: USAGE });
    await connect();
    expect(auto.asked('usage').length).toBeGreaterThanOrEqual(1);
    expect(useUsageStore.getState().usage).toEqual(USAGE);
  });

  it('reads again when the list is read again, and on the usage event', async () => {
    auto = installAutoApi({ usage: USAGE });
    await connect();
    const before = auto.asked('usage').length;
    auto.state.usage = { ...USAGE, limits: [{ ...USAGE.limits[0], used: 0.6 }] };
    await useAutoStore.getState().refresh();
    await settle();
    expect(auto.asked('usage').length).toBeGreaterThan(before);
    expect(useUsageStore.getState().usage?.limits[0].used).toBe(0.6);

    const after = auto.asked('usage').length;
    auto.state.usage = { ...USAGE, limits: [{ ...USAGE.limits[0], used: 0.9 }] };
    dispatchStream({ token: useAutoStore.getState().listToken ?? -1, type: 'event', stream: 'list', event: { kind: 'usage' }, cursor: null });
    await settle();
    expect(auto.asked('usage').length).toBeGreaterThan(after);
    expect(useUsageStore.getState().usage?.limits[0].used).toBe(0.9);
  });

  it('reads once more after a read when the event arrives during it, and no more', async () => {
    auto = installAutoApi({ usage: USAGE });
    await connect();
    const before = auto.asked('usage').length;
    const first = useUsageStore.getState().read();
    void useUsageStore.getState().read();
    void useUsageStore.getState().read();
    await first;
    expect(auto.asked('usage').length - before).toBe(2);
  });

  it('holds nothing when the route answers 404, and touches neither reach nor problem', async () => {
    auto = installAutoApi({ usage: null });
    await connect();
    expect(auto.asked('usage').length).toBeGreaterThanOrEqual(1);
    expect(useUsageStore.getState().usage).toBeNull();
    expect(useAutoStore.getState().reachable).toBe(true);
    expect(useAutoStore.getState().problem).toBeNull();
  });

  it('holds nothing when the read fails, and says nothing of it', async () => {
    auto = installAutoApi({ usage: USAGE });
    await connect();
    expect(useUsageStore.getState().usage).toEqual(USAGE);
    auto.state.usage = null;
    const original = auto.api.request;
    auto.api.request = (async (route: { kind: string }) =>
      route.kind === 'usage' ? { success: false, error: { kind: 'unreachable', message: "Can't reach Auto." } } : original(route as never)) as typeof original;
    await useUsageStore.getState().read();
    expect(useUsageStore.getState().usage).toBeNull();
    expect(useAutoStore.getState().reachable).toBe(true);
    expect(useAutoStore.getState().problem).toBeNull();
  });

  it('holds nothing while the service is out of reach, and reads again when it is back', async () => {
    auto = installAutoApi({ usage: USAGE });
    await connect();
    expect(useUsageStore.getState().usage).toEqual(USAGE);
    dispatchStream({ token: useAutoStore.getState().listToken ?? -1, type: 'down' });
    expect(useAutoStore.getState().reachable).toBe(false);
    expect(useUsageStore.getState().usage).toBeNull();
    const before = auto.asked('usage').length;
    await useUsageStore.getState().read();
    expect(auto.asked('usage').length).toBe(before);
    await useAutoStore.getState().refresh();
    await settle();
    expect(useUsageStore.getState().usage).toEqual(USAGE);
  });

  it('reads nothing without an address', async () => {
    auto = installAutoApi({ url: null, usage: USAGE });
    await connect();
    expect(auto.asked('usage')).toEqual([]);
    expect(useUsageStore.getState().usage).toBeNull();
  });

  it('forgets the usage with the address', async () => {
    auto = installAutoApi({ usage: USAGE });
    await connect();
    expect(useUsageStore.getState().usage).toEqual(USAGE);
    await useAutoStore.getState().saveAddress('');
    expect(useUsageStore.getState().usage).toBeNull();
  });
});
