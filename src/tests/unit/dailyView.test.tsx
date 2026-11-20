import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DailyOverview } from '@/renderer/features/daily/DailyView';
import { ShellProvider } from '@/renderer/features/shell/context/ShellContext';
import { selectOpenedPath, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { installActivityApi } from '@/tests/helpers/activityApi';
import { resetTabs } from '@/tests/helpers/tabs';
import type { DayLogEntry, VaultDay } from '@/types/day';

const vaultAPI = window.vaultAPI;

afterEach(() => {
  Object.assign(window, { vaultAPI });
  resetTabs();
});

it('shows substantive updates and opens documents for the day', async () => {
  const date = '2026-11-19';
  const root = '/Vault';
  const plan = '/Vault/Plan.md';
  const entry = (time: string, kind: string, text: string): DayLogEntry => ({ time, kind, text, until: null, links: [] });
  const day: VaultDay = {
    date, daily: null, digest: null, log: '/Vault/Library/logs/2026-11-19 log.md', chats: [], recordings: [], people: [],
    documents: [{ path: plan, label: 'Plan', last: '09:00' }],
    entries: [
      entry('10:00', 'connector call', 'Read a channel.'),
      entry('09:00', 'agent turn', 'Updated the plan.'),
    ],
  };
  installActivityApi();
  Object.assign(window, {
    vaultAPI: {
      discover: async () => ({ success: true, data: [{ path: root }] }),
      day: vi.fn(async () => ({ success: true, data: day })),
    },
  });
  render(<MemoryRouter><ShellProvider><DailyOverview date={date} /></ShellProvider></MemoryRouter>);
  const updates = screen.getByRole('region', { name: 'Daily update' });
  expect(await within(updates).findByText('Updated the plan.')).toBeVisible();
  expect(within(updates).queryByText('Read a channel.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
  expect(selectOpenedPath(useTabsStore.getState())).toBe(plan);
});
