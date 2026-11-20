import { create } from 'zustand';
import {
  isAbsoluteFsPath,
  isFsPathAtOrBelow,
  normalizeFsPath,
  remapFsPath,
} from '@/common/fsPaths';
import { isStackKind, stackKindForPath } from '@/common/stackModel';
import { localDate } from '@/common/vaultModel';
import { readPref, writePref } from '@/renderer/shared/prefs/prefs';
import {
  aloneLocation,
  collectionOf,
  fileLocation,
  filesLocationKey,
  isAutoLocation,
  isDigestLocation,
  isDailyLocation,
  locationPath,
  remapFilesLocation,
  stackLocation,
  type FilesLocation,
} from '../navigation/filesLocation';
import {
  pathMutationCoordinator,
  type AppPathMutation,
} from '../navigation/pathMutationCoordinator';

const PREF_KEY = 'tabs.session';
/** Before tabs had history, the open files were saved as a list of paths. */
const LEGACY_PREF_KEY = 'tabs.open';
const HISTORY_LIMIT = 50;
const RECENTLY_CLOSED_LIMIT = 20;

/** Where a stack was scrolled: the section at the top of the view, and how far into it the view starts. */
export interface StackViewState {
  /** The path of the section at the top of the view. */
  anchor: string;
  /** How far, in px, the view's top is below that section's top. */
  offset: number;
  /**
   * When the view starts inside the section's text: the line there, as the
   * position of its start, and how far, in px, the view's top is into it.
   */
  line?: { pos: number; into: number };
}

export interface TabEntry {
  location: FilesLocation;
  /** How far the page was scrolled when the tab last left this entry. */
  scrollTop?: number;
  /** A stack's place when the tab last left this entry; a stack does not use `scrollTop`. */
  stack?: StackViewState;
}

/** What a tab remembers about where an entry was scrolled. */
export type EntryView = { scrollTop: number } | { stack: StackViewState };

/** The largest stack offset kept; anything larger was not a real place. */
const STACK_OFFSET_LIMIT = 1_000_000;

/**
 * One tab, as in Safari and Obsidian: it shows one place at a time and keeps
 * its own back and forward history.
 */
export interface Tab {
  id: string;
  /** Everything the tab has shown, oldest first. */
  history: TabEntry[];
  /** The entry the tab shows now. */
  index: number;
}

/**
 * One page card and its row of tabs. The page area holds one pane, or two
 * side by side; each has its own tabs and its own open tab.
 */
export interface Pane {
  id: string;
  /** Its tabs, left to right. */
  tabs: Tab[];
  activeId: string | null;
}

export interface TabsState {
  /** One pane, or two: the left one first. */
  panes: Pane[];
  /** The pane last clicked or typed in. Sidebar clicks, the keys for tabs and the address follow it. */
  activePaneId: string;
  /** The left pane's share of the width the two panes have, from 0 to 1. */
  split: number;
  /** The active pane's tabs, left to right. Kept equal to its pane's. */
  tabs: Tab[];
  /** The active pane's open tab. Kept equal to its pane's. */
  activeId: string | null;
  /** Most recently closed first, history and all; Cmd+Shift+T reopens the head. */
  recentlyClosed: ClosedTab[];
  /** The day the previous session last saved its tabs. Launch opens Daily when it is not today. */
  lastSessionDate: string | null;
}

/** A closed tab, the position it had and the pane it was in, where reopening puts it back. */
export interface ClosedTab {
  tab: Tab;
  index: number;
  paneId?: string;
}

export interface OpenOptions {
  /** Open beside the active tab instead of in it. */
  newTab?: boolean;
  /** Open in the other pane, making it when there is one pane. */
  side?: boolean;
}

export interface TabsActions {
  /**
   * Shows a place in the active tab as a new history step, or in a new tab.
   * With no tab open it opens one either way. A place the other pane shows
   * is not opened twice: its tab and pane become active instead.
   */
  open: (location: FilesLocation, options?: OpenOptions) => void;
  back: () => void;
  forward: () => void;
  /** Makes a tab of either pane the open one, and its pane the active one. */
  activate: (id: string) => void;
  /** By position from the left; -1 is the last tab. */
  activateIndex: (index: number) => void;
  activateNext: () => void;
  activatePrevious: () => void;
  close: (id: string) => void;
  /** Closes every other tab of its pane; the kept tab becomes active. */
  closeOthers: (id: string) => void;
  /** Closes every tab after this one; the active tab moves here if it was among them. */
  closeToRight: (id: string) => void;
  /** Closes every tab of a pane, the active one by default. */
  closeAll: (paneId?: string) => void;
  /** Reopens the most recently closed tab where it was; false when there is none. */
  reopenClosed: () => boolean;
  /** Reorders within a pane, the active one by default. */
  move: (from: number, to: number, paneId?: string) => void;
  /** Remembers where one entry was scrolled, so Back and switching tabs return to it. */
  saveView: (id: string, index: number, view: EntryView) => void;
  /** Opens an empty pane at the right and makes it active; with two panes, makes the other one active. */
  splitRight: () => void;
  focusPane: (paneId: string) => void;
  focusOtherPane: () => void;
  /** Closes a pane and its tabs, when there are two. */
  closePane: (paneId: string) => void;
  /**
   * Moves a tab to another pane at a position (beside its open tab by
   * default), making a pane at the right when there is one. The tab and its
   * new pane become active; a pane left with no tab closes.
   */
  moveToPane: (id: string, paneId?: string, at?: number) => void;
  /** Sets the left pane's share of the width. */
  setSplit: (split: number) => void;
}

