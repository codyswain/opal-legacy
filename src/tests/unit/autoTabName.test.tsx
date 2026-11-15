import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAutoStore } from '@/renderer/features/auto';
import { useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { useAutoTabName } from '@/renderer/features/auto/useAutoTabName';
import { locationName, tabLabels } from '@/renderer/features/disk-explorer/components/tabLabels';
import { browseAuto } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { autoThread } from '@/tests/helpers/autoApi';

describe('the Auto tab’s name', () => {
  beforeEach(() => {
    useAutoStore.setState(useAutoStore.getInitialState(), true);
    useThreadStore.setState(useThreadStore.getInitialState(), true);
  });

  it('is after what the tab shows: the thread’s title, Digest or New thread; Auto for the address form', () => {
    const { result } = renderHook(() => useAutoTabName());
    expect(result.current).toBe('Auto');
    act(() => useAutoStore.setState({ configured: true, address: 'https://host.example/agent', loaded: true, threads: [autoThread('bread', { title: 'Sourdough timings' })] }));
    expect(result.current).toBe('New thread');
    act(() => useThreadStore.setState({ openId: 'bread' }));
    expect(result.current).toBe('Sourdough timings');
    act(() => useThreadStore.setState({ openId: ':digest' }));
    expect(result.current).toBe('Digest');
    act(() => useAutoStore.setState({ editing: true }));
    expect(result.current).toBe('Auto');
  });

  it('names the tab in the tab row and the window', () => {
    const location = browseAuto().location;
    expect(locationName(location, undefined, 'Seed order')).toBe('Seed order');
    expect(tabLabels([location], ['/Vault'], 'Digest')[0].name).toBe('Digest');
  });
});
