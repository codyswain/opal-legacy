import { describe, expect, it } from 'vitest';
import { SseOverflowError, SseReader } from '@/main/auto/sseReader';

describe('the stream reader', () => {
  it('gives out an event once its blank line has arrived', () => {
    const reader = new SseReader();
    expect(reader.push('id: 6c1f7699.15\nevent: append\ndata: {"text": " three steps."}\n').events).toEqual([]);
    expect(reader.push('\n').events).toEqual([{ id: '6c1f7699.15', event: 'append', data: '{"text": " three steps."}' }]);
  });

  it('reads the same events however the bytes are cut', () => {
    const text = 'retry: 3000\n\nid: b.1\nevent: turn\ndata: {"items": []}\n\n: hb\n\nid: b.2\nevent: append\ndata: {"text": "a\\nb"}\n\nid: b.3\nevent: reset\ndata: {}\n\n';
    const whole = new SseReader().push(text);
    expect(whole.events.map((event) => [event.id, event.event])).toEqual([['b.1', 'turn'], ['b.2', 'append'], ['b.3', 'reset']]);
    expect(whole.comments).toBe(1);
    expect(whole.retry).toBe(3000);
    for (let size = 1; size <= 7; size += 1) {
      const reader = new SseReader();
      const events = [];
      let comments = 0;
      for (let at = 0; at < text.length; at += size) {
        const piece = reader.push(text.slice(at, at + size));
        events.push(...piece.events);
        comments += piece.comments;
      }
      expect(events, `pieces of ${size}`).toEqual(whole.events);
      expect(comments).toBe(1);
    }
  });

  it('counts a heartbeat as a comment and makes no event of it', () => {
    const piece = new SseReader().push(': hb\n\n: hb\n\n');
    expect(piece.events).toEqual([]);
    expect(piece.comments).toBe(2);
  });

  it('keeps the cursor of the last event that carried one', () => {
    const piece = new SseReader().push('id: b.7\nevent: activity\ndata: {}\n\nevent: activity\ndata: {}\n\n');
    expect(piece.events.map((event) => event.id)).toEqual(['b.7', 'b.7']);
  });

  it('joins data lines and takes CRLF and CR line ends, also across pieces', () => {
    const reader = new SseReader();
    expect(reader.push('event: add\r\ndata: one\r\ndata: two\r').events).toEqual([]);
    expect(reader.push('\n\r\n').events).toEqual([{ id: null, event: 'add', data: 'one\ntwo' }]);
    expect(new SseReader().push('data: x\r\rdata: y\r\r').events.map((event) => event.data)).toEqual(['x', 'y']);
  });

  it('names an event with no kind `message`, and skips fields it does not know', () => {
    expect(new SseReader().push('data: hello\nfoo: bar\nretry: soon\n\n')).toEqual({
      events: [{ id: null, event: 'message', data: 'hello' }],
      comments: 0,
      retry: null,
    });
  });

  it('reads a value with or without the space after the colon', () => {
    expect(new SseReader().push('event:end\ndata:{"a": 1}\n\n').events).toEqual([{ id: null, event: 'end', data: '{"a": 1}' }]);
  });

  it('stops at an event or a line past the limit', () => {
    const reader = new SseReader(100);
    expect(() => reader.push(`data: ${'x'.repeat(60)}\ndata: ${'y'.repeat(60)}\n`)).toThrow(SseOverflowError);
    expect(() => new SseReader(100).push('x'.repeat(101))).toThrow(SseOverflowError);
  });
});
