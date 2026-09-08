import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UserRole } from '../../../core/api/api.models';
import { MeService } from '../../../core/api/me.service';
import { SupabaseAuthService } from '../../../core/auth/supabase-auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ACCEPTED_IMAGE_ACCEPT, resizeToSquare } from '../../../core/utils/image-resize';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiDialogService } from '../../../shared/ui/dialog/ui-dialog.service';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { UploadDropzoneDirective } from '../components/upload-dropzone.directive';
import { messageOf } from '../data/drawings-list.store';

const ROLES: readonly { id: UserRole; label: string }[] = [
  { id: 'architect', label: 'Architect' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'student', label: 'Student' },
  { id: 'other', label: 'Other' },
];

/**
 * `/dashboard/profile` — personal info.
 *
 * Design decisions:
 *  - **Names are written to Supabase, not to our own API.** `users.first_name` is
 *    mirrored *from* the access token, so a local write would be overwritten the
 *    next time the guard re-read a token. `SupabaseAuthService.updateName()` (which
 *    also refreshes the session so the new metadata reaches the token) then
 *    `MeService.refresh()` keeps one source of truth. Mirrors `onboarding.page.ts`.
 *  - **The profile picture goes to Supabase Storage, not our own bucket.** Same
 *    reason as the names: `users.image_url` is mirrored from the access token, so
 *    the URL has to live in `user_metadata.avatar_url` to survive. The bytes are
 *    downscaled to a square in the browser first (`resizeToSquare`), so what is
 *    stored is ~20 KB rather than a phone photo.
 *  - **Email and password are handled in Settings → Account**, which owns the
 *    change-password form and lists the connected sign-in providers.
 *  - **Route is `/profile`, not `/account`.** `/dashboard/settings/account` is the
 *    account pane inside Settings; taking that prefix would shadow it.
 *  - Units / theme / autosave deliberately stay in Settings — this page is
 *    identity, not preferences, and duplicating them invites divergence.
 */
