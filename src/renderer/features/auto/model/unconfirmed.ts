/*
 * What he has just done and the service has yet to confirm, kept by id. A
 * copy of the same thing that arrives meanwhile (the list stream's own word
 * of the action, another write's answer, a fresh read) has the change laid
 * over it, so a row he archived does not come back and one he brought back
 * does not leave again while the posts are still on their way. An action
 * keeps its change until its post, and the post that undoes it, have
 * landed; a later change to the same thing takes the earlier one's place.
 */

export interface Unconfirmed<T> {
  /** Keeps a change to the thing with this id, and answers the token that ends it. */
  keep: (id: string, change: (value: T) => T) => number;
  /** Ends a change, unless a later one has taken its place. */
  end: (id: string, token: number) => void;
  /** The value as he left it. */
  lay: (id: string, value: T) => T;
  has: (id: string) => boolean;
  clear: () => void;
}

export function unconfirmed<T>(): Unconfirmed<T> {
  const kept = new Map<string, { change: (value: T) => T; token: number }>();
  let tokens = 0;
  return {
    keep: (id, change) => {
      tokens += 1;
      kept.set(id, { change, token: tokens });
      return tokens;
    },
    end: (id, token) => {
      if (kept.get(id)?.token === token) kept.delete(id);
    },
    lay: (id, value) => kept.get(id)?.change(value) ?? value,
    has: (id) => kept.has(id),
    clear: () => kept.clear(),
  };
}
