import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors/api-error';
import type { Env } from '../config/env.schema';

/** Result of `headObject`. */
export interface ObjectHead {
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

/** A presigned URL plus its absolute expiry (ISO) for the client. */
export interface PresignedUrl {
  url: string;
  expiresAt: string;
}

/** Options for `presignGet`. */
export interface PresignGetOptions {
  /** Overrides the `Content-Type` S3 returns (e.g. `text/plain; charset=utf-8`). */
  responseContentType?: string;
  /** e.g. `attachment; filename="plan.dxf"` for `?download=1`. */
  responseContentDisposition?: string;
  /**
   * Pin the signature timestamp. Flooring it (e.g. to the hour) makes the URL
   * byte-stable across requests so browsers can cache thumbnails.
   */
  signingDate?: Date;
}

/** S3 DeleteObjects accepts at most 1000 keys per call. */
const DELETE_BATCH = 1000;

/** Body types accepted by `putObject`. */
export type PutBody = string | Buffer | Uint8Array;

/**
 * Thin, opinionated wrapper over the AWS S3 v3 client that works identically
 * against MinIO (dev), Cloudflare R2 and AWS S3 (prod).
 *
 * Design decisions:
 * - `requestChecksumCalculation`/`responseChecksumValidation` are pinned to
 *   `WHEN_REQUIRED`. Since SDK 3.729 the default adds `x-amz-checksum-*`
 *   headers to every PUT — including presigned ones. Browsers never send those
 *   headers, so MinIO/R2 answer `SignatureDoesNotMatch`.
 * - Two clients: `client` talks to `S3_ENDPOINT` (e.g. `http://minio:9000`
 *   inside compose) while `presignClient` signs with `S3_PUBLIC_ENDPOINT`
 *   (`http://localhost:9000`) because the `Host` header is part of the SigV4
 *   signature — a URL signed for one host is invalid on another.
 * - Missing objects surface as `null` from `headObject` and as 404
 *   `OBJECT_NOT_FOUND` from readers; everything else propagates so the
 *   exception filter turns it into a 500 with a log line.
 * - `forcePathStyle` is an env switch: MinIO wants `host/bucket/key`, AWS/R2
 *   prefer virtual-hosted style.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  readonly bucket: string;
  readonly endpoint: string;
  readonly publicEndpoint: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.publicEndpoint = config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? this.endpoint;

    const base: S3ClientConfig = {
      region: config.get('S3_REGION', { infer: true }),
      endpoint: this.endpoint,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    this.client = new S3Client(base);
    this.presignClient =
      this.publicEndpoint === this.endpoint ? this.client : new S3Client({ ...base, endpoint: this.publicEndpoint });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** Uploads a whole object. Returns the ETag when the backend reports one. */
  async putObject(key: string, body: PutBody, contentType: string, cacheControl?: string): Promise<{ etag: string | null }> {
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload,
        ContentType: contentType,
        ContentLength: payload.byteLength,
        CacheControl: cacheControl,
      }),
    );
    return { etag: res.ETag ?? null };
  }

  /**
   * Server-side copy. When `contentType` is given the metadata is REPLACED so
   * the destination gets the right type even if the source was uploaded raw
   * (browser uploads through presigned PUTs often arrive as octet-stream).
   */
  async copyObject(sourceKey: string, destinationKey: string, contentType?: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        CopySource: `${this.bucket}/${encodeKeyForCopySource(sourceKey)}`,
        ...(contentType ? { MetadataDirective: 'REPLACE', ContentType: contentType } : {}),
      }),
    );
  }

  /** Deletes one object; a missing key is not an error. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Deletes many objects in batches of 1000. Returns how many were deleted. */
  async deleteObjects(keys: string[]): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH);
      const res = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      const failed = res.Errors?.length ?? 0;
      if (failed > 0) {
        this.logger.warn(`deleteObjects: ${failed}/${batch.length} keys failed (first: ${res.Errors?.[0]?.Key})`);
      }
      deleted += batch.length - failed;
    }
    return deleted;
  }

  /** Deletes every object under `prefix`. Returns the number deleted. */
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix || prefix === '/') {
      throw new Error('deletePrefix: refusing to delete an empty prefix');
    }
    let total = 0;
    let page: string[] = [];
    for await (const key of this.listKeys(prefix)) {
      page.push(key);
      if (page.length === DELETE_BATCH) {
        total += await this.deleteObjects(page);
        page = [];
      }
    }
    if (page.length > 0) {
      total += await this.deleteObjects(page);
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Streams every key under `prefix` (paginated ListObjectsV2). */
  async *listKeys(prefix: string): AsyncGenerator<string, void, undefined> {
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) {
          yield obj.Key;
        }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }

  /** Metadata for one object, or `null` when it does not exist. */
  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
        etag: res.ETag ?? null,
        lastModified: res.LastModified ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Whole object as UTF-8 text. 404 `OBJECT_NOT_FOUND` when missing. */
  async getObjectText(key: string): Promise<string> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (await res.Body?.transformToString('utf-8')) ?? '';
    } catch (error) {
      if (isNotFound(error)) {
        throw ApiException.notFound('OBJECT_NOT_FOUND', 'Stored object not found');
      }
      throw error;
    }
  }

  /**
   * Bytes `[start, end]` (inclusive) of an object. Ranges past the end are
   * clamped by S3; a start beyond the object yields an empty buffer.
   */
  async getObjectRange(key: string, start: number, end: number): Promise<Buffer> {
    if (start < 0 || end < start) {
      throw new RangeError(`getObjectRange: invalid range ${start}-${end}`);
    }
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : Buffer.alloc(0);
    } catch (error) {
      if (isNotFound(error)) {
        throw ApiException.notFound('OBJECT_NOT_FOUND', 'Stored object not found');
      }
      if (isErrorNamed(error, 'InvalidRange') || statusOf(error) === 416) {
        return Buffer.alloc(0);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Presigning
  // ---------------------------------------------------------------------------

  /**
   * Presigned PUT for a browser-direct upload. `contentType` and
   * `contentLength` are part of the signature, so the browser must send exactly
   * those values — which is how we cap upload size without proxying bytes.
   */
  async presignPut(key: string, contentType: string, contentLength: number, ttlSec: number): Promise<PresignedUrl> {
    const signingDate = new Date();
    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      { expiresIn: ttlSec, signingDate },
    );
    return { url, expiresAt: expiresAtIso(signingDate, ttlSec) };
  }

  /** Presigned GET, optionally overriding response headers and the signing time. */
  async presignGet(key: string, ttlSec: number, options: PresignGetOptions = {}): Promise<PresignedUrl> {
    const signingDate = options.signingDate ?? new Date();
    const url = await getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: options.responseContentType,
        ResponseContentDisposition: options.responseContentDisposition,
      }),
      { expiresIn: ttlSec, signingDate },
    );
    return { url, expiresAt: expiresAtIso(signingDate, ttlSec) };
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function expiresAtIso(from: Date, ttlSec: number): string {
  return new Date(from.getTime() + ttlSec * 1000).toISOString();
}

/** `CopySource` must be URL-encoded per segment but keep `/` separators. */
function encodeKeyForCopySource(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function isErrorNamed(error: unknown, name: string): boolean {
  return (error as { name?: string })?.name === name;
}

/** S3 reports missing objects as `NoSuchKey` (GET) or `NotFound` (HEAD). */
export function isNotFound(error: unknown): boolean {
  return isErrorNamed(error, 'NoSuchKey') || isErrorNamed(error, 'NotFound') || statusOf(error) === 404;
}
