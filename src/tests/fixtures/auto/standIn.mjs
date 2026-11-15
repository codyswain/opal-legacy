// A stand-in for the Auto service, for tests and acceptance runs. It speaks
// the service's HTTP API for a handful of made-up threads (a garden, a
// kitchen, a few plans) on http://127.0.0.1 and nowhere else: the list and
// its stream, a thread's snapshot and stream with cursors and `reset`,
// scripted replies that stream in, a question, a permission request,
// follow-ups, snooze, move, archive, rename, a waiting entry with `start`,
// the mark for the Mac, a few days of digests as a queue (resolve, note, a
// thread from an entry), and switches for signed-out, failing writes and
// being out of reach.
// It runs no agent and reaches no network.
//
//   const service = await startStandIn();
//   service.url            // http://127.0.0.1:<port>/agent
//   service.requests       // every request it got: {method, path, headers, body}
//   await service.close();
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const MODELS = { '': 'Default', small: 'Small', large: 'Large' };
const SIGN_IN = 'auto-login --on desk-mac';
const NAME = 'Robin';

const LONG_REPLY = `Here is the bake, worked back from dinner at 7.

## Timings

| Step | Start | Takes | Notes |
| --- | --- | ---: | --- |
| Feed the starter | 8:00 am | 4 h | It should double |
| Mix and rest | 12:00 pm | 45 min | Flour and water only |
| Fold | 12:45 pm | 3 h | Four folds, 30 min apart |
| Shape and proof | 3:45 pm | 1 h 30 | Seam side up in the basket |
| Bake | 5:30 pm | 45 min | Lid on for the first 25 |

## What to check

1. The starter floats in water before you mix.
2. The dough has grown by about half before shaping:
   - a few large bubbles at the edge
   - it jiggles when the bowl moves
3. The oven and the pot are **fully hot**, 250 °C for 40 minutes.

> A loaf that spreads flat was proofed too long. Shorten the last rise by 20 minutes next time.

To scale the recipe, keep the ratios:

\`\`\`python
def scale(flour_g, hydration=0.75, salt=0.02, starter=0.2):
    return {
        "water": round(flour_g * hydration),
        "salt": round(flour_g * salt),
        "starter": round(flour_g * starter),
    }
\`\`\`

The full method is in [Bread](Recipes/Bread.md), and the flour you have is listed in \`Projects/Kitchen/Pantry.md\`. There is a good [shaping video](https://example.com/shaping).

---

Rest the loaf for an hour before you cut it.`;

const SHORT_REPLY = `The four beds get six hours of sun from May. Beans and peas go in bed 2, where the trellis is.

See [Beds](Projects/Garden/Beds.md) for the layout.`;

const ENTRY = `Digest, Friday November 13, item 2: Book the allotment inspection

Priority: High

The committee walks the plots on the 21st. Plot 14 needs the path cleared and the water butt lid replaced first.

- Clear the path along the north fence
- Replace the lid, 60 cm

From Library/digests/2026-11-13 digest.md`;

const now = () => Date.now() / 1000;
const hex = (bytes) => randomBytes(bytes).toString('hex');
const WIDE_REPLY = `The whole year, month by month.

| Crop | January | February | March | April | May | June | July | August | September | October | November | December |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Broad beans | Rest | Sow under cover | Sow outside | Stake the rows | Pinch the tips | Pick | Pick and clear | Green manure | Green manure | Dig it in | Sow for spring | Rest |
| Squash | Rest | Rest | Order the seed | Sow under cover | Plant out after frost | Feed weekly | Feed weekly | Pick the first | Cure in the sun | Store | Rest | Rest |

\`\`\`sh
rsync --archive --delete --exclude ".cache" --exclude "*.tmp" ~/Garden/plans/ /Volumes/Backup/garden/plans/ && echo "plans copied on $(date +%F)" >> ~/Garden/backup.log
\`\`\`

That is everything.`;

