/**
 * Cheap structural check that a payload is a DXF text file: the first 8 KB
 * must contain a `SECTION` group and the last 64 bytes must contain `EOF`.
 *
 * Design: full DXF parsing on the server would duplicate the browser importer
 * and cost CPU on every save; this sniff rejects the common failure modes
 * (HTML error pages, JSON, truncated uploads, binary DWG) in O(1) memory. The
 * same function serves inline saves (string) and range-read imports (Buffer).
 */
export function looksLikeDxf(payload: string | Buffer | Uint8Array): boolean {
  if (payload == null) {
    return false;
  }
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  if (buf.length < 8) {
    return false;
  }
  const head = buf.subarray(0, Math.min(buf.length, HEAD_BYTES)).toString('latin1');
  if (!head.includes('SECTION')) {
    return false;
  }
  const tail = buf.subarray(Math.max(0, buf.length - TAIL_BYTES)).toString('latin1');
  return tail.includes('EOF');
}

/** Bytes inspected at the start of the payload. */
export const HEAD_BYTES = 8 * 1024;
/** Bytes inspected at the end of the payload. */
export const TAIL_BYTES = 64;

/**
 * Variant for two separately fetched ranges (import path: `getObjectRange`
 * head + tail without downloading a 50 MB file).
 */
export function looksLikeDxfRanges(head: Buffer | Uint8Array, tail: Buffer | Uint8Array): boolean {
  return (
    Buffer.from(head).toString('latin1').includes('SECTION') && Buffer.from(tail).toString('latin1').includes('EOF')
  );
}
