import React, { useState } from 'react';
import { AutoView, DigestNavItem, SaidBar, ThreadsSection } from '@/renderer/features/auto';
import { browseAuto, isAutoLocation, isDigestLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { selectCurrentLocation, selectPaneTab, tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { PaneProvider } from '@/renderer/features/disk-explorer/panes/PaneContext';

/**
 * What a test of the Auto tab draws: the sidebar's Threads, the Undo line
 * that sits at the sidebar's foot, and the tab itself, which is put in front
 * when no Auto tab is open yet, as a click on a thread would.
 */
export function AutoScreen() {
  useState(() => {
    const tabs = useTabsStore.getState();
    const current = selectCurrentLocation(tabs);
    if (isAutoLocation(current) || isDigestLocation(current)) return null;
    const open = tabs.tabs.find((tab) => isAutoLocation(tabLocation(tab)));
    if (open) tabs.activate(open.id);
    else tabs.open(browseAuto().location, { newTab: true });
    return null;
  });
  const panes = useTabsStore((state) => state.panes);
  return (
    <>
      <DigestNavItem />
      <ThreadsSection />
      <SaidBar />
      {panes.map((pane) => {
        const tab = selectPaneTab({ panes }, pane.id);
        const location = tab && tabLocation(tab);
        if (!isAutoLocation(location) && !isDigestLocation(location)) return null;
        return <PaneProvider key={pane.id} paneId={pane.id}><AutoView digest={isDigestLocation(location)} /></PaneProvider>;
      })}
    </>
  );
}
