/**
 * Client-side image downscaling for user-picked pictures (today: avatars).
 *
 * Lives in `app/core` rather than `cad-editor`: the layering rule points one
 * way (cad-core → app/core → cad-editor → features), and the dashboard must not
 * reach into the editor for a canvas helper. The editor's own thumbnail
 * services render CAD documents, not picked files, so there was nothing to reuse.
 *
 * Why resize at all: a phone photo is 3-8 MB and 4000 px wide, and it would be
 * stored and re-downloaded at that size to be drawn into a 56 px circle. One
 * pass here makes the stored object ~15-30 KB and normalises every input
 * (EXIF-rotated JPEG, PNG with alpha, huge WebP) to one square format.
 */

/** Formats we hand to `createImageBitmap` and accept from a file picker. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** `accept` attribute for a file input, derived so the two cannot drift. */
export const ACCEPTED_IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

/**
 * Largest file we will even attempt to decode (10 MB).
 *
 * Not a storage limit — the resized output is tiny regardless. It is a guard on
 * `createImageBitmap`, which decodes the full bitmap into memory and will hang
 * or crash a tab on a pathological input long before the upload is reached.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Edge length of the square produced by {@link resizeToSquare}. */
export const AVATAR_SIZE = 256;

/** A resized image, ready to upload. */
export interface ResizedImage {
  blob: Blob;
  /** MIME actually produced — WebP where supported, else PNG. */
  contentType: string;
  /** File extension matching `contentType`, no dot. */
  extension: string;
}

/** True when the browser can encode this MIME from a canvas. */
function canEncode(type: string): boolean {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  // toDataURL falls back to image/png for a type it cannot encode, so a prefix
  // check is the reliable feature test.
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

/** Promise wrapper over the callback-style `toBlob`. */
function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Decodes `file`, centre-crops it to a square and scales it to `size`×`size`.
 *
 * Centre-crop rather than letterbox: a face is near the middle of a portrait
 * photo, and the result is drawn in a circle where bars would be visible.
 *
 * @throws Error with a user-facing message when the file is too large, not an
 *   image, or cannot be decoded/encoded.
 */
export async function resizeToSquare(file: Blob, size = AVATAR_SIZE): Promise<ResizedImage> {
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
    throw new Error(`That image is larger than ${mb} MB. Please pick a smaller one.`);
  }
  if (file.type && !file.type.startsWith('image/')) {
    throw new Error('That file is not an image. Pick a PNG, JPEG or WebP.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // A corrupt file, or a format the browser will not decode (HEIC on Chrome).
    throw new Error('That image could not be read. Try a PNG or JPEG instead.');
  }

  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    if (!edge) {
      throw new Error('That image could not be read. Try a PNG or JPEG instead.');
    }
    // Source rect: the largest centred square of the original.
    const sx = (bitmap.width - edge) / 2;
    const sy = (bitmap.height - edge) / 2;
    // Never upscale — a 64 px source stays 64 px rather than being blurred up.
    const target = Math.min(size, edge);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = target;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('That image could not be processed in this browser.');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, target, target);

    // WebP is ~30% smaller at the same quality; PNG is the universal fallback.
    const webp = canEncode('image/webp');
    const contentType = webp ? 'image/webp' : 'image/png';
    // Quality is ignored by the PNG encoder, which is lossless.
    const blob = await toBlob(canvas, contentType, 0.85);
    if (!blob) {
      throw new Error('That image could not be processed in this browser.');
    }
    return { blob, contentType, extension: webp ? 'webp' : 'png' };
  } finally {
    // Frees the decoded bitmap immediately rather than at the next GC.
    bitmap.close();
  }
}
