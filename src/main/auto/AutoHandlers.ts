import type { IpcMain } from 'electron';
import type { AutoFailure, AutoResult, FolderUpdateOutcome } from '@/types/auto';
import type { AutoService } from './AutoService';
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
  }) {}

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
    // No arguments: the page can never name a folder, a remote or a command. Only for a Mac with an address set.
    ipc.handle('auto:update-folders', async (): Promise<AutoResult<FolderUpdateOutcome>> => {
      const config = await service.config().catch(() => ({ url: null }));
      if (!config.url) return { success: true, data: 'none' };
      return { success: true, data: await folders.update().catch((): FolderUpdateOutcome => 'refused') };
    });
  }

  private async respond<T>(operation: () => Promise<T>): Promise<AutoResult<T>> {
    try {
      return { success: true, data: await operation() } as AutoResult<T>;
    } catch (error) {
      return refuse('invalid', error instanceof AutoAddressError ? error.message : 'Opal could not save the address.');
    }
  }
}
