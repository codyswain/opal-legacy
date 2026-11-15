/*
 * Where he was. The scroll position of each thread, of the list and of the
 * queue is kept for the session, so coming back to the tab, to a thread or
 * from a page finds the same lines on screen. Kept in memory only.
 */

export interface Place {
  /** The scroller's offset from its top. */
  top: number;
  /** Whether it was at its end, where a thread follows new text. */
  atEnd: boolean;
  /** How tall its content was, to tell whether text arrived while he was away. */
  height: number;
}

const LIMIT = 200;
const places = new Map<string, Place>();

export const threadPlace = (id: string): string => `thread:${id}`;
export const queuePlace = (date: string): string => `queue:${date}`;
export const LIST_PLACE = 'list';

export function keepPlace(key: string, place: Place): void {
  places.delete(key);
  places.set(key, place);
  // The oldest go first.
  for (const oldest of places.keys()) {
    if (places.size <= LIMIT) break;
    places.delete(oldest);
  }
}

export const placeOf = (key: string): Place | null => places.get(key) ?? null;

export function forgetPlaces(): void {
  places.clear();
}

/** Forgets one place: a tab opened fresh starts its list at the top. */
export function forgetPlace(key: string): void {
  places.delete(key);
}

/** How near the end counts as at the end, in px. */
export const END_SLACK = 80;

/** The place a scroller is at now. */
export function placeIn(element: { scrollTop: number; scrollHeight: number; clientHeight: number }): Place {
  return {
    top: element.scrollTop,
    atEnd: element.scrollHeight - element.scrollTop - element.clientHeight < END_SLACK,
    height: element.scrollHeight,
  };
}