export type TabsStore = TabsState & TabsActions;

/** The divider's place before it is ever moved. */
export const DEFAULT_SPLIT = 0.5;

let createdTabs = 0;
let createdPanes = 0;

function createTab(history: TabEntry[], index = history.length - 1): Tab {
  createdTabs += 1;
  return { id: `tab-${createdTabs}`, history, index };
}

function createPane(tabs: Tab[] = [], activeId: string | null = tabs[0]?.id ?? null): Pane {
  createdPanes += 1;
  return { id: `pane-${createdPanes}`, tabs, activeId };
}

export function tabLocation(tab: Tab): FilesLocation {
  return tab.history[tab.index].location;
}

/** The file a tab shows, a stack's head, or null while it shows Recent or Auto. */
export function tabFile(tab: Tab): string | null {
  return locationPath(tabLocation(tab));
}

export function selectActiveTab(state: Pick<TabsState, 'tabs' | 'activeId'>): Tab | null {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? null;
}

export function selectCurrentLocation(state: Pick<TabsState, 'tabs' | 'activeId'>): FilesLocation | null {
  const tab = selectActiveTab(state);
  return tab ? tabLocation(tab) : null;
}

/** The file the active pane's page shows. */
export function selectOpenedPath(state: Pick<TabsState, 'tabs' | 'activeId'>): string | null {
  const tab = selectActiveTab(state);
  return tab ? tabFile(tab) : null;
}

export function selectCanGoBack(state: Pick<TabsState, 'tabs' | 'activeId'>): boolean {
  const tab = selectActiveTab(state);
  return !!tab && tab.index > 0;
}

export function selectCanGoForward(state: Pick<TabsState, 'tabs' | 'activeId'>): boolean {
  const tab = selectActiveTab(state);
  return !!tab && tab.index < tab.history.length - 1;
}

export function selectPane(state: Pick<TabsState, 'panes'>, paneId: string): Pane | null {
  return state.panes.find((pane) => pane.id === paneId) ?? null;
}

/** The open tab of one pane. */
export function selectPaneTab(state: Pick<TabsState, 'panes'>, paneId: string): Tab | null {
  const pane = selectPane(state, paneId);
  return pane?.tabs.find((tab) => tab.id === pane.activeId) ?? null;
}

/** The pane that is not the active one, or null with one pane. */
export function selectOtherPane(state: Pick<TabsState, 'panes' | 'activePaneId'>): Pane | null {
  return state.panes.find((pane) => pane.id !== state.activePaneId) ?? null;
}

/** Every open tab of both panes, left to right. */
export function allTabs(state: Pick<TabsState, 'panes'>): Tab[] {
  return state.panes.flatMap((pane) => pane.tabs);
}

/** A tab of either pane, by id. */
export function findTab(state: Pick<TabsState, 'panes'>, id: string): Tab | null {
  return allTabs(state).find((tab) => tab.id === id) ?? null;
}

/** The pane that holds a tab. */
export function paneOfTab(state: Pick<TabsState, 'panes'>, id: string): Pane | null {
  return state.panes.find((pane) => pane.tabs.some((tab) => tab.id === id)) ?? null;
}

/** A tab of either pane that shows this place now. */
function tabShowing(panes: readonly Pane[], key: string): { pane: Pane; tab: Tab } | null {
  for (const pane of panes) {
    const tab = pane.tabs.find((candidate) => filesLocationKey(tabLocation(candidate)) === key);
    if (tab) return { pane, tab };
  }
  return null;
}

/**
 * The place launch goes back to: the active restored tab, unless nothing was
 * restored or the day has changed since the last session, when launch opens
 * Daily instead.
 */
