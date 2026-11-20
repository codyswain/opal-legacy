// @vitest-environment node
import { generateKeyPairSync, sign as nodeSign, verify } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { toGrantSend, toQuestion } from '@/common/autoModel';
import { AutoHandlers } from '@/main/auto/AutoHandlers';
import type { AutoService } from '@/main/auto/AutoService';
import { DEVICE, grantBytes, grantReason, helperSigner, keyCode, SignerError, signerPath, validKeyLine, type SendSigner } from '@/main/auto/sendSigning';
import type { AutoGrant, AutoGrantSend } from '@/types/auto';

// The grant as the service sends it, and the bytes its grants.grant_text makes of it, taken from
// the service's own function on 2026-11-19. The words hold a two-byte letter, a three-byte sign and
// an emoji, so the hash is of UTF-8.
const RAW = {
  id: '9f2c4e1a7b3d4c5e8f6a0b1c2d3e4f5a',
  thread_id: '82a494f21dd8',
  channel: 'slack',
  to: [{ name: 'Jack Newsom', id: 'U01ABCDEF' }, { name: 'Sam', id: 'C02GHIJKL' }],
  about: 'the seed swap',
  expires: 1794637200.75,
  text: 'I will bring the bean seedlings on Saturday. Café ☕ — 🌱',
};
const WITH_WORDS =
  'auto-grant-v1\n9f2c4e1a7b3d4c5e8f6a0b1c2d3e4f5a\n82a494f21dd8\nslack\nU01ABCDEF,C02GHIJKL\n1794637200\n9e85a4c4e7e5da0445dcb6f18e0eabe4440ae551ca0266dc9aa5ebeccc8d4b3f\n';
const WITHOUT_WORDS = 'auto-grant-v1\n9f2c4e1a7b3d4c5e8f6a0b1c2d3e4f5a\n82a494f21dd8\nemail\nrobin@example.com\n1794637200\n';

const question = (grant: Record<string, unknown> = RAW) =>
  toQuestion({ id: '0c5e2f7a1b33', kind: 'grant', title: 'Send this Slack message to Jack Newsom and Sam?', detail: 'the seed swap', grant }) as AutoGrant;

describe('the bytes a yes signs', () => {
  it('match the service’s grant_text byte for byte, with the words', () => {
    const send = question().send as AutoGrantSend;
    expect(send).toEqual({ id: RAW.id, threadId: RAW.thread_id, channel: 'slack', to: RAW.to, expires: 1794637200.75, text: RAW.text });
    expect(grantBytes(send).equals(Buffer.from(WITH_WORDS, 'utf8'))).toBe(true);
  });

  it('match it without words, which then sign no hash', () => {
    for (const text of [null, '', undefined]) {
      const send = question({ ...RAW, channel: 'email', to: [{ name: 'Robin', id: 'robin@example.com' }], text }).send as AutoGrantSend;
      expect(send.text).toBeNull();
      expect(grantBytes(send).toString('utf8')).toBe(WITHOUT_WORDS);
    }
  });

  it('are made only from a grant that is whole, so the card offers only No otherwise', () => {
    const odd: Array<Record<string, unknown>> = [
      { ...RAW, id: '' },
      { ...RAW, id: 'a\nb' },
      { ...RAW, thread_id: 7 },
      { ...RAW, channel: undefined },
      { ...RAW, to: [] },
      { ...RAW, to: [{ name: 'Sam', id: 'U1,U2' }] },
      { ...RAW, to: [{ name: 'Sam' }] },
      { ...RAW, expires: '1794637200' },
      { ...RAW, expires: Number.NaN },
      { ...RAW, text: 5 },
      { ...RAW, text: 'x'.repeat(100_001) },
      { ...RAW, text: 'half a pair \uD83C' },
    ];
    for (const grant of odd) expect(question(grant).send).toBeNull();
    expect(toQuestion({ id: '0c5e2f7a1b33', kind: 'grant', title: 'Send?', detail: '' })).toMatchObject({ send: null, text: null });
    // The card's words are the words signed.
    expect(question().text).toBe(question().send?.text);
  });

  it('give Touch ID the channel and the people', () => {
    const send = question().send as AutoGrantSend;
    expect(grantReason({ ...send, to: [send.to[0]] })).toBe('Let Auto send one Slack message to Jack Newsom');
    expect(grantReason(send)).toBe('Let Auto send one Slack message to Jack Newsom and Sam');
    expect(grantReason({ ...send, channel: 'email', to: [{ id: 'a@x', name: 'A' }, { id: 'b@x', name: 'B' }, { id: 'c@x', name: '' }] })).toBe('Let Auto send one email to A, B and c@x');
    expect(grantReason({ ...send, channel: 'text', to: ['A', 'B', 'C', 'D'].map((name) => ({ id: name, name })) })).toBe('Let Auto send one text to A, B and 2 others');
  });
});

