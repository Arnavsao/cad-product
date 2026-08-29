import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users + `/me`. Imports `AuthModule` for the Clerk Backend client; the
 * auth guard (in `AppModule`) depends on `UsersService`, so the dependency
 * points this way and never back.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
