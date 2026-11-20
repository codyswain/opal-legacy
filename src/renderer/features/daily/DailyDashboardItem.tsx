import { CalendarDays } from 'lucide-react';
import { browseDaily, isDailyLocation } from '@/renderer/features/disk-explorer/navigation';
import { openHowFor, type OpenHow } from '@/renderer/features/disk-explorer/navigation/openHow';
import { allTabs, selectCurrentLocation, tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { SidebarItem } from '@/renderer/features/shell/components/SidebarItem';
import { useShell } from '@/renderer/features/shell/context/ShellContext';

export function openDailyDashboard(navigate: ReturnType<typeof useShell>['navigateFiles'], how: OpenHow = {}) {
  const tabs = useTabsStore.getState();
  const open = allTabs(tabs).find((tab) => isDailyLocation(tabLocation(tab)));
  if (open && !how.side) tabs.activate(open.id);
  else navigate(browseDaily(), { ...how, newTab: true });
}

export function DailyDashboardItem({ onNavigate }: { onNavigate?: () => void }) {
  const { navigateFiles } = useShell();
  const active = useTabsStore((state) => isDailyLocation(selectCurrentLocation(state)));
  return (
    <SidebarItem icon={CalendarDays} label="Daily" active={active} onActivate={(event) => {
      openDailyDashboard(navigateFiles, openHowFor(event));
      onNavigate?.();
    }} />
  );
}
