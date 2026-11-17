import * as React from 'react';
import { Image as ImageIcon, X } from 'lucide-react';
import { create } from 'zustand';
import { MAX_AUTO_IMAGES, MAX_AUTO_IMAGE_BYTES, validImageMime } from '@/common/autoImages';
import type { AutoImage } from '@/types/auto';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/renderer/shared/ui';
import { cn } from '@/renderer/shared/utils';
import { autoApi, useAutoStore } from '../store/autoStore';

export const noImages: readonly string[] = [];

interface PasteState {
  pending: number;
  error?: string;
}

const idle: PasteState = { pending: 0 };
const pastes = create<{ boxes: Record<string, PasteState> }>(() => ({ boxes: {} }));
const queues = new Map<string, Promise<void>>();
// Reuse images just pasted or recently opened. Full image bytes never enter localStorage.
const previews = new Map<string, string>();
const remember = (id: string, url: string) => {
  previews.delete(id);
  previews.set(id, url);
  if (previews.size > 8) previews.delete(previews.keys().next().value);
};

let serviceGeneration = 0;
useAutoStore.subscribe((state, previous) => {
  if (state.address === previous.address) return;
  serviceGeneration++;
  previews.clear();
  queues.clear();
  pastes.setState({ boxes: {} });
});

function mark(key: string, state: PasteState): void {
  const boxes = { ...pastes.getState().boxes };
  if (state.pending || state.error) boxes[key] = state;
  else delete boxes[key];
  pastes.setState({ boxes });
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      if (typeof url === 'string' && url.includes(',')) resolve(url.slice(url.indexOf(',') + 1));
      else reject(new Error('Opal could not read the pasted image.'));
    };
    reader.onerror = () => reject(new Error('Opal could not read the pasted image.'));
    reader.readAsDataURL(file);
  });
}

async function imageBytes(file: File): Promise<AutoImage> {
  if (!validImageMime(file.type)) throw new Error('Paste a PNG, JPEG, or WebP image.');
  if (file.size <= MAX_AUTO_IMAGE_BYTES) return { mime: file.type, data: await readBase64(file) };
  // Retina screenshots can be larger than the service accepts. Downsample only that copy.
  const tooLarge = 'Auto accepts images up to 5 MB. Copy a smaller version.';
  if (typeof createImageBitmap !== 'function') throw new Error(tooLarge);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(tooLarge);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 3072 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const smaller = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
      if (smaller && smaller.size <= MAX_AUTO_IMAGE_BYTES && validImageMime(smaller.type)) {
        return { mime: smaller.type, data: await readBase64(smaller) };
      }
    }
    throw new Error(tooLarge);
  } finally {
    bitmap.close();
  }
}

function clipboardImages(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? []);
  // Some clipboard sources only expose the File through the item.
  if (!files.length) {
    for (const item of Array.from(data.items ?? [])) {
      const file = item.kind === 'file' && item.getAsFile();
      if (file) files.push(file);
    }
  }
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!images.length || !data.getData('text/plain')) return images;
  // Finder also puts file names on the clipboard. A rich-text selection, on the other
  // hand, can contain a rendering of the copied words: keep the native text paste.
  return images.filter((file) => window.filesAPI?.hasPath?.(file));
}

