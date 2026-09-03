import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import {
  ListNotificationsDto,
  type MarkAllReadDto,
  type NotificationDto,
  type NotificationPageDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/** `/notifications` — the signed-in user's in-app inbox. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** `GET /notifications` → `NotificationPageDto` (page + `unreadCount`); 400 INVALID_CURSOR. */
  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: ListNotificationsDto): Promise<NotificationPageDto> {
    return this.notifications.list(userId, query);
  }

  /** `PATCH /notifications/:id/read` → `NotificationDto`; idempotent, 404 NOTIFICATION_NOT_FOUND. */
  @Patch(':id/read')
  markRead(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<NotificationDto> {
    return this.notifications.markRead(userId, id);
  }

  /** `POST /notifications/read-all` → `{ updated }`. */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser('id') userId: string): Promise<MarkAllReadDto> {
    return this.notifications.markAllRead(userId);
  }
}