export function selectLaunchLocation(
  state: Pick<TabsState, 'tabs' | 'activeId' | 'lastSessionDate'>,
  today = localDate()
): FilesLocation | null {
  return state.lastSessionDate === today ? selectCurrentLocation(state) : null;
}

/**
 * Tabs compare places by key, so each place has one form: a normalized path,
 * and a plain open of a stack's head becomes that stack. Every open passes
 * here, so the tree, the palette, Recent, links and the sidebars all agree.
 * `alone` stays only on a path that would otherwise open as a stack.
 */
export function canonical(location: FilesLocation): FilesLocation {
  if (location.mode === 'browse') return location;
  if (location.mode === 'stack') return stackLocation(location.kind, location.file);
  const kind = stackKindForPath(location.file);
  if (!kind) return fileLocation(location.file);
  return location.alone ? aloneLocation(location.file) : stackLocation(kind, location.file);
}

type StoredTab = Pick<Tab, 'history' | 'index'>;

interface StoredPane {
  active: number;
  tabs: StoredTab[];
}

/**
 * What is saved. `active` and `tabs` are the shape from before panes: every
 * tab of both panes in one row, so an older build still finds them all.
 */
interface StoredSession {
  date: string;
  active: number;
  tabs: StoredTab[];
  panes?: StoredPane[];
  activePane?: number;
  split?: number;
}

const storedTab = ({ history, index }: Tab): StoredTab => ({ history, index });

function persist(state: Pick<TabsState, 'panes' | 'activePaneId' | 'split'>): void {
  const tabs = allTabs(state);
  const active = selectPaneTab(state, state.activePaneId);
  writePref<StoredSession>(PREF_KEY, {
    date: localDate(),
    active: active ? tabs.indexOf(active) : -1,
    tabs: tabs.map(storedTab),
    panes: state.panes.map((pane) => ({
      active: pane.tabs.findIndex((tab) => tab.id === pane.activeId),
      tabs: pane.tabs.map(storedTab),
    })),
    activePane: state.panes.findIndex((pane) => pane.id === state.activePaneId),
    split: state.split,
  });
}

function isStoredPath(value: unknown): value is string {
  return typeof value === 'string' && isAbsoluteFsPath(value);
}

/** Folder pages are gone; a stored one is dropped from the history. */
function restoredLocation(value: unknown): FilesLocation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {
    mode?: unknown;
    collection?: { kind?: unknown };
    file?: unknown;
    kind?: unknown;
    alone?: unknown;
  };
  if (candidate.mode === 'focus') {
    if (!isStoredPath(candidate.file)) return null;
    return canonical(candidate.alone === true ? aloneLocation(candidate.file) : fileLocation(candidate.file));
  }
  if (candidate.mode === 'stack') {
    return isStoredPath(candidate.file) && isStackKind(candidate.kind)
      ? stackLocation(candidate.kind, candidate.file)
      : null;
  }
  const collection = candidate.mode === 'browse' ? collectionOf(candidate.collection?.kind) : null;
  return collection ? { mode: 'browse', collection } : null;
}

const inRange = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit;

export function restoredStackView(value: unknown): StackViewState | null {
  if (!value || typeof value !== 'object') return null;
  const { anchor, offset, line } = value as { anchor?: unknown; offset?: unknown; line?: { pos?: unknown; into?: unknown } };
  if (!isStoredPath(anchor) || !inRange(offset, STACK_OFFSET_LIMIT)) return null;
  const view: StackViewState = { anchor: normalizeFsPath(anchor), offset };
  // A bad line drops only the line; the section and offset still restore.
  if (line && Number.isInteger(line.pos) && inRange(line.pos, 100_000_000) && inRange(line.into, STACK_OFFSET_LIMIT)) {
    view.line = { pos: line.pos as number, into: line.into as number };
  }
  return view;
}

function restoredTab(value: unknown): Tab | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { history?: unknown; index?: unknown };
  if (!Array.isArray(candidate.history)) return null;
  const history = candidate.history
    .flatMap((value: unknown): TabEntry[] => {
      const entry = value as Partial<TabEntry> | null;
      const location = restoredLocation(entry?.location);
      if (!location) return [];
      if (location.mode === 'stack') {
        const stack = restoredStackView(entry?.stack);
        return stack ? [{ location, stack }] : [{ location }];
      }
      const scrollTop = entry?.scrollTop;
      return typeof scrollTop === 'number' && Number.isFinite(scrollTop) && scrollTop > 0
        ? [{ location, scrollTop }]
        : [{ location }];
    })
    .slice(-HISTORY_LIMIT);
  if (history.length === 0) return null;
  const index =
    typeof candidate.index === 'number' && Number.isInteger(candidate.index)
      ? Math.min(history.length - 1, Math.max(0, candidate.index))
      : history.length - 1;
  return createTab(history, index);
}

