import { describe, expect, it } from 'vitest';
import { fadeOf, revealIn } from '@/renderer/features/auto/components/listScroll';

/** A scroll area with a fixed view and content height, and boxes measured from its top. */
function area(height: number, content: number, top = 0) {
  const element = { scrollTop: top, clientHeight: height, scrollHeight: content, getBoundingClientRect: () => ({ top: 100, bottom: 100 + height }) };
  return element as unknown as HTMLElement;
}
const section = (scroller: HTMLElement, from: number, to: number) =>
  ({ getBoundingClientRect: () => ({ top: 100 + from - scroller.scrollTop, bottom: 100 + to - scroller.scrollTop }) }) as unknown as HTMLElement;

describe('Threads’ cut edges', () => {
  it('fades nothing when the rows fit', () => {
    expect(fadeOf(area(300, 300))).toBeNull();
  });

  it('fades the bottom while more is below, the top once scrolled, and both between', () => {
    expect(fadeOf(area(300, 600, 0))).toBe('bottom');
    expect(fadeOf(area(300, 600, 150))).toBe('both');
    expect(fadeOf(area(300, 600, 300))).toBe('top');
  });
});

describe('a put-away line opened in Threads', () => {
  it('scrolls its first rows into view', () => {
    const scroller = area(300, 900);
    revealIn(scroller, section(scroller, 250, 400));
    expect(scroller.scrollTop).toBe(100);
  });

  it('never scrolls the line itself past the top, however long the section', () => {
    const scroller = area(300, 2000);
    revealIn(scroller, section(scroller, 250, 1500));
    expect(scroller.scrollTop).toBe(250);
  });

  it('keeps the line clear of the top edge’s fade', () => {
    const scroller = area(300, 2000);
    revealIn(scroller, section(scroller, 250, 1500), 24);
    expect(scroller.scrollTop).toBe(226);
  });

  it('leaves the rows alone when the section is already in view', () => {
    const scroller = area(300, 900, 40);
    revealIn(scroller, section(scroller, 100, 300));
    expect(scroller.scrollTop).toBe(40);
  });
});
