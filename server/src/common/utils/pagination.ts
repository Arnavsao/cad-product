import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../errors/api-error';

/** Wire shape of a paginated list (plan §1 `Page<T>`). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Opaque keyset cursor. We encode the sort key + id of the last row rather
 * than an offset so that concurrent inserts/deletes never skip or duplicate
 * rows between pages, and so the DB can use the `(ownerId, <sort>)` indexes.
 */
export interface KeysetCursor {
  /** ISO timestamp or string sort key of the last row on the previous page. */
  k: string;
  /** Row id of the last row on the previous page (tie-breaker). */
  id: string;
}

const CURSOR_ENCODING: BufferEncoding = 'base64url';

/** Serialises a cursor to a URL-safe string. */
export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString(CURSOR_ENCODING);
}

/**
 * Parses a cursor; `undefined`/empty → `null` (first page). A garbage cursor
 * is a 400 `INVALID_CURSOR`, never a 500.
 */
export function decodeCursor(raw: string | undefined | null): KeysetCursor | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(raw, CURSOR_ENCODING).toString('utf8')) as Partial<KeysetCursor>;
    if (typeof parsed?.k !== 'string' || typeof parsed?.id !== 'string') {
      throw new Error('shape');
    }
    return { k: parsed.k, id: parsed.id };
  } catch {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'Malformed pagination cursor');
  }
}

/**
 * Clamps a requested page size into `[1, max]`, defaulting when absent.
 * Prisma `take` is `limit + 1` so we can tell whether a next page exists
 * without a second COUNT query.
 */
export function clampLimit(limit: number | undefined, defaultLimit = 30, max = 100): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return defaultLimit;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

/**
 * Builds a `Page<T>` from a `limit + 1` result set.
 *
 * @param rows        Up to `limit + 1` rows fetched in sort order.
 * @param limit       The page size requested.
 * @param cursorOf    Extracts the keyset cursor from the LAST row kept.
 * @param map         Optional row → DTO mapper.
 */
export function paginate<Row, Dto = Row>(
  rows: Row[],
  limit: number,
  cursorOf: (row: Row) => KeysetCursor,
  map: (row: Row) => Dto = (row) => row as unknown as Dto,
): Page<Dto> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return {
    items: kept.map(map),
    nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}
