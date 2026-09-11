import { A11yModule } from '@angular/cdk/a11y';
import { LocaleDatePipe } from '../../../shared/ui/pipes/locale-date.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  AccessLevel,
  MAX_LINK_EMAIL_MESSAGE,
  MAX_LINK_EMAIL_RECIPIENTS,
  ShareDto,
  ShareLinkDto,
  ShareLinkExpiry,
  SharePermission,
  SharesDto,
} from '../../../core/api/api.models';
import { DrawingsApiService } from '../../../core/api/drawings-api.service';
import { FoldersApiService } from '../../../core/api/folders-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { ApiError } from '../../../core/services/http-manager.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UI_DIALOG_DATA, UiDialogRef } from '../../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';

export interface ShareDialogData {
  kind: 'drawing' | 'folder';
  id: string;
  name: string;
  /** The workspace the item lives in — that org cannot also be a share target. */
  organizationId: string | null;
}

/** Expiries offered for a new link; the label key is resolved per language. */
const EXPIRIES: readonly { value: string; days: ShareLinkExpiry; labelKey: string }[] = [
  { value: '7', days: 7, labelKey: 'dashboard.components.share.expiryDays' },
  { value: '30', days: 30, labelKey: 'dashboard.components.share.expiryDays' },
  { value: '90', days: 90, labelKey: 'dashboard.components.share.expiryDays' },
  { value: 'never', days: null, labelKey: 'dashboard.components.share.expiryNever' },
];

