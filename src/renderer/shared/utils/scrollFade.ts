/* Which edges of a sidebar scroll area cut its content, for `.sidebar-fade` (index.css). */

export type Fade = 'top' | 'bottom' | 'both' | null;

/** The edges of a scroll area that cut its content: the top once scrolled, the bottom while more is below. */
export function fadeOf(element: HTMLElement): Fade {
  const above = element.scrollTop > 1;
  const below = element.scrollHeight - element.clientHeight - element.scrollTop > 1;
  return above && below ? 'both' : above ? 'top' : below ? 'bottom' : null;
}

/** Sets `data-fade-y` on an element that is not drawn by React, as the tree's virtual list. */
export function markFade(element: HTMLElement, fade: Fade): void {
  if (fade) element.setAttribute('data-fade-y', fade);
  else element.removeAttribute('data-fade-y');
}
