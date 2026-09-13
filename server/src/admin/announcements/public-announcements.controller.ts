import { Controller, Get } from '@nestjs/common';
import type { PublicAnnouncementDto } from '../dto/admin-announcement.dto';
import { AnnouncementsService } from './announcements.service';

/**
 * `GET /announcements/active` — what a signed-in user should see right now.
 *
 * Outside `/admin` and outside `AdminGuard`: it is read by the app shell on
 * every load. Authenticated (no `@Public()`) because an announcement is product
 * news for people who have accounts, not marketing for the open web.
 */
@Controller('announcements')
export class PublicAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('active')
  active(): Promise<PublicAnnouncementDto[]> {
    return this.announcements.active();
  }
}