/** A row of stored tabs and the open one, with what does not read dropped. */
function restoredRow(tabs: unknown, active: unknown): { tabs: Tab[]; activeId: string | null } {
  const candidates = Array.isArray(tabs) ? tabs.map(restoredTab) : [];
  const kept = candidates.filter((tab): tab is Tab => tab !== null);
  const open = typeof active === 'number' ? candidates[active] : null;
  return { tabs: kept, activeId: open?.id ?? kept[0]?.id ?? null };
}

export function safeSplit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_SPLIT;
}

type Restored = Pick<TabsState, 'panes' | 'activePaneId' | 'split' | 'lastSessionDate'>;

function restoredPanes(session: Partial<StoredSession>): Pick<TabsState, 'panes' | 'activePaneId' | 'split'> {
  const stored = Array.isArray(session.panes) ? session.panes.slice(0, 2) : null;
  if (stored && stored.length > 0) {
    const panes = stored.flatMap((value): Pane[] => {
      const pane = (value ?? {}) as Partial<StoredPane>;
      const row = restoredRow(pane.tabs, pane.active);
      // A pane saved empty, just split, comes back empty; one whose every tab failed to read goes.
      const savedTabs = Array.isArray(pane.tabs) ? pane.tabs.length : 0;
      return row.tabs.length === 0 && savedTabs > 0 ? [] : [createPane(row.tabs, row.activeId)];
    });
    if (panes.length > 0) {
      const active = typeof session.activePane === 'number' ? panes[session.activePane] : undefined;
      return { panes, activePaneId: (active ?? panes[0]).id, split: safeSplit(session.split) };
    }
  }
  // The shape from before panes: one row of tabs.
  const row = restoredRow(session.tabs, session.active);
  const pane = createPane(row.tabs, row.activeId);
  return { panes: [pane], activePaneId: pane.id, split: DEFAULT_SPLIT };
}

function restoredSession(): Restored {
  const stored = readPref<unknown>(PREF_KEY, null);
  if (stored && typeof stored === 'object') {
    const session = stored as Partial<StoredSession>;
    return {
      ...restoredPanes(session),
      lastSessionDate: typeof session.date === 'string' ? session.date : null,
    };
  }
  const legacy = readPref<unknown>(LEGACY_PREF_KEY, null);
  const paths = Array.isArray(legacy)
    ? [...new Set(legacy.filter(isStoredPath).map(normalizeFsPath))]
    : [];
  const pane = createPane(paths.map((path) => createTab([{ location: fileLocation(path) }])));
  return { panes: [pane], activePaneId: pane.id, split: DEFAULT_SPLIT, lastSessionDate: null };
}

/**
 * Makes a state whole after a change: a pane that had tabs and has none now
 * closes when there is another one, the active pane is one that exists, and
 * `tabs` and `activeId` are the active pane's.
 */
function settle(previous: Pick<TabsState, 'panes'>, next: TabsState): TabsState {
  let panes = next.panes;
  if (panes.length > 1) {
    const emptied = (pane: Pane) =>
      pane.tabs.length === 0 && (selectPane(previous, pane.id)?.tabs.length ?? 0) > 0;
    const kept = panes.filter((pane) => !emptied(pane));
    panes = kept.length > 0 ? kept : [selectPane(next, next.activePaneId) ?? panes[0]];
  }
  if (panes.length === 0) panes = [createPane()];
  const active = selectPane({ panes }, next.activePaneId) ?? panes[0];
  return { ...next, panes, activePaneId: active.id, tabs: active.tabs, activeId: active.activeId };
}

/** A fresh state with one empty pane. */
export function emptyTabsState(): Pick<TabsState, 'panes' | 'activePaneId' | 'split' | 'tabs' | 'activeId' | 'recentlyClosed' | 'lastSessionDate'> {
  const pane = createPane();
  return { panes: [pane], activePaneId: pane.id, split: DEFAULT_SPLIT, tabs: [], activeId: null, recentlyClosed: [], lastSessionDate: null };
}

/** What the tab rules work on: one pane's row, and the closed tabs. */
interface PaneView {
  paneId: string;
  tabs: Tab[];
  activeId: string | null;
  recentlyClosed: ClosedTab[];
}

type PaneChange = Partial<Pick<PaneView, 'tabs' | 'activeId' | 'recentlyClosed'>>;

function replacePane(panes: readonly Pane[], pane: Pane): Pane[] {
  return panes.map((candidate) => (candidate.id === pane.id ? pane : candidate));
}

