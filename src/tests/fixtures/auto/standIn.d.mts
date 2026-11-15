/** The stand-in Auto service (standIn.mjs), as tests see it. */
export interface StandInRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface StandInOptions {
  /** 'default': the made-up list. 'empty': only snoozed threads. 'none': no thread. */
  fixture?: 'default' | 'empty' | 'none';
  /** 'default': three days of digests. 'done': one day, all of it resolved. 'none': no digest. */
  digests?: 'default' | 'done' | 'none';
  /** Milliseconds between pieces of a streamed reply. */
  pace?: number;
  heartbeatMs?: number;
  /** The wait every stream asks of a client before it opens it again. */
  retryMs?: number;
  mount?: string;
  port?: number;
}

export interface StandIn {
  port: number;
  /** `http://127.0.0.1:<port>/agent`. */
  url: string;
  requests: StandInRequest[];
  /** Digest boxes ticked by a Done. */
  ticks: Array<{ date: string; id: string }>;
  thread: (id: string) => Record<string, unknown> | undefined;
  entries: () => Array<Record<string, unknown> & { id: string; title: string }>;
  /** A day's digest as the service answers it; the latest with no date. */
  digest: (date?: string) => {
    date: string;
    left: number;
    sections: Array<{ title: string; entries: Array<{ id: string; state: string; thread: string | null; note: string }> }>;
  } | null;
  signOut: (out?: boolean) => void;
  failWrites: (how: false | 'refuse' | 'drop') => void;
  down: (isDown?: boolean) => void;
  dropStreams: () => void;
  restart: () => void;
  hold: (name: string) => void;
  release: (name: string) => void;
  wake: (id: string) => void;
  sendWaiting: (id: string) => void;
  sendWent: (id: string) => void;
  raw: (text: string, id?: string) => void;
  close: () => Promise<void>;
}

export function startStandIn(options?: StandInOptions): Promise<StandIn>;
