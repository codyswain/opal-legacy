import React, { useState } from 'react';
import { AutoView, SaidBar, ThreadsSection } from '@/renderer/features/auto';
import { browseAuto, isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';

/**
 * What a test of the Auto tab draws: the sidebar's Threads, the Undo line
 * that sits at the sidebar's foot, and the tab itself, which is put in front
 * when no Auto tab is open yet, as a click on a thread would.
 */
export function AutoScreen() {
  useState(() => {
    const tabs = useTabsStore.getState();
    const open = tabs.tabs.find((tab) => isAutoLocation(tabLocation(tab)));
    if (open) tabs.activate(open.id);
    else tabs.open(browseAuto().location, { newTab: true });
    return null;
  });
  return (
    <>
      <ThreadsSection />
      <SaidBar />
      <AutoView />
    </>
  );
}
