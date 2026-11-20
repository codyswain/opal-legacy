import { Button } from '@/renderer/shared/ui';
import { dayTitle, entryName } from '../model/digestModel';
import { useDigestStore } from '../store/digestStore';

export function DueDigestEntries() {
  const due = useDigestStore((state) => state.past ? undefined : state.latest?.dueSnoozes);
  if (!due?.length) return null;

  return (
    <section aria-label="Back from snooze" className="border-b border-border-subtle pb-2 pt-3">
      <h3 className="text-control font-medium text-foreground-secondary">Back from snooze</h3>
      <ul>
        {due.map(({ date, entry }) => (
          <li key={`${date}/${entry.id}`}>
            <Button
              size="compact"
              variant="ghost"
              className="-ml-2 max-w-full gap-2 font-normal"
              onClick={() => void useDigestStore.getState().show(date, entry)}
            >
              <span className="truncate">{entryName(entry)}</span>
              <span className="shrink-0 text-foreground-tertiary">{dayTitle(date)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
