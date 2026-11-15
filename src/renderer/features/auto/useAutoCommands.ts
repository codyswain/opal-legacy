import { useEffect } from 'react';
import { commandRegistry, type Command } from '@/renderer/features/commands/services/commandRegistry';
import { isAutoLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { selectCurrentLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { DIGEST_QUEUE, NEW_THREAD, paneThread } from './model/pane';
import { openAutoTab } from './openAutoTab';
import { turnRuns } from './model/threadModel';
import { archiveThread, restoreThread, snoozeThread } from './store/actions';
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
 * and every thread by its title, the archived ones too once the archive
 * has been read. While the Auto tab is in front with a thread open, that
 * thread can be archived, snoozed, marked and renamed from there, a running
 * turn stopped, and a thread that is put away (archived, snoozed or waiting
 * on a reply) brought back.
 */
export function useAutoCommands(): void {
  const { navigateFiles } = useShell();
  const address = useAutoStore((state) => state.address);
  const inFront = useTabsStore((state) => isAutoLocation(selectCurrentLocation(state)));
  const openThread = useThreadStore((state) => paneThread(state.openId));
  const open = useAutoStore((state) => (openThread ? state.threads.find((thread) => thread.id === openThread) : undefined));
  // The open thread is one from the archive: it can be read and brought back, and nothing else.
  const gone = useAutoStore((state) => (openThread && !open ? state.archive.threads.find((thread) => thread.id === openThread) : undefined));
  const running = useThreadStore((state) => turnRuns(state.view));
  const marked = open ? open.desk !== null : false;
  const acts = address !== null && inFront && open !== undefined ? open.id : null;
  // What is put away, of any kind, comes back by the one verb: archived, snoozed to a time, or waiting on a reply.
  const away = gone ?? (open && open.snoozed !== null ? open : undefined);
  const returns = address !== null && inFront && away !== undefined ? away.id : null;
  // Only ids and titles matter here: the list changes far more often than they do.
  const titles = useAutoStore((state) => state.threads.map((thread) => `${thread.id}\t${thread.title}`).join('\n'));
  const archived = useAutoStore((state) => state.archive.threads.map((thread) => `${thread.id}\t${thread.title}`).join('\n'));

  useEffect(() => {
    if (!address) return;
    const show = (pane: string) => {
      openAutoTab(navigateFiles);
      useThreadStore.getState().open(pane);
    };
    const named = (lines: string, hint: string) =>
      lines.split('\n').filter(Boolean).map((line): Command => {
        const [id, title = ''] = line.split('\t');
        return { id: `auto.thread.${id}`, name: title || 'Untitled', label: title || 'Untitled', hint, searchOnly: true, type: 'navigation', keywords: ['thread', 'auto'], perform: () => show(id) };
      });
    return register([
      { id: 'auto.newThread', name: 'New Auto thread', label: 'New Auto thread', type: 'action', keywords: ['message', 'ask', 'agent', 'start'], perform: () => show(NEW_THREAD) },
      { id: 'auto.openDigest', name: 'Open Auto digest', label: 'Open Auto digest', type: 'navigation', keywords: ['queue', 'today', 'entries'], perform: () => show(DIGEST_QUEUE) },
      ...named(titles, 'Auto thread'),
      // Findable once the archive has been read: he opens it to read it, and brings it back from there.
      ...named(archived, 'Archived Auto thread'),
    ]);
  }, [address, titles, archived, navigateFiles]);

  useEffect(() => {
    if (!returns) return;
    return register([
      {
        id: 'auto.bringBackThread', name: 'Bring back thread', label: 'Bring back thread', type: 'action', keywords: ['auto', 'restore', 'unarchive', 'archive', 'unsnooze', 'snooze', 'wake'],
        perform: () => {
          const { archive, threads } = useAutoStore.getState();
          const listed = threads.find((candidate) => candidate.id === returns);
          const archived = archive.threads.find((candidate) => candidate.id === returns);
          if (listed && listed.snoozed !== null) void snoozeThread(listed, null, { from: 'pane' });
          else if (!listed && archived) void restoreThread(archived, { from: 'pane' });
        },
      },
    ]);
  }, [returns]);

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
      {
        id: 'auto.renameThread', name: 'Rename thread', label: 'Rename thread', type: 'action', keywords: ['auto', 'title', 'name'],
        // The palette closes first; the title's field then takes the keyboard.
        perform: () => window.setTimeout(() => useThreadStore.getState().startRename(acts), 0),
      },
      // Only while a turn runs: there is nothing else to stop.
      ...(running
        ? [{
            id: 'auto.stopThread', name: 'Stop', label: 'Stop', type: 'action' as const, keywords: ['auto', 'cancel', 'halt', 'turn'],
            perform: () => {
              void useThreadStore.getState().stop();
            },
          }]
        : []),
    ]);
  }, [acts, marked, running]);
}
