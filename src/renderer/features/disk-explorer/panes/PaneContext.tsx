import * as React from 'react';
import { selectPaneTab, useTabsStore, type Tab } from '../store/tabsStore';

/**
 * The pane a page is drawn in. What a page shows comes from its own pane's
 * open tab, never from the active pane's; outside a pane (a test that draws
 * the page alone) it is the active pane.
 */
const PaneContext = React.createContext<string | null>(null);

export function PaneProvider({ paneId, children }: { paneId: string; children: React.ReactNode }) {
  return <PaneContext.Provider value={paneId}>{children}</PaneContext.Provider>;
}

/** The pane this is drawn in, or the active pane outside one. */
export function usePaneId(): string {
  const own = React.useContext(PaneContext);
  const active = useTabsStore((state) => state.activePaneId);
  return own ?? active;
}

/** The open tab of the pane this is drawn in. */
export function usePaneTab(): Tab | null {
  const paneId = usePaneId();
  return useTabsStore((state) => selectPaneTab(state, paneId));
}

/** Whether the pane this is drawn in is the active one. */
export function useIsActivePane(): boolean {
  const paneId = usePaneId();
  return useTabsStore((state) => state.activePaneId === paneId);
}

/**
 * What the files route remembers about the address it last wrote. Each pane
 * draws the route, and the one in the active pane keeps the address; the
 * shell hands every pane the same memory, so the address has one keeper.
 */
export interface AddressMemory {
  written: string | null;
  pending: boolean;
  /**
   * Addresses written that the router has not reported back yet. A press in
   * the other pane makes it active, and its route writes its open page,
   * before the click brings one of its other tabs forward and the address is
   * written again: the first write, reported late, is not a link to follow.
   */
  inFlight: string[];
}

const AddressContext = React.createContext<AddressMemory | null>(null);

export function AddressProvider({ children }: { children: React.ReactNode }) {
  const memory = React.useRef<AddressMemory>({ written: null, pending: false, inFlight: [] });
  return <AddressContext.Provider value={memory.current}>{children}</AddressContext.Provider>;
}

/** The shell's shared memory of the address, or one of this caller's own outside the shell. */
export function useAddressMemory(): AddressMemory {
  const shared = React.useContext(AddressContext);
  const own = React.useRef<AddressMemory>({ written: null, pending: false, inFlight: [] });
  return shared ?? own.current;
}

/** Whether this pane keeps the address: the active pane, or the page drawn outside a pane. */
export function useKeepsAddress(): boolean {
  const own = React.useContext(PaneContext);
  const active = useTabsStore((state) => state.activePaneId);
  return own === null || own === active;
}
