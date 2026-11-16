import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoStore } from '@/renderer/features/auto';
import { useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { REREAD_CHECK_MS, REREAD_JUMP_MS, REREAD_STALE_MS, useAutoReread } from '@/renderer/features/auto/useAutoReread';
import { autoDigest, autoThread, digestEntry, installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';

let auto: FakeAuto;

function Reread(): null {
  useAutoReread();
  return null;
}

/** How many times the list has been read. */
const reads = () => auto.asked('threads').length;

/** Starts the app at a local time, with the list read once. */
async function launch(at: Date, options: Parameters<typeof installAutoApi>[0] = {}) {
  vi.setSystemTime(at);
  auto = installAutoApi({ threads: [autoThread('one')], ...options });
  await act(async () => {
    await useAutoStore.getState().start();
  });
  render(<Reread />);
}

const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
/** The Mac sleeps: the clock moves on and no timer runs meanwhile. */
const sleep = (ms: number) => vi.setSystemTime(Date.now() + ms);
const toFront = () => act(async () => {
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  useAutoStore.setState(useAutoStore.getInitialState(), true);
  useDigestStore.setState(useDigestStore.getInitialState(), true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reading Auto again while the app stays open', () => {
  it('reads again when the window comes back to the front five minutes after the last read', async () => {
    await launch(new Date(2026, 10, 15, 12, 0));
    expect(reads()).toBe(1);
    await later(REREAD_STALE_MS);
    expect(reads()).toBe(1);
    await toFront();
    expect(reads()).toBe(2);
  });

  it('does not read again when the window comes back after one minute', async () => {
    await launch(new Date(2026, 10, 15, 12, 0));
    await later(REREAD_CHECK_MS);
    await toFront();
    expect(reads()).toBe(1);
  });

  it('reads again when the local day turns', async () => {
    await launch(new Date(2026, 10, 15, 23, 59, 30));
    await later(REREAD_CHECK_MS);
    expect(reads()).toBe(2);
    // Once only: the read just made is of the new day.
    await later(REREAD_CHECK_MS * 3);
    expect(reads()).toBe(2);
  });

  it('reads again when the clock jumped, as after the Mac slept', async () => {
    await launch(new Date(2026, 10, 15, 12, 0));
    sleep(REREAD_JUMP_MS + 1);
    await later(REREAD_CHECK_MS);
    expect(reads()).toBe(2);
  });

  it('reads nothing while no address is set', async () => {
    await launch(new Date(2026, 10, 15, 23, 59, 30), { url: null });
    sleep(REREAD_STALE_MS + REREAD_JUMP_MS);
    await later(REREAD_CHECK_MS);
    await toFront();
    expect(auto.routes()).toEqual([]);
  });

  it('reads once when two triggers come together', async () => {
    await launch(new Date(2026, 10, 15, 12, 0));
    await later(REREAD_CHECK_MS - 1_000);
    // Woken: the window comes to the front, and a second later the clock check finds the jump.
    sleep(REREAD_STALE_MS + REREAD_JUMP_MS);
    await toFront();
    expect(reads()).toBe(2);
    await later(1_000);
    expect(reads()).toBe(2);
    // A minute on, the triggers may read again.
    sleep(REREAD_JUMP_MS + 1);
    await later(REREAD_CHECK_MS);
    expect(reads()).toBe(3);
  });

  it('leaves a service out of reach to the retry timer', async () => {
    await launch(new Date(2026, 10, 15, 12, 0));
    act(() => useAutoStore.setState({ reachable: false }));
    sleep(REREAD_STALE_MS + REREAD_JUMP_MS);
    await toFront();
    await later(REREAD_CHECK_MS);
    expect(reads()).toBe(1);
  });

  it('reads a newer day of the digest that no event announced', async () => {
    const DAY = '2026-11-15';
    const NEXT = '2026-11-16';
    await launch(new Date(2026, 10, 15, 12, 0), { digests: { [DAY]: autoDigest(DAY, [['Top 3', [digestEntry('a')]]]) } });
    await later(0);
    expect(useDigestStore.getState().latest?.date).toBe(DAY);
    auto.state.digests[NEXT] = autoDigest(NEXT, [['Top 3', [digestEntry('b'), digestEntry('c')]]]);
    await later(REREAD_STALE_MS);
    expect(useDigestStore.getState().latest?.date).toBe(DAY);
    await toFront();
    await later(0);
    expect(useDigestStore.getState().latest).toMatchObject({ date: NEXT, left: 2 });
  });
});
