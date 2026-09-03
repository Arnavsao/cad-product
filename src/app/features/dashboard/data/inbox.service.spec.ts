import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InboxItemDto, InboxPageDto } from '../../../core/api/api.models';
import { InboxApiService } from '../../../core/api/inbox-api.service';
import { InboxService } from './inbox.service';

/**
 * The header badge and the inbox page read this one store, so the unread count
 * has to stay honest through optimistic updates and failures.
 */

function item(overrides: Partial<InboxItemDto> = {}): InboxItemDto {
  return {
    id: 'n1',
    kind: 'system',
    title: 'Import finished',
    body: null,
    linkUrl: null,
    readAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function page(overrides: Partial<InboxPageDto> = {}): InboxPageDto {
  return { items: [item()], nextCursor: null, unreadCount: 1, ...overrides };
}

describe('InboxService', () => {
  let api: jasmine.SpyObj<InboxApiService>;
  let service: InboxService;

  beforeEach(() => {
    api = jasmine.createSpyObj<InboxApiService>('InboxApiService', ['list', 'markRead', 'markAllRead']);
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), InboxService, { provide: InboxApiService, useValue: api }],
    });
    service = TestBed.inject(InboxService);
  });

  // ── loading ────────────────────────────────────────────────────────────────

  it('starts empty', () => {
    expect(service.items()).toEqual([]);
    expect(service.unreadCount()).toBe(0);
    expect(service.hasUnread()).toBeFalse();
  });

  it('loads a page and its unread count', async () => {
    api.list.and.resolveTo(page({ unreadCount: 4, nextCursor: 'c1' }));
    await service.load();

    expect(service.items().length).toBe(1);
    expect(service.unreadCount()).toBe(4);
    expect(service.hasMore()).toBeTrue();
    expect(service.error()).toBeNull();
  });

  it('records a load failure without throwing, so the shell still renders', async () => {
    api.list.and.rejectWith(new Error('offline'));
    await expectAsync(service.load()).toBeResolved();

    expect(service.error()).toBe('offline');
    expect(service.unavailable()).toBeTrue();
    expect(service.unreadCount()).toBe(0);
  });

  it('refreshCount swallows its own errors — a badge is not worth an error state', async () => {
    api.list.and.rejectWith(new Error('offline'));
    await expectAsync(service.refreshCount()).toBeResolved();
    expect(service.error()).toBeNull();
  });

  // ── marking read ───────────────────────────────────────────────────────────

  it('decrements the unread count when an item is read', async () => {
    api.list.and.resolveTo(page({ unreadCount: 2 }));
    await service.load();

    api.markRead.and.resolveTo(item({ readAt: '2026-09-01T11:00:00.000Z' }));
    await service.markRead('n1');

    expect(service.unreadCount()).toBe(1);
    expect(service.items()[0].readAt).toBe('2026-09-01T11:00:00.000Z');
  });

  it('does not double-decrement when the same item is read twice', async () => {
    api.list.and.resolveTo(page({ unreadCount: 1 }));
    await service.load();
    api.markRead.and.resolveTo(item({ readAt: '2026-09-01T11:00:00.000Z' }));

    await service.markRead('n1');
    await service.markRead('n1');

    expect(service.unreadCount()).toBe(0);
    expect(api.markRead).toHaveBeenCalledTimes(1);
  });

  it('floors the unread count at zero even if the server count was stale', async () => {
    api.list.and.resolveTo(page({ unreadCount: 0 }));
    await service.load();
    api.markRead.and.resolveTo(item({ readAt: '2026-09-01T11:00:00.000Z' }));

    await service.markRead('n1');
    expect(service.unreadCount()).toBe(0);
  });

  it('rolls the item back when marking read fails', async () => {
    api.list.and.resolveTo(page({ unreadCount: 1 }));
    await service.load();
    api.markRead.and.rejectWith(new Error('nope'));

    await service.markRead('n1');

    expect(service.items()[0].readAt).toBeNull();
    expect(service.unreadCount()).toBe(1);
    expect(service.error()).toBe('nope');
  });

  // ── mark all ───────────────────────────────────────────────────────────────

  it('clears the badge on mark-all-read', async () => {
    api.list.and.resolveTo(
      page({ items: [item({ id: 'a' }), item({ id: 'b' })], unreadCount: 2 }),
    );
    await service.load();
    api.markAllRead.and.resolveTo({ updated: 2 });

    await service.markAllRead();

    expect(service.unreadCount()).toBe(0);
    expect(service.items().every((i) => i.readAt)).toBeTrue();
  });

  it('restores the previous state when mark-all-read fails', async () => {
    api.list.and.resolveTo(page({ items: [item({ id: 'a' }), item({ id: 'b', readAt: 'x' })], unreadCount: 1 }));
    await service.load();
    api.markAllRead.and.rejectWith(new Error('boom'));

    await service.markAllRead();

    expect(service.unreadCount()).toBe(1);
    expect(service.items()[0].readAt).toBeNull();
    expect(service.items()[1].readAt).toBe('x');
  });

  it('does nothing when there is nothing unread', async () => {
    api.list.and.resolveTo(page({ items: [item({ readAt: 'x' })], unreadCount: 0 }));
    await service.load();

    await service.markAllRead();
    expect(api.markAllRead).not.toHaveBeenCalled();
  });
});
