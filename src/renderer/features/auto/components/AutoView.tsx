import * as React from 'react';
import { useShellStore } from '@/renderer/features/shell/store/shellStore';
import { Button } from '@/renderer/shared/ui';
import { MarkdownLinksContext } from '../markdown/Markdown';
import { AWAY, DIGEST_QUEUE } from '../model/pane';
import { signInProblem, useAutoStore } from '../store/autoStore';
import { useThreadStore } from '../store/threadStore';
import { useVaultLinks } from '../useVaultLinks';
import { AwayPane } from './AwayPane';
import { QueuePane } from './QueuePane';
import { SaidBar } from './SaidBar';
import { SnoozeDateHost } from './SnoozeMenu';
import { ThreadPane } from './ThreadPane';

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
 * The Auto tab: a screen for a service that runs on another machine. It
 * shows one thing, picked in the sidebar's Threads: the open thread, the
 * digest's queue, a new thread, the Put away page, or the address form. Opal holds no sign-in
 * and starts no run itself; it asks the service.
 */
export function AutoView() {
  const configured = useAutoStore((state) => state.configured);
  const address = useAutoStore((state) => state.address);
  const editing = useAutoStore((state) => state.editing);
  const loaded = useAutoStore((state) => state.loaded);
  const openId = useThreadStore((state) => state.openId);
  const sidebarShown = useShellStore((state) => (state.narrowLayout ? state.narrowSidebarOpen : state.sidebarOpen));
  const links = useVaultLinks();
  useWatching();

  let body: React.ReactNode = null;
  if (configured && (!address || editing)) body = <AddressForm />;
  else if (configured && !loaded) body = <Unreachable />;
  else if (configured) {
    body = (
      <MarkdownLinksContext.Provider value={links}>
        <Notice />
        <div className="flex min-h-0 flex-1">
          {/* One pane: a thread, a new thread, the digest's queue, or what is put away. */}
          {openId === DIGEST_QUEUE ? <QueuePane /> : openId === AWAY ? <AwayPane /> : <ThreadPane />}
        </div>
        {/* With the sidebar not shown, what the last action did, and its Undo, show here instead. */}
        {sidebarShown ? null : (
          <div className="auto-beside-talk shrink-0 pb-3">
            <div className="auto-column">
              <SaidBar />
            </div>
          </div>
        )}
        <SnoozeDateHost />
      </MarkdownLinksContext.Provider>
    );
  }
  return (
    // The palette, closed with Escape, hands the keyboard back to where it was opened from in here.
    <div data-testid="auto" data-palette-return data-auto-keys className="flex h-full min-w-0 flex-col">
      {body}
    </div>
  );
}