const firstLine = (text) => (text.split('\n').find((line) => line.trim()) ?? '').replace(/^#+\s*/, '').slice(0, 200);
/** A line's words without their Markdown marks, links by their text. */
const plainWords = (text) => text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();

/** The made-up threads the list starts with, first on top. */
function fixtureThreads(kind) {
  const t = now();
  const base = (id, title, fields = {}) => ({
    id, title, status: 'idle', last: '', activity: '', ask: null, unread: false, model: '', created: t - 86400, updated: t - 3600,
    error: null, queued: 0, archived: false, snoozed: null, woke: null, digest: null, waits: false,
    items: [], next: [], seed: null, ...fields,
  });
  const snoozed = [
    base('5a0000000007', 'Pantry labels', { last: 'The label sheet is A4, 21 to a page.', snoozed: t + 20 * 3600, updated: t - 2 * 86400,
      items: [{ role: 'user', text: 'What size are the pantry labels?' }, { role: 'assistant', text: 'The label sheet is A4, 21 to a page.' }] }),
    base('5a0000000008', 'Herb spiral', { last: 'Thyme at the top, mint in its own pot at the bottom.', snoozed: t + 6 * 86400, updated: t - 3 * 86400,
      items: [{ role: 'user', text: 'Where does each herb go?' }, { role: 'assistant', text: 'Thyme at the top, mint in its own pot at the bottom.' }] }),
  ];
  if (kind === 'none') return [];
  if (kind === 'empty') return snoozed;
  return [
    base('5a0000000001', 'Raised bed plan', { status: 'waiting', updated: t - 600, activity: 'Waiting for you',
      items: [{ role: 'user', text: 'Plan the two new raised beds by the shed.' }],
      liveAsk: { kind: 'ask', questions: [{ question: 'Which wood for the frames?', header: 'Wood', multiSelect: false,
        options: [{ label: 'Cedar', description: '' }, { label: 'Larch', description: '' }] }] } }),
    base('5a0000000002', 'Sourdough timings', { last: firstLine(LONG_REPLY), updated: t - 1500,
      items: [
        { role: 'user', text: 'When do I start the bread for dinner at 7?' },
        { role: 'steps', steps: [{ g: 'read', text: 'Recipes/Bread.md', path: 'Recipes/Bread.md' }, { g: 'quiet', text: 'Looked up a tool' }, { g: 'run', text: 'Work the times back from 7 pm' }] },
        { role: 'assistant', text: LONG_REPLY },
      ],
      next: ['Scale it to two loaves', 'Put the times in today’s page'] }),
    base('5a0000000003', 'Seed order for spring', { last: 'Twelve packets, 38.40 in all. The peas are back in stock.', unread: true, updated: t - 4000,
      items: [{ role: 'user', text: 'Total the seed order.' }, { role: 'assistant', text: 'Twelve packets, 38.40 in all. The peas are back in stock.' }] }),
    base('5a0000000004', 'Compost bin', { status: 'failed', error: 'The turn ended early: the agent stopped answering.', updated: t - 86400,
      items: [{ role: 'user', text: 'How big should the compost bin be?' }] }),
    base('5a0000000005', 'Tomato trellis', { last: 'String lines every 20 cm hold a vine up to two metres.', woke: t - 900, updated: t - 86400 * 2,
      items: [{ role: 'user', text: 'How far apart are the trellis strings?' }, { role: 'assistant', text: 'String lines every 20 cm hold a vine up to two metres.' }] }),
    base('5a0000000006', 'Book the allotment inspection', { waits: true, seed: ENTRY, last: 'The committee walks the plots on the 21st.',
      digest: { date: '2026-11-13', id: 'item-2' }, updated: t - 86400 * 3 }),
    base('5a0000000009', 'Rain barrel', { status: 'stopped', last: 'Stopped', updated: t - 86400 * 9,
      items: [{ role: 'user', text: 'Size the rain barrel for the shed roof.' }, { role: 'note', text: 'Stopped' }] }),
    ...snoozed,
  ];
}

/** The made-up digests, by day. Each entry keeps what he did with it. */
function fixtureDigests(kind) {
  const digests = new Map();
  if (kind === 'none') return digests;
  const day = (date, sections) => digests.set(date, { date, path: `Library/digests/${date} digest.md`, sections });
  const text = (id, md, fields = {}) => ({ id, kind: 'text', title: '', md, note: '', resolved: false, ...fields });
  day('2026-11-13', [
    { title: 'Meetings', entries: [
      { id: 'meeting-allotment-committee', kind: 'meeting', title: 'Allotment committee', note: '', resolved: false,
        md: '**10:00 [Allotment committee](https://example.com/meet)** (in the hall)\n- Agree the date of the inspection\n- Who brings the keys to the tool store' },
    ] },
    { title: 'Top 3', entries: [
      { id: 'item-1', kind: 'item', title: 'Order the seed trays', n: 1, checked: false, priority: '', note: '',
        md: 'The garden centre holds an order until Saturday. Two trays cover the beans and the peas.',
        draft: { title: 'Garden centre', md: '**Garden centre**, seed trays, email.', paste: 'Two trays of 40 cells, please.\n\nI can collect them on Saturday morning.' } },
      { id: 'item-2', kind: 'item', title: 'Book the allotment inspection', n: 2, checked: false, priority: 'High', note: '', draft: null,
        md: 'The committee walks the plots on the 21st. Plot 14 needs the path cleared and the water butt lid replaced first.\n\n- Clear the path along the north fence\n- Replace the lid, 60 cm' },
      { id: 'item-3', kind: 'item', title: 'Fix the kitchen tap', n: 3, checked: false, priority: 'Medium', note: '', draft: null,
        md: 'The hot side drips. The washer is a 12 mm, and the spare is in [Tap](Projects/Kitchen/Tap.md).' },
    ] },
    { title: 'People', entries: [
      { id: 'person-robin-seed-swap', kind: 'person', title: 'Robin (seed swap)', note: '', resolved: false,
        md: '**Robin (seed swap):** quiet since the spring list went round. The swap is two weeks away.' },
    ] },
    { title: 'Plots', entries: [
      text('text-plots-3d20bff3', '| Plot | Bed | Sown | Next |\n| --- | --- | --- | --- |\n| 14 | 2 | Beans | Stake on Sunday |\n| 14 | 3 | Chard | Thin out |\n| 9 | 1 | Peas | Net against birds |', { title: 'Plots' }),
    ] },
    { title: 'Yesterday', entries: [
      text('text-yesterday-88ae3a55', 'The compost was turned and the lid is back on.', { resolved: true }),
      text('text-yesterday-5c1d2e3f', '**Ready to plant.** The bean seedlings have four leaves and the frost is past.', { title: 'Ready to plant' }),
      text('text-yesterday-a7b8c9d0', 'The shed roof let water in at the back corner again.'),
    ] },
    { title: 'Drafted replies', entries: [
      { id: 'draft-1', kind: 'draft', title: 'Garden club', md: '**Garden club**, newsletter, email.', note: '', resolved: false,
        paste: 'Thanks, the newsletter reads well.\n\nOne change: the open day is the 21st, not the 28th.' },
    ] },
  ]);
  day('2026-11-12', [
    { title: 'Top 3', entries: [
      { id: 'item-1', kind: 'item', title: 'Water the tomatoes', n: 1, checked: true, priority: '', note: '', draft: null, md: 'Before nine, while the bed is in shade.' },
      { id: 'item-2', kind: 'item', title: 'Sharpen the secateurs', n: 2, checked: false, priority: 'Low', note: 'The stone is in the blue tin', draft: null, md: 'They tore the rose stems last week.' },
    ] },
    { title: 'Yesterday', entries: [
      text('text-yesterday-1a2b3c4d', 'Four rows of carrots are in. The fleece is pegged down.'),
    ] },
  ]);
  day('2026-11-11', []);
  if (kind === 'done') {
    digests.delete('2026-11-12');
    digests.delete('2026-11-11');
    for (const section of digests.get('2026-11-13').sections) {
      for (const entry of section.entries) {
        if (entry.kind === 'item') entry.checked = true;
        else entry.resolved = true;
      }
    }
  }
  return digests;
}

/**
 * Starts the stand-in.
 *   fixture: 'default' | 'empty' (only snoozed threads) | 'none'
 *   digests: 'default' (three days) | 'done' (one day, all of it resolved) | 'none'
 *   pace: ms between pieces of a streamed reply
 *   heartbeatMs: how often every stream sends `: hb`
 *   retryMs: the wait every stream asks of a client before it opens it again
 */
export async function startStandIn(options = {}) {
  const mount = options.mount ?? '/agent';
  const pace = options.pace ?? 25;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const retryMs = options.retryMs ?? 3_000;
  let boot = hex(4);
  const state = {
    signedOut: false,
    failWrites: false, // false | 'refuse' | 'drop'
    down: false,
    slowMs: 0,
    slow: 0, // ms every answer but a stream's waits
    holds: new Map(),
  };
  const requests = [];
  /** Tries to allow a send with no signature from a phone. */
  const unsigned = [];
  const ticks = [];
  const digests = fixtureDigests(options.digests ?? 'default');
  const threads = new Map();
  let order = [];
  const list = { n: 0, events: [], clients: new Set() };
  const cids = new Map();
  const sockets = new Set();
  const timers = new Set();

  function add(fields, onTop) {
    const { liveAsk, ...rest } = fields;
    const thread = { live: null, queue: [], unsent: null, n: 0, events: [], clients: new Set(), run: null, send: null, sent: [], answer: null, ...rest };
    threads.set(thread.id, thread);
    if (onTop) order.unshift(thread.id); else order.push(thread.id);
    if (liveAsk) askAtStart(thread, liveAsk);
    return thread;
  }

  /** A thread that starts out waiting on an answer: its turn carries on once the answer comes. */
  function askAtStart(thread, question) {
    const run = { stopped: false };
    thread.run = run;
    thread.live = { items: thread.items.splice(0), activity: '', state: 'waiting', question: null };
    const ctx = context(thread, run);
    void (async () => {
      const answer = await ctx.ask(question);
      const picked = Object.values(answer.answers ?? {})[0] ?? 'that';
      ctx.activity('Writing');
      await ctx.say(`${Array.isArray(picked) ? picked.join(' and ') : picked} it is. Two frames need eight boards of 2.4 m.`);
      return ['List the fixings'];
    })().then(
      (next) => endTurn(thread, run, 'done', null, next),
      () => endTurn(thread, run, 'stopped', null, []),
    );
  }

  /** The list's short form of an open question. */
  function askOf(thread) {
    const question = thread.live?.question;
    if (!question) return null;
    if (question.kind === 'permission') return { id: question.id, kind: 'permission', text: question.title };
    // A send to allow up front: its title, and nothing to answer it with from a row.
    if (question.kind === 'grant') return { id: question.id, kind: 'grant', text: question.title };
    const [part] = question.questions;
    const line = part.question.split('\n')[0];
    const mark = line.indexOf('?');
    const sentence = mark === -1 ? line : line.slice(0, mark + 1);
    const plain = question.questions.length === 1 && !part.multiSelect && part.options.length <= 3 && sentence === part.question;
    return { id: question.id, kind: 'ask', text: sentence, ...(plain ? { options: part.options.map((option) => option.label), question: part.question } : {}) };
  }

  function entry(thread) {
    return {
      id: thread.id, title: thread.title, status: thread.status, last: thread.last, activity: thread.live ? thread.activity : '',
      ask: askOf(thread), unread: thread.unread, model: thread.model, created: thread.created, updated: thread.updated,
      error: thread.status === 'failed' ? thread.error : null, queued: thread.queue.length, archived: thread.archived,
      snoozed: thread.snoozed, woke: thread.woke, desk: thread.desk ?? null, yours: thread.yours ?? '', digest: thread.digest, ...(thread.waits ? { waits: true } : {}),
    };
  }

  /**
   * The mark for the Mac ends by itself when he picks the thread up from a
   * client other than the one that set it.
   */
  function pickedUp(thread, client) {
    if (thread.desk && thread.desk.by !== client) thread.desk = null;
  }

  const days = () => [...digests.keys()].sort().reverse();
  const entriesOf = (digest) => digest.sections.flatMap((section) => section.entries);
  const isResolved = (found) => (found.kind === 'item' ? found.checked : found.resolved);

  /** The thread a digest entry became. One put away before anything was said in it does not count. */
  function threadOf(date, id) {
    return [...threads.values()].find((thread) => thread.digest?.date === date && thread.digest.id === id && !(thread.archived && thread.waits)) ?? null;
  }

  /** A day's digest as the service answers it, each entry with what became of it. */
  function digestOf(date) {
    const digest = digests.get(date);
    if (!digest) return null;
    const count = { open: 0, resolved: 0, thread: 0 };
    const sections = digest.sections.map((section) => ({
      title: section.title,
      entries: section.entries.map((found) => {
        const thread = threadOf(date, found.id);
        const state = isResolved(found) ? 'resolved' : thread ? 'thread' : 'open';
        count[state] += 1;
        const { resolved, ...shown } = found;
        return { ...shown, section: section.title, state, thread: thread ? thread.id : null };
      }),
    })).filter((section) => section.entries.length > 0);
    return {
      date, path: digest.path, today: date === days()[0],
      left: count.open, resolved: count.resolved, threads: count.thread, total: count.open + count.resolved + count.thread,
      sections,
    };
  }

  /** The first message of a thread made from an entry, in the form the service writes. */
  function seedOf(date, found, section) {
    const [year, month, dayOfMonth] = date.split('-').map(Number);
    const written = new Date(year, month - 1, dayOfMonth).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).replace(',', '');
    const what = found.kind === 'item' ? `item ${found.n}` : found.kind === 'draft' ? 'reply' : found.kind === 'text' ? section.toLowerCase() : found.kind;
    const title = found.title || firstLine(found.md).slice(0, 80);
    const paste = found.draft?.paste ?? found.paste;
    return [
      `Digest, ${written}, ${what}: ${title}`,
      ...(found.priority ? [`Priority: ${found.priority}`] : []),
      found.md,
      ...(paste ? [`Drafted reply in the digest, for ${found.draft?.title ?? found.title}:\n\n\`\`\`\n${paste}\n\`\`\``] : []),
      `From ${digests.get(date).path}`,
    ].join('\n\n');
  }

  /** Marks one entry resolved or open again. A thread nobody has talked in follows the mark. */
  function resolveEntry(date, found, resolved) {
    if (found.kind === 'item') found.checked = resolved;
    else found.resolved = resolved;
    const waiting = [...threads.values()].find((thread) => thread.waits && thread.digest?.date === date && thread.digest.id === found.id);
    if (!waiting || waiting.archived === resolved) return;
    waiting.archived = resolved;
    if (resolved) {
      waiting.desk = null;
      emitList('thread', entry(waiting));
    } else {
      emitList('thread', entry(waiting));
      toTop(waiting);
    }
  }

  function write(client, event) {
    client.write(`id: ${boot}.${event.n}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }

  function emitList(kind, data) {
    list.n += 1;
    const event = { n: list.n, kind, data };
    list.events.push(event);
    if (list.events.length > 1000) list.events.shift();
    for (const client of list.clients) write(client, event);
  }

  function emitThread(thread, kind, data) {
    thread.n += 1;
    const event = { n: thread.n, kind, data };
    thread.events.push(event);
    for (const client of thread.clients) write(client, event);
  }

  /** The list entry changed: both streams say so. */
  function changed(thread) {
    emitList('thread', entry(thread));
    emitThread(thread, 'thread', entry(thread));
  }

  /** His order, as clients get it. An archived thread keeps its place in `order` and is left out here. */
  const shown = () => order.filter((id) => !threads.get(id)?.archived);

  function toTop(thread) {
    order = [thread.id, ...order.filter((id) => id !== thread.id)];
    emitList('order', { ids: shown() });
  }

  function status() {
    const all = [...threads.values()];
    return {
      auth: { loggedIn: !state.signedOut, checked: now(), token: 'none', error: null },
      signin: SIGN_IN,
      running: all.filter((thread) => thread.status === 'working').length,
      waiting: all.filter((thread) => thread.status === 'queued').length,
      limit: 3,
      models: MODELS,
    };
  }

  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
    timers.add(timer);
  });

  class Stopped extends Error {}

  /** What a script can do in a turn. Every call ends the script once the turn is stopped. */
  function context(thread, run) {
    const alive = () => { if (run.stopped) throw new Stopped(); };
    const wait = async (ms) => { await sleep(ms); alive(); };
    const live = () => thread.live;
    const ctx = {
      wait,
      async gate(name) {
        while (state.holds.get(name)) await wait(20);
      },
      activity(text) {
        alive();
        thread.activity = text;
        live().activity = text;
        emitThread(thread, 'activity', { text });
        emitList('thread', entry(thread));
      },
      /** One more step of the turn: the first makes the steps item, later ones replace it. */
      step(step) {
        alive();
        const items = live().items;
        const last = items[items.length - 1];
        if (last?.role === 'steps') {
          last.steps.push(step);
          emitThread(thread, 'set', { index: items.length - 1, item: last });
        } else {
          const item = { role: 'steps', steps: [step] };
          items.push(item);
          emitThread(thread, 'add', { item });
        }
      },
      /** A reply that streams in, a few words at a time. */
      async say(text, { piece = 14, hold = null, every = pace } = {}) {
        alive();
        const item = { role: 'assistant', text: '', open: true };
        live().items.push(item);
        emitThread(thread, 'add', { item: { ...item } });
        for (let at = 0; at < text.length; at += piece) {
          if (hold && at >= text.length / 2) { await ctx.gate(hold); hold = null; }
          await wait(every + state.slowMs);
          const part = text.slice(at, at + piece);
          item.text += part;
          emitThread(thread, 'append', { text: part });
        }
        delete item.open;
        emitThread(thread, 'set', { index: live().items.indexOf(item), item });
      },
      /** Asks and waits for the answer. */
      async ask(fields) {
        alive();
        const question = { id: hex(6), ...fields };
        live().question = question;
        live().state = 'waiting';
        thread.status = 'waiting';
        ctx.activity('Waiting for you');
        emitThread(thread, 'question', { question });
        changed(thread);
        const answer = await new Promise((resolve) => { thread.answer = resolve; });
        thread.answer = null;
        live().question = null;
        live().state = 'working';
        thread.status = 'working';
        emitThread(thread, 'question', { question: null });
        if (run.stopped) throw new Stopped();
        // A permission request folds to its title and what he said to it. A send to allow folds to its title
        // and whether it was allowed: words sent with its answer are never read.
        const yesOrNo = question.kind === 'permission' || question.kind === 'grant';
        const title = yesOrNo ? question.title : question.questions[0].question.split('\n')[0];
        const said = question.kind === 'grant'
          ? (answer.allow ? 'Allowed' : 'Not allowed')
          : yesOrNo
          ? (answer.allow ? 'Allowed' : answer.message || 'Denied')
          : Object.values(answer.answers).map((value) => (Array.isArray(value) ? value.join(', ') : value)).join('; ');
        const item = { role: 'asked', text: title, answer: said };
        live().items.push(item);
        emitThread(thread, 'add', { item });
        changed(thread);
        return answer;
      },
    };
    return ctx;
  }

  /** The reply to a message, picked by a word in it. */
  async function script(ctx, text) {
    const said = text.toLowerCase();
    if (said.includes('fail')) {
      ctx.activity('Reading the notes');
      await ctx.wait(pace * 4);
      const error = new Error('The turn ended early: the agent stopped answering.');
      error.failed = true;
      throw error;
    }
    if (said.includes('timings') || said.includes('table')) {
      ctx.activity('Reading Bread.md');
      await ctx.wait(pace * 2);
      ctx.step({ g: 'read', text: 'Recipes/Bread.md', path: 'Recipes/Bread.md' });
      ctx.step({ g: 'quiet', text: 'Looked up a tool' });
      ctx.activity('Working the times back');
      await ctx.wait(pace * 2);
      ctx.step({ g: 'run', text: 'Work the times back from 7 pm' });
      ctx.activity('Writing');
      await ctx.say(LONG_REPLY, { piece: 40 });
      return ['Scale it to two loaves', 'Put the times in today’s page'];
    }
    if (said.includes('which bed')) {
      ctx.activity('Reading Beds.md');
      await ctx.wait(pace * 2);
      ctx.step({ g: 'read', text: 'Projects/Garden/Beds.md', path: 'Projects/Garden/Beds.md' });
      const answer = await ctx.ask({
        kind: 'ask',
        questions: [{
          question: 'Which bed gets the tomatoes this year?\nBed 1 had them last year, so it should rest. Beds 3 and 4 both get full sun.\n\n> Bed 3 is nearer the tap.',
          header: 'Bed',
          multiSelect: false,
          options: [
            { label: 'Bed 3', description: 'Nearer the tap, a little shade after 5 pm' },
            { label: 'Bed 4', description: 'Sun all day, the hose just reaches' },
          ],
        }],
      });
      ctx.activity('Writing');
      const picked = Object.values(answer.answers)[0];
      await ctx.say(`Tomatoes go in **${Array.isArray(picked) ? picked.join(' and ') : picked}**. I moved the basil beside them.`);
      return ['Show the whole planting plan'];
    }
    if (said.includes('two things')) {
      ctx.activity('Reading Beds.md');
      await ctx.wait(pace * 2);
      // A question in two parts, one of them with several choices: clicks pick, and the picks go together.
      const answer = await ctx.ask({
        kind: 'ask',
        questions: [
          { question: 'Which bed gets the squash?', header: 'Bed', multiSelect: false, options: [{ label: 'Bed 1', description: '' }, { label: 'Bed 2', description: '' }] },
          { question: 'Which of these go in beside it?', header: 'Beside', multiSelect: true, options: [{ label: 'Nasturtiums', description: '' }, { label: 'Borage', description: '' }, { label: 'Dill', description: '' }] },
        ],
      });
      ctx.activity('Writing');
      const picks = Object.values(answer.answers).map((picked) => (Array.isArray(picked) ? picked.join(' and ') : picked));
      await ctx.say(`Squash: **${picks[0]}**. Beside it: **${picks[1]}**.`);
      return [];
    }
    if (said.includes('wide')) {
      ctx.activity('Writing');
      await ctx.wait(pace * 2);
      // A table and a line of code wider than the column: each scrolls sideways in its own box.
      await ctx.say(WIDE_REPLY, { piece: 80 });
      return [];
    }
    if (said.includes('send robin')) {
      ctx.activity('Looking Robin up');
      await ctx.wait(pace * 2);
      // A send he is asked to allow up front, in the service's own words: the title names the channel and the
      // people, the detail is what it is about, a blank line, and how it would go. Only a phone can say yes,
      // with a signature; a page can only say no.
      const answer = await ctx.ask({
        kind: 'grant',
        title: 'Send this Slack message to Robin?',
        detail: 'the seed swap\n\nThese exact words, once, from this thread.',
        grant: { id: hex(6), thread_id: 'here', channel: 'slack', to: [{ name: 'Robin', id: 'U01' }], about: 'the seed swap', expires: Math.floor(Date.now() / 1000) + 7200, text: 'I will bring the bean seedlings on Saturday.' },
      });
      ctx.activity('Writing');
      // Whatever came with a no is not read: the turn hears only that it was not allowed.
      await ctx.say(answer.allow === true ? 'Sent.' : 'Nothing was sent.');
      return [];
    }
    if (said.includes('note for the club')) {
      ctx.activity('Writing the note');
      await ctx.wait(pace * 2);
      await ctx.say('The note for the garden club is drafted in Ideas. It is three lines.');
      // The next move is his: words on the row, never a button.
      return ['you: Read the note and send it to the club', 'Make it shorter'];
    }
    if (said.includes('drafts')) {
      ctx.activity('Listing the old drafts');
      await ctx.wait(pace * 2);
      ctx.step({ g: 'search', text: 'old drafts in Notes' });
      const answer = await ctx.ask({
        kind: 'permission',
        tool: 'Bash',
        title: 'Run a command: move three old drafts to the archive',
        detail: 'mv Notes/drafts/2024-*.md Archive/drafts/',
        reason: 'They were last changed over a year ago.',
      });
      ctx.activity('Writing');
      if (answer.allow) {
        ctx.step({ g: 'run', text: 'Move three old drafts to the archive' });
        await ctx.say('Done. Three drafts moved to the archive.');
      } else {
        await ctx.say(answer.message ? `Left them where they are. You said: ${answer.message}` : 'Left them where they are.');
      }
      return [];
    }
    if (said.includes('slow')) {
      ctx.activity('Reading the seed list');
      await ctx.wait(pace * 2);
      ctx.step({ g: 'read', text: 'Projects/Garden/Seeds.md', path: 'Projects/Garden/Seeds.md' });
      ctx.step({ g: 'search', text: 'sowing months' });
      ctx.step({ g: 'websearch', text: 'last frost date by region' });
      ctx.step({ g: 'fetch', text: 'A sowing calendar' });
      ctx.step({ g: 'mcp:checked the calendar', text: 'Checked the calendar' });
      ctx.activity('Sorting by sowing month');
      await ctx.say('Here is the list by month, starting with what goes in first.\n\n- **March**: broad beans, peas, spinach\n- **April**: carrots, beetroot, chard\n- **May**: french beans, courgettes, squash\n\nThe frost can still come in early May, so hold the beans back if the nights stay cold. I will add the sowing depths next.', { piece: 9, hold: 'stream', every: pace * 3 });
      return [];
    }
    ctx.activity('Reading Beds.md');
    await ctx.wait(pace * 2);
    ctx.step({ g: 'read', text: 'Projects/Garden/Beds.md', path: 'Projects/Garden/Beds.md' });
    ctx.activity('Writing');
    await ctx.say(SHORT_REPLY);
    return ['Show the watering schedule', 'Draft the shopping list'];
  }

  function startTurn(thread, user) {
    const run = { stopped: false };
    thread.run = run;
    thread.status = 'working';
    thread.next = [];
    // His move goes when he sends from the thread, or when the next turn ends without one.
    thread.yours = '';
    thread.unsent = null;
    thread.waits = false;
    thread.seed = null;
    thread.send = null;
    thread.updated = now();
    thread.events = []; // only the running turn can be replayed
    thread.live = { items: [user], activity: '', state: 'working', question: null };
    thread.activity = '';
    emitThread(thread, 'turn', { items: [user], state: 'working', activity: '' });
    changed(thread);
    void script(context(thread, run), user.text).then(
      (next) => endTurn(thread, run, 'done', null, next),
      (error) => endTurn(thread, run, error instanceof Stopped || run.stopped ? 'stopped' : 'failed', error.failed ? error.message : null, []),
    );
  }

  function endTurn(thread, run, outcome, error, next) {
    if (thread.run !== run) return;
    thread.run = null;
    const items = thread.live.items.map((item) => {
      const { open, ...rest } = item;
      return rest;
    });
    thread.items.push(...items);
    thread.live = null;
    thread.activity = '';
    if (outcome === 'stopped') thread.items.push({ role: 'note', text: 'Stopped' });
    const reply = [...items].reverse().find((item) => item.role === 'assistant' && item.text);
    thread.status = outcome === 'done' ? 'idle' : outcome;
    thread.error = outcome === 'failed' ? error ?? 'The turn did not finish.' : null;
    thread.last = outcome === 'stopped' ? 'Stopped' : reply ? firstLine(reply.text) : thread.last;
    thread.unread = thread.clients.size === 0 && outcome !== 'stopped';
    thread.updated = now();
    const waiting = thread.queue.length > 0;
    // One follow-up may open "you:": it is his move, kept as words on the thread and never a button.
    const lines = outcome === 'done' && !waiting ? next : [];
    const his = lines.find((line) => /^you:/i.test(line));
    thread.yours = his ? his.replace(/^you:\s*/i, '').slice(0, 80) : '';
    thread.next = lines.filter((line) => line !== his);
    emitThread(thread, 'end', { outcome, error: thread.error, next: thread.next });
    changed(thread);
    if (waiting && outcome !== 'stopped') {
      const queued = thread.queue.shift();
      emitThread(thread, 'queue', { queue: thread.queue });
      startTurn(thread, { role: 'user', text: queued.text, cid: queued.cid });
    }
  }

  function snapshot(thread) {
    thread.unread = false;
    if (thread.woke) thread.woke = null;
    emitList('thread', entry(thread));
    return {
      thread: entry(thread),
      items: thread.items,
      live: thread.live ? { items: thread.live.items, activity: thread.live.activity, state: thread.live.state, question: thread.live.question } : null,
      queue: thread.queue,
      unsent: thread.unsent,
      next: thread.live || thread.status !== 'idle' ? [] : thread.next,
      cursor: `${boot}.${thread.n}`,
      ...(thread.waits ? { seed: thread.seed } : {}),
      ...(thread.send ? { send: thread.send } : {}),
      sent: thread.sent,
    };
  }

  // Snoozed threads come back at their time: on top, with `woke` set.
  const waker = setInterval(() => {
    for (const thread of threads.values()) {
      if (thread.snoozed && thread.snoozed <= now()) wake(thread);
    }
  }, 100);

  function wake(thread) {
    thread.snoozed = null;
    thread.woke = now();
    toTop(thread);
    changed(thread);
  }

  const answer = (response, code, body) => {
    const text = JSON.stringify(body);
    response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    response.end(text);
  };
  const refuse = (response, code, name, message) => answer(response, code, { error: { code: name, message } });

  function stream(request, response, source) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    response.write(`retry: ${retryMs}\n\n`);
    const last = new URL(request.url, 'http://127.0.0.1').searchParams.get('last') || request.headers['last-event-id'] || '';
    if (last) {
      const [from, count] = last.split('.');
      const n = Number(count);
      const first = source.events.length > 0 ? source.events[0].n : source.n + 1;
      if (from === boot && Number.isInteger(n) && n >= first - 1 && n <= source.n) {
        for (const event of source.events) if (event.n > n) write(response, event);
      } else {
        response.write(`id: ${boot}.${source.n}\nevent: reset\ndata: {}\n\n`);
      }
    }
    source.clients.add(response);
    const beat = setInterval(() => response.write(': hb\n\n'), heartbeatMs);
    request.on('close', () => {
      clearInterval(beat);
      source.clients.delete(response);
    });
  }

  async function body(request) {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
      if (text.length > 1024 * 1024) return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (state.down) {
      request.socket.destroy();
      return;
    }
    if (!url.pathname.startsWith(`${mount}/api/`) && url.pathname !== `${mount}/api`) {
      // Something else answers in the service's place, as a proxy does when the service is not running.
      response.writeHead(502, { 'Content-Type': 'text/html' });
      response.end('<h1>Bad gateway</h1>');
      return;
    }
    const path = url.pathname.slice(mount.length);
    const isWrite = request.method === 'POST';
    const data = isWrite ? await body(request) : undefined;
    // A slow network: every answer but a stream's waits this long.
    if (state.slow > 0 && !path.endsWith('/events')) await new Promise((resolve) => setTimeout(resolve, state.slow));
    requests.push({ method: request.method, path: `${path}${url.search}`, headers: request.headers, body: data });

    if (isWrite) {
      if (!(request.headers['content-type'] ?? '').includes('application/json')) return refuse(response, 415, 'bad_type', 'Send JSON.');
      if (request.headers.origin) return refuse(response, 403, 'bad_origin', 'That page may not write here.');
      if (!request.headers['x-auto-client']) return refuse(response, 403, 'no_origin', 'Say which client this is.');
      if (!data || typeof data !== 'object' || Array.isArray(data)) return refuse(response, 400, 'bad_request', 'The body must be a JSON object.');
      if (state.failWrites === 'drop') {
        request.socket.destroy();
        return;
      }
      if (state.failWrites === 'refuse') return refuse(response, 500, 'stand_in', 'The stand-in refuses writes for now.');
    } else if (request.method !== 'GET') {
      return refuse(response, 405, 'bad_method', 'Use GET or POST.');
    }

    if (path === '/api/status' && !isWrite) return answer(response, 200, status());
    if (path === '/api/status/check' && isWrite) return answer(response, 200, status());
    if (path === '/api/events' && !isWrite) return stream(request, response, list);
    if (path === '/api/threads' && !isWrite) {
      return answer(response, 200, { threads: shown().map((id) => entry(threads.get(id))), cursor: `${boot}.${list.n}` });
    }
    if (path === '/api/threads' && isWrite) {
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 100_000) return refuse(response, 400, 'bad_request', 'Say something first.');
      if (data.model !== undefined && !(data.model in MODELS)) return refuse(response, 400, 'bad_request', 'No such model.');
      const cid = typeof data.cid === 'string' ? data.cid.slice(0, 40) : '';
      if (cid && cids.has(cid)) return answer(response, 201, { thread: entry(threads.get(cids.get(cid))) });
      const t = now();
      const thread = add({
        id: hex(6), title: firstLine(data.text).slice(0, 40), status: 'idle', last: '', activity: '', unread: false, model: data.model ?? '',
        created: t, updated: t, error: null, archived: false, snoozed: null, woke: null, digest: null, waits: false, items: [], next: [], seed: null,
      }, true);
      if (cid) cids.set(cid, thread.id);
      emitList('thread', entry(thread));
      startTurn(thread, { role: 'user', text: data.text, ...(cid ? { cid } : {}) });
      return answer(response, 201, { thread: entry(thread) });
    }

    const client = request.headers['x-auto-client'] ?? 'web';
    if (path === '/api/digests' && !isWrite) return answer(response, 200, { days: days(), latest: days()[0] ?? null });
    if (path === '/api/digest' && !isWrite) {
      const date = url.searchParams.get('date') ?? days()[0];
      const digest = date ? digestOf(date) : null;
      return digest ? answer(response, 200, digest) : refuse(response, 404, 'not_found', 'No digest.');
    }
    if (path.startsWith('/api/digest/') && isWrite) {
      const digest = digests.get(data.date);
      if (path === '/api/digest/inbox') return answer(response, 200, { date: data.date ?? days()[0] ?? null, made: 0 });
      if (!digest) return refuse(response, 404, 'not_found', 'No digest.');
      const find = (id) => entriesOf(digest).find((found) => found.id === id);
      if (path === '/api/digest/tick') {
        const item = entriesOf(digest).find((found) => found.kind === 'item' && found.n === data.n);
        if (!item) return refuse(response, 409, 'conflict', 'The digest has no such item.');
        resolveEntry(data.date, item, data.checked === true);
        emitList('digest', { date: data.date });
        return answer(response, 200, digestOf(data.date));
      }
      if (path === '/api/digest/resolve') {
        const ids = Array.isArray(data.ids) ? data.ids : [data.id];
        if (ids.length === 0 || ids.length > 200) return refuse(response, 400, 'bad_request', 'Name one entry, or up to 200.');
        const found = ids.map(find);
        if (found.some((each) => !each)) return refuse(response, 404, 'not_found', 'No such entry.');
        for (const each of found) resolveEntry(data.date, each, data.resolved !== false);
        emitList('digest', { date: data.date });
        return answer(response, 200, digestOf(data.date));
      }
      const found = find(data.id);
      if (!found) return refuse(response, 404, 'not_found', 'No such entry.');
      if (path === '/api/digest/note') {
        if (typeof data.text !== 'string' || data.text.length > 4_000) return refuse(response, 400, 'bad_request', 'A note is at most 4,000 characters.');
        found.note = data.text.trim();
        emitList('digest', { date: data.date });
        return answer(response, 200, digestOf(data.date));
      }
      if (path === '/api/digest/thread') {
        const words = typeof data.words === 'string' && data.words.trim() ? data.words : null;
        if (data.words !== undefined && (!words || words.length > 100_000)) return refuse(response, 400, 'bad_request', 'Say something first.');
        const section = digest.sections.find((each) => each.entries.includes(found)).title;
        // The entry, then his note and his words under one line.
        const said = [found.note, words].filter(Boolean).join('\n\n');
        const first = () => (said ? `${seedOf(data.date, found, section)}\n\n${NAME} says:\n\n${said}` : seedOf(data.date, found, section));
        const cid = typeof data.cid === 'string' ? data.cid.slice(0, 40) : '';
        const made = threadOf(data.date, found.id);
        if (made) {
          // A second call returns the same thread; one that still waits starts when this call says so.
          if (made.waits && (data.start !== false || words)) {
            pickedUp(made, client);
            startTurn(made, { role: 'user', text: first(), ...(cid ? { cid } : {}) });
          }
          return answer(response, 200, { thread: entry(made) });
        }
        const t = now();
        const thread = add({
          id: hex(6), title: (found.title || plainWords(firstLine(found.md))).slice(0, 80), status: 'idle', last: plainWords(firstLine(found.md)), activity: '', unread: false, model: '',
          created: t, updated: t, error: null, archived: false, snoozed: null, woke: null, digest: { date: data.date, id: found.id },
          waits: true, items: [], next: [], seed: seedOf(data.date, found, section),
        }, true);
        emitList('thread', entry(thread));
        if (data.start !== false || words) startTurn(thread, { role: 'user', text: first(), ...(cid ? { cid } : {}) });
        emitList('digest', { date: data.date });
        return answer(response, 201, { thread: entry(thread) });
      }
      return refuse(response, 404, 'not_found', 'Not found.');
    }

    const match = /^\/api\/threads\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
    const thread = match ? threads.get(match[1]) : null;
    if (!match || !thread || (thread.archived && match[2] !== 'archive')) return refuse(response, 404, 'not_found', match ? 'No such thread.' : 'Not found.');
    const action = match[2] ?? '';

    if (!isWrite) {
      if (action === '') return answer(response, 200, snapshot(thread));
      if (action === 'events') {
        if (thread.unread || thread.woke) { thread.unread = false; thread.woke = null; emitList('thread', entry(thread)); }
        return stream(request, response, thread);
      }
      return refuse(response, 404, 'not_found', 'Not found.');
    }

    switch (action) {
      case 'messages': {
        if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 100_000) return refuse(response, 400, 'bad_request', 'Say something first.');
        const cid = typeof data.cid === 'string' ? data.cid.slice(0, 40) : '';
        if (cid && cids.has(cid)) return answer(response, 200, { queued: thread.queue.some((queued) => queued.cid === cid) });
        if (cid) cids.set(cid, thread.id);
        pickedUp(thread, client);
        if (thread.run) {
          thread.queue.push({ cid, text: data.text });
          emitThread(thread, 'queue', { queue: thread.queue });
          changed(thread);
          return answer(response, 200, { queued: true });
        }
        // The first words to a waiting entry travel with the entry.
        const text = thread.waits ? `${thread.seed}\n\n${NAME} says:\n\n${data.text}` : data.text;
        startTurn(thread, { role: 'user', text, ...(cid ? { cid } : {}) });
        return answer(response, 200, { queued: false });
      }
      case 'start':
        if (!thread.waits) return refuse(response, 409, 'conflict', 'That thread has already started.');
        pickedUp(thread, client);
        startTurn(thread, { role: 'user', text: thread.seed });
        return answer(response, 200, { thread: entry(thread) });
      case 'stop': {
        const returned = thread.queue.splice(0);
        if (returned.length > 0) emitThread(thread, 'queue', { queue: [] });
        if (thread.run) {
          thread.run.stopped = true;
          thread.answer?.({ allow: false, answers: {} });
        }
        return answer(response, 200, { returned });
      }
      case 'answer': {
        const question = thread.live?.question;
        if (!question || question.id !== data.id || !thread.answer) return refuse(response, 409, 'conflict', 'That question is no longer open.');
        if (question.kind === 'grant') {
          // The yes is signed on his phone. Anything else that says yes is refused, and counted.
          if (data.allow === true && typeof data.signature !== 'string') {
            unsigned.push({ thread: thread.id, client });
            return refuse(response, 403, 'unsigned', 'Only your phone can allow a send.');
          }
          if (typeof data.allow !== 'boolean') return refuse(response, 400, 'bad_request', 'That is not an answer to this question.');
        } else if (question.kind === 'permission' ? typeof data.allow !== 'boolean' : !data.answers || typeof data.answers !== 'object') {
          return refuse(response, 400, 'bad_request', 'That is not an answer to this question.');
        }
        pickedUp(thread, client);
        // An answer to a send to allow is read for its yes or no alone, as the service reads it.
        thread.answer(question.kind === 'grant' ? { allow: data.allow === true } : data);
        return answer(response, 200, { ok: true });
      }
      case 'model':
        if (!(data.model in MODELS)) return refuse(response, 400, 'bad_request', 'No such model.');
        thread.model = data.model;
        changed(thread);
        return answer(response, 200, { thread: entry(thread) });
      case 'rename':
        if (typeof data.title !== 'string' || !data.title.trim()) return refuse(response, 400, 'bad_request', 'A title cannot be empty.');
        thread.title = data.title.split('\n')[0].trim().slice(0, 120);
        changed(thread);
        return answer(response, 200, { thread: entry(thread) });
      case 'desk':
        if (typeof data.on !== 'boolean') return refuse(response, 400, 'bad_request', 'Say on or off.');
        thread.desk = data.on ? { at: now(), by: client } : null;
        changed(thread);
        return answer(response, 200, { thread: entry(thread) });
      case 'archive':
        thread.archived = data.archived !== false;
        if (thread.archived) {
          thread.desk = null;
          // Done also marks the entry the thread came from.
          if (data.done === true && thread.digest) {
            ticks.push({ ...thread.digest });
            const digest = digests.get(thread.digest.date);
            const found = digest ? entriesOf(digest).find((each) => each.id === thread.digest.id) : null;
            if (found) {
              if (found.kind === 'item') found.checked = true;
              else found.resolved = true;
              emitList('digest', { date: thread.digest.date });
            }
          }
          changed(thread);
        } else {
          // Restored, it is back where it was in his order.
          changed(thread);
          emitList('order', { ids: shown() });
        }
        return answer(response, 200, { thread: entry(thread) });
      case 'move': {
        if (data.before !== null && (!threads.has(data.before) || data.before === thread.id || !shown().includes(data.before))) {
          return refuse(response, 400, 'bad_request', 'Move it before another thread, or to the end.');
        }
        order = order.filter((id) => id !== thread.id);
        if (data.before === null) order.push(thread.id); else order.splice(order.indexOf(data.before), 0, thread.id);
        emitList('order', { ids: shown() });
        return answer(response, 200, { ids: shown() });
      }
      case 'snooze':
        if (data.until === null) {
          thread.snoozed = null;
          toTop(thread);
          changed(thread);
          return answer(response, 200, { thread: entry(thread) });
        }
        if (typeof data.until !== 'number' || data.until <= now() || data.until > now() + 366 * 86400) {
          return refuse(response, 400, 'bad_request', 'Snooze until a time in the next year.');
        }
        thread.snoozed = data.until;
        thread.woke = null;
        changed(thread);
        return answer(response, 200, { thread: entry(thread) });
      default:
        return refuse(response, 404, 'not_found', 'Not found.');
    }
  }

  for (const thread of fixtureThreads(options.fixture ?? 'default')) add(thread, false);

  const server = http.createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) refuse(response, 500, 'stand_in', 'The stand-in broke.');
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    port,
    url: `http://127.0.0.1:${port}${mount}`,
    requests,
    /** Digest boxes ticked by a Done. */
    ticks,
    thread: (id) => threads.get(id),
    /** Every try to allow a send without the phone's signature. A page must never make one. */
    unsigned,
    entries: () => shown().map((id) => entry(threads.get(id))),
    /** A day's digest as the service answers it; the latest with no date. */
    digest: (date) => digestOf(date ?? days()[0]),
    /** Signs the service out of, or back into, its agent: the list stream says so. */
    signOut(out = true) {
      state.signedOut = out;
      emitList('status', status());
    },
    /** 'refuse' answers every write with an error, 'drop' cuts the connection, false stops both. */
    failWrites(how) {
      state.failWrites = how;
    },
    /** Every answer but a stream's waits this many ms, as on a slow network; 0 stops it. */
    slow(ms) {
      state.slow = ms;
    },
    /** Out of reach: every connection is cut, open streams too. */
    down(isDown = true) {
      state.down = isDown;
      if (isDown) for (const socket of sockets) socket.destroy();
    },
    /** Cuts the open streams once, as a network drop does. */
    dropStreams() {
      for (const socket of sockets) socket.destroy();
    },
    /** As if the service restarted: cursors from before no longer replay, so streams answer `reset`. */
    restart() {
      boot = hex(4);
      list.events = [];
      for (const thread of threads.values()) thread.events = [];
      for (const socket of sockets) socket.destroy();
    },
    /** Holds a scripted reply at the gate of this name until `release`. */
    hold(name) {
      state.holds.set(name, true);
    },
    release(name) {
      state.holds.delete(name);
    },
    /** Brings a snoozed thread back now, as its time passing does. */
    wake(id) {
      wake(threads.get(id));
    },
    /** A send that waits to be confirmed on the phone, and one that went out. */
    sendWaiting(id) {
      const thread = threads.get(id);
      thread.send = { id: hex(4), to: ['club@example.com'], subject: 'Plot inspection' };
      emitThread(thread, 'send', { send: thread.send });
    },
    sendWent(id) {
      const thread = threads.get(id);
      const sent = { at: now(), to: ['club@example.com'], subject: 'Plot inspection', draft: 'd1' };
      thread.send = null;
      thread.sent.push(sent);
      emitThread(thread, 'send', { send: null, sent });
    },
    /** Sends raw lines down every open stream of a thread, or of the list with no id. */
    raw(text, id) {
      for (const client of id ? threads.get(id).clients : list.clients) client.write(text);
    },
    async close() {
      clearInterval(waker);
      for (const timer of timers) clearTimeout(timer);
      for (const thread of threads.values()) {
        if (thread.run) thread.run.stopped = true;
        thread.answer?.({ allow: false, answers: {} });
      }
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
