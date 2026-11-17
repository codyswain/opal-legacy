import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FILES_ROUTE_PATH,
  parseFilesLocation,
  serializeFilesLocation,
} from '../navigation/filesLocation';
import { useDiskStore } from '../store/diskStore';
import { selectCurrentLocation, useTabsStore } from '../store/tabsStore';
import { useAddressMemory, useKeepsAddress, usePaneId, usePaneTab } from '../panes/PaneContext';
import { closePane } from '../panes/focusPane';
import { DiskExplorer } from './DiskExplorer';
import { NoFolderOpen } from './NoFolderOpen';
import { NoPageOpen } from './NoPageOpen';

/**
 * The active tab is the navigation model. This route mirrors it into the URL
 * (always replacing, so tabs own Back and Forward) and opens a URL it did not
 * write in the active tab. Each pane draws the route with its own tab; only
 * the active pane's keeps the URL.
 */
export function FilesRoute() {
  const roots = useDiskStore((state) => state.roots);
  const rootsLoaded = useDiskStore((state) => state.rootsLoaded);
  const current = useTabsStore(selectCurrentLocation);
  const shown = usePaneTab();
  const paneId = usePaneId();
  const split = useTabsStore((state) => state.panes.length > 1);
  const keeps = useKeepsAddress();
  const location = useLocation();
  const navigate = useNavigate();
  const search = React.useRef(location.search);
  search.current = location.search;
  /** The last search written, and a search from outside that waits for the roots before it can be checked. */
  const memory = useAddressMemory();
  const currentKey = current ? serializeFilesLocation(current) : null;

  const syncUrl = React.useCallback(() => {
    if (memory.pending) return;
    const active = selectCurrentLocation(useTabsStore.getState());
    const next = active ? serializeFilesLocation(active) : '';
    memory.written = next;
    // What the address will say once the router has caught up with this window's own writes.
    if ((memory.inFlight.at(-1) ?? search.current) !== next) {
      memory.inFlight = [...memory.inFlight, next].slice(-8);
      navigate({ pathname: FILES_ROUTE_PATH, search: next }, { replace: true });
    }
  }, [memory, navigate]);

  // A link, a reload or a test can set the URL; it shows in the active tab.
  React.useEffect(() => {
    if (!keeps) return;
    if (location.search === memory.written) {
      memory.inFlight = [];
      return;
    }
    // One of this window's own writes, overtaken by a later one: not an address to open.
    if (memory.inFlight.includes(location.search)) return;
    memory.pending = location.search !== '' && roots.length === 0;
    if (memory.pending) return;
    const target = parseFilesLocation(location.search, roots);
    if (target) useTabsStore.getState().open(target);
    syncUrl();
  }, [keeps, location.search, memory, roots, syncUrl]);

  React.useEffect(() => {
    if (keeps) syncUrl();
  }, [keeps, currentKey, syncUrl]);

  if (rootsLoaded && roots.length === 0) return <NoFolderOpen />;
  if (shown) return <DiskExplorer />;
  // Until the opened folders are known, show nothing rather than claim there are none.
  if (roots.length === 0) return null;
  return <NoPageOpen onClosePane={split ? () => closePane(paneId) : undefined} />;
}
