import type { IpcMain } from 'electron';
import { toGrantSend, validThreadId } from '@/common/autoModel';
import type { AutoFailure, AutoResult, AutoSendKey, FolderUpdateOutcome } from '@/types/auto';
import type { AutoService } from './AutoService';
import { DEVICE, grantBytes, grantReason, keyCode, SignerError, type SendSigner } from './sendSigning';
import { AutoAddressError, validRoute, validStreamTarget } from './autoRequests';
import { resolveVaultPage, type AutoPagesDependencies, type ResolvedPage } from './autoPages';

const refuse = (kind: AutoFailure['kind'], message: string): AutoResult<never> => ({ success: false, error: { kind, message } });
const invalid = (): AutoResult<never> => refuse('invalid', 'Opal could not send that to Auto.');

/**
 * The page's way to Auto. Every request is one of a fixed list of routes,
 * checked and rebuilt field by field before it goes anywhere; the page never
 * names an address, a path or a header.
 */
export class AutoHandlers {
  constructor(private deps: {
    ipc: Pick<IpcMain, 'handle'>;
    service: AutoService;
    pages: AutoPagesDependencies;
    /** Brings the opened folders that are git checkouts up to date; the folders are the main process's own. */
    folders: { update: () => Promise<FolderUpdateOutcome> };
    /** This Mac's key for allowing sends (sendSigning.ts). */
    signer: SendSigner;
  }) {}

  /** One Touch ID at a time: a second click while one is up does nothing. */
  private signing = false;

  registerAll(): void {
    const { ipc, service, pages, folders } = this.deps;
    ipc.handle('auto:config', () => this.respond(() => service.config()));
    ipc.handle('auto:set-address', (_event, url: unknown) =>
      typeof url === 'string' ? this.respond(() => service.setAddress(url)) : invalid());
    ipc.handle('auto:request', (_event, value: unknown) => {
      const route = validRoute(value);
      return route ? service.request(route).catch(() => refuse('unreachable', "Can't reach Auto.")) : invalid();
    });
    ipc.handle('auto:follow', (_event, value: unknown) => {
      const target = validStreamTarget(value);
      return target ? service.follow(target).catch(() => refuse('unreachable', "Can't reach Auto.")) : invalid();
    });
    ipc.handle('auto:unfollow', (_event, stream: unknown) => {
      if (stream !== 'list' && stream !== 'thread') return invalid();
      service.unfollow(stream);
      return { success: true, data: undefined };
    });
    ipc.handle('auto:resolve-page', async (_event, written: unknown) => {
      const page = await resolveVaultPage(pages, written).catch((): ResolvedPage => ({ error: 'Opal could not open that file.' }));
      if ('path' in page) return { success: true, data: { path: page.path, title: page.title } };
      return refuse('missing' in page ? 'missing' : 'invalid', page.error);
    });
    ipc.handle('auto:send-key', () => this.sendKey());
    ipc.handle('auto:pair-mac', () => this.pairMac());
    ipc.handle('auto:allow-send', (_event, thread: unknown, question: unknown) => this.allowSend(thread, question));
    // No arguments: the page can never name a folder, a remote or a command. Only for a Mac with an address set.
    ipc.handle('auto:update-folders', async (): Promise<AutoResult<FolderUpdateOutcome>> => {
      const config = await service.config().catch(() => ({ url: null }));
      if (!config.url) return { success: true, data: 'none' };
      return { success: true, data: await folders.update().catch((): FolderUpdateOutcome => 'refused') };
    });
  }

  /** Whether this Mac has a key and the service trusts it. Makes no key. */
  async sendKey(): Promise<AutoResult<AutoSendKey>> {
    const { service, signer } = this.deps;
    try {
      if (!(await signer.hasKey())) return { success: true, data: { code: null, paired: false } };
      const code = keyCode(await signer.publicKey());
      const trusted = await service.trustedKeys();
      if (!trusted.success) return { success: false, error: trusted.error };
      return { success: true, data: { code, paired: trusted.data.includes(code) } };
    } catch (error) {
      return refuse('invalid', error instanceof SignerError ? error.message : 'Opal could not read this Mac\'s key.');
    }
  }

  /** Makes this Mac's key if need be and offers it to the service as this device. */
  async pairMac(): Promise<AutoResult<{ code: string }>> {
    const { service, signer } = this.deps;
    try {
      const line = await signer.publicKey();
      const offered = await service.offerKey(line, DEVICE);
      if (!offered.success) return offered;
      // The code he types on the Mini must be this key's; one for any other key would pair the wrong one.
      if (offered.data.code !== keyCode(line)) return refuse('refused', 'Auto heard a different key. Nothing was paired.');
      return offered;
    } catch (error) {
      return refuse('invalid', error instanceof SignerError ? error.message : 'Opal could not make this Mac\'s key.');
    }
  }

  /**
   * The yes to a send, from the card the page shows. The signed bytes and
   * Touch ID's words are built here from the grant's own fields, checked
   * again, and the card's words must be the words signed.
   */
  async allowSend(thread: unknown, value: unknown): Promise<AutoResult> {
    const question = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
    if (!validThreadId(thread) || !question || question.kind !== 'grant' || !validThreadId(question.id)) return invalid();
    const send = toGrantSend(question.send);
    if (!send) return refuse('invalid', 'This send cannot be allowed from Opal. Say no, or allow it on your phone.');
    if ((question.text ?? null) !== send.text) return invalid();
    if (this.signing) return refuse('invalid', 'Touch ID is already asking.');
    this.signing = true;
    try {
      const signature = await this.deps.signer.sign(grantBytes(send), grantReason(send));
      return await this.deps.service.allowSend(thread, question.id, signature);
    } catch (error) {
      return refuse(error instanceof SignerError && error.cancelled ? 'refused' : 'invalid', error instanceof SignerError ? error.message : 'This Mac could not sign the send. Nothing was sent.');
    } finally {
      this.signing = false;
    }
  }

  private async respond<T>(operation: () => Promise<T>): Promise<AutoResult<T>> {
    try {
      return { success: true, data: await operation() } as AutoResult<T>;
    } catch (error) {
      return refuse('invalid', error instanceof AutoAddressError ? error.message : 'Opal could not save the address.');
    }
  }
}
