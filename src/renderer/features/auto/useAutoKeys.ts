import { useEffect } from 'react';
import { isAutoLocation, isDigestLocation } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { selectCurrentLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { inField } from './components/focus';
import { turnRuns } from './model/threadModel';
import { useSaidStore } from './store/saidStore';
import { useThreadStore } from './store/threadStore';

/**
 * Auto's own keys, from a row of the sidebar's Threads, from the Auto tab
 * (both carry `data-auto-keys`), or from nowhere while the Auto tab is in
 * front. Cmd+Z takes back his last action, newest first, while one is on
 * offer; in a field that holds text it is the field's own undo, and in an
 * empty one it undoes the action. Cmd+. stops the open thread's running
 * turn while the tab is in front. A title being renamed takes none of them. O opens what the last action made, from a row or
 * an entry. None acts in a page's text, the palette, a dialog or another
 * part of the app. Mounted once, by useAutoSync.
 */
export function useAutoKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      // A title being renamed is his text alone: no key there acts on a thread, Cmd+Z included, even with the field emptied.
      if (target instanceof HTMLElement && target.hasAttribute('data-rename-field')) return;
      const nowhere = target === document.body || target === null;
      const location = selectCurrentLocation(useTabsStore.getState());
      const threadInFront = isAutoLocation(location);
      const place = nowhere ? null : target.closest<HTMLElement>('[data-auto-keys]');
      if (!place && !(nowhere && (threadInFront || isDigestLocation(location)))) return;
      if (!(event.metaKey || event.ctrlKey)) {
        // A single key, so only from a row or an entry, never from a field.
        const onRow = !!target && (target.hasAttribute('data-auto-row') || target.hasAttribute('data-auto-entry'));
        if (event.key.toLowerCase() === 'o' && onRow && useSaidStore.getState().open()) event.preventDefault();
        return;
      }
      if (event.key === '.') {
        // Only with the Auto tab in front, from it or from a row of the sidebar.
        if (!threadInFront) return;
        const { view, stop } = useThreadStore.getState();
        if (!turnRuns(view)) return;
        event.preventDefault();
        void stop();
      } else if (event.key.toLowerCase() === 'z') {
        // With text in the field Cmd+Z is the field's own; with none there is nothing of the field's to undo.
        if (inField(target) && (target as HTMLInputElement | HTMLTextAreaElement).value !== '') return;
        // A page's text is never Auto's, wherever it sits.
        if (target?.isContentEditable) return;
        if (useSaidStore.getState().undo()) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
