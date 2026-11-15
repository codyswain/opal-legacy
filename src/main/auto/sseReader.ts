/** One server-sent event. */
export interface SseEvent {
  /** The event's id, which is the stream's cursor after it; null when it carried none. */
  id: string | null;
  /** The kind; `message` when the stream named none. */
  event: string;
  data: string;
}

/** What one piece of a stream held. */
export interface SsePiece {
  events: SseEvent[];
  /** Comment lines, such as the service's `: hb` heartbeat. */
  comments: number;
  /** The reconnect delay the stream asked for, in ms, when this piece set one. */
  retry: number | null;
}

export class SseOverflowError extends Error {}

/** The largest single event, and the longest unfinished line, a stream may hold. */
export const SSE_EVENT_LIMIT = 4 * 1024 * 1024;

/**
 * Reads a `text/event-stream` body piece by piece. A piece can end anywhere,
 * in the middle of a line or of a line ending; an event is given out once
 * its blank line has arrived. Lines end with LF, CRLF or CR.
 */
export class SseReader {
  private rest = '';
  private id: string | null = null;
  private event = '';
  private data: string[] = [];
  private size = 0;
  /** The last piece ended on a CR, whose LF may open the next one. */
  private afterCr = false;

  constructor(private limit = SSE_EVENT_LIMIT) {}

  push(chunk: string): SsePiece {
    const piece: SsePiece = { events: [], comments: 0, retry: null };
    let text = this.rest + chunk;
    if (this.afterCr && text.startsWith('\n')) text = text.slice(1);
    this.afterCr = false;
    let start = 0;
    const ending = /[\r\n]/g;
    for (;;) {
      ending.lastIndex = start;
      const found = ending.exec(text);
      if (!found) break;
      const at = found.index;
      const line = text.slice(start, at);
      if (text[at] === '\r') {
        // A CR at the very end may be half of a CRLF.
        if (at + 1 === text.length) this.afterCr = true;
        start = text[at + 1] === '\n' ? at + 2 : at + 1;
      } else {
        start = at + 1;
      }
      this.line(line, piece);
    }
    this.rest = text.slice(start);
    if (this.rest.length > this.limit) throw new SseOverflowError('A line of the stream was too long.');
    return piece;
  }

  private line(line: string, piece: SsePiece): void {
    if (line === '') {
      if (this.data.length > 0 || this.event !== '') {
        piece.events.push({ id: this.id, event: this.event || 'message', data: this.data.join('\n') });
      }
      this.event = '';
      this.data = [];
      this.size = 0;
      return;
    }
    if (line.startsWith(':')) {
      piece.comments += 1;
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      this.size += value.length + 1;
      if (this.size > this.limit) throw new SseOverflowError('An event of the stream was too large.');
      this.data.push(value);
    } else if (field === 'event') {
      this.event = value;
    } else if (field === 'id') {
      // An id holding NUL is ignored, as the format says.
      if (!value.includes('\0')) this.id = value;
    } else if (field === 'retry' && /^\d+$/.test(value)) {
      piece.retry = Number(value);
    }
  }
}
