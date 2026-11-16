import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoResult, AutoSnapshot, AutoThread } from '@/types/auto';
import { useAutoStore } from '@/renderer/features/auto';
import { archiveThread } from '@/renderer/features/auto/store/actions';
import { useSaidStore } from '@/renderer/features/auto/store/saidStore';
import { useThreadStore } from '@/renderer/features/auto/store/threadStore';
import { autoSnapshot, autoThread, installAutoApi, type FakeAuto } from '@/tests/helpers/autoApi';

const BREAD = autoThread('bread', { title: 'Sourdough timings' });

let auto: FakeAuto;

beforeEach(() => {
  auto = installAutoApi({ threads: [BREAD], snapshots: { bread: autoSnapshot(BREAD) } });
  useAutoStore.setState({ ...useAutoStore.getInitialState(), configured: true, address: 'https://host.example/agent', loaded: true, reachable: true, threads: [BREAD] }, true);
  useThreadStore.setState({ ...useThreadStore.getInitialState(), openId: 'bread', watching: true }, true);
});

const heard = (token: number, thread: AutoThread) =>
  useThreadStore.getState().handle({ token, type: 'event', stream: 'thread', event: { kind: 'thread', thread }, cursor: null });
const listed = () => useAutoStore.getState().threads.map((thread) => thread.id);

describe('the pane’s thread stream', () => {
  it('takes only the follow asked for last, when two loads overlap', async () => {
    // Each follow answers only when the test says so, the first one last.
    const answers: Array<(result: AutoResult<{ token: number }>) => void> = [];
    vi.mocked(auto.api.follow).mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    const first = useThreadStore.getState().load();
    await vi.waitFor(() => expect(answers).toHaveLength(1));
    const second = useThreadStore.getState().load();
    // The second load ends the follow still on its way, so the main process drops its stream.
    expect(auto.api.unfollow).toHaveBeenCalledWith('thread');
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]({ success: true, data: { token: 12 } });
    await second;
    answers[0]({ success: true, data: { token: 11 } });
    await first;
    expect(useThreadStore.getState().token).toBe(12);
    // An event of the older stream, which starts from an older cursor, changes nothing.
    heard(11, { ...BREAD, title: 'From an older cursor' });
    expect(useThreadStore.getState().view?.thread.title).toBe('Sourdough timings');
  });

  it('drops a snapshot answered after a later load began, and follows from the later one', async () => {
    const request = vi.mocked(auto.api.request);
    const passOn = request.getMockImplementation();
    const snapshots: Array<(result: AutoResult<AutoSnapshot>) => void> = [];
    request.mockImplementation((route) => (route.kind === 'thread' || !passOn ? new Promise((resolve) => snapshots.push(resolve as never)) : passOn(route)));

    const first = useThreadStore.getState().load();
    const second = useThreadStore.getState().load();
    await vi.waitFor(() => expect(snapshots).toHaveLength(2));
    snapshots[1]({ success: true, data: autoSnapshot(BREAD, { cursor: 'b.6' }) });
    await second;
    // The first answer comes last, from before the second was asked for.
    snapshots[0]({ success: true, data: autoSnapshot({ ...BREAD, archived: true }, { cursor: 'b.4' }) });
    await first;
    expect(useThreadStore.getState().view?.cursor).toBe('b.6');
    expect(vi.mocked(auto.api.follow).mock.calls.map(([target]) => target.cursor)).toEqual(['b.6']);
    expect(listed()).toEqual(['bread']);
  });

  it('leaves rows joining and leaving the list to the list’s stream', async () => {
    await useThreadStore.getState().load();
    const token = useThreadStore.getState().token ?? -1;
    // A replay from an older cursor: archived, then a change to a thread no longer listed.
    heard(token, { ...BREAD, archived: true });
    heard(token, autoThread('gone'));
    expect(listed()).toEqual(['bread']);
    expect(useThreadStore.getState().openId).toBe('bread');
    // A change that keeps it listed still reaches its row.
    heard(token, { ...BREAD, title: 'Sourdough, longer proof' });
    expect(useAutoStore.getState().threads[0].title).toBe('Sourdough, longer proof');
  });
});

describe('a thread’s writes', () => {
  it('reach the service in the order he made them, each undo included, however slow the first', async () => {
    const request = vi.mocked(auto.api.request);
    const passOn = request.getMockImplementation();
    const sent: string[] = [];
    let slowFirst: (() => void) | null = null;
    request.mockImplementation(async (route) => {
      if (route.kind === 'archive') {
        sent.push(route.archived ? 'archive' : 'undo');
        // The first archive is slow; everything after it is quick.
        if (sent.length === 1) await new Promise<void>((resolve) => (slowFirst = resolve));
        return { success: true, data: { thread: { ...BREAD, archived: route.archived } } } as never;
      }
      return passOn ? passOn(route) : (new Promise(() => undefined) as never);
    });

    useSaidStore.setState(useSaidStore.getInitialState(), true);
    const first = archiveThread(BREAD);
    expect(useSaidStore.getState().undo()).toBe(true);
    const second = archiveThread(BREAD);
    expect(useSaidStore.getState().undo()).toBe(true);
    await vi.waitFor(() => expect(sent).toEqual(['archive']));
    // The second archive waits for the first, and for its undo.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual(['archive']);
    slowFirst?.();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(sent).toEqual(['archive', 'undo', 'archive', 'undo']));
    expect(listed()).toEqual(['bread']);
  });
});