/** Deliberately loose: the server is the authority on address validity. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * "Share" for a drawing or a folder: people, organizations and (for drawings)
 * revocable links.
 *
 * Design decisions:
 *
 * - **One dialog for both kinds.** The share model is identical apart from
 *   links, so `kind` picks the API client and hides the Link block rather than
 *   duplicating 300 lines. A folder share covers its subtree, which the dialog
 *   says out loud — that is the one thing a user cannot guess.
 *
 * - **Every mutation is applied to the loaded lists, not re-fetched.** The
 *   response of a PUT is the new `ShareDto`, so a permission change is one
 *   request and no flicker. `changed` is remembered so the caller can refresh
 *   the row's share badge exactly once, on close.
 *
 * - **The failures live beside the control that caused them.** `SHARE_SELF`,
 *   `SHARE_SAME_ORG` and `ORG_NOT_FOUND` are all mistakes a person fixes by
 *   editing the field in front of them, so they render inline; a storage or
 *   network failure is not, and toasts instead.
 *
 * - **The link URL is built from `location.origin`.** The API deliberately
 *   returns only a token: the same deployment is reached on different hosts
 *   (localhost, staging, production) and only the browser knows which one the
 *   user is actually on. The one exception is **Email** on a link, where the
 *   server builds the URL itself from `APP_BASE_URL` — a link inside an email
 *   is read outside the browser that created it, so the client's origin is not
 *   the right authority there.
 */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, A11yModule, LocaleDatePipe, UiButtonDirective, UiIconComponent, UiInputDirective, UiSkeletonComponent],
  template: `
    <div class="ui-dialog sh" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus *transloco="let t">
      <header class="ui-dialog__header">
        <h2 [id]="titleId">
          {{ t('dashboard.components.share.title', { name: data.name }) }}
          @if (access(); as level) {
            <span class="sh__access" [title]="t('dashboard.components.share.yourAccess', { level: t('dashboard.components.share.accessLevel.' + level) })">
              {{ t('dashboard.components.share.accessLevel.' + level) }}
            </span>
          }
        </h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly [attr.aria-label]="t('dashboard.components.close')" (click)="close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body sh__body">
        @if (loading()) {
          <ui-skeleton [lines]="4" height="34px" />
        } @else if (loadError(); as message) {
          <p class="sh__error" role="alert">{{ message }}</p>
          <button type="button" uiButton size="sm" (click)="reload()"><ui-icon name="refresh" [size]="14" /> {{ t('common.retry') }}</button>
        } @else {
          @if (isFolder) {
            <p class="sh__note">{{ t('dashboard.components.share.folderNote') }}</p>
          }

          <!-- ── people ──────────────────────────────────────────────────── -->
          <h3 class="sh__h3">{{ t('dashboard.components.share.people') }}</h3>
          @if (!people().length) {
            <p class="sh__muted">{{ t('dashboard.components.share.noPeople') }}</p>
          } @else {
            <ul class="sh__list">
              @for (share of people(); track share.id) {
                <li class="sh__row">
                  <span class="sh__avatar" aria-hidden="true">
                    @if (share.targetUser?.imageUrl) {
                      <img [src]="share.targetUser?.imageUrl" alt="" loading="lazy" decoding="async" />
                    } @else {
                      {{ initialsOf(share) }}
                    }
                  </span>
                  <span class="sh__who">
                    <span class="sh__who-name">{{ nameOf(share) }}</span>
                    <span class="sh__who-sub">
                      {{ share.targetEmail }}
                      @if (share.expiresAt) {
                        · {{ t('dashboard.components.share.until', { date: (share.expiresAt | localeDate: 'mediumDate') }) }}
                      }
                    </span>
                  </span>
                  <select
                    uiInput
                    class="sh__perm"
                    [attr.aria-label]="t('dashboard.components.share.permissionFor', { target: share.targetEmail })"
                    [value]="share.permission"
                    [disabled]="busy() === share.id"
                    (change)="onPermission(share, $event)"
                  >
                    <option value="view">{{ t('dashboard.components.share.canView') }}</option>
                    <option value="edit">{{ t('dashboard.components.share.canEdit') }}</option>
                  </select>
                  <button
                    type="button"
                    uiButton
                    variant="ghost"
                    size="sm"
                    iconOnly
                    [attr.aria-label]="t('dashboard.components.share.stopSharingWith', { target: share.targetEmail })"
                    [disabled]="busy() === share.id"
                    (click)="remove(share)"
                  >
                    <ui-icon name="close" [size]="14" />
                  </button>
                </li>
              }
            </ul>
          }

          <form class="sh__add" (submit)="addPerson($event)">
            <input
              uiInput
              type="email"
              class="sh__add-input"
              placeholder="name@company.com"
              autocomplete="off"
              [attr.aria-label]="t('dashboard.components.share.emailAria')"
              [value]="email()"
              [invalid]="!!emailError()"
              [disabled]="busy() === 'person'"
              (input)="onEmail($event)"
            />
            <select
              uiInput
              class="sh__perm"
              [attr.aria-label]="t('dashboard.components.share.permission')"
              [value]="emailPermission()"
              [disabled]="busy() === 'person'"
              (change)="emailPermission.set(permissionOf($event))"
            >
              <option value="view">{{ t('dashboard.components.share.canView') }}</option>
              <option value="edit">{{ t('dashboard.components.share.canEdit') }}</option>
            </select>
            <button
              type="submit"
              uiButton
              variant="primary"
              [loading]="busy() === 'person'"
              [disabled]="!emailValid() || busy() === 'person'"
            >
              {{ t('dashboard.components.share.share') }}
            </button>
          </form>
          @if (emailError(); as message) {
            <p class="sh__error" role="alert">{{ message }}</p>
          }

          <!-- ── organizations ───────────────────────────────────────────── -->
          <h3 class="sh__h3">{{ t('dashboard.components.share.organizations') }}</h3>
          @if (orgShares().length) {
            <ul class="sh__list">
              @for (share of orgShares(); track share.id) {
                <li class="sh__row">
                  <span class="sh__avatar sh__avatar--org" aria-hidden="true"><ui-icon name="building" [size]="14" /></span>
                  <span class="sh__who">
                    <span class="sh__who-name">{{ share.targetOrganization?.name }}</span>
                    <span class="sh__who-sub">
                      {{ t('dashboard.components.share.everyMember') }}
                      @if (share.expiresAt) {
                        · {{ t('dashboard.components.share.until', { date: (share.expiresAt | localeDate: 'mediumDate') }) }}
                      }
                    </span>
                  </span>
                  <select
                    uiInput
                    class="sh__perm"
                    [attr.aria-label]="t('dashboard.components.share.permissionFor', { target: share.targetOrganization?.name })"
                    [value]="share.permission"
                    [disabled]="busy() === share.id"
                    (change)="onPermission(share, $event)"
                  >
                    <option value="view">{{ t('dashboard.components.share.canView') }}</option>
                    <option value="edit">{{ t('dashboard.components.share.canEdit') }}</option>
                  </select>
                  <button
                    type="button"
                    uiButton
                    variant="ghost"
                    size="sm"
                    iconOnly
                    [attr.aria-label]="t('dashboard.components.share.stopSharingWith', { target: share.targetOrganization?.name })"
                    [disabled]="busy() === share.id"
                    (click)="remove(share)"
                  >
                    <ui-icon name="close" [size]="14" />
                  </button>
                </li>
              }
            </ul>
          }
          @if (shareableOrgs().length) {
            <form class="sh__add" (submit)="addOrg($event)">
              <select
                uiInput
                class="sh__add-input"
                [attr.aria-label]="t('dashboard.components.share.orgAria')"
                [value]="orgId()"
                [disabled]="busy() === 'org'"
                (change)="onOrg($event)"
              >
                <option value="">{{ t('dashboard.components.share.chooseOrg') }}</option>
                @for (org of shareableOrgs(); track org.id) {
                  <option [value]="org.id">{{ org.name }}</option>
                }
              </select>
              <select
                uiInput
                class="sh__perm"
                [attr.aria-label]="t('dashboard.components.share.permission')"
                [value]="orgPermission()"
                [disabled]="busy() === 'org'"
                (change)="orgPermission.set(permissionOf($event))"
              >
                <option value="view">{{ t('dashboard.components.share.canView') }}</option>
                <option value="edit">{{ t('dashboard.components.share.canEdit') }}</option>
              </select>
              <button
                type="submit"
                uiButton
                variant="primary"
                [loading]="busy() === 'org'"
                [disabled]="!orgId() || busy() === 'org'"
              >
                {{ t('dashboard.components.share.share') }}
              </button>
            </form>
          } @else {
            <p class="sh__muted">{{ t('dashboard.components.share.noOtherOrg') }}</p>
          }
          @if (orgError(); as message) {
            <p class="sh__error" role="alert">{{ message }}</p>
          }

          <!-- ── links (drawings only) ───────────────────────────────────── -->
          @if (!isFolder) {
            <h3 class="sh__h3">{{ t('dashboard.components.share.link') }}</h3>
            @if (!links().length) {
              <p class="sh__muted">{{ t('dashboard.components.share.noLink') }}</p>
            } @else {
              <ul class="sh__list">
                @for (link of links(); track link.id) {
                  <li class="sh__row">
                    <span class="sh__avatar sh__avatar--org" aria-hidden="true"><ui-icon name="link" [size]="14" /></span>
                    <span class="sh__who">
                      <span class="sh__who-name">
                        {{ t(link.permission === 'edit' ? 'dashboard.components.share.linkCanEdit' : 'dashboard.components.share.linkCanView') }}
                      </span>
                      <span class="sh__who-sub">
                        @if (link.expiresAt) {
                          {{ t('dashboard.components.share.expires', { date: (link.expiresAt | localeDate: 'mediumDate') }) }}
                        } @else {
                          {{ t('dashboard.components.share.neverExpires') }}
                        }
                      </span>
                    </span>
                    <button type="button" uiButton size="sm" (click)="copyLink(link)">
                      <ui-icon name="copy" [size]="14" />
                      {{ t('dashboard.components.share.copyLink') }}
                    </button>
                    <button
                      type="button"
                      uiButton
                      variant="ghost"
                      size="sm"
                      [attr.aria-expanded]="emailingLinkId() === link.id"
                      [attr.aria-label]="t('dashboard.components.share.emailLink')"
                      (click)="toggleEmailForm(link)"
                    >
                      <ui-icon name="mail" [size]="14" />
                      {{ t('common.email') }}
                    </button>
                    <button
                      type="button"
                      uiButton
                      variant="ghost"
                      size="sm"
                      [disabled]="busy() === link.id"
                      (click)="revokeLink(link)"
                    >
                      {{ t('dashboard.components.share.revoke') }}
                    </button>
                  </li>
                  @if (emailingLinkId() === link.id) {
                    <li class="sh__mail">
                      <form (submit)="sendLinkEmail(link, $event)">
                        <input
                          uiInput
                          type="text"
                          class="sh__mail-to"
                          placeholder="name@company.com, someone@else.com"
                          autocomplete="off"
                          [attr.aria-label]="t('dashboard.components.share.mailToAria')"
                          [value]="mailTo()"
                          [invalid]="!!mailError()"
                          [disabled]="busy() === 'mail'"
                          (input)="onMailTo($event)"
                        />
                        <textarea
                          uiInput
                          class="sh__mail-note"
                          rows="2"
                          [placeholder]="t('dashboard.components.share.mailMessagePlaceholder')"
                          [attr.aria-label]="t('dashboard.components.share.mailMessageAria')"
                          [attr.maxlength]="maxMessage"
                          [value]="mailMessage()"
                          [disabled]="busy() === 'mail'"
                          (input)="mailMessage.set(textValue($event))"
                        ></textarea>
                        <div class="sh__mail-actions">
                          <span class="sh__mail-hint">
                            {{ t('dashboard.components.share.mailHint', { max: maxRecipients }) }}
                          </span>
                          <button
                            type="submit"
                            uiButton
                            variant="primary"
                            size="sm"
                            [loading]="busy() === 'mail'"
                            [disabled]="!mailValid() || busy() === 'mail'"
                          >
                            {{ t('dashboard.components.share.send') }}
                          </button>
                        </div>
                      </form>
                      @if (mailError(); as message) {
                        <p class="sh__error" role="alert">{{ message }}</p>
                      }
                    </li>
                  }
                }
              </ul>
            }

            <form class="sh__add" (submit)="createLink($event)">
              <select
                uiInput
                class="sh__perm"
                [attr.aria-label]="t('dashboard.components.share.linkPermission')"
                [value]="linkPermission()"
                [disabled]="busy() === 'link'"
                (change)="linkPermission.set(permissionOf($event))"
              >
                <option value="view">{{ t('dashboard.components.share.canView') }}</option>
                <option value="edit">{{ t('dashboard.components.share.canEdit') }}</option>
              </select>
              <select
                uiInput
                class="sh__perm"
                [attr.aria-label]="t('dashboard.components.share.linkExpiry')"
                [value]="linkExpiry()"
                [disabled]="busy() === 'link'"
                (change)="onExpiry($event)"
              >
                @for (option of expiries; track option.value) {
                  <option [value]="option.value">{{ t(option.labelKey, { count: option.days }) }}</option>
                }
              </select>
              <button type="submit" uiButton [loading]="busy() === 'link'" [disabled]="busy() === 'link'">
                <ui-icon name="link" [size]="14" />
                {{ t('dashboard.components.share.createLink') }}
              </button>
            </form>
          }
        }
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" (click)="close()">{{ t('dashboard.components.done') }}</button>
      </footer>
    </div>
  `,
  styles: [
    `
      .sh { width: 560px; max-width: 100%; }
      .sh__body { max-height: 62vh; }

      .sh__access {
        margin-left: var(--ui-space-2); padding: 1px 8px;
        font-size: var(--ui-text-xs); font-weight: 600; text-transform: capitalize;
        color: var(--ui-accent); background: var(--ui-accent-tint);
        border-radius: var(--ui-radius-full); vertical-align: middle;
      }
      .sh__h3 {
        margin: var(--ui-space-5) 0 var(--ui-space-2);
        font-size: var(--ui-text-sm); font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .sh__h3:first-of-type { margin-top: 0; }
      .sh__note {
        margin: 0 0 var(--ui-space-4); padding: 8px 10px;
        font-size: var(--ui-text-sm); color: var(--ui-text-dim);
        background: var(--ui-hover); border-radius: var(--ui-radius-md);
      }
      .sh__muted { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .sh__error { margin: var(--ui-space-2) 0 0; font-size: var(--ui-text-sm); color: var(--ui-danger); }

      .sh__list { list-style: none; margin: 0; padding: 0; }
      .sh__row {
        display: flex; align-items: center; gap: var(--ui-space-2);
        padding: 8px 0; border-bottom: 1px solid var(--ui-border);
      }
      .sh__row:last-child { border-bottom: 0; }

      .sh__avatar {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 28px; height: 28px; overflow: hidden;
        border-radius: var(--ui-radius-full);
        background: var(--ui-accent-tint); color: var(--ui-accent);
        font-size: var(--ui-text-xs); font-weight: 700;
      }
      .sh__avatar img { width: 100%; height: 100%; object-fit: cover; }
      .sh__avatar--org { background: var(--ui-hover); color: var(--ui-text-dim); }

      .sh__who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .sh__who-name {
        font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sh__who-sub {
        font-size: var(--ui-text-sm); color: var(--ui-text-dim);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sh__perm { flex: 0 0 auto; width: auto; min-width: 104px; }

      .sh__add {
        display: flex; align-items: center; gap: var(--ui-space-2);
        margin-top: var(--ui-space-3); flex-wrap: wrap;
      }
      .sh__add-input { flex: 1 1 200px; min-width: 0; width: auto; }

      .sh__mail {
        list-style: none;
        padding: var(--ui-space-3) 0 var(--ui-space-4);
        border-bottom: 1px solid var(--ui-border);
      }
      .sh__mail:last-child { border-bottom: 0; }
      .sh__mail form { display: grid; gap: var(--ui-space-2); }
      .sh__mail-to { width: 100%; }
      .sh__mail-note { width: 100%; resize: vertical; min-height: 52px; }
      .sh__mail-actions {
        display: flex; align-items: center; justify-content: space-between;
        gap: var(--ui-space-3); flex-wrap: wrap;
      }
      .sh__mail-hint { font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      @media (max-width: 620px) {
        .sh { width: auto; }
        .sh__perm { min-width: 92px; }
      }
    `,
  ],
})
export class ShareDialogComponent {
  protected readonly data = inject(UI_DIALOG_DATA) as ShareDialogData;
  /** Resolves `true` when anything changed, so the caller can refresh its row. */
  protected readonly ref = inject(UiDialogRef) as UiDialogRef<boolean>;