describe('this Mac’s key', () => {
  it('has the code the service and pair-phone.sh work out, and a line of one uncompressed point', () => {
    // A key line from the phone's SendKey and the code its SendKey.code gives.
    const line = 'BM8RGVY2BaHDpE6o7uUcXuSnom6bSieaAPjnPfolLmWLDOL94umi2/dw3WLz4LWEYl0WiZ0tOBzOiQnm75jreAU=';
    expect(validKeyLine(line)).toBe(true);
    expect(keyCode(line)).toMatch(/^[0-9a-f]{12}$/);
    expect(keyCode(`${line}\n`)).toBe(keyCode(line));
    expect(validKeyLine(Buffer.alloc(65, 1).toString('base64'))).toBe(false);
    expect(validKeyLine('not a key')).toBe(false);
  });

  it('is run from the app’s Resources when packaged, and from the checkout’s build otherwise', () => {
    expect(signerPath(true, '/Applications/Opal.app/Contents/Resources', '/Applications/Opal.app/Contents/Resources/app')).toBe('/Applications/Opal.app/Contents/Resources/app/build/native/opal-signer');
    expect(signerPath(false, '/r', '/code/opal')).toBe('/code/opal/build/native/opal-signer');
  });

  it('signs the bytes on stdin with the reason as an argument, and tells a cancel from a failure', async () => {
    const exec = vi.fn(async (_file: string, args: string[], _options: { timeout: number }, input: Buffer | null) => {
      if (args[0] === 'pubkey') return { code: 0, stdout: 'BM8RGVY2BaHDpE6o7uUcXuSnom6bSieaAPjnPfolLmWLDOL94umi2/dw3WLz4LWEYl0WiZ0tOBzOiQnm75jreAU=\n', stderr: '' };
      if (args[2] === 'cancel') return { code: 2, stdout: '', stderr: 'Not confirmed. Nothing was sent.\n' };
      if (args[2] === 'fail') return { code: 1, stdout: '', stderr: 'This Mac could not sign the send (x 1). Nothing was sent.\n' };
      return { code: 0, stdout: `${input?.toString('base64')}\n`, stderr: '' };
    });
    const signer = helperSigner({ helper: '/opal-signer', fs: { access: async () => undefined }, exec });
    expect(await signer.publicKey()).toMatch(/^BM8R/);
    expect(await signer.sign(Buffer.from('abc'), 'Let Auto send')).toBe(Buffer.from('abc').toString('base64'));
    expect(exec).toHaveBeenLastCalledWith('/opal-signer', ['sign', '--reason', 'Let Auto send'], { timeout: 90_000 }, Buffer.from('abc'));
    await expect(signer.sign(Buffer.from('abc'), 'cancel')).rejects.toMatchObject({ cancelled: true, message: 'Not confirmed. Nothing was sent.' });
    await expect(signer.sign(Buffer.from('abc'), 'fail')).rejects.toMatchObject({ cancelled: false });
    const none = helperSigner({ helper: '/opal-signer', fs: { access: async () => { throw new Error('ENOENT'); } }, exec });
    expect(await none.hasKey()).toBe(false);
    await expect(none.sign(Buffer.from('abc'), 'x')).rejects.toBeInstanceOf(SignerError);
  });
});

