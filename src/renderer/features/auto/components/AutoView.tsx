import * as React from 'react';
import { toast } from 'sonner';
import { recordOpened } from '@/renderer/features/disk-explorer/activity/recordActivity';
import { filesLocationKey, focusFile } from '@/renderer/features/disk-explorer/navigation/filesLocation';
import { useDiskStore } from '@/renderer/features/disk-explorer/store/diskStore';
import { canonical, tabLocation, useTabsStore } from '@/renderer/features/disk-explorer/store/tabsStore';
import { useShell } from '@/renderer/features/shell/context/ShellContext';
import { Button } from '@/renderer/shared/ui';
import { MarkdownLinksContext, type MarkdownLinks } from '../markdown/Markdown';
import { DIGEST_QUEUE } from '../model/pane';
import { autoApi, signInProblem, useAutoStore } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';
import { QueuePane } from './QueuePane';
import { ThreadList } from './ThreadList';
import { ThreadPane } from './ThreadPane';

/** Under this width of tab the list hides while a thread is open. */
export const NARROW_WIDTH = 720;

/** Whether the tab is narrower than the two columns need. A width not yet measured counts as wide. */
function useNarrow(element: React.RefObject<HTMLElement>): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useLayoutEffect(() => {
    const target = element.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const measure = (width: number) => setNarrow(width > 0 && width < NARROW_WIDTH);
    measure(target.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => measure(entries[entries.length - 1].contentRect.width));
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return narrow;
}

/**
 * The open thread's stream is followed only while the tab is in view. The
 * service counts a thread with an open stream as looked at and sends no
 * ping for it, so a tab left in the background must not hold one.
 */
function useWatching(): void {
  React.useEffect(() => {
    const update = () => useThreadStore.getState().setWatching(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      useThreadStore.getState().setWatching(false);
    };
  }, []);
}

/**
 * How links in replies are followed. A vault path is looked up by the main
 * process inside the opened folders, and the file opens in a tab of its
 * own, or in the tab that already shows it, so the thread stays where it is.
 */
function useLinks(): MarkdownLinks {
  const { navigateFiles } = useShell();
  const roots = useDiskStore((state) => state.roots);
  const listings = useDiskStore((state) => state.listings);
  const tops = React.useMemo(
    () => new Set(roots.flatMap((root) => listings[root] ?? []).map((entry) => entry.name)),
    [roots, listings]
  );
  const openVault = React.useCallback(
    (path: string) => {
      void autoApi()?.resolvePage(path).then((result) => {
        if (!result.success) {
          toast(result.error.message);
          return;
        }
        recordOpened(result.data.path);
        const intent = focusFile(result.data.path);
        const key = filesLocationKey(canonical(intent.location));
        const tabs = useTabsStore.getState();
        const shown = tabs.tabs.find((tab) => filesLocationKey(tabLocation(tab)) === key);
        if (shown) tabs.activate(shown.id);
        else navigateFiles(intent, { newTab: true });
      });
    },
    [navigateFiles]
  );
  return React.useMemo(() => ({ context: { roots, tops }, openVault }), [roots, tops, openVault]);
}

const field =
  'h-control w-full rounded-control border border-border-strong bg-canvas px-2 text-ui text-foreground outline-none placeholder:text-icon focus-visible:ring-2 focus-visible:ring-focus';

/** Where Auto is: typed once, kept on this Mac. */
function AddressForm() {
  const address = useAutoStore((state) => state.address);
  const { saveAddress, editAddress } = useAutoStore.getState();
  const [typed, setTyped] = React.useState(address ?? '');
  const [problem, setProblem] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  return (
    <form
      data-testid="auto-address-form"
      className="mx-auto flex h-full w-full max-w-sm flex-col justify-center gap-3 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void saveAddress(typed).then((refused) => {
          setSaving(false);
          setProblem(refused);
        });
      }}
    >
      <h1 className="text-ui-heading font-semibold text-foreground">Auto</h1>
      <p className="text-ui text-foreground-tertiary">Enter the address of your Auto service. Opal keeps it on this Mac.</p>
      <input
        autoFocus
        aria-label="Address"
        aria-invalid={problem ? true : undefined}
        placeholder="https://host.example/agent"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setProblem(null);
        }}
        className={field}
      />
      {problem ? <p role="alert" className="text-ui font-medium text-foreground">{problem}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || (!typed.trim() && !address)}>Connect</Button>
        {address ? <Button variant="ghost" onClick={() => editAddress(false)}>Cancel</Button> : null}
      </div>
    </form>
  );
}

