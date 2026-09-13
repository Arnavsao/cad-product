import { Module } from '@nestjs/common';
import { BillingModule } from '../billing.module';
import { QuotaService } from './quota.service';

/**
 * Plan-limit enforcement.
 *
 * Its own module, separate from the admin portal that flips the switch, so a
 * feature module can enforce limits by importing this — and does NOT end up
 * importing the whole staff portal to do it. `FlagsModule` is `@Global()`, so
 * the flag read needs no import here.
 */
@Module({
  imports: [BillingModule],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