describe('allowing a send from Opal', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const LINE = 'BM8RGVY2BaHDpE6o7uUcXuSnom6bSieaAPjnPfolLmWLDOL94umi2/dw3WLz4LWEYl0WiZ0tOBzOiQnm75jreAU=';

  function setup(signer: Partial<SendSigner> = {}, trusted: string[] = [keyCode(LINE)]) {
    const handlers = new Map<string, Handler>();
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const fullSigner: SendSigner = {
      hasKey: vi.fn(async () => true),
      publicKey: vi.fn(async () => LINE),
      // Stands in for the Secure Enclave: a P-256 signature in DER over exactly the bytes given.
      sign: vi.fn(async (bytes: Buffer) => nodeSign('sha256', bytes, keys.privateKey).toString('base64')),
      ...signer,
    };
    const service = {
      allowSend: vi.fn(async () => ({ success: true as const, data: undefined })),
      trustedKeys: vi.fn(async () => ({ success: true as const, data: trusted })),
      offerKey: vi.fn(async (key: string) => ({ success: true as const, data: { code: keyCode(key) } })),
    };
    new AutoHandlers({
      ipc: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); } } as never,
      service: service as unknown as AutoService,
      pages: { registry: { list: (): string[] => [], assertAllowed: async (target: string) => target }, vaults: async (): Promise<string[]> => [] } as never,
      folders: { update: async () => 'none' as const },
      signer: fullSigner,
    }).registerAll();
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);
    return { call, service, signer: fullSigner, keys };
  }

  it('signs the grant’s own bytes after Touch ID and answers with the signature', async () => {
    const { call, service, signer, keys } = setup();
    expect(await call('auto:allow-send', 'bread', question())).toEqual({ success: true, data: undefined });
    expect(signer.sign).toHaveBeenCalledWith(Buffer.from(WITH_WORDS, 'utf8'), 'Let Auto send one Slack message to Jack Newsom and Sam');
    const [thread, id, signature] = service.allowSend.mock.calls[0] as unknown as [string, string, string];
    expect([thread, id]).toEqual(['bread', '0c5e2f7a1b33']);
    // What the service checks: the signature verifies over the grant_text bytes with this key.
    expect(verify('sha256', Buffer.from(WITH_WORDS, 'utf8'), keys.publicKey, Buffer.from(signature, 'base64'))).toBe(true);
  });

  it('signs nothing the card did not show whole, and nothing the page put together', async () => {
    const { call, signer, service } = setup();
    const good = question();
    for (const bad of [
      { ...good, text: 'Other words' },
      { ...good, send: { ...good.send, to: [{ id: 'U1,U2', name: 'x' }] } },
      { ...good, send: null },
      { ...good, kind: 'ask' },
      { ...good, id: '../x' },
      null,
    ]) {
      expect(await call('auto:allow-send', 'bread', bad)).toMatchObject({ success: false });
    }
    expect(await call('auto:allow-send', '../status', good)).toMatchObject({ success: false });
    expect(signer.sign).not.toHaveBeenCalled();
    expect(service.allowSend).not.toHaveBeenCalled();
  });

  it('answers nothing when he cancels Touch ID, and says why', async () => {
    const { call, service } = setup({ sign: vi.fn(async () => { throw new SignerError('Not confirmed. Nothing was sent.', true); }) });
    expect(await call('auto:allow-send', 'bread', question())).toEqual({ success: false, error: { kind: 'refused', message: 'Not confirmed. Nothing was sent.' } });
    expect(service.allowSend).not.toHaveBeenCalled();
  });

  it('asks for one Touch ID at a time', async () => {
    let release: (value: string) => void = () => undefined;
    const { call, signer } = setup({ sign: vi.fn((): Promise<string> => new Promise<string>((resolve) => { release = resolve; })) });
    const first = call('auto:allow-send', 'bread', question());
    expect(await call('auto:allow-send', 'bread', question())).toMatchObject({ success: false, error: { message: 'Touch ID is already asking.' } });
    release('MEUCIQ==');
    expect(await first).toEqual({ success: true, data: undefined });
    expect(signer.sign).toHaveBeenCalledTimes(1);
  });

  it('says whether this Mac is paired, without making a key', async () => {
    expect(await setup().call('auto:send-key')).toEqual({ success: true, data: { code: keyCode(LINE), paired: true } });
    expect(await setup({}, ['aaaaaaaaaaaa']).call('auto:send-key')).toEqual({ success: true, data: { code: keyCode(LINE), paired: false } });
    const fresh = setup({ hasKey: vi.fn(async () => false) });
    expect(await fresh.call('auto:send-key')).toEqual({ success: true, data: { code: null, paired: false } });
    expect(fresh.signer.publicKey).not.toHaveBeenCalled();
  });

  it('offers this Mac’s key as the MacBook Pro and answers its code', async () => {
    const { call, service } = setup();
    expect(await call('auto:pair-mac')).toEqual({ success: true, data: { code: keyCode(LINE) } });
    expect(service.offerKey).toHaveBeenCalledWith(LINE, DEVICE);
    expect(DEVICE).toBe('macbook-pro');
    // A code for some other key would pair the wrong one.
    service.offerKey.mockResolvedValueOnce({ success: true, data: { code: 'bbbbbbbbbbbb' } });
    expect(await call('auto:pair-mac')).toMatchObject({ success: false, error: { kind: 'refused' } });
  });

  it('checks a grant the page hands back as strictly as one from the service', () => {
    const send = question().send;
    expect(toGrantSend(send)).toEqual(send);
    expect(toGrantSend({ ...send, extra: 'ignored' })).toEqual(send);
    expect(toGrantSend({ ...send, expires: 0 })).toBeNull();
  });
});
