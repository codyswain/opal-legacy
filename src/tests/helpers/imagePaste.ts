import { fireEvent } from '@testing-library/react';

// A one-pixel PNG, as copied by macOS.
export const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAsTj2FAAAAABJRU5ErkJggg==';
export const PNG_ID = 'd44c0303173ecdb8ba72a7ab688f020583b31865537e2f9ab57e56aeec687807';
export const screenshot = () => new File([Uint8Array.from(atob(PNG_DATA), (char) => char.charCodeAt(0))], 'clipboard.png', { type: 'image/png' });

/** happy-dom does not implement a system clipboard paste into a focused field. */
export function pasteFiles(field: HTMLElement, files: File[], plain = ''): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files,
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (type: string) => type === 'text/plain' ? plain : '',
    },
  });
  fireEvent(field, event);
  return event;
}
