import React from 'react';

/** What a page shows once every tab is closed, and an empty pane beside another. */
export const NoPageOpen: React.FC<{
  /** Given in a pane beside another, which this closes. */
  onClosePane?: () => void;
}> = ({ onClosePane }) => (
  <div
    data-testid="no-page-open"
    className="flex h-full flex-col items-center justify-center gap-3 p-8"
  >
    <p className="text-ui text-foreground-tertiary">
      No file is open. Choose one in the sidebar or press ⌘K to search.
    </p>
    {onClosePane ? (
      <button
        type="button"
        data-testid="close-pane"
        onClick={onClosePane}
        className="rounded-control px-2 py-1 text-ui text-foreground-secondary transition-hover hover:bg-surface-hover hover:text-foreground"
      >
        Close pane
      </button>
    ) : null}
  </div>
);
