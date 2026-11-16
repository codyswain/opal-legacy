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

/**
 * The first line of some words as the service keeps it for a list row:
 * without its Markdown marks, a link by its text, and cut with an ellipsis.
 */
function firstLine(text, limit = 160) {
  for (const raw of (text ?? '').split('\n')) {
    const line = raw
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, '')
      .replace(/\*\*|__|`/g, '')
      .trim()
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
      .split(/\s+/).filter(Boolean).join(' ');
    if (line) return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
  }
  return '';
}
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
    // Put away until someone replies: the service is watching the conversation.
    base('5a000000000a', 'Greenhouse glass', { last: 'Waiting on Sam in Gmail. The wait gives up in two days.', updated: t - 5 * 3600,
      snoozed: t + 2 * 86400, snoozed_at: t - 5 * 3600,
      wait: { say: 'until Sam sends the quote for the glass', state: 'watching', on: 'Sam', what: 'the quote for the greenhouse glass', where: 'Gmail',
        link: 'https://mail.example/mail/u/0/#all/18c2f0a1b2c3d4e5', check: 'Any reply from Sam with a price',
        since: t - 5 * 3600, expires: t + 2 * 86400, checked: t - 600, heard: 'Sam: I will measure the frames on Monday.', reply: null },
      items: [
        { role: 'user', text: 'Ask Sam for a quote on the greenhouse glass.' },
        { role: 'assistant', text: 'The request is drafted for you to send.' },
        { role: 'user', text: 'Wait for a reply: until Sam sends the quote for the glass' },
        { role: 'assistant', text: 'Waiting on Sam in Gmail. The wait gives up in two days.' },
      ] }),
    ...archivedThreads(t, base),
  ];
}

/** What he archived, each with when: enough of them that the archive shows its newest few first. */
function archivedThreads(t, base) {
  const titles = [
    ['Fence paint', 'Two coats of the dark green cover the north side.'],
    ['Bird feeder', 'Hang it two metres up, away from the hedge.'],
    ['Leaf mould bin', 'Four posts and chicken wire, one metre square.'],
    ['Shed shelf', 'Three brackets carry the seed boxes.'],
    ['Onion sets', 'Plant them 10 cm apart in rows 30 cm apart.'],
    ['Hose reel', 'Mount it by the tap, at hip height.'],
    ['Path edging', 'Twelve metres of timber edging, pegged every metre.'],
    ['Cold frame', 'The old window fits a frame of 90 by 60 cm.'],
    ['Wormery', 'Feed it a handful of peelings twice a week.'],
    ['Bean poles', 'Eight poles, 2.4 m, tied at the top.'],
    ['Gutter for the shed', 'Three metres of gutter and one downpipe.'],
    ['Slug traps', 'Sink the jars to their rims by the lettuces.'],
  ];
  return titles.map(([title, last], at) => base(`5b00000000${String(at + 1).padStart(2, '0')}`, title, {
    last, archived: true, archived_at: t - (at + 1) * 86400 - at * 600, updated: t - (at + 2) * 86400,
    items: [{ role: 'user', text: `About the ${title.toLowerCase()}.` }, { role: 'assistant', text: last }],
  }));
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
 * The plan's usage as the service answers it: made-up numbers for a made-up
 * plan, and no account but the plan's name. One limit covers every model,
 * one a model of the model menu.
 */
function fixtureUsage(kind) {
  const t = now();
  if (kind === 'none') return { account: { plan: 'Pro' }, limits: [], as_of: null };
  const week = Math.floor(t + 3 * 86400);
  return {
    account: { plan: 'Pro' },
    limits: [
      { key: 'seven_day', label: 'Weekly, all models', used: 0.45, resets_at: week, status: 'allowed', seen_at: Math.floor(t), model: 'large' },
      { key: 'seven_day_large', label: 'Weekly, Large', used: 0.73, resets_at: week, status: 'allowed', seen_at: Math.floor(t), model: 'large' },
    ],
    as_of: Math.floor(t),
  };
}

/**
 * Starts the stand-in.
 *   fixture: 'default' | 'empty' (only snoozed threads) | 'none'
 *   digests: 'default' (three days) | 'done' (one day, all of it resolved) | 'none'
 *   pace: ms between pieces of a streamed reply
 *   heartbeatMs: how often every stream sends `: hb`
 *   retryMs: the wait every stream asks of a client before it opens it again
 *   usage: 'default' (two limits, 45% and 73%) | 'none' (nothing seen yet) | 'missing' (no route: 404, as an older service)
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
    usage: fixtureUsage(options.usage ?? 'default'),
    usageMissing: options.usage === 'missing',
  };
  const requests = [];
  /** Tries to allow a send with no signature from a phone. */
  const unsigned = [];
  const ticks = [];
  const digests = fixtureDigests(options.digests ?? 'default');
  /** The days whose digest he archived. */
  const archivedDays = new Set();
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
      snoozed_at: thread.snoozed ? thread.snoozed_at ?? thread.updated : null,
      archived_at: thread.archived ? thread.archived_at ?? thread.updated : null,
      wait: waitOf(thread.wait),
    };
  }

  /** A thread's wait as clients read it: every key there, whatever state it is in. */
  function waitOf(wait) {
    if (!wait) return null;
    return {
      say: wait.say || '', state: wait.state || 'finding', on: wait.on || '', what: wait.what || '', where: wait.where || '', link: wait.link || '', check: wait.check || '',
      since: wait.since ?? null, expires: wait.expires ?? null, checked: wait.checked ?? null, heard: wait.heard ?? null, reply: wait.reply ?? null,
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
      archived: archivedDays.has(date),
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

  /**
   * Starts a turn. `run` is the script it follows, by default the one picked
   * by a word in his message. With `own` it is a turn the service started
   * itself: a finished wait stays on the thread through it.
   */
  function startTurn(thread, user, play = null, { own = false } = {}) {
    const run = { stopped: false };
    thread.run = run;
    thread.status = 'working';
    thread.next = [];
    // A finished wait has said what it had to once he takes the thread up.
    if (!own && !play && (thread.wait?.state === 'met' || thread.wait?.state === 'expired')) thread.wait = null;
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
    void (play ? play(context(thread, run)) : script(context(thread, run), user.text)).then(
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
    // The turn that was to name the conversation ended with none named: nothing watches, and the thread is not put away.
    if (thread.wait?.state === 'finding') {
      const was = thread.snoozed !== null;
      Object.assign(thread, { wait: null, snoozed: null, snoozed_at: null });
      if (was) toTop(thread);
    }
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
      if (!thread.snoozed || thread.snoozed > now() || thread.archived) continue;
      // A wait that runs out returns as expired; a timed snooze just comes back.
      if (thread.wait?.state === 'watching') waitOver(thread, 'expired');
      else wake(thread);
    }
  }, 100);

  function wake(thread) {
    // While Auto is still naming the conversation, a return drops the wait: nothing was ever watched.
    if (thread.wait?.state === 'finding') thread.wait = null;
    thread.snoozed = null;
    thread.snoozed_at = null;
    thread.woke = now();
    toTop(thread);
    changed(thread);
  }

  /** Two working days on, at 5 pm: the default give-up time of a wait. */
  function defaultGiveUp(at) {
    const day = new Date(at * 1000);
    let left = 2;
    while (left > 0) {
      day.setDate(day.getDate() + 1);
      if (day.getDay() !== 0 && day.getDay() !== 6) left -= 1;
    }
    day.setHours(17, 0, 0, 0);
    return day.getTime() / 1000;
  }

  /** "Tue 5:00 pm", or "Nov 24, 5:00 pm" when it is more than six days off. */
  function clock(at) {
    const when = new Date(at * 1000);
    const hour = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP]M)$/i, (_all, half) => ` ${half.toLowerCase()}`);
    const days = Math.abs(Math.round((new Date(when).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000));
    return days <= 6 ? `${when.toLocaleDateString('en-US', { weekday: 'short' })} ${hour}` : `${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${hour}`;
  }

  /**
   * The turn in which Auto names the conversation a thread waits on. His
   * words show as his message. The thread is snoozed from the start and
   * stays so. Words that name nobody ("someone") make Auto ask, which
   * brings the thread back with its question until he answers. Words that
   * speak of a text make it a wait in Messages.
   */
  function find(thread) {
    const began = thread.wait.since;
    startTurn(thread, { role: 'user', text: `Wait for a reply: ${thread.wait.say}` }, async (ctx) => {
      ctx.activity('Finding the conversation');
      await ctx.wait(pace * 2);
      let on = 'Robin';
      if (/\bsomeone\b/i.test(thread.wait?.say ?? '')) {
        // A question brings a snoozed thread back at once. The wait stays, still finding.
        Object.assign(thread, { snoozed: null, snoozed_at: null, woke: now() });
        toTop(thread);
        const answer = await ctx.ask({ kind: 'ask', questions: [{ question: 'Who are you waiting on?', header: 'Who', multiSelect: false, options: [{ label: 'Robin', description: '' }, { label: 'Sam', description: '' }] }] });
        on = String(Object.values(answer.answers ?? {})[0] ?? 'Robin');
      }
      // He brought it back meanwhile: there is nothing to wait for now.
      if (!thread.wait || thread.wait.since !== began) {
        await ctx.say('You brought this thread back, so there is nothing to wait for now.');
        return [];
      }
      // A wait on a text is watched in Messages, and its link is the number, which no client opens.
      const byText = /\btexts?\b/i.test(thread.wait.say);
      const where = byText ? 'Messages' : 'Slack';
      const link = byText ? 'imessage:+15550100' : 'https://chat.example/archives/C0SEEDS/p1794700000123456';
      Object.assign(thread.wait, { state: 'watching', on, what: 'an answer about the seed swap', where, link, check: `Any reply from ${on}`, checked: now() });
      Object.assign(thread, { snoozed: thread.wait.expires, snoozed_at: thread.snoozed_at ?? now(), woke: null });
      changed(thread);
      await ctx.say(`Waiting on ${on} in ${where}. The wait gives up ${clock(thread.wait.expires)}.`);
      return [];
    });
  }

  /** The reply came, or the time ran out: the thread returns on top, and a turn of the service's own says what happened. */
  function waitOver(thread, outcome, line = '') {
    const wait = thread.wait;
    const who = wait.on || 'them';
    Object.assign(wait, { state: outcome, reply: outcome === 'met' ? line : null, checked: now() });
    Object.assign(thread, { snoozed: null, snoozed_at: null, woke: now(), last: outcome === 'met' ? firstLine(line, 300) : `No reply from ${who}.`, updated: now() });
    toTop(thread);
    changed(thread);
    // The turn opens with a note in place of his words, and Auto says in a line or two what happened.
    const note = outcome === 'met' ? `${line.includes(': ') ? line.split(': ')[0] : who} replied` : `No reply by ${clock(wait.expires)}`;
    startTurn(thread, { role: 'note', text: note }, async (ctx) => {
      ctx.activity('Reading the conversation');
      await ctx.wait(pace * 2);
      // The conversation is linked only when it has a web address: a text's number stays out of the thread.
      const place = /^https?:/.test(wait.link) ? `[the conversation](${wait.link})` : wait.where || 'the conversation';
      await ctx.say(outcome === 'met'
        ? `${who} replied in ${place}: ${line.includes(': ') ? line.split(': ').slice(1).join(': ') : line}`
        : `Nobody has replied in ${place} yet.`);
      return [];
    }, { own: true });
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
    if (path === '/api/usage' && !isWrite) {
      return state.usageMissing ? refuse(response, 404, 'not_found', 'Not found.') : answer(response, 200, state.usage);
    }
    if (path === '/api/status/check' && isWrite) return answer(response, 200, status());
    if (path === '/api/events' && !isWrite) return stream(request, response, list);
    if (path === '/api/threads' && !isWrite) {
      if (url.searchParams.get('archived') === '1') {
        // What he archived, newest archived first. An entry nobody started is left out: the service put those away.
        const limit = url.searchParams.get('limit') ?? '';
        const rows = [...threads.values()].filter((thread) => thread.archived && !thread.seed).map(entry).sort((left, right) => (right.archived_at ?? 0) - (left.archived_at ?? 0));
        return answer(response, 200, { threads: /^\d+$/.test(limit) && Number(limit) > 0 ? rows.slice(0, Number(limit)) : rows, total: rows.length, cursor: `${boot}.${list.n}` });
      }
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
    if (path === '/api/digests' && !isWrite) return answer(response, 200, { days: days(), latest: days()[0] ?? null, archived: days().filter((day) => archivedDays.has(day)) });
    if (path === '/api/digest' && !isWrite) {
      const date = url.searchParams.get('date') ?? days()[0];
      const digest = date ? digestOf(date) : null;
      return digest ? answer(response, 200, digest) : refuse(response, 404, 'not_found', 'No digest.');
    }
    if (path.startsWith('/api/digest/') && isWrite) {
      const digest = digests.get(data.date);
      if (path === '/api/digest/inbox') return answer(response, 200, { date: data.date ?? days()[0] ?? null, made: 0 });
      if (!digest) return refuse(response, 404, 'not_found', 'No digest.');
      if (path === '/api/digest/archive') {
        // A mark for the screens: no entry and no thread changes.
        const on = data.archived ?? true;
        if (typeof on !== 'boolean') return refuse(response, 400, 'bad_request', 'Send archived, true or false.');
        if (archivedDays.has(data.date) !== on) {
          if (on) archivedDays.add(data.date);
          else archivedDays.delete(data.date);
          emitList('digest', { date: data.date });
        }
        return answer(response, 200, digestOf(data.date));
      }
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
    // An archived thread is served like any other: it is only left out of the list.
    if (!match || !thread) return refuse(response, 404, 'not_found', match ? 'No such thread.' : 'Not found.');
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
      case 'archive': {
        const was = thread.archived;
        thread.archived = data.archived !== false;
        if (thread.archived !== was) thread.archived_at = thread.archived ? now() : null;
        if (thread.archived) {
          thread.desk = null;
          // Put away for good: nothing is watched for it.
          if (thread.wait) Object.assign(thread, { wait: null, snoozed: null, snoozed_at: null });
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
          if (was) emitList('order', { ids: shown() });
        }
        return answer(response, 200, { thread: entry(thread) });
      }
      case 'move': {
        if (data.before !== null && (!threads.has(data.before) || data.before === thread.id || !shown().includes(data.before))) {
          return refuse(response, 400, 'bad_request', 'Move it before another thread, or to the end.');
        }
        order = order.filter((id) => id !== thread.id);
        if (data.before === null) order.push(thread.id); else order.splice(order.indexOf(data.before), 0, thread.id);
        emitList('order', { ids: shown() });
        return answer(response, 200, { ids: shown() });
      }
      case 'snooze': {
        let until = data.until ?? null;
        const wait = data.wait ?? null;
        if (wait !== null) {
          if (typeof wait !== 'object' || typeof wait.say !== 'string' || !wait.say.trim()) return refuse(response, 400, 'bad_request', 'Send wait as {"say": who or what he is waiting for}.');
          if (wait.say.length > 2000) return refuse(response, 400, 'bad_request', 'Say who or what he is waiting for in fewer words.');
          // With no time of his own the wait gives up two working days on, at 5 pm.
          if (until === null) until = defaultGiveUp(now());
        }
        if (until === null) {
          // Brought back now: on top, with no "Back", and a wait ends with it.
          const was = thread.snoozed !== null;
          Object.assign(thread, { snoozed: null, snoozed_at: null, woke: was ? null : thread.woke, wait: null });
          if (was) toTop(thread);
          changed(thread);
          return answer(response, 200, { thread: entry(thread) });
        }
        if (typeof until !== 'number' || Number.isNaN(until)) return refuse(response, 400, 'bad_request', 'Give the time to snooze until, in seconds.');
        if (until <= now()) return refuse(response, 400, 'bad_request', 'Pick a time in the future.');
        if (until > now() + 366 * 86400) return refuse(response, 400, 'bad_request', 'Pick a time within a year.');
        // A plain snooze replaces a wait.
        Object.assign(thread, {
          snoozed: until, snoozed_at: now(), woke: null,
          wait: wait ? { say: wait.say.split(/\s+/).filter(Boolean).join(' '), state: 'finding', on: '', what: '', where: '', link: '', check: '', since: now(), expires: until, checked: null, heard: null, reply: null } : null,
        });
        changed(thread);
        if (thread.wait) find(thread);
        return answer(response, 200, { thread: entry(thread) });
      }
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
    /** A new day's digest is written, as by the morning's run, and the list stream says nothing of it. */
    addDigest(date, sections) {
      digests.set(date, { date, path: `Library/digests/${date} digest.md`, sections });
    },
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
    /**
     * Changes the plan's usage and says so on the list stream. `limits`
     * replaces the list (each `{ key, label, used, resets_at, status, seen_at }`;
     * missing times are filled in as now and three days on), `plan` the
     * plan's name, and `missing: true` makes the route answer 404 as an
     * older service does.
     */
    setUsage({ limits, plan, missing } = {}) {
      const t = Math.floor(now());
      if (limits) {
        state.usage.limits = limits.map((limit) => ({ status: 'allowed', resets_at: t + 3 * 86400, seen_at: t, ...limit }));
        state.usage.as_of = limits.length > 0 ? t : null;
      }
      if (plan !== undefined) state.usage.account = { plan };
      if (missing !== undefined) state.usageMissing = missing;
      emitList('usage', {});
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
    /** A thread at work has been at it this many seconds longer: its time of last change moves back. */
    age(id, seconds) {
      const thread = threads.get(id);
      if (!thread) return;
      thread.updated -= seconds;
      emitThread(thread, 'thread', entry(thread));
      emitList('thread', entry(thread));
    },
    /** The reply a thread waits for arrives: one line, as the reply check gives it ("Robin: Saturday works."). */
    reply(id, line) {
      const thread = threads.get(id);
      if (thread?.wait?.state === 'watching') waitOver(thread, 'met', line);
    },
    /** The wait's time runs out with no reply. */
    expire(id) {
      const thread = threads.get(id);
      if (thread?.wait?.state === 'watching') waitOver(thread, 'expired');
    },
    /** The other side wrote, but not what he waits for: one line. A check is no news, so the row's time stays. */
    heard(id, line) {
      const thread = threads.get(id);
      if (thread?.wait?.state !== 'watching') return;
      Object.assign(thread.wait, { heard: line, checked: now() });
      emitThread(thread, 'thread', entry(thread));
      emitList('thread', entry(thread));
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
