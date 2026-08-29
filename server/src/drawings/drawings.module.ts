import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { StorageModule } from '../storage/storage.module';
import { DrawingsController } from './drawings.controller';
import { DrawingsService } from './drawings.service';
import { UploadsController } from './uploads.controller';

/**
 * Drawings, thumbnails and the upload/import flow.
 *
 * Imports `FoldersModule` for the owner-scoped folder lookup that validates
 * `folderId` on create/move/import, and `StorageModule` for the S3 client. The
 * dependency only points this way — folders know nothing about drawings — so
 * there is no module cycle.
 *
 * `UploadsController` is registered first purely for readability; both of its
 * routes are absolute (`uploads/presign`, `drawings/import`) and neither
 * collides with `DrawingsController`'s `:id` patterns.
 */
@Module({
  imports: [StorageModule, FoldersModule],
  controllers: [UploadsController, DrawingsController],
  providers: [DrawingsService],
  exports: [DrawingsService],
})
export class DrawingsModule {}