/** The list could not be read: what went wrong, the address, and Retry. */
function Unreachable() {
  const address = useAutoStore((state) => state.address);
  const problem = useAutoStore((state) => state.problem);
  const loading = useAutoStore((state) => state.loading);
  const { refresh, editAddress } = useAutoStore.getState();
  if (loading && !problem) {
    return <p role="status" className="flex h-full items-center justify-center p-8 text-ui text-foreground-tertiary">Connecting…</p>;
  }
  return (
    <div data-testid="auto-unreachable" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p role="alert" className="text-ui text-foreground-secondary">{problem ?? "Can't reach Auto."}</p>
      <p className="max-w-full truncate text-metadata text-foreground-tertiary">{address}</p>
      <div className="flex gap-2">
        <Button size="compact" variant="outline" disabled={loading} onClick={() => void refresh()}>Retry</Button>
        <Button size="compact" variant="ghost" onClick={() => editAddress(true)}>Change address</Button>
      </div>
    </div>
  );
}

const noticeBar = 'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-sunken px-4 py-2 text-ui text-foreground-secondary';

/** One line above the columns while Auto is out of reach or signed out. */
function Notice() {
  const reachable = useAutoStore((state) => state.reachable);
  const problem = useAutoStore((state) => state.problem);
  const status = useAutoStore((state) => state.status);
  const { refresh, checkStatus } = useAutoStore.getState();
  if (!reachable) {
    return (
      <div role="status" data-testid="auto-notice" className={noticeBar}>
        <span className="font-medium text-foreground">{problem ?? "Can't reach Auto."}</span>
        <span>Opal keeps trying.</span>
        <Button size="compact" variant="outline" className="ml-auto" onClick={() => void refresh()}>Retry</Button>
      </div>
    );
  }
  const signIn = signInProblem(status);
  if (!signIn) return null;
  return (
    <div role="status" data-testid="auto-signed-out" className={noticeBar}>
      <span className="font-medium text-foreground">{signIn}</span>
      {status?.signin ? (
        <>
          <span>Run this, then it carries on:</span>
          <code className="select-all rounded-sm bg-surface-active px-1.5 py-0.5 font-mono text-control text-foreground">{status.signin}</code>
          <Button size="compact" variant="ghost" onClick={() => void navigator.clipboard?.writeText(status.signin)}>Copy</Button>
        </>
      ) : null}
      <Button size="compact" variant="outline" className="ml-auto" onClick={() => void checkStatus()}>Check again</Button>
    </div>
  );
}

/**
 * The Auto tab: a screen for a service that runs on another machine. The
 * list on the left, the open thread beside it, the box at the bottom. Opal
 * holds no sign-in and starts no run itself; it asks the service.
 */
export function AutoView() {
  const configured = useAutoStore((state) => state.configured);
  const address = useAutoStore((state) => state.address);
  const editing = useAutoStore((state) => state.editing);
  const loaded = useAutoStore((state) => state.loaded);
  const openId = useThreadStore((state) => state.openId);
  const frame = React.useRef<HTMLDivElement>(null);
  const narrow = useNarrow(frame);
  const links = useLinks();
  useWatching();

  let body: React.ReactNode = null;
  if (configured && (!address || editing)) body = <AddressForm />;
  else if (configured && !loaded) body = <Unreachable />;
  else if (configured) {
    body = (
      <MarkdownLinksContext.Provider value={links}>
        <Notice />
        <div className="flex min-h-0 flex-1">
          {!narrow || openId === null ? <ThreadList narrow={narrow} /> : null}
          {/* One pane beside the list: a thread, or the digest's queue. Narrow, either one hides the list. */}
          {narrow && openId === null ? null : openId === DIGEST_QUEUE ? <QueuePane narrow={narrow} /> : <ThreadPane narrow={narrow} />}
        </div>
      </MarkdownLinksContext.Provider>
    );
  }
  return (
    <div ref={frame} data-testid="auto" data-narrow={narrow || undefined} className="flex h-full min-w-0 flex-col">
      {body}
    </div>
  );
}
