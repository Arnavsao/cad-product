import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { InboxItemDto } from '../../../core/api/api.models';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiEmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { UiIconComponent, type UiIconName } from '../../../shared/ui/icon.component';
import { RelativeTimePipe } from '../../../shared/ui/pipes/relative-time.pipe';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { InboxService } from '../data/inbox.service';

/** Icon per notification kind — the kind is the only thing distinguishing rows at a glance. */
const KIND_ICONS: Record<InboxItemDto['kind'], UiIconName> = {
  system: 'alert',
  drawing: 'file',
  storage: 'cloud',
  account: 'user',
};

/**
 * `/dashboard/inbox` — the notification inbox.
 *
 * Design decisions:
 *  - **State lives in `InboxService`, not here.** The header badge reads the same
 *    unread count, and two sources would drift the moment one of them refetched.
 *  - **Opening a notification marks it read.** Clicking a row that has a link
 *    navigates *and* marks; clicking one without a link just marks. Requiring a
 *    separate "mark read" click for something you have visibly just read is busywork.
 *  - **No auto mark-all-on-view.** Landing on this page does not clear the badge:
 *    scrolling past something is not the same as reading it.
 */
@Component({
  selector: 'app-inbox-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiEmptyStateComponent, UiIconComponent, UiSkeletonComponent, RelativeTimePipe],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">Notifications</h1>
      @if (inbox.hasUnread()) {
        <button type="button" uiButton variant="secondary" size="sm" (click)="inbox.markAllRead()">
          <ui-icon name="check" [size]="14" />
          Mark all read
        </button>
      }
    </header>

    @if (inbox.loading()) {
      <ui-skeleton [lines]="5" height="58px" radius="var(--ui-radius-md)" />
    } @else if (inbox.error(); as message) {
      <div class="pg__error" role="alert">
        <ui-icon name="alert" [size]="18" />
        <div>
          <p class="pg__error-title">Notifications could not be loaded.</p>
          <p class="pg__error-msg">{{ message }}</p>
        </div>
        <button type="button" uiButton (click)="inbox.load()"><ui-icon name="refresh" [size]="14" /> Retry</button>
      </div>
    } @else if (inbox.isEmpty()) {
      <ui-empty-state
        icon="bell"
        heading="Nothing to catch up on"
        description="Imports, storage warnings and account updates will show up here."
      />
    } @else {
      <ul class="in__list">
        @for (item of inbox.items(); track item.id) {
          <li
            class="in__row"
            [class.in__row--unread]="!item.readAt"
            [class.in__row--link]="item.linkUrl"
            (click)="open(item)"
            (keydown.enter)="open(item)"
            (keydown.space)="open(item); $event.preventDefault()"
            [attr.tabindex]="0"
            [attr.role]="item.linkUrl ? 'link' : 'button'"
          >
            <span class="in__icon" [class.in__icon--unread]="!item.readAt">
              <ui-icon [name]="iconFor(item)" [size]="16" />
            </span>
            <div class="in__body">
              <p class="in__title">
                {{ item.title }}
                @if (!item.readAt) { <span class="in__dot" aria-label="Unread"></span> }
              </p>
              @if (item.body) { <p class="in__text">{{ item.body }}</p> }
            </div>
            <time class="in__time" [attr.datetime]="item.createdAt">{{ item.createdAt | relativeTime }}</time>
          </li>
        }
      </ul>

      @if (inbox.hasMore()) {
        <div class="in__more">
          <button type="button" uiButton variant="secondary" [loading]="inbox.loadingMore()" (click)="inbox.loadMore()">
            Load older
          </button>
        </div>
      }
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); margin-bottom: var(--ui-space-5); flex-wrap: wrap; }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .in__list {
        list-style: none; margin: 0; padding: 0;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg); overflow: hidden;
      }
      .in__row {
        display: flex; align-items: flex-start; gap: var(--ui-space-3);
        padding: 12px 14px; border-bottom: 1px solid var(--ui-border);
        cursor: default; background: var(--ui-surface);
        transition: background var(--ui-dur-fast);
      }
      .in__row:last-child { border-bottom: 0; }
      .in__row:hover { background: var(--ui-hover); }
      .in__row:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
      .in__row--link { cursor: pointer; }
      /* Unread is carried by weight + the dot, not colour alone. */
      .in__row--unread { background: var(--ui-accent-tint); }
      .in__row--unread:hover { background: var(--ui-accent-tint); }

      .in__icon {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 28px; height: 28px; border-radius: var(--ui-radius-full);
        background: var(--ui-hover); color: var(--ui-text-dim);
      }
      .in__icon--unread { background: var(--ui-accent); color: var(--ui-on-accent); }

      .in__body { flex: 1; min-width: 0; }
      .in__title {
        display: flex; align-items: center; gap: 6px;
        margin: 0; font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong);
      }
      .in__row--unread .in__title { font-weight: 650; }
      .in__dot { width: 6px; height: 6px; border-radius: var(--ui-radius-full); background: var(--ui-accent); flex: 0 0 auto; }
      .in__text { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); line-height: var(--ui-leading); }
      .in__time { flex: 0 0 auto; font-size: var(--ui-text-xs); color: var(--ui-text-dim); white-space: nowrap; padding-top: 2px; }

      .in__more { display: flex; justify-content: center; margin-top: var(--ui-space-5); }
    `,
  ],
})
export class InboxPage {
  protected readonly inbox = inject(InboxService);
  private readonly router = inject(Router);

  constructor() {
    void this.inbox.load();
  }

  protected iconFor(item: InboxItemDto): UiIconName {
    return KIND_ICONS[item.kind] ?? 'alert';
  }

  /** Mark read, then follow the link if there is one. */
  protected open(item: InboxItemDto): void {
    void this.inbox.markRead(item.id);
    if (item.linkUrl) {
      void this.router.navigateByUrl(item.linkUrl);
    }
  }
}
