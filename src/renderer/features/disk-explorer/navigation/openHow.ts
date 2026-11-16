import type { OpenOptions } from '../store/tabsStore';

/** Where a click opens a place: Option opens it in the other pane, Cmd or a middle click in a new tab. */
export type OpenHow = Pick<OpenOptions, 'newTab' | 'side'>;

export function openHowFor(event: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; button?: number }): OpenHow {
  if (event.altKey) return { side: true };
  return { newTab: event.metaKey || event.ctrlKey || event.button === 1 };
}
