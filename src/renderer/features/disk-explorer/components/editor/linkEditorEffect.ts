import { Facet, StateEffect } from '@codemirror/state';

/*
 * The effect that shows a link's popover, in a file of its own so that
 * wikiLinks.ts and fileActions.ts can use it without importing docMode.ts,
 * which imports them through formatCommands.ts.
 */

/** The link a click or Cmd+K is about, while its popover shows; `editing` once its fields are open. */
export interface LinkEditor {
  from: number;
  to: number;
  editing: boolean;
}

export const setLinkEditor = StateEffect.define<LinkEditor | null>();

/**
 * On in a note: a click on a link follows it, as it does on a page that is
 * read, rather than putting the caret in the link to edit it, a document's
 * way. Cmd+K edits the link at the caret either way.
 */
export const followLinkClicks = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });
