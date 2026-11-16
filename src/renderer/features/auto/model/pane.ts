/*
 * What the pane beside the list shows is one value: a thread's id, the empty
 * thread, the digest queue, the Put away page, or null for nothing. The
 * names that are not threads start with a colon, which no thread id can hold.
 */

/** The empty thread, where a new one is started. */
export const NEW_THREAD = ':new';
/** The digest, as a queue he works through. */
export const DIGEST_QUEUE = ':digest';
/** What is put away: the threads waiting on a reply, the snoozed ones and the archive. */
export const AWAY = ':away';

/** The thread a pane shows, or null for the empty thread, the queue, the Put away page and no pane. */
export const paneThread = (openId: string | null): string | null => (openId && !openId.startsWith(':') ? openId : null);