  private readonly drawings = inject(DrawingsApiService);
  private readonly folders = inject(FoldersApiService);
  private readonly workspace = inject(WorkspaceService);
  private readonly notify = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly titleId = `share-title-${++seq}`;
  protected readonly isFolder = this.data.kind === 'folder';
  protected readonly expiries = EXPIRIES;

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  /** Id (a share id, a link id, or a form name) with a request in flight. */
  protected readonly busy = signal<string | null>(null);
  protected readonly access = signal<AccessLevel | null>(null);
  protected readonly shares = signal<ShareDto[]>([]);
  protected readonly links = signal<ShareLinkDto[]>([]);

  protected readonly email = signal('');
  protected readonly emailPermission = signal<SharePermission>('view');
  protected readonly emailError = signal<string | null>(null);
  protected readonly emailValid = computed(() => EMAIL_RE.test(this.email().trim()));

  protected readonly orgId = signal('');
  protected readonly orgPermission = signal<SharePermission>('view');
  protected readonly orgError = signal<string | null>(null);

  protected readonly linkPermission = signal<SharePermission>('view');
  protected readonly linkExpiry = signal('30');

  protected readonly maxRecipients = MAX_LINK_EMAIL_RECIPIENTS;
  protected readonly maxMessage = MAX_LINK_EMAIL_MESSAGE;
  /** Id of the link whose email form is open, or null when none is. */
  protected readonly emailingLinkId = signal<string | null>(null);
  protected readonly mailTo = signal('');
  protected readonly mailMessage = signal('');
  protected readonly mailError = signal<string | null>(null);
  /** Enabled once every parsed address looks like one, and there are not too many. */
  protected readonly mailValid = computed(() => {
    const parsed = parseAddresses(this.mailTo());
    return parsed.length > 0 && parsed.length <= MAX_LINK_EMAIL_RECIPIENTS && parsed.every((a) => EMAIL_RE.test(a));
  });