/** Runs a rule on one pane's row and writes the row back. */
function inPane(
  state: TabsState,
  paneId: string,
  change: (view: PaneView) => PaneChange
): Partial<TabsState> {
  const pane = selectPane(state, paneId);
  if (!pane) return {};
  const next = change({ paneId, tabs: pane.tabs, activeId: pane.activeId, recentlyClosed: state.recentlyClosed });
  if (Object.keys(next).length === 0) return {};
  const updated: Pane = {
    ...pane,
    tabs: next.tabs ?? pane.tabs,
    activeId: next.activeId !== undefined ? next.activeId : pane.activeId,
  };
  return {
    panes: replacePane(state.panes, updated),
    ...(next.recentlyClosed ? { recentlyClosed: next.recentlyClosed } : {}),
  };
}

function replaceTab(tabs: readonly Tab[], tab: Tab): Tab[] {
  return tabs.map((candidate) => (candidate.id === tab.id ? tab : candidate));
}

/** Inserts beside the active tab, where Obsidian and Safari put a new one. */
function insertBesideActive(view: Pick<PaneView, 'tabs' | 'activeId'>, tab: Tab): Tab[] {
  const active = view.tabs.findIndex((candidate) => candidate.id === view.activeId);
  const at = active === -1 ? view.tabs.length : active + 1;
  return [...view.tabs.slice(0, at), tab, ...view.tabs.slice(at)];
}

function remember(view: PaneView, closed: readonly Tab[]): ClosedTab[] {
  // A bulk close reopens from the left, so each tab lands back where it was.
  const entries = closed.map((tab) => ({ tab, index: view.tabs.indexOf(tab), paneId: view.paneId }));
  return [...entries, ...view.recentlyClosed].slice(0, RECENTLY_CLOSED_LIMIT);
}

function openInView(view: PaneView, location: FilesLocation, options: OpenOptions): PaneChange {
  const active = selectActiveTab(view);
  if (!active || options.newTab) {
    const tab = createTab([{ location }]);
    return { tabs: insertBesideActive(view, tab), activeId: tab.id };
  }
  const from = tabLocation(active);
  if (filesLocationKey(from) === filesLocationKey(location)) return {};
  // Keep the thread, digest and Daily in their own tabs when opening another place.
  if (isAutoLocation(from) || isDigestLocation(from) || isDailyLocation(from)) {
    const shown = view.tabs.find((tab) => filesLocationKey(tabLocation(tab)) === filesLocationKey(location));
    if (shown) return { activeId: shown.id };
    const tab = createTab([{ location }]);
    return { tabs: insertBesideActive(view, tab), activeId: tab.id };
  }
  const history = [...active.history.slice(0, active.index + 1), { location }].slice(
    -HISTORY_LIMIT
  );
  return { tabs: replaceTab(view.tabs, { ...active, history, index: history.length - 1 }) };
}

/** Makes a tab its pane's open one and the pane the active one. */
function activateIn(state: TabsState, pane: Pane, id: string): Partial<TabsState> {
  if (state.activePaneId === pane.id && pane.activeId === id) return {};
  return { activePaneId: pane.id, panes: replacePane(state.panes, { ...pane, activeId: id }) };
}

/** The other pane, made at the right when there is one pane. */
function ensureOtherPane(state: TabsState): { panes: Pane[]; other: Pane } {
  const other = selectOtherPane(state);
  if (other) return { panes: state.panes, other };
  const made = createPane();
  return { panes: [...state.panes, made], other: made };
}

function moveState(state: TabsState, id: string, paneId?: string, at?: number): Partial<TabsState> {
  const source = paneOfTab(state, id);
  if (!source) return {};
  let panes = state.panes;
  let target = paneId ? selectPane(state, paneId) : null;
  if (!paneId) {
    // A pane that would be left with nothing has nothing to split from.
    if (state.panes.length === 1 && source.tabs.length < 2) return {};
    const other = state.panes.find((pane) => pane.id !== source.id);
    if (other) target = other;
    else ({ panes, other: target } = ensureOtherPane(state));
  }
  if (!target || target.id === source.id) return {};
  const tab = source.tabs.find((candidate) => candidate.id === id) as Tab;
  const from = source.tabs.indexOf(tab);
  const left = source.tabs.filter((candidate) => candidate.id !== id);
  const sourceActive =
    source.activeId === id ? (left[from] ?? left[from - 1])?.id ?? null : source.activeId;
  const position =
    at === undefined
      ? insertBesideActive(target, tab)
      : [...target.tabs.slice(0, Math.max(0, Math.min(at, target.tabs.length))), tab, ...target.tabs.slice(Math.max(0, Math.min(at, target.tabs.length)))];
  panes = replacePane(replacePane(panes, { ...source, tabs: left, activeId: sourceActive }), {
    ...target,
    tabs: position,
    activeId: id,
  });
  return { panes, activePaneId: target.id };
}

