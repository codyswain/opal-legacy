import { useEffect } from 'react';
import { commandRegistry, type Command } from '@/renderer/features/commands/services/commandRegistry';
import { isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { selectCurrentLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { DIGEST_QUEUE, NEW_THREAD, paneThread } from './model/pane';
import { openAutoTab } from './openAutoTab';
import { archiveThread } from './store/actions';
import { useAutoStore } from './store/autoStore';
import { useThreadStore } from './store/threadStore';

/** Puts commands in the palette for as long as the effect that called it lives. They have no keys, so the menu is not told. */
function register(commands: Command[]): () => void {
  const has = (id: string) => commandRegistry.getAllCommands().some((command) => command.id === id);
  const added = commands.filter((command) => !has(command.id));
  added.forEach((command) => commandRegistry.registerCommand(command));
  return () => added.forEach((command) => has(command.id) && commandRegistry.unregisterCommand(command));
}

/**
 * Auto in the palette, once an address is set: a new thread, the digest,
 * and every thread by its title. While the Auto tab is in front with a
 * thread open, that thread can be archived, snoozed and marked from there.
 */
export function useAutoCommands(): void {
  const { navigateFiles } = useShell();
  const address = useAutoStore((state) => state.address);
  const inFront = useTabsStore((state) => isAutoLocation(selectCurrentLocation(state)));
  const openThread = useThreadStore((state) => paneThread(state.openId));
  const open = useAutoStore((state) => (openThread ? state.threads.find((thread) => thread.id === openThread) : undefined));
  const marked = open ? open.desk !== null : false;
  const acts = address !== null && inFront && open !== undefined ? open.id : null;
  // Only ids and titles matter here: the list changes far more often than they do.
  const titles = useAutoStore((state) => state.threads.map((thread) => `${thread.id}\t${thread.title}`).join('\n'));

  useEffect(() => {
    if (!address) return;
    const show = (pane: string) => {
      openAutoTab(navigateFiles);
      useThreadStore.getState().open(pane);
    };
    return register([
      { id: 'auto.newThread', name: 'New Auto thread', label: 'New Auto thread', type: 'action', keywords: ['message', 'ask', 'agent', 'start'], perform: () => show(NEW_THREAD) },
      { id: 'auto.openDigest', name: 'Open Auto digest', label: 'Open Auto digest', type: 'navigation', keywords: ['queue', 'today', 'entries'], perform: () => show(DIGEST_QUEUE) },
      ...titles.split('\n').filter(Boolean).map((line): Command => {
        const [id, title = ''] = line.split('\t');
        return { id: `auto.thread.${id}`, name: title || 'Untitled', label: title || 'Untitled', hint: 'Auto thread', searchOnly: true, type: 'navigation', keywords: ['thread', 'auto'], perform: () => show(id) };
      }),
    ]);
  }, [address, titles, navigateFiles]);

  useEffect(() => {
    if (!acts) return;
    /** The thread as the list has it now. */
    const thread = () => useAutoStore.getState().threads.find((candidate) => candidate.id === acts);
    return register([
      {
        id: 'auto.archiveThread', name: 'Archive thread', type: 'action', keywords: ['auto', 'done', 'clear'],
        perform: () => {
          const now = thread();
          if (now) void archiveThread(now, { from: 'pane' });
        },
      },
      {
        id: 'auto.snoozeThread', name: 'Snooze thread…', type: 'action', keywords: ['auto', 'later', 'tomorrow'],
        perform: () => {
          const now = thread();
          // The palette closes first; the dialog then takes the keyboard.
          if (now) window.setTimeout(() => useAutoStore.getState().pickSnooze({ thread: now, from: 'pane' }), 0);
        },
      },
      {
        id: 'auto.markThread', name: marked ? 'Take off the Mac mark' : 'Mark thread for the Mac', label: marked ? 'Take off the Mac mark' : 'Mark thread for the Mac',
        type: 'action', keywords: ['auto', 'desk', 'computer'],
        perform: () => {
          const now = thread();
          if (now) void useAutoStore.getState().desk(now, now.desk === null);
        },
      },
    ]);
  }, [acts, marked]);
}
