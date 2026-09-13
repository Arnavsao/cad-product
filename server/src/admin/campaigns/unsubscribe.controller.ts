import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ApiException } from '../../common/errors/api-error';
import { UnsubscribeDto } from '../dto/admin-campaign.dto';
import { CampaignsService } from './campaigns.service';
import { verifyUnsubscribeToken } from './unsubscribe-token';

/** Tight: one honest click per person, and a signed token cannot be brute-forced usefully. */
const UNSUBSCRIBE_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/**
 * `POST /unsubscribe` — the link in every campaign email.
 *
 * `@Public()` because it must work from an email client for somebody who is not
 * signed in, which is the whole point of an unsubscribe link. The token is what
 * authorises it: without a signature, the address in the URL could be edited to
 * unsubscribe anybody.
 *
 * A bad token is a plain 400. It is not worth distinguishing "forged" from
 * "corrupted by a mail client that mangled the URL" — neither is actionable by
 * the person reading, and the distinction only helps somebody probing.
 */
@Controller('unsubscribe')
export class UnsubscribeController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Public()
  @Throttle(UNSUBSCRIBE_THROTTLE)
  @Post()
  @HttpCode(HttpStatus.OK)
  async unsubscribe(@Body() dto: UnsubscribeDto): Promise<{ email: string }> {
    const email = verifyUnsubscribeToken(dto.token, this.campaigns.secret);
    if (!email) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'INVALID_UNSUBSCRIBE_TOKEN', 'That unsubscribe link is not valid');
    }
    await this.campaigns.suppress(email, 'unsubscribed');
    // The address is echoed so the page can say which one was unsubscribed —
    // useful when somebody has several and does not know which we hold.
    return { email };
  }
}
