import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { PreferencesDto, Units } from '../../../core/api/api.models';
import { MeService } from '../../../core/api/me.service';
import { ClerkService } from '../../../core/auth/clerk.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { CAD_THEMES, ThemeService } from '../../cad-editor/core/services/theme.service';
import { messageOf } from '../data/drawings-list.store';

const UNITS: readonly { id: Units; label: string; name: string }[] = [
  { id: 'mm', label: 'mm', name: 'Millimetres' },
  { id: 'cm', label: 'cm', name: 'Centimetres' },
  { id: 'm', label: 'm', name: 'Metres' },
  { id: 'in', label: 'in', name: 'Inches' },
  { id: 'ft', label: 'ft', name: 'Feet' },
];

const AUTOSAVE_INTERVALS = [15, 30, 60, 120] as const;

/**
 * `/dashboard/settings` (and everything beneath it) — preferences plus Clerk's
 * own account UI.
 *
 * Design decisions:
 *  - **Every control saves itself.** There is no Save button: each change fires
 *    `PATCH /me/preferences` and shows a small "Saved" marker. `MeService`
 *    already applies the response to `ThemeService` and `AutosaveService`, so a
 *    deferred Save would only create a window where the app and the account
 *    disagree.
 *  - **Theme applies before it persists.** Clicking a swatch calls
 *    `ThemeService.setTheme` first; if the PATCH fails the toast says so and the
 *    stored preference is what reverts on next load — never the UI mid-click.
 *  - **Clerk owns the account pane.** `<UserProfile>` path-routes under
 *    `/dashboard/settings/account`, which is why this route uses a prefix
 *    matcher: its sub-pages must not remount this component.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiIconComponent, UiInputDirective, UiSkeletonComponent],
  template: `
    <header class="pg__head">
      <h1 class="pg__title">Settings</h1>
      @if (saving()) {
        <span class="st__status">Saving…</span>
      } @else if (savedOnce()) {
        <span class="st__status st__status--ok"><ui-icon name="check" [size]="14" /> Saved</span>
      }
    </header>

    <section class="st__section">
      <h2 class="st__heading">Preferences</h2>

      <div class="st__field">
        <div class="st__label">
          <span class="st__label-title">Drawing units</span>
          <span class="st__label-hint">Applied to new drawings and to the coordinate readout.</span>
        </div>
        <div class="st__seg" role="radiogroup" aria-label="Drawing units">
          @for (unit of units; track unit.id) {
            <button
              type="button"
              role="radio"
              class="st__seg-btn"
              [class.st__seg-btn--on]="prefs().units === unit.id"
              [attr.aria-checked]="prefs().units === unit.id"
              [attr.aria-label]="unit.name"
              [disabled]="saving()"
              (click)="save({ units: unit.id })"
            >
              {{ unit.label }}
            </button>
          }
        </div>
      </div>

      <div class="st__field">
        <div class="st__label">
          <span class="st__label-title">Autosave interval</span>
          <span class="st__label-hint">How often a local recovery snapshot is taken while you draw.</span>
        </div>
        <label class="st__control">
          <span class="ui-visually-hidden">Autosave interval</span>
          <select uiInput [disabled]="saving()" (change)="onAutosave($event)">
            @for (seconds of intervals; track seconds) {
              <option [value]="seconds" [selected]="seconds === prefs().autosaveIntervalSec">Every {{ seconds }} seconds</option>
            }
          </select>
        </label>
      </div>

      <div class="st__field st__field--stack">
        <div class="st__label">
          <span class="st__label-title">Theme</span>
          <span class="st__label-hint">Applies to the editor canvas and to the rest of the app.</span>
        </div>
        <div class="st__themes" role="radiogroup" aria-label="Theme">
          @for (theme of themes; track theme.id) {
            <button
              type="button"
              role="radio"
              class="st__theme"
              [class.st__theme--on]="activeThemeId() === theme.id"
              [attr.aria-checked]="activeThemeId() === theme.id"
              (click)="pickTheme(theme.id)"
            >
              <span class="st__theme-swatch" aria-hidden="true">
                <span [style.background]="theme.swatch[0]"></span>
                <span [style.background]="theme.swatch[1]"></span>
                <span [style.background]="theme.swatch[2]"></span>
              </span>
              <span class="st__theme-name">{{ theme.name }}</span>
            </button>
          }
        </div>
      </div>
    </section>

    <section class="st__section">
      <h2 class="st__heading">Account</h2>
      @if (clerk.enabled()) {
        @if (!clerk.isLoaded()) {
          <ui-skeleton width="100%" height="320px" radius="var(--ui-radius-lg)" />
        } @else if (clerk.loadError(); as message) {
          <div class="pg__error" role="alert">
            <ui-icon name="alert" [size]="18" />
            <div>
              <p class="pg__error-title">The account panel could not be loaded.</p>
              <p class="pg__error-msg">{{ message }}</p>
            </div>
          </div>
        }
        <div #profile class="st__profile"></div>
      } @else {
        <p class="st__note">Accounts are disabled in this deployment.</p>
      }

      <div class="st__signout">
        <button type="button" uiButton variant="danger" (click)="signOut()">
          <ui-icon name="log-out" [size]="15" />
          Sign out
        </button>
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; max-width: 860px; }
      .pg__head { display: flex; align-items: center; gap: var(--ui-space-3); margin-bottom: var(--ui-space-6); }
      .pg__title { margin: 0; font-size: var(--ui-text-xl); font-weight: 600; letter-spacing: -.01em; color: var(--ui-text-strong); }
      .st__status { display: inline-flex; align-items: center; gap: 5px; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .st__status--ok { color: var(--ui-success); }

      .pg__error {
        display: flex; align-items: center; gap: var(--ui-space-3);
        padding: 14px 16px; margin-bottom: var(--ui-space-4);
        border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-lg); background: var(--ui-danger-tint);
      }
      .pg__error > ui-icon { color: var(--ui-danger); flex: 0 0 auto; }
      .pg__error-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .pg__error-msg { margin: 2px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .st__section {
        padding: var(--ui-space-5) var(--ui-space-6);
        margin-bottom: var(--ui-space-5);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl);
        background: var(--ui-surface);
      }
      .st__heading { margin: 0 0 var(--ui-space-4); font-size: var(--ui-text-base); font-weight: 600; color: var(--ui-text-strong); }
      .st__note { margin: 0; font-size: var(--ui-text-md); color: var(--ui-text-dim); }

      .st__field {
        display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-6);
        padding: var(--ui-space-4) 0;
        border-top: 1px solid var(--ui-border);
      }
      .st__field--stack { flex-direction: column; align-items: stretch; gap: var(--ui-space-3); }
      .st__label { display: grid; gap: 3px; min-width: 0; }
      .st__label-title { font-size: var(--ui-text-md); font-weight: 500; color: var(--ui-text-strong); }
      .st__label-hint { font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .st__control select { width: auto; min-width: 180px; }

      .st__seg {
        display: inline-flex; padding: 3px; gap: 2px; flex: 0 0 auto;
        background: var(--ui-surface-raised); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md);
      }
      .st__seg-btn {
        min-width: 46px; height: 28px; padding: 0 10px;
        border: 0; border-radius: var(--ui-radius-sm);
        background: transparent; color: var(--ui-text-dim);
        font: 500 var(--ui-text-md) / 1 var(--ui-font-mono); cursor: pointer;
      }
      .st__seg-btn:hover:not(:disabled) { color: var(--ui-text); }
      .st__seg-btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .st__seg-btn:disabled { cursor: not-allowed; }
      .st__seg-btn--on { background: var(--ui-accent); color: var(--ui-on-accent); }

      .st__themes { display: grid; gap: var(--ui-space-2); grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
      .st__theme {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 10px; cursor: pointer; text-align: left;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md);
        background: var(--ui-surface-raised); color: var(--ui-text);
        font: 500 var(--ui-text-md) / 1.2 var(--ui-font);
      }
      .st__theme:hover { border-color: var(--ui-border-strong); }
      .st__theme:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .st__theme--on { border-color: var(--ui-accent); box-shadow: var(--ui-focus-ring); color: var(--ui-accent); }
      .st__theme-swatch {
        display: flex; flex: 0 0 auto; width: 34px; height: 22px; overflow: hidden;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm);
      }
      .st__theme-swatch span { flex: 1; }
      .st__theme-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .st__profile { display: block; min-height: 0; }
      .st__signout { margin-top: var(--ui-space-5); padding-top: var(--ui-space-4); border-top: 1px solid var(--ui-border); }
    `,
  ],
})
export class SettingsPage implements AfterViewInit, OnDestroy {
  protected readonly clerk = inject(ClerkService);
  private readonly me = inject(MeService);
  private readonly theme = inject(ThemeService);
  private readonly notify = inject(NotificationService);

  private readonly profile = viewChild<ElementRef<HTMLDivElement>>('profile');
  private mounted: HTMLDivElement | null = null;
  private destroyed = false;

  protected readonly units = UNITS;
  protected readonly intervals = AUTOSAVE_INTERVALS;
  protected readonly themes = CAD_THEMES;

  protected readonly prefs = computed(() => this.me.preferences());
  protected readonly activeThemeId = this.theme.themeId;
  protected readonly saving = signal(false);
  protected readonly savedOnce = signal(false);

  constructor() {
    void this.me.load().catch(() => undefined);
  }

  async ngAfterViewInit(): Promise<void> {
    if (!this.clerk.enabled()) return;
    await this.clerk.load();
    if (this.destroyed || this.clerk.loadError()) return;
    const el = this.profile()?.nativeElement;
    if (!el) return;
    this.clerk.mountUserProfile(el);
    this.mounted = el;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.mounted) {
      this.clerk.unmountUserProfile(this.mounted);
      this.mounted = null;
    }
  }

  protected onAutosave(event: Event): void {
    const seconds = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(seconds) && seconds > 0) void this.save({ autosaveIntervalSec: seconds });
  }

  /** Apply the theme locally first, then persist it. */
  protected pickTheme(id: string): void {
    this.theme.setTheme(id);
    void this.save({ theme: id });
  }

  protected async save(patch: Partial<PreferencesDto>): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.me.updatePreferences(patch);
      this.savedOnce.set(true);
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.saving.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.me.invalidate();
    await this.clerk.signOut();
  }
}
