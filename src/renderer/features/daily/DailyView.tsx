import { useId } from 'react';
import { FileText } from 'lucide-react';
import { mondayOf, touchedForDay, weekdayIndex } from '@/common/touchedModel';
import { AutoView } from '@/renderer/features/auto';
import { selectDay, useDigestStore } from '@/renderer/features/auto/store/digestStore';
import { dayName } from '@/renderer/features/day-sidebar/dayRule';
import { useDay, useToday } from '@/renderer/features/day-sidebar/hooks/useDay';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { TouchedList, useTouchedWeeks } from '@/renderer/features/disk-explorer/components/stack/TouchedList';
import { focusFile } from '@/renderer/features/disk-explorer/navigation';
import { useShell } from '@/renderer/features/shell/context/ShellContext';

export function DailyOverview({ date }: { date: string }) {
  const updateId = useId();
  const documentsId = useId();
  const day = useDay(date);
  const { navigateFiles } = useShell();
  const root = day.status === 'ready' && day.day.date === date ? day.root : null;
  const weeks = useTouchedWeeks(root, [date]);
  const week = weeks.get(mondayOf(date));
  const weekday = weekdayIndex(date);
  const rows = root && week?.root === root ? touchedForDay(week, weekday) : [];
  const data = day.status === 'ready' && day.day.date === date ? day.day : null;
  const log = data?.log;
  const updates = data?.entries.filter((entry) => !entry.kind?.includes('connector call')).slice(0, 3) ?? [];
  const openPath = (path: string, newTab = false) => {
    recordOpened(path);
    navigateFiles(focusFile(path), { newTab });
  };

  return (
    <div className="flex flex-col gap-5 border-b border-border-subtle py-5">
      <section aria-labelledby={updateId}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={updateId} className="text-ui font-medium text-foreground">Daily update</h2>
          {log ? (
            <button type="button" className="text-control text-foreground-tertiary hover:underline" onClick={() => openPath(log)}>
              Activity log
            </button>
          ) : null}
        </div>
        {updates.length ? (
          <ul className="mt-2 space-y-1 text-ui text-foreground-secondary">
            {updates.map((entry, index) => (
              <li key={index} className="flex items-baseline gap-2">
                <time className="shrink-0 text-control tabular-nums text-foreground-tertiary">{entry.time}</time>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-ui text-foreground-tertiary">
            {day.status === 'no-vault' ? 'Open your vault folder first.'
              : day.status === 'error' ? day.error
              : data ? 'No updates yet.' : 'Loading…'}
          </p>
        )}
      </section>
      <section aria-labelledby={documentsId}>
        <h2 id={documentsId} className="text-ui font-medium text-foreground">Documents</h2>
        {week && rows.length ? (
          <TouchedList touched={{ week, day: weekday, rows }} openPath={openPath} />
        ) : data?.documents.length ? (
          <ul className="mt-1">
            {data.documents.slice(0, 8).map((document) => (
              <li key={document.path}>
                <button type="button" className="opal-touched-row" onClick={(event) => openPath(document.path, event.metaKey || event.ctrlKey)}>
                  <FileText aria-hidden className="opal-touched-icon" />
                  <span className="opal-touched-name">{document.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : data ? <p className="mt-1 text-ui text-foreground-tertiary">No documents touched.</p> : null}
      </section>
    </div>
  );
}

export function DailyView() {
  const today = useToday();
  const digest = useDigestStore(selectDay);
  const date = digest?.date ?? today;
  return <AutoView digest queueIntro={<DailyOverview date={date} />} queueTitle={dayName(date)} />;
}
