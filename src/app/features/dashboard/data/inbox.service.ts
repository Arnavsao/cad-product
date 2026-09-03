import { Injectable, computed, inject, signal } from '@angular/core';
import { InboxApiService } from '../../../core/api/inbox-api.service';
import { InboxItemDto } from '../../../core/api/api.models';
import { messageOf } from './drawings-list.store';

/** Page size for the inbox list. */
const PAGE_SIZE = 20;

/**
 * State for the notification inbox, shared by the header badge and the inbox
 * page. Root-provided on purpose (unlike `DrawingsListStore`, which is
 * component-scoped): the badge lives in the shell and must keep its count when
 * the page is not mounted, and two copies of the unread count would drift.
 *
 * Deliberately **not** named `NotificationService` — that name is already the
 * transient toast queue in `core/services/notification.service.ts`.
 */
@Injectable({ providedIn: 'root' })
export class InboxService {
  private readonly api = inject(InboxApiService);

  readonly items = signal<InboxItemDto[]>([]);
  readonly unreadCount = signal(0);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  /** True once a load failed, so the badge stops claiming a stale count. */
  readonly unavailable = signal(false);

  readonly hasMore = computed(() => this.nextCursor() !== null);
  readonly hasUnread = computed(() => this.unreadCount() > 0);
  readonly isEmpty = computed(() => !this.loading() && !this.error() && this.items().length === 0);

  /** Drops responses from a superseded request — same guard the pages use. */
  private generation = 0;

  /**
   * Refetches the first page. Safe to call on every dashboard load; failures are
   * recorded rather than thrown so the shell never breaks over the badge.
   */
  async load(): Promise<void> {
    const gen = ++this.generation;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.list({ limit: PAGE_SIZE });
      if (gen !== this.generation) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.unreadCount.set(page.unreadCount);
      this.unavailable.set(false);
    } catch (e) {
      if (gen !== this.generation) return;
      this.items.set([]);
      this.nextCursor.set(null);
      this.unreadCount.set(0);
      this.unavailable.set(true);
      this.error.set(messageOf(e));
    } finally {
      if (gen === this.generation) this.loading.set(false);
    }
  }

  /**
   * Refreshes only the unread total. Used by the shell so the badge can be
   * correct without paying for a full page of rows.
   */
  async refreshCount(): Promise<void> {
    try {
      const page = await this.api.list({ unreadOnly: true, limit: 1 });
      this.unreadCount.set(page.unreadCount);
      this.unavailable.set(false);
    } catch {
      // A badge is not worth surfacing an error for; leave the last known count.
      this.unavailable.set(true);
    }
  }

  /** Appends the next page. No-op while one is already in flight. */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const gen = this.generation;
    this.loadingMore.set(true);
    try {
      const page = await this.api.list({ limit: PAGE_SIZE, cursor });
      if (gen !== this.generation) return;
      this.items.update((current) => [...current, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.unreadCount.set(page.unreadCount);
    } catch (e) {
      if (gen === this.generation) this.error.set(messageOf(e));
    } finally {
      this.loadingMore.set(false);
    }
  }

  /**
   * Marks one item read, patching it in place.
   *
   * The count is decremented locally rather than refetched so the badge responds
   * immediately, and is floored at zero: a double-click would otherwise drive it
   * negative even though the server call is idempotent.
   */
  async markRead(id: string): Promise<void> {
    const current = this.items().find((item) => item.id === id);
    if (!current || current.readAt) return;

    // Optimistic: the row is already on screen and the server call is idempotent.
    const readAt = new Date().toISOString();
    this.patch(id, readAt);
    this.unreadCount.update((n) => Math.max(0, n - 1));

    try {
      const updated = await this.api.markRead(id);
      this.patch(id, updated.readAt);
    } catch (e) {
      // Put it back: an unread item that silently looks read is worse than an error.
      this.patch(id, null);
      this.unreadCount.update((n) => n + 1);
      this.error.set(messageOf(e));
    }
  }

  /** Marks everything read. */
  async markAllRead(): Promise<void> {
    if (!this.hasUnread()) return;
    const snapshot = this.items();
    const readAt = new Date().toISOString();
    this.items.update((items) => items.map((item) => (item.readAt ? item : { ...item, readAt })));
    this.unreadCount.set(0);

    try {
      await this.api.markAllRead();
    } catch (e) {
      this.items.set(snapshot);
      this.unreadCount.set(snapshot.filter((item) => !item.readAt).length);
      this.error.set(messageOf(e));
    }
  }

  /** Clears a surfaced error without refetching. */
  dismissError(): void {
    this.error.set(null);
  }

  private patch(id: string, readAt: string | null): void {
    this.items.update((items) => items.map((item) => (item.id === id ? { ...item, readAt } : item)));
  }
}
