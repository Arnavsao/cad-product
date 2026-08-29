import { Module } from '@nestjs/common';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

/**
 * Folder tree. Depends only on the global `PrismaModule` — folders hold no
 * objects, so nothing here touches storage. `FoldersService` is exported
 * because `DrawingsModule` reuses its owner-scoped lookup to validate
 * `folderId` on create/move/import.
 */
@Module({
  controllers: [FoldersController],
  providers: [FoldersService],
  exports: [FoldersService],
})
export class FoldersModule {}
