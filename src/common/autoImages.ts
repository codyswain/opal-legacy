import type { AutoImage, AutoImageMime } from '@/types/auto';

export const MAX_AUTO_IMAGES = 4;
export const MAX_AUTO_IMAGE_BYTES = 5 * 1024 * 1024;

export const validImageMime = (value: unknown): value is AutoImageMime =>
  value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';

export const validImageId = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 64 && !/[^0-9a-f]/.test(value);

export const validImageIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_AUTO_IMAGES && [...value].every(validImageId) &&
  new Set(value).size === value.length;

export function toAutoImage(mime: unknown, data: unknown): AutoImage | null {
  if (!validImageMime(mime) || typeof data !== 'string' || !data.length ||
      data.length % 4 !== 0 || data.length > Math.ceil(MAX_AUTO_IMAGE_BYTES / 3) * 4) return null;
  const padding = data.endsWith('==') ? 2 : Number(data.endsWith('='));
  if ((data.length / 4) * 3 - padding > MAX_AUTO_IMAGE_BYTES || /[^A-Za-z0-9+/]/.test(data.slice(0, data.length - padding))) return null;
  return { mime, data };
}

/** Preserve the wire format of older, text-only messages. */
export const imageFields = (images: unknown): { images?: string[] } =>
  validImageIds(images) && images.length ? { images: [...images] } : {};
