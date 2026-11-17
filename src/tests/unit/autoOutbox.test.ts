import { beforeEach, describe, expect, it } from 'vitest';
import {
  NEW_THREAD,
  RESEND_WINDOW_MS,
  cidFor,
  drop,
  giveBack,
  leftOver,
  newCid,
  put,
  readBox,
  setDraft,
  writeBox,
  type BoxState,
  type OutboxEntry,
} from '@/renderer/features/auto/model/outbox';
import { useAutoStore } from '@/renderer/features/auto';
import { useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { autoSnapshot, autoThread, installAutoApi } from '@/tests/helpers/autoApi';

const NOW = 1_800_000_000_000;
const EMPTY: BoxState = { outbox: [], drafts: {} };
const entry = (cid: string, fields: Partial<OutboxEntry> = {}): OutboxEntry => ({ cid, thread: 'bread', text: `Message ${cid}`, model: '', at: NOW, ...fields });

beforeEach(() => {
  window.localStorage.clear();
});

describe('the outbox', () => {
  it('keeps a message until the service has it', () => {
    let box = put(EMPTY, entry('a1'));
    box = put(box, entry('b2', { thread: null, model: 'small' }));
    expect(box.outbox.map((each) => each.cid)).toEqual(['a1', 'b2']);
    // The same message put twice is one message.
    expect(put(box, entry('a1')).outbox.map((each) => each.cid)).toEqual(['b2', 'a1']);
    expect(drop(box, 'a1').outbox.map((each) => each.cid)).toEqual(['b2']);
  });

  it('lasts across a relaunch, with what was typed and not sent', () => {
    writeBox(setDraft(put(EMPTY, entry('a1')), 'bread', 'Half a thought'));
    expect(readBox()).toEqual({ outbox: [entry('a1')], drafts: { bread: 'Half a thought' } });
    expect(readBox().outbox[0]).not.toBe(entry('a1'));
  });

  it('reads nothing it does not know from storage', () => {
    expect(readBox()).toEqual(EMPTY);
    window.localStorage.setItem('opal.auto.box', JSON.stringify({ version: 1, value: { outbox: [entry('a1'), { cid: 'not a cid', text: 'x' }, 'junk', { ...entry('c3'), text: '' }], drafts: { bread: 7, beds: 'Kept' } } }));
    expect(readBox()).toEqual({ outbox: [entry('a1')], drafts: { beds: 'Kept' } });
    window.localStorage.setItem('opal.auto.box', 'not json');
    expect(readBox()).toEqual(EMPTY);
  });

  it('gives a failed message back to its box, above anything typed since', () => {
    const box = setDraft(put(EMPTY, entry('a1', { text: 'Move it to the 22nd' })), 'bread', 'And one more thing');
    expect(giveBack(box, entry('a1', { text: 'Move it to the 22nd' }))).toEqual({ outbox: [], drafts: { bread: 'Move it to the 22nd\n\nAnd one more thing' } });
    expect(giveBack(put(EMPTY, entry('n1', { thread: null })), entry('n1', { thread: null })).drafts).toEqual({ [NEW_THREAD]: 'Message n1' });
  });

  it('empties a draft by setting it to nothing', () => {
    expect(setDraft(setDraft(EMPTY, 'bread', 'Words'), 'bread', '')).toEqual(EMPTY);
  });

  it('sends again what was on its way minutes ago, and gives back what is older', () => {
    const box = put(put(put(EMPTY, entry('old', { at: NOW - RESEND_WINDOW_MS - 1 })), entry('new', { at: NOW - 30_000 })), entry('later', { at: NOW + 60_000 }));
    const sorted = leftOver(box, NOW);
    expect(sorted.resend.map((each) => each.cid)).toEqual(['new']);
    expect(sorted.returned.map((each) => each.cid)).toEqual(['old', 'later']);
    expect(sorted.state.outbox.map((each) => each.cid)).toEqual(['new']);
    expect(sorted.state.drafts.bread).toBe('Message later\n\nMessage old');
  });

  it('makes an id of ten hex characters, and keeps the id of the same words sent again', () => {
    expect(newCid()).toMatch(/^[0-9a-f]{10}$/);
    expect(newCid()).not.toBe(newCid());
    const failed = { thread: 'bread', text: 'Move it', cid: 'a1b2c3d4e5' };
    expect(cidFor(failed, 'bread', 'Move it')).toBe('a1b2c3d4e5');
    expect(cidFor(failed, 'bread', 'Move it please')).not.toBe('a1b2c3d4e5');
    expect(cidFor(failed, 'beds', 'Move it')).not.toBe('a1b2c3d4e5');
    expect(cidFor(null, 'bread', 'Move it')).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe('the box’s store', () => {
  const BREAD = autoThread('bread', { title: 'Sourdough timings' });

  function start(box: BoxState = EMPTY) {
    const auto = installAutoApi({ threads: [BREAD], snapshots: { bread: autoSnapshot(BREAD) } });
    useAutoStore.setState({ ...useAutoStore.getInitialState(), configured: true, address: 'https://host.example/agent', loaded: true, reachable: true, threads: [BREAD] }, true);
    useThreadStore.setState({ ...useThreadStore.getInitialState(), box, openId: 'bread' }, true);
    return auto;
  }
  const stored = () => readBox();

  it('holds a message in the outbox while it is on its way, and drops it once it is there', async () => {
    const auto = start();
    const sending = useThreadStore.getState().send('Move it to the 22nd');
    expect(stored().outbox.map((each) => each.text)).toEqual(['Move it to the 22nd']);
    expect(useThreadStore.getState().pending.map((message) => message.text)).toEqual(['Move it to the 22nd']);
    expect(await sending).toBe(true);
    expect(stored().outbox).toEqual([]);
    expect(auto.asked('message')).toEqual([{ kind: 'message', id: 'bread', text: 'Move it to the 22nd', cid: expect.stringMatching(/^[0-9a-f]{10}$/) }]);
  });

  it('waits for this thread’s model before replying, even if another thread opened', async () => {
    const auto = start();
    const store = useThreadStore.getState();
    let land: () => void = () => undefined;
    auto.state.gate = new Promise<void>((resolve) => { land = resolve; });
    const picking = store.setModel('small');
    const sending = store.send('Bread reply');
    expect(auto.asked('message')).toEqual([]);
    expect(stored().outbox[0].awaitingModel).toBe(true);
    useThreadStore.setState({ openId: 'herbs' });
    auto.state.gate = null;
    expect(await store.send('Herb reply')).toBe(true);
    land();
    await picking;
    expect(await sending).toBe(true);
    expect(auto.asked('message').map(({ id, text }) => [id, text])).toEqual([['herbs', 'Herb reply'], ['bread', 'Bread reply']]);
  });

  it('restores his words and holds retries when the model change failed', async () => {
    const auto = start();
    const store = useThreadStore.getState();
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    const picking = store.setModel('small');
    const sending = store.send('Bread reply');
    store.setDraft('Additional words');
    await picking;
    expect(await sending).toBe(false);
    expect(auto.asked('message')).toEqual([]);
    expect(stored().drafts.bread).toBe('Bread reply\n\nAdditional words');
    auto.state.failWrites = null;
    expect(await store.send(stored().drafts.bread)).toBe(false);
    expect(auto.asked('message')).toEqual([]);
    await store.setModel('small');
    expect(await store.send(stored().drafts.bread)).toBe(true);
  });

  it('restores a reply if Opal closed before its model was confirmed', () => {
    const auto = start({ outbox: [entry('a2', { awaitingModel: true, at: Date.now() })], drafts: {} });
    useThreadStore.getState().flush();
    expect(auto.asked('message')).toEqual([]);
    expect(stored()).toEqual({ outbox: [], drafts: { bread: 'Message a2' } });
  });

  it('puts the words back in the box when the post fails', async () => {
    const auto = start();
    auto.state.failWrites = { kind: 'unreachable', message: "Can't reach Auto." };
    useThreadStore.getState().setDraft('Move it to the 22nd');
    expect(await useThreadStore.getState().send('Move it to the 22nd')).toBe(false);
    expect(stored()).toEqual({ outbox: [], drafts: { bread: 'Move it to the 22nd' } });
    expect(useThreadStore.getState().notSent).toEqual({ thread: 'bread', text: 'Not sent' });
    expect(useThreadStore.getState().pending).toEqual([]);
  });

  it('sends a message left by a closed app again, under its own id', async () => {
    const auto = start({ outbox: [entry('a1b2c3d4e5', { text: 'Left on its way', at: Date.now() - 5_000 })], drafts: {} });
    useThreadStore.getState().flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auto.asked('message')).toEqual([{ kind: 'message', id: 'bread', text: 'Left on its way', cid: 'a1b2c3d4e5' }]);
    expect(stored().outbox).toEqual([]);
  });

  it('gives an old one back to its box instead of sending it', async () => {
    const auto = start({ outbox: [entry('a1b2c3d4e5', { text: 'From last week', at: Date.now() - RESEND_WINDOW_MS - 60_000 })], drafts: {} });
    useThreadStore.getState().flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auto.asked('message')).toEqual([]);
    expect(stored()).toEqual({ outbox: [], drafts: { bread: 'From last week' } });
    expect(useThreadStore.getState().notSent).toEqual({ thread: 'bread', text: 'Not sent' });
  });

  it('sends nothing empty', async () => {
    const auto = start();
    expect(await useThreadStore.getState().send('   ')).toBe(false);
    expect(auto.routes()).toEqual([]);
  });
});