@Component({
  selector: 'app-profile-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiButtonDirective,
    UiIconComponent,
    UiInputDirective,
    UiSkeletonComponent,
    UploadDropzoneDirective,
  ],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">Personal info</h1>
      @if (saving()) {
        <span class="pg__state">Saving…</span>
      } @else if (savedOnce()) {
        <span class="pg__state pg__state--ok"><ui-icon name="check" [size]="13" /> Saved</span>
      }
    </header>

    <section class="pf__card">
      <div
        class="pf__identity"
        appUploadDropzone
        #photoZone="appUploadDropzone"
        [disabled]="!canEditPhoto() || uploadingPhoto()"
        [class.pf__identity--over]="photoZone.over()"
        (filesDropped)="onPhotoDropped($event)"
      >
        <div class="pf__avatar-wrap">
          @if (auth.enabled() && !auth.isLoaded()) {
            <ui-skeleton width="56px" height="56px" circle />
          } @else if (avatarUrl(); as url) {
            <img class="pf__avatar" [src]="url" alt="" width="56" height="56" />
          } @else {
            <span class="pf__avatar pf__avatar--fallback" aria-hidden="true">{{ initials() }}</span>
          }
          @if (uploadingPhoto()) {
            <span class="pf__avatar-busy" role="status" aria-label="Uploading your photo"></span>
          }
        </div>

        <div class="pf__identity-text">
          <p class="pf__name">{{ displayName() }}</p>
          <p class="pf__email">{{ email() || 'No email on file' }}</p>

          @if (canEditPhoto()) {
            <div class="pf__photo-actions">
              <button
                type="button"
                uiButton
                variant="secondary"
                size="sm"
                [disabled]="uploadingPhoto()"
                [loading]="uploadingPhoto()"
                (click)="photoInput.click()"
              >
                <ui-icon name="upload" [size]="14" />
                {{ avatarUrl() ? 'Change photo' : 'Upload photo' }}
              </button>
              @if (canRemovePhoto()) {
                <button
                  type="button"
                  uiButton
                  variant="ghost"
                  size="sm"
                  [disabled]="uploadingPhoto()"
                  (click)="removePhoto()"
                >
                  <ui-icon name="trash" [size]="14" />
                  Remove
                </button>
              }
            </div>
            <p class="pf__hint">{{ photoHint() }}</p>
          }
        </div>

        <!-- Hidden picker fronted by the button above; the house pattern. -->
        <input
          #photoInput
          type="file"
          class="ui-visually-hidden"
          tabindex="-1"
          aria-hidden="true"
          [accept]="acceptedImages"
          (change)="onPhotoPicked($event)"
        />
      </div>

      @if (photoError(); as message) {
        <div class="pg__error" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="pg__error-title">Your photo could not be saved.</p>
            <p class="pg__error-msg">{{ message }}</p>
          </div>
        </div>
      }

      <div class="pf__grid">
        <div class="pf__field">
          <label class="pf__label" for="pf-first">First name</label>
          <input uiInput id="pf-first" autocomplete="given-name" [value]="firstName()" (input)="firstName.set(value($event))" />
        </div>
        <div class="pf__field">
          <label class="pf__label" for="pf-last">Last name</label>
          <input uiInput id="pf-last" autocomplete="family-name" [value]="lastName()" (input)="lastName.set(value($event))" />
        </div>
      </div>

      <div class="pf__field">
        <label class="pf__label" for="pf-email">Email</label>
        <input uiInput id="pf-email" type="email" [value]="email()" readonly disabled />
        <p class="pf__hint">
          Managed by your sign-in provider.
          <a routerLink="/dashboard/settings/account">Change it in account settings</a>.
        </p>
      </div>

      @if (error(); as message) {
        <div class="pg__error" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="pg__error-title">Your name could not be saved.</p>
            <p class="pg__error-msg">{{ message }}</p>
          </div>
        </div>
      }

      <div class="pf__actions">
        <button type="button" uiButton [disabled]="!dirty() || saving()" [loading]="saving()" (click)="save()">
          Save changes
        </button>
        @if (dirty()) {
          <button type="button" uiButton variant="ghost" [disabled]="saving()" (click)="revert()">Cancel</button>
        }
      </div>
    </section>

    <section class="pf__card">
      <h2 class="pf__section-title">What you do</h2>
      <p class="pf__hint pf__hint--block">Helps us pick sensible defaults. Change it whenever you like.</p>
      <div class="pf__roles" role="radiogroup" aria-label="Your role">
        @for (option of roles; track option.id) {
          <button
            type="button"
            class="pf__role"
            role="radio"
            [class.pf__role--on]="role() === option.id"
            [attr.aria-checked]="role() === option.id"
            [disabled]="savingRole()"
            (click)="setRole(option.id)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    </section>

    <section class="pf__card">
      <h2 class="pf__section-title">Security &amp; sessions</h2>
      <p class="pf__hint pf__hint--block">
        Password, two-factor authentication and signed-in devices are handled by your sign-in provider.
      </p>
      <a uiButton variant="secondary" routerLink="/dashboard/settings/account">
        <ui-icon name="settings" [size]="15" />
        Open account settings
      </a>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .pg__head { display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4); margin-bottom: var(--ui-space-5); flex-wrap: wrap; }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .pg__state { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .pg__state--ok { color: var(--ui-success); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg);
        background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error > div { flex: 1; min-width: 0; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .pf__card {
        display: grid; gap: var(--ui-space-4);
        padding: var(--ui-space-5);
        margin-bottom: var(--ui-space-5);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl); background: var(--ui-surface);
      }
      .pf__section-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }

      .pf__identity {
        display: flex; align-items: flex-start; gap: var(--ui-space-4);
        padding: var(--ui-space-2); margin: calc(var(--ui-space-2) * -1);
        border: 1px dashed transparent; border-radius: var(--ui-radius-lg);
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast);
      }
      /* Drop-target affordance, only while a file drag is over the block. */
      .pf__identity--over { border-color: var(--ui-accent); background: var(--ui-accent-tint); }

      .pf__avatar-wrap { position: relative; flex: 0 0 auto; width: 56px; height: 56px; }
      .pf__avatar { width: 56px; height: 56px; border-radius: var(--ui-radius-full); object-fit: cover; flex: 0 0 auto; }
      .pf__avatar--fallback {
        display: grid; place-items: center;
        background: var(--ui-accent); color: var(--ui-on-accent);
        font-size: var(--ui-text-lg); font-weight: 600;
      }
      /* Dims the picture and spins over it while the upload is in flight. */
      .pf__avatar-busy {
        position: absolute; inset: 0;
        display: grid; place-items: center;
        border-radius: var(--ui-radius-full);
        background: color-mix(in srgb, var(--ui-surface) 60%, transparent);
      }
      .pf__avatar-busy::after {
        content: '';
        width: 18px; height: 18px;
        border-radius: 50%;
        border: 2px solid var(--ui-accent);
        border-right-color: transparent;
        animation: ui-spin .7s linear infinite;
      }

      .pf__identity-text { min-width: 0; }
      .pf__photo-actions { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); margin-top: var(--ui-space-3); }
      .pf__name { margin: 0; font-size: var(--ui-text-lg); font-weight: 600; color: var(--ui-text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pf__email { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .pf__grid { display: grid; gap: var(--ui-space-4); grid-template-columns: 1fr 1fr; }
      @media (max-width: 560px) { .pf__grid { grid-template-columns: 1fr; } }
      .pf__field { display: grid; gap: 6px; min-width: 0; }
      .pf__label { font-size: var(--ui-text-sm); font-weight: 500; color: var(--ui-text); }
      .pf__hint { margin: 0; font-size: var(--ui-text-xs); color: var(--ui-text-dim); }
      .pf__hint--block { margin-top: -8px; }
      .pf__hint a { color: var(--ui-accent); }

      .pf__roles { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); }
      .pf__role {
        padding: 6px 14px; border-radius: var(--ui-radius-full);
        border: 1px solid var(--ui-border); background: var(--ui-surface); color: var(--ui-text);
        font-size: var(--ui-text-sm); cursor: pointer;
        transition: border-color var(--ui-dur-fast), background var(--ui-dur-fast), color var(--ui-dur-fast);
      }
      .pf__role:hover:not(:disabled) { border-color: var(--ui-border-strong); background: var(--ui-hover); }
      .pf__role:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .pf__role:disabled { opacity: .6; cursor: default; }
      .pf__role--on { border-color: var(--ui-accent); background: var(--ui-accent-tint); color: var(--ui-accent); font-weight: 600; }

      .pf__actions { display: flex; gap: var(--ui-space-3); align-items: center; flex-wrap: wrap; }
    `,
  ],
})
export class ProfilePage {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly me = inject(MeService);
  private readonly notify = inject(NotificationService);
  private readonly dialog = inject(UiDialogService);

  protected readonly roles = ROLES;
  protected readonly acceptedImages = ACCEPTED_IMAGE_ACCEPT;

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly saving = signal(false);
  protected readonly savingRole = signal(false);
  protected readonly savedOnce = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly uploadingPhoto = signal(false);
  protected readonly photoError = signal<string | null>(null);

  /** Server / session truth, used to decide whether the form is dirty. */
  private readonly baseFirst = signal('');
  private readonly baseLast = signal('');
  /** Stops a late session resolution from clobbering what the user is typing. */
  private touched = false;

  protected readonly role = computed<UserRole | null>(() => this.me.preferences().role ?? null);

  protected readonly email = computed(() => this.me.me()?.user.email ?? this.auth.userEmail());
  protected readonly avatarUrl = computed(() => this.me.me()?.user.imageUrl ?? this.auth.userAvatarUrl());

  /** Editing the picture needs a real session — embedded mode has no account. */
  protected readonly canEditPhoto = computed(() => this.auth.enabled() && this.auth.isSignedIn());

  /** Only offer removal when there is a picture to clear. */
  protected readonly canRemovePhoto = computed(() => !!this.avatarUrl());

  /**
   * Copy under the buttons. An account that signed in with Google or GitHub
   * keeps the provider's `picture` in metadata, which the avatar falls back to,
   * so "Remove" reverts to that rather than to initials — say so instead of
   * letting the button look broken.
   */
  protected readonly photoHint = computed(() => {
    const base = 'PNG, JPEG or WebP. Drop one here or browse — it will be cropped to a square.';
    if (!this.canRemovePhoto() || this.auth.identities().length === 0) {
      return base;
    }
    return `${base} Removing yours reverts to your sign-in provider's photo.`;
  });

  protected readonly displayName = computed(() => {
    const name = `${this.firstName()} ${this.lastName()}`.trim();
    return name || this.email() || 'Your account';
  });

  protected readonly initials = computed(() => {
    const first = this.firstName().trim();
    const last = this.lastName().trim();
    const letters = `${first.charAt(0)}${last.charAt(0)}`.trim();
    return (letters || this.email().charAt(0) || '?').toUpperCase();
  });

  protected readonly dirty = computed(
    () => this.firstName().trim() !== this.baseFirst() || this.lastName().trim() !== this.baseLast(),
  );

  constructor() {
    void this.me.load().catch(() => undefined);

    // Prefill from whichever source resolves first, but never over live typing.
    effect(() => {
      const user = this.me.me()?.user;
      const first = user?.firstName ?? this.auth.userFirstName();
      const last = user?.lastName ?? this.auth.userLastName();
      untracked(() => {
        this.baseFirst.set(first);
        this.baseLast.set(last);
        if (this.touched) return;
        this.firstName.set(first);
        this.lastName.set(last);
      });
    });
  }

  protected value(event: Event): string {
    this.touched = true;
    return (event.target as HTMLInputElement).value;
  }

  protected revert(): void {
    this.firstName.set(this.baseFirst());
    this.lastName.set(this.baseLast());
    this.error.set(null);
    this.touched = false;
  }

  protected async save(): Promise<void> {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      // Supabase owns these fields; `updateName` also refreshes the session so the
      // new metadata reaches the access token before we re-read `/me`.
      await this.auth.updateName(this.firstName().trim(), this.lastName().trim());
      await this.me.refresh();
      this.touched = false;
      this.savedOnce.set(true);
    } catch (e) {
      this.error.set(messageOf(e));
    } finally {
      this.saving.set(false);
    }
  }

  // ── profile picture ───────────────────────────────────────────────────────

  /** File picker → upload. Resets the input so re-picking the same file fires. */
  protected onPhotoPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      void this.uploadPhoto(file);
    }
  }

  /** Drag-and-drop onto the identity block. Extra files are ignored. */
  protected onPhotoDropped(files: File[]): void {
    const [file] = files;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.photoError.set('That file is not an image. Pick a PNG, JPEG or WebP.');
      return;
    }
    void this.uploadPhoto(file);
  }

  /**
   * Downscales locally, stores the object, then re-reads `/me`.
   *
   * The refresh is not optional: `avatarUrl()` prefers the server's
   * `me().user.imageUrl`, which is mirrored from the access token, so without it
   * the new picture would be replaced by the stale one on the next `/me`.
   */
  private async uploadPhoto(file: File): Promise<void> {
    if (this.uploadingPhoto()) return;
    this.uploadingPhoto.set(true);
    this.photoError.set(null);
    try {
      const { blob, contentType, extension } = await resizeToSquare(file);
      await this.auth.uploadAvatar(blob, contentType, extension);
      await this.me.refresh();
      this.notify.success('Your profile photo was updated.');
    } catch (e) {
      this.photoError.set(messageOf(e));
    } finally {
      this.uploadingPhoto.set(false);
    }
  }

  /** Clears the picture after a confirm, matching the dashboard's delete flows. */
  protected async removePhoto(): Promise<void> {
    if (this.uploadingPhoto()) return;
    const reverts = this.auth.identities().length > 0;
    const ok = await this.dialog.confirm({
      title: 'Remove photo?',
      message: reverts
        ? 'Your uploaded photo will be deleted and your sign-in provider’s photo will be used instead.'
        : 'Your uploaded photo will be deleted and your initials will be shown instead.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;

    this.uploadingPhoto.set(true);
    this.photoError.set(null);
    try {
      await this.auth.removeAvatar();
      await this.me.refresh();
      this.notify.success('Your profile photo was removed.');
    } catch (e) {
      this.photoError.set(messageOf(e));
    } finally {
      this.uploadingPhoto.set(false);
    }
  }

  /** Role lives in preferences, which we DO own — straight to `PATCH /me/preferences`. */
  protected async setRole(role: UserRole): Promise<void> {
    if (this.savingRole() || this.role() === role) return;
    this.savingRole.set(true);
    try {
      await this.me.updatePreferences({ role });
      this.savedOnce.set(true);
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.savingRole.set(false);
    }
  }
}
