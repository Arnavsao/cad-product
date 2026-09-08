import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { InboxItemDto } from '../../../core/api/api.models';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
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
  selector: 'app-inbox-dropdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent, UiSkeletonComponent, RelativeTimePipe],
  template: `
    <header class="pg__head">
      <h3 class="pg__title">Notifications</h3>
      <div class="pg__head-actions">
        @if (inbox.hasUnread()) {
          <button type="button" uiButton variant="ghost" size="sm" class="mark-read-btn" (click)="inbox.markAllRead()" title="Mark all read">
            <ui-icon name="check" [size]="14" />
          </button>
        }
        <button type="button" uiButton variant="ghost" size="sm" iconOnly (click)="close.emit()" title="Close">
          <ui-icon name="close" [size]="16" />
        </button>
      </div>
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
      <div class="in__empty">
        <p class="in__empty-title">No Notifications</p>
        <p class="in__empty-desc">Helpful information about the product and your account will appear here.</p>
      </div>
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
      :host { 
        display: flex; flex-direction: column; 
        width: 320px; max-height: 400px;
        background: var(--ui-surface);
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-lg);
        box-shadow: var(--ui-shadow-panel);
        overflow-y: auto;
      }
      .pg__head { 
        display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-2); 
        padding: 12px 16px; border-bottom: 1px solid var(--ui-border);
        position: sticky; top: 0; background: var(--ui-surface); z-index: 2;
      }
      .pg__title { margin: 0; font-size: var(--ui-text-lg); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .pg__head-actions { display: flex; align-items: center; gap: 4px; }
      .mark-read-btn { color: var(--ui-text-dim); }
      .mark-read-btn:hover { color: var(--ui-text-strong); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .in__empty { padding: 24px 16px; text-align: left; }
      .in__empty-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .in__empty-desc { margin: 4px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); line-height: var(--ui-leading); }

      .in__list {
        list-style: none; margin: 0; padding: 0;
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
export class InboxDropdownComponent {
  readonly close = output<void>();

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
