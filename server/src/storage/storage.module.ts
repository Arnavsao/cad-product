import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Exposes the single `StorageService` (two S3 clients, one connection pool).
 * Not global on purpose: only drawings/uploads should touch object storage.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
