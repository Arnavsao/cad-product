import { Controller, Get } from '@nestjs/common';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { flagDefinition, type FlagMap } from './flag-registry';
import type { FlagDto } from './dto/flag.dto';
import { FlagsService } from './flags.service';

/**
 * `GET /flags` — the effective switches, for the browser.
 *
 * Deliberately outside `/admin` and outside `AdminGuard`: the sign-up page has
 * to know whether sign-ups are open *before* anyone has a session, and the
 * maintenance banner shows on the marketing site. `@OptionalAuth()` rather than
 * `@Public()` for the usual reason (see `FeedbackController`) — it still
 * identifies a caller who has a token, which keeps the request logs useful.
 *
 * Flags marked `internal` in the registry publish their on/off bit but never
 * their payload, so an operational detail cannot leak through a switch that the
 * client legitimately needs to read.
 */
@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @OptionalAuth()
  @Get()
  async list(): Promise<FlagDto[]> {
    const map: FlagMap = await this.flags.all();
    return Object.values(map).map((flag) => ({
      key: flag.key,
      enabled: flag.enabled,
      payload: flagDefinition(flag.key).internal ? null : flag.payload,
    }));
  }
}
