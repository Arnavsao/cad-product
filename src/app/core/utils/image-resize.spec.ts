import { AVATAR_SIZE, MAX_IMAGE_BYTES, resizeToSquare } from './image-resize';

/** A real encoded PNG of the given size, so `createImageBitmap` can decode it. */
async function pngBlob(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Two bands, so a wrong crop is visible as a colour change rather than a size.
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(0, 0, width / 2, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob!;
}

/** Decodes a produced blob so its real pixel dimensions can be asserted. */
async function dimensionsOf(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height };
}

describe('resizeToSquare', () => {
  it('produces a square at the requested size from a landscape source', async () => {
    const { blob } = await resizeToSquare(await pngBlob(800, 400), 128);
    expect(await dimensionsOf(blob)).toEqual({ width: 128, height: 128 });
  });

  it('produces a square from a portrait source', async () => {
    const { blob } = await resizeToSquare(await pngBlob(300, 900), 128);
    expect(await dimensionsOf(blob)).toEqual({ width: 128, height: 128 });
  });

  it('defaults to AVATAR_SIZE', async () => {
    const { blob } = await resizeToSquare(await pngBlob(1024, 1024));
    expect(await dimensionsOf(blob)).toEqual({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  });

  it('never upscales — a source smaller than the target keeps its own edge', async () => {
    // 64px source, 256px target: blowing it up would only add blur.
    const { blob } = await resizeToSquare(await pngBlob(64, 64), 256);
    expect(await dimensionsOf(blob)).toEqual({ width: 64, height: 64 });
  });

  it('uses the shorter edge of a non-square source as the crop size', async () => {
    // 500x120 → the square is 120px, and the target is capped to it.
    const { blob } = await resizeToSquare(await pngBlob(500, 120), 256);
    expect(await dimensionsOf(blob)).toEqual({ width: 120, height: 120 });
  });

  it('reports a browser-encodable type and a matching extension', async () => {
    const { contentType, extension } = await resizeToSquare(await pngBlob(200, 200), 64);
    expect(['image/webp', 'image/png']).toContain(contentType);
    expect(contentType).toBe(`image/${extension}`);
  });

  it('shrinks a large source well below the original byte size', async () => {
    const source = await pngBlob(1200, 1200);
    const { blob } = await resizeToSquare(source, 128);
    expect(blob.size).toBeLessThan(source.size);
  });

  // ── rejections ─────────────────────────────────────────────────────────────

  it('rejects a file over the byte cap before trying to decode it', async () => {
    // Deliberately not a real image: the size check must come first, or a
    // pathological file would be decoded into memory before being refused.
    const huge = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' });
    await expectAsync(resizeToSquare(huge)).toBeRejectedWithError(/larger than/i);
  });

  it('rejects a non-image MIME type', async () => {
    const text = new Blob(['not an image'], { type: 'text/plain' });
    await expectAsync(resizeToSquare(text)).toBeRejectedWithError(/not an image/i);
  });

  it('rejects bytes that are not a decodable image', async () => {
    const corrupt = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' });
    await expectAsync(resizeToSquare(corrupt)).toBeRejectedWithError(/could not be read/i);
  });
});