/** Opens a place in the other pane, making it if needed; a tab that shows it already goes there instead. */
function openBesideState(state: TabsState, location: FilesLocation): Partial<TabsState> {
  const key = filesLocationKey(location);
  // What the active pane shows now goes to the side, or only comes forward when it is all that pane has.
  const here = selectPane(state, state.activePaneId);
  const hereTab = here ? selectActiveTab(here) : null;
  const shown = here && hereTab && filesLocationKey(tabLocation(hereTab)) === key ? { pane: here, tab: hereTab } : tabShowing(state.panes, key);
  if (shown && shown.pane.id !== state.activePaneId) return activateIn(state, shown.pane, shown.tab.id);
  if (shown) {
    // Shown in this pane: the tab itself goes to the side, unless it is all this pane has, which would end the split
    // or leave nothing to split from. Then it only comes forward here.
    if (shown.pane.tabs.length < 2) return activateIn(state, shown.pane, shown.tab.id);
    const moved = moveState(state, shown.tab.id);
    return Object.keys(moved).length > 0 ? moved : activateIn(state, shown.pane, shown.tab.id);
  }
  const { panes, other } = ensureOtherPane(state);
  const tab = createTab([{ location }]);
  return {
    panes: replacePane(panes, { ...other, tabs: insertBesideActive(other, tab), activeId: tab.id }),
    activePaneId: other.id,
  };
}

function openState(state: TabsState, target: FilesLocation, options: OpenOptions): Partial<TabsState> {
  const location = canonical(target);
  if (options.side) return openBesideState(state, location);
  // A page shows in one place: when the other pane's open tab shows it, that is where it opens. One in a tab
  // behind it opens here; the slot draws the line there if that tab comes forward later.
  const other = selectOtherPane(state);
  const otherTab = other ? selectActiveTab(other) : null;
  if (other && otherTab && filesLocationKey(tabLocation(otherTab)) === filesLocationKey(location)) return activateIn(state, other, otherTab.id);
  return inPane(state, state.activePaneId, (view) => openInView(view, location, options));
}

/**
 * Back or Forward in the active pane's open tab, always. A page it lands on
 * that is live in the other pane shows the slot's line there, with Show it here.
 */
function stepState(state: TabsState, delta: number): Partial<TabsState> {
  return inPane(state, state.activePaneId, (view) => stepView(view, delta));
}

function stepView(view: PaneView, delta: number): PaneChange {
  const tab = selectActiveTab(view);
  const index = tab ? tab.index + delta : -1;
  if (!tab || index < 0 || index >= tab.history.length) return {};
  return { tabs: replaceTab(view.tabs, { ...tab, index }) };
}

function activateAt(view: PaneView, index: number): PaneChange {
  const tab = view.tabs.at(index);
  return tab && tab.id !== view.activeId ? { activeId: tab.id } : {};
}

function cycle(view: PaneView, delta: number): PaneChange {
  if (view.tabs.length === 0) return {};
  const current = view.tabs.findIndex((tab) => tab.id === view.activeId);
  const from = current === -1 ? (delta > 0 ? -1 : 0) : current;
  return activateAt(view, (from + delta + view.tabs.length) % view.tabs.length);
}

/** Keeps only `kept` tabs in their order, moving the active tab onto a kept one. */
function keepOnly(view: PaneView, kept: readonly Tab[]): PaneChange {
  const tabs = view.tabs.filter((tab) => kept.includes(tab));
  const closed = view.tabs.filter((tab) => !kept.includes(tab));
  const activeId = tabs.some((tab) => tab.id === view.activeId)
    ? view.activeId
    : (tabs.at(-1)?.id ?? null);
  return { tabs, activeId, recentlyClosed: remember(view, closed) };
}

function closeInView(view: PaneView, id: string): PaneChange {
  const index = view.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return {};
  const tabs = view.tabs.filter((tab) => tab.id !== id);
  // Prefer the tab to the right, as browsers do.
  const activeId =
    view.activeId === id ? (tabs[index] ?? tabs[index - 1])?.id ?? null : view.activeId;
  return { tabs, activeId, recentlyClosed: remember(view, [view.tabs[index]]) };
}

/** Runs a rule on the pane that holds a tab. */
function inPaneOf(state: TabsState, id: string, change: (view: PaneView) => PaneChange): Partial<TabsState> {
  const pane = paneOfTab(state, id);
  return pane ? inPane(state, pane.id, change) : {};
}

