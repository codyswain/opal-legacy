import { isDocFile } from '@/common/fileKind';
import type { EditingSetup } from '@/renderer/features/disk-explorer/components/editor/editorSetup';

/**
 * The setup for tests of the plain reading setup, which read-only log pages
 * use: a ".md" path gets it, and a ".mdo" path the document setup. In the
 * app a note is edited as a document; tests of that use the default.
 */
export const plainUnlessDocument = (path: string): EditingSetup => (isDocFile(path) ? 'document' : 'plain');