/** All reads/writes below are bound to the draft where Cmd+V was pressed, even after navigation. */
export function useImagePaste(key: string, read: () => readonly string[], add: (id: string) => void, enabled = true) {
  const state = pastes((current) => current.boxes[key] ?? idle);
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.currentTarget.readOnly || !event.clipboardData) return;
    const files = clipboardImages(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    const current = pastes.getState().boxes[key] ?? idle;
    if (!enabled) {
      mark(key, { ...current, error: 'Images can be attached to a message after this question is answered.' });
      return;
    }
    if (files.length + current.pending + read().length > MAX_AUTO_IMAGES) {
      mark(key, { ...current, error: `Attach up to ${MAX_AUTO_IMAGES} images per message.` });
      return;
    }
    const generation = serviceGeneration;
    mark(key, { pending: current.pending + files.length });
    // Keep two consecutive pastes in order. The user can keep typing during the uploads.
    const upload = async () => {
      for (const file of files) {
        if (generation !== serviceGeneration) return;
        let problem: string | undefined;
        try {
          const image = await imageBytes(file);
          if (generation !== serviceGeneration) return;
          const result = await autoApi()?.request({ kind: 'upload-image', ...image });
          if (generation !== serviceGeneration) return;
          if (!result?.success) throw new Error(result?.error.message || 'Auto could not attach the image. Paste it again.');
          remember(result.data.id, `data:${image.mime};base64,${image.data}`);
          add(result.data.id);
        } catch (error) {
          problem = error instanceof Error && error.message ? error.message : 'Auto could not attach the image. Paste it again.';
        } finally {
          if (generation === serviceGeneration) {
            const latest = pastes.getState().boxes[key] ?? idle;
            mark(key, { pending: Math.max(0, latest.pending - 1), error: problem ?? latest.error });
          }
        }
      }
    };
    const job = (queues.get(key) ?? Promise.resolve()).then(upload);
    queues.set(key, job);
    void job.finally(() => { if (queues.get(key) === job) queues.delete(key); });
  };
  const canSubmit = () => {
    if (pastes.getState().boxes[key]?.pending) return false;
    if (pastes.getState().boxes[key]?.error) mark(key, idle);
    return true;
  };
  return { ...state, onPaste, canSubmit };
}

function Attachment({ id, label, compact }: { id: string; label: string; compact: boolean }) {
  const address = useAutoStore((state) => state.address);
  const [version, retry] = React.useReducer((n: number) => n + 1, 0);
  const [loaded, setLoaded] = React.useState<{ id: string; address: string | null; url: string | null }>();
  const host = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const cached = previews.get(id);
    if (cached) {
      setLoaded({ id, address, url: cached });
      return;
    }
    let live = true;
    const generation = serviceGeneration;
    let started = false;
    const load = async () => {
      if (started) return;
      started = true;
      const result = await autoApi()?.request({ kind: 'image', id }).catch(() => null);
      if (!live || serviceGeneration !== generation) return;
      const url = result?.success ? `data:${result.data.mime};base64,${result.data.data}` : null;
      if (url) remember(id, url);
      setLoaded({ id, address, url });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); void load(); }
    }, { rootMargin: '160px' });
    if (host.current && observer) observer.observe(host.current);
    else void load();
    return () => { live = false; observer?.disconnect(); };
  }, [id, address, version]);
  const url = previews.get(id) ?? (loaded?.id === id && loaded.address === address ? loaded.url : undefined);
  return (
    <div ref={host} className="flex min-h-12 min-w-14 items-center justify-center">
      {url ? (
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" aria-label={`View ${label.toLowerCase()}`} className="block cursor-zoom-in rounded-control focus-visible:ring-2 focus-visible:ring-focus">
              <img src={url} alt={label} className={cn('block rounded-control object-contain', compact ? 'max-h-16 max-w-28' : 'max-h-56 max-w-full')} />
            </button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="w-fit max-w-[94vw] p-0">
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <img src={url} alt={label} className="max-h-[90vh] max-w-[94vw] rounded-dialog object-contain" />
          </DialogContent>
        </Dialog>
      ) : url === null ? (
        <button type="button" onClick={retry} className="text-control underline">Reload image</button>
      ) : <ImageIcon aria-label={`Loading ${label.toLowerCase()}`} className="h-5 w-5 text-icon" />}
    </div>
  );
}

export function Attachments({ ids, remove }: { ids: readonly string[]; remove?: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <div data-testid="auto-attachments" className="flex flex-wrap items-center gap-2">
      {ids.map((id, index) => (
        <div key={id} className="relative min-w-0 max-w-full">
          <Attachment id={id} label={`Pasted image ${index + 1}`} compact={!!remove} />
          {remove && (
            <button
              type="button"
              aria-label={`Remove image ${index + 1}`}
              onClick={() => remove(id)}
              className="absolute right-0 top-0 rounded-full border border-border bg-surface p-0.5 text-foreground hover:bg-surface-hover"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function PasteStatus({ pending, error }: PasteState) {
  return (
    <>
      {pending > 0 && <p role="status" className="py-1 text-control text-foreground-tertiary">Attaching {pending === 1 ? 'image' : 'images'}…</p>}
      {error && <p role="alert" className="py-1 text-control text-foreground">{error}</p>}
    </>
  );
}