export const useTabsStore = create<TabsStore>((set, get) => {
  const update = (change: (state: TabsState) => Partial<TabsState>) =>
    set((state) => {
      const next = change(state);
      if (Object.keys(next).length === 0) return {};
      const settled = settle(state, { ...state, ...next });
      persist(settled);
      return settled;
    });
  const restored = restoredSession();
  const initial = settle(restored, { ...restored, tabs: [], activeId: null, recentlyClosed: [] });

  return {
    ...initial,

    open: (location, options = {}) =>
      update((state) => openState(state, location, options)),

    back: () => update((state) => stepState(state, -1)),

    forward: () => update((state) => stepState(state, 1)),

    activate: (id) =>
      update((state) => {
        const pane = paneOfTab(state, id);
        return pane ? activateIn(state, pane, id) : {};
      }),

    activateIndex: (index) => update((state) => inPane(state, state.activePaneId, (view) => activateAt(view, index))),

    activateNext: () => update((state) => inPane(state, state.activePaneId, (view) => cycle(view, 1))),

    activatePrevious: () => update((state) => inPane(state, state.activePaneId, (view) => cycle(view, -1))),

    close: (id) => update((state) => inPaneOf(state, id, (view) => closeInView(view, id))),

    closeOthers: (id) =>
      update((state) =>
        inPaneOf(state, id, (view) => {
          const tab = view.tabs.find((candidate) => candidate.id === id);
          return tab ? { ...keepOnly(view, [tab]), activeId: id } : {};
        })
      ),

    closeToRight: (id) =>
      update((state) =>
        inPaneOf(state, id, (view) => {
          const index = view.tabs.findIndex((tab) => tab.id === id);
          if (index === -1 || index === view.tabs.length - 1) return {};
          const kept = view.tabs.slice(0, index + 1);
          const next = keepOnly(view, kept);
          return kept.some((tab) => tab.id === view.activeId) ? next : { ...next, activeId: id };
        })
      ),

    closeAll: (paneId) =>
      update((state) => inPane(state, paneId ?? state.activePaneId, (view) => keepOnly(view, []))),

    reopenClosed: () => {
      const [closed, ...rest] = get().recentlyClosed;
      if (!closed) return false;
      update((state) => {
        // The tab opens again in its own pane, always. A page live in the other pane shows the slot's line there.
        const paneId = closed.paneId && selectPane(state, closed.paneId) ? closed.paneId : state.activePaneId;
        const placed = inPane(state, paneId, (view) => ({
          tabs: [...view.tabs.slice(0, closed.index), closed.tab, ...view.tabs.slice(closed.index)],
          activeId: closed.tab.id,
          recentlyClosed: rest,
        }));
        return { ...placed, activePaneId: paneId };
      });
      return true;
    },

    move: (from, to, paneId) =>
      update((state) =>
        inPane(state, paneId ?? state.activePaneId, (view) => {
          const count = view.tabs.length;
          if (from < 0 || to < 0 || from >= count || to >= count || from === to) return {};
          const tabs = [...view.tabs];
          const [moved] = tabs.splice(from, 1);
          tabs.splice(to, 0, moved);
          return { tabs };
        })
      ),

    saveView: (id, index, view) =>
      update((state) =>
        inPaneOf(state, id, (row) => {
          const tab = row.tabs.find((candidate) => candidate.id === id);
          const entry = tab?.history[index];
          if (!tab || !entry) return {};
          let next: TabEntry;
          if ('stack' in view) {
            const stack = restoredStackView(view.stack);
            if (!stack || JSON.stringify(entry.stack) === JSON.stringify(stack)) return {};
            next = { location: entry.location, stack };
          } else {
            // A stack keeps its place by section, never as a plain scroll.
            if (entry.location.mode === 'stack' || entry.scrollTop === view.scrollTop) return {};
            next = { location: entry.location, scrollTop: view.scrollTop };
          }
          const history = tab.history.map((candidate, at) => (at === index ? next : candidate));
          return { tabs: replaceTab(row.tabs, { ...tab, history }) };
        })
      ),

    splitRight: () =>
      update((state) => {
        const other = selectOtherPane(state);
        if (other) return { activePaneId: other.id };
        const made = createPane();
        return { panes: [...state.panes, made], activePaneId: made.id };
      }),

    focusPane: (paneId) =>
      update((state) =>
        paneId !== state.activePaneId && selectPane(state, paneId) ? { activePaneId: paneId } : {}
      ),

    focusOtherPane: () =>
      update((state) => {
        const other = selectOtherPane(state);
        return other ? { activePaneId: other.id } : {};
      }),

    closePane: (paneId) =>
      update((state) => {
        const pane = selectPane(state, paneId);
        if (!pane || state.panes.length < 2) return {};
        const closed = remember(
          { paneId, tabs: pane.tabs, activeId: pane.activeId, recentlyClosed: state.recentlyClosed },
          pane.tabs
        );
        const panes = state.panes.filter((candidate) => candidate.id !== paneId);
        return {
          panes,
          activePaneId: state.activePaneId === paneId ? panes[0].id : state.activePaneId,
          recentlyClosed: closed,
        };
      }),

    moveToPane: (id, paneId, at) => update((state) => moveState(state, id, paneId, at)),

    setSplit: (split) =>
      update((state) => {
        const next = safeSplit(split);
        return next === state.split ? {} : { split: next };
      }),
  };
});

