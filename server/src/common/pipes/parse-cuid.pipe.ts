import { ArgumentMetadata, HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ApiException } from '../errors/api-error';

/** Prisma `cuid()` v1: `c` + 24 lowercase base-36 chars. */
const CUID_RE = /^c[a-z0-9]{24}$/;

/**
 * Validates `:id` route params before they reach Prisma.
 *
 * Design: a malformed id is a client error, not a "not found" — but we still
 * answer 404 so a probe cannot distinguish "bad format" from "someone else's
 * drawing". Cheap regex, no DB round-trip.
 */
@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !CUID_RE.test(value)) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${metadata.data ?? 'id'} not found`);
    }
    return value;
  }
}

/** Reusable predicate for services that accept ids from bodies (e.g. `folderId`). */
export const isCuid = (value: unknown): value is string => typeof value === 'string' && CUID_RE.test(value);