  protected readonly people = computed(() => this.shares().filter((s) => !!s.targetEmail));
  protected readonly orgShares = computed(() => this.shares().filter((s) => !!s.targetOrganization));

  /**
   * Orgs the caller belongs to, minus the one the item already lives in (the
   * server refuses that with 422 `SHARE_SAME_ORG`) and minus the ones it is
   * already shared with.
   */
  protected readonly shareableOrgs = computed(() => {
    const taken = new Set(this.orgShares().map((s) => s.targetOrganization?.id));
    return this.workspace
      .organizations()
      .filter((org) => org.id !== this.data.organizationId && !taken.has(org.id));
  });

  private changed = false;

  constructor() {
    void this.reload();
  }

  protected close(): void {
    this.ref.close(this.changed);
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const result: SharesDto = this.isFolder
        ? await this.folders.shares(this.data.id)
        : await this.drawings.shares(this.data.id);
      this.access.set(result.access);
      this.shares.set(result.shares ?? []);
      this.links.set(result.links ?? []);
    } catch (e) {
      this.loadError.set(e instanceof Error && e.message ? e.message : this.t('dashboard.components.share.loadFailed'));
    } finally {
      this.loading.set(false);
    }
  }

  // ── display helpers ───────────────────────────────────────────────────────

  protected nameOf(share: ShareDto): string {
    const user = share.targetUser;
    const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    return full || share.targetEmail || this.t('dashboard.components.unknownUser');
  }

  protected initialsOf(share: ShareDto): string {
    const user = share.targetUser;
    const parts = [user?.firstName, user?.lastName].filter((p): p is string => !!p);
    if (parts.length) return parts.map((p) => p[0]!.toUpperCase()).join('');
    return share.targetEmail?.[0]?.toUpperCase() ?? '?';
  }

  protected permissionOf(event: Event): SharePermission {
    return (event.target as HTMLSelectElement).value === 'edit' ? 'edit' : 'view';
  }

  protected onEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
    this.emailError.set(null);
  }

  protected onOrg(event: Event): void {
    this.orgId.set((event.target as HTMLSelectElement).value);
    this.orgError.set(null);
  }

  protected onExpiry(event: Event): void {
    this.linkExpiry.set((event.target as HTMLSelectElement).value);
  }

  protected textValue(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  protected onMailTo(event: Event): void {
    this.mailTo.set((event.target as HTMLInputElement).value);
    this.mailError.set(null);
  }

  // ── mutations ─────────────────────────────────────────────────────────────

  protected async addPerson(event: Event): Promise<void> {
    event.preventDefault();
    const email = this.email().trim();
    if (!this.emailValid() || this.busy()) return;
    this.busy.set('person');
    this.emailError.set(null);
    try {
      const share = await this.upsert({ email, permission: this.emailPermission() });
      this.mergeShare(share);
      this.email.set('');
      this.notify.success(this.t('dashboard.components.share.sharedWith', { email }));
    } catch (e) {
      this.emailError.set(this.shareMessage(e, 'dashboard.components.share.shareFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  protected async addOrg(event: Event): Promise<void> {
    event.preventDefault();
    const organizationId = this.orgId();
    if (!organizationId || this.busy()) return;
    this.busy.set('org');
    this.orgError.set(null);
    try {
      const share = await this.upsert({ organizationId, permission: this.orgPermission() });
      this.mergeShare(share);
      this.orgId.set('');
      this.notify.success(this.t('dashboard.components.share.sharedWithOrg'));
    } catch (e) {
      this.orgError.set(this.shareMessage(e, 'dashboard.components.share.shareOrgFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  protected async onPermission(share: ShareDto, event: Event): Promise<void> {
    const permission = this.permissionOf(event);
    if (permission === share.permission || this.busy()) return;
    this.busy.set(share.id);
    try {
      const updated = await this.upsert(
        share.targetOrganization
          ? { organizationId: share.targetOrganization.id, permission }
          : { email: share.targetEmail ?? '', permission },
      );
      this.mergeShare(updated);
    } catch (e) {
      // The select still shows the failed value, so put it back.
      (event.target as HTMLSelectElement).value = share.permission;
      this.notify.error(this.shareMessage(e, 'dashboard.components.share.permissionFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(share: ShareDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(share.id);
    try {
      if (this.isFolder) await this.folders.removeShare(this.data.id, share.id);
      else await this.drawings.removeShare(this.data.id, share.id);
      this.shares.update((list) => list.filter((s) => s.id !== share.id));
      this.changed = true;
    } catch (e) {
      this.notify.error(this.shareMessage(e, 'dashboard.components.share.removeFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  protected async createLink(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const expiry = EXPIRIES.find((o) => o.value === this.linkExpiry()) ?? EXPIRIES[1];
    this.busy.set('link');
    try {
      const link = await this.drawings.createLink(this.data.id, {
        permission: this.linkPermission(),
        expiresInDays: expiry.days,
      });
      this.links.update((list) => [link, ...list]);
      this.changed = true;
      await this.copyLink(link);
    } catch (e) {
      this.notify.error(this.shareMessage(e, 'dashboard.components.share.linkCreateFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  protected async revokeLink(link: ShareLinkDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(link.id);
    try {
      await this.drawings.revokeLink(this.data.id, link.id);
      this.links.update((list) => list.filter((l) => l.id !== link.id));
      this.changed = true;
      this.notify.success(this.t('dashboard.components.share.linkRevoked'));
    } catch (e) {
      this.notify.error(this.shareMessage(e, 'dashboard.components.share.linkRevokeFailed'));
    } finally {
      this.busy.set(null);
    }
  }

  /**
   * Opens the email form under one link, or closes it if it was already open.
   *
   * One form at a time, reusing a single set of signals: two links open at once
   * would need per-link state for a control almost nobody uses twice in a row,
   * and switching links clears the draft so a note written for one link cannot
   * be sent with another.
   */
  protected toggleEmailForm(link: ShareLinkDto): void {
    const open = this.emailingLinkId() === link.id;
    this.emailingLinkId.set(open ? null : link.id);
    this.mailTo.set('');
    this.mailMessage.set('');
    this.mailError.set(null);
  }

  /**
   * `POST /drawings/:id/links/:linkId/email`.
   *
   * Addresses are parsed from a single comma-separated field rather than a chip
   * editor: this is a low-frequency action, and pasting a list from elsewhere
   * is the common case. The server is the authority on validity — the local
   * check only decides whether Send is enabled.
   */
  protected async sendLinkEmail(link: ShareLinkDto, event: Event): Promise<void> {
    event.preventDefault();
    if (!this.mailValid() || this.busy()) return;
    const emails = parseAddresses(this.mailTo());
    const message = this.mailMessage().trim();
    this.busy.set('mail');
    this.mailError.set(null);
    try {
      const { sent } = await this.drawings.emailLink(this.data.id, link.id, {
        emails,
        ...(message ? { message } : {}),
      });
      this.emailingLinkId.set(null);
      this.mailTo.set('');
      this.mailMessage.set('');
      this.notify.success(sent === 1 ? this.t('dashboard.components.share.linkEmailedOne') : this.t('dashboard.components.share.linkEmailedOther', { count: sent }));
    } catch (e) {
      this.mailError.set(this.linkEmailMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  protected async copyLink(link: ShareLinkDto): Promise<void> {
    const url = `${location.origin}/shared/${link.token}`;
    try {
      await navigator.clipboard.writeText(url);
      this.notify.success(this.t('dashboard.components.share.linkCopied'));
    } catch {
      // Clipboard access can be denied outright; showing the URL is the fallback.
      this.notify.info(url, 10000);
    }
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  /** The refusals the email-a-link form can produce, worded for the person. */
  private linkEmailMessage(e: unknown): string {
    if (e instanceof ApiError) {
      switch (e.code) {
        case 'LINK_INVALID':
          return this.t('dashboard.components.share.linkInvalid');
        case 'VALIDATION_ERROR':
          return this.t('dashboard.components.share.mailValidation', { max: MAX_LINK_EMAIL_RECIPIENTS });
        default:
          break;
      }
      if (e.status === 429) {
        return this.t('dashboard.components.share.mailRateLimited');
      }
    }
    return e instanceof Error && e.message ? e.message : this.t('dashboard.components.share.linkEmailFailed');
  }

  /** The four sharing refusals a person can act on get their own wording; `fallbackKey` covers the rest. */
  private shareMessage(e: unknown, fallbackKey: string): string {
    if (e instanceof ApiError) {
      switch (e.code) {
        case 'SHARE_SELF':
          return this.t('dashboard.components.share.errSelf');
        case 'SHARE_SAME_ORG':
          return this.t('dashboard.components.share.errSameOrg');
        case 'ORG_NOT_FOUND':
          return this.t('dashboard.components.share.errOrgNotFound');
        case 'SHARE_TARGET_REQUIRED':
          return this.t('dashboard.components.share.errTargetRequired');
        default:
          break;
      }
    }
    return e instanceof Error && e.message ? e.message : this.t(fallbackKey);
  }

  private upsert(body: { email?: string; organizationId?: string; permission: SharePermission }): Promise<ShareDto> {
    return this.isFolder ? this.folders.upsertShare(this.data.id, body) : this.drawings.upsertShare(this.data.id, body);
  }

  /** Replace a share with the same id or target; otherwise append. */
  private mergeShare(share: ShareDto): void {
    this.changed = true;
    this.shares.update((list) => {
      const index = list.findIndex(
        (s) =>
          s.id === share.id ||
          (!!share.targetEmail && s.targetEmail === share.targetEmail) ||
          (!!share.targetOrganization && s.targetOrganization?.id === share.targetOrganization.id),
      );
      if (index < 0) return [...list, share];
      const next = [...list];
      next[index] = share;
      return next;
    });
  }
}

/**
 * `"a@b.com, c@d.com"` → `['a@b.com', 'c@d.com']`.
 *
 * Splits on commas, semicolons and newlines, because a list pasted out of a
 * mail client or a spreadsheet arrives with any of the three.
 */
function parseAddresses(raw: string): string[] {
  return [...new Set(raw.split(/[,;\n]/).map((part) => part.trim().toLowerCase()).filter((part) => !!part))];
}

let seq = 0;