function remapEntry(entry: TabEntry, mutation: AppPathMutation): TabEntry {
  const location = remapFilesLocation(entry.location, mutation.oldPath, mutation.newPath);
  if (!entry.stack) return { ...entry, location };
  const anchor = remapFsPath(entry.stack.anchor, mutation.oldPath, mutation.newPath);
  return { ...entry, location, stack: { ...entry.stack, anchor } };
}

function remapTab(tab: Tab, mutation: AppPathMutation): Tab {
  return { ...tab, history: tab.history.map((entry) => remapEntry(entry, mutation)) };
}

export function remapTabsState(
  state: TabsState,
  mutation: AppPathMutation
): TabsState {
  return settle(state, {
    ...state,
    panes: state.panes.map((pane) => ({ ...pane, tabs: pane.tabs.map((tab) => remapTab(tab, mutation)) })),
    recentlyClosed: state.recentlyClosed.map((closed) => ({
      ...closed,
      tab: remapTab(closed.tab, mutation),
    })),
  });
}

/**
 * Drops every history entry `keep` rejects. A tab whose current entry goes
 * shows the nearest earlier entry that stays, as if Back were pressed; a tab
 * with nothing left closes, and its pane's open tab then moves right, as on
 * close. A pane left with no tab closes when there is another.
 */
function keepEntries(
  state: TabsState,
  keep: (path: string) => boolean
): TabsState {
  const kept = (entry: TabEntry) => {
    const path = locationPath(entry.location);
    return path === null || keep(path);
  };
  const prune = (tab: Tab): Tab | null => {
    const history = tab.history.filter(kept);
    if (history.length === 0) return null;
    if (history.length === tab.history.length) return tab;
    const earlier = tab.history.slice(0, tab.index + 1).filter(kept).length;
    return { ...tab, history, index: Math.max(0, earlier - 1) };
  };
  const prunePane = (pane: Pane): Pane => {
    const pruned = pane.tabs.map(prune);
    const tabs = pruned.filter((tab): tab is Tab => tab !== null);
    const activeIndex = pane.tabs.findIndex((tab) => tab.id === pane.activeId);
    const activeId =
      activeIndex === -1
        ? null
        : (pruned.slice(activeIndex).find(Boolean) ??
            pruned.slice(0, activeIndex).reverse().find(Boolean))?.id ?? null;
    return { ...pane, tabs, activeId };
  };
  return settle(state, {
    ...state,
    panes: state.panes.map(prunePane),
    recentlyClosed: state.recentlyClosed.flatMap((closed) => {
      const tab = prune(closed.tab);
      return tab ? [{ ...closed, tab }] : [];
    }),
  });
}

export function removePathsFromTabsState(
  state: TabsState,
  removedPaths: readonly string[]
): TabsState {
  return keepEntries(
    state,
    (path) => !removedPaths.some((root) => isFsPathAtOrBelow(root, path))
  );
}

export function retainTabsWithinRoots(
  state: TabsState,
  roots: readonly string[]
): TabsState {
  return keepEntries(state, (path) =>
    roots.some((root) => isFsPathAtOrBelow(root, path))
  );
}

function prepare(next: (previous: TabsState) => TabsState) {
  const previous = useTabsStore.getState();
  const updated = next(previous);
  return {
    commit: () => {
      persist(updated);
      useTabsStore.setState(updated);
    },
    rollback: () => {
      persist(previous);
      useTabsStore.setState(previous);
    },
  };
}

pathMutationCoordinator.register({
  id: 'tabs-store',
  prepareAppMutation: (mutation) =>
    prepare((previous) => remapTabsState(previous, mutation)),
  preparePathRemoval: (paths) =>
    prepare((previous) => removePathsFromTabsState(previous, paths)),
  prepareAllowedRoots: (roots) =>
    prepare((previous) => retainTabsWithinRoots(previous, roots)),
});
