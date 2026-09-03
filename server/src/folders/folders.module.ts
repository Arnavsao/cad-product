import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';

/**
 * Folder tree. Folders hold no objects, so nothing here touches storage; the
 * only import is `OrganizationsModule`, for resolving a request's workspace.
 * `FoldersService` is exported because `DrawingsModule` reuses its
 * workspace-scoped lookup to validate `folderId` on create/move/import.
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [FoldersController],
  providers: [FoldersService],
  exports: [FoldersService],
})
export class FoldersModule {}
