import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import { InboxItemDto, InboxPageDto, MarkAllReadDto } from './api.models';

/** Query for a page of the inbox. */
export interface InboxListQuery {
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string | null;
}

/**
 * Promise-returning client for `/notifications` (the in-app inbox).
 *
 * Named "inbox" rather than "notifications" to keep it clearly distinct from
 * `NotificationService`, which is the transient toast queue.
 *
 * Codes worth branching on: 400 `INVALID_CURSOR` (a stale `nextCursor`) and
 * 404 `NOTIFICATION_NOT_FOUND` (someone else's id, or one already deleted).
 */
@Injectable({ providedIn: 'root' })
export class InboxApiService {
  private readonly api = inject(HttpManagerService);

  /** `GET /notifications` — newest first, with the unread total for the badge. */
  list(query: InboxListQuery = {}): Promise<InboxPageDto> {
    return firstValueFrom(
      this.api.get<InboxPageDto>('notifications', {
        params: {
          unreadOnly: query.unreadOnly ? true : undefined,
          limit: query.limit ?? undefined,
          cursor: query.cursor ?? undefined,
        },
      }),
    );
  }

  /** `PATCH /notifications/:id/read` — idempotent. */
  markRead(id: string): Promise<InboxItemDto> {
    return firstValueFrom(this.api.patch<InboxItemDto>(`notifications/${encodeURIComponent(id)}/read`, {}));
  }

  /** `POST /notifications/read-all` — returns how many rows changed. */
  markAllRead(): Promise<MarkAllReadDto> {
    return firstValueFrom(this.api.post<MarkAllReadDto>('notifications/read-all', {}));
  }
}
