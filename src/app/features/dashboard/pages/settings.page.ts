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
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { filter, scan } from 'rxjs/operators';
import { PreferencesDto, Units } from '../../../core/api/api.models';
import { MeService } from '../../../core/api/me.service';
import { SupabaseAuthService } from '../../../core/auth/supabase-auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';
import { CAD_THEMES, ThemeService } from '../../cad-editor/core/services/theme.service';
import { LanguageService } from '../../../core/i18n/language.service';
import { BillingApiService } from '../../../core/api/billing-api.service';
import { messageOf } from '../data/drawings-list.store';

/** `label` is the unit symbol and stays untranslated; `nameKey` is the spoken name. */
const UNITS: readonly { id: Units; label: string; nameKey: string }[] = [
  { id: 'mm', label: 'mm', nameKey: 'dashboard.settings.unit.mm' },
  { id: 'cm', label: 'cm', nameKey: 'dashboard.settings.unit.cm' },
  { id: 'm', label: 'm', nameKey: 'dashboard.settings.unit.m' },
  { id: 'in', label: 'in', nameKey: 'dashboard.settings.unit.in' },
  { id: 'ft', label: 'ft', nameKey: 'dashboard.settings.unit.ft' },
];

/** Supabase's own default minimum; kept next to the hint that states it. */
const MIN_PASSWORD_LENGTH = 6;

const AUTOSAVE_INTERVALS = [15, 30, 60, 120] as const;

/**
 * `/dashboard/settings` (and everything beneath it) — drawing preferences,
 * email notifications, and the account pane.
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
 *  - **The account pane is deliberately thin.** Email and connected providers are
 *    read-only, because Supabase owns them and re-implementing verification or
 *    provider linking badly would be worse than not owning it. The one write is
 *    changing the password, offered only when the account actually has one — an
 *    OAuth-only user has no password to change.
 *  - **Email toggles are opt-OUT, and invitations are exempt.** Both default to
 *    on (matching the column default), because a user who never opened this page
 *    should still hear that something was shared with them. Organization
 *    invitations are governed by neither: an invitation may go to an address
 *    with no account, which has no preferences to consult, and it is the only
 *    way that person learns they were invited. The pane says so out loud rather
 *    than leaving the absence of a third toggle to be read as an oversight.
 *  - **`/dashboard/settings/account` and `…/notifications` both resolve here**,
 *    via the route's prefix matcher, so existing links and bookmarks keep
 *    working — including the "Manage email preferences" link in every email.
 */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiButtonDirective, UiIconComponent, UiInputDirective, UiSkeletonComponent],
  template: `
    <ng-container *transloco="let t">
    <header class="pg__head">
      <h1 class="pg__title">{{ t('dashboard.shell.settings') }}</h1>
      @if (saving()) {
        <span class="st__status">{{ t('dashboard.settings.saving') }}</span>
      } @else if (savedOnce()) {
        <span class="st__status st__status--ok"><ui-icon name="check" [size]="14" /> {{ t('dashboard.settings.saved') }}</span>
      }
    </header>

    <section class="st__section">
      <h2 class="st__heading">{{ t('dashboard.settings.preferences') }}</h2>

      <div class="st__field">
        <div class="st__label">
          <span class="st__label-title">{{ t('dashboard.settings.units') }}</span>
          <span class="st__label-hint">{{ t('dashboard.settings.unitsHint') }}</span>
        </div>
        <div class="st__seg" role="radiogroup" [attr.aria-label]="t('dashboard.settings.units')">
          @for (unit of units; track unit.id) {
            <button
              type="button"
              role="radio"
              class="st__seg-btn"
              [class.st__seg-btn--on]="prefs().units === unit.id"
              [attr.aria-checked]="prefs().units === unit.id"
              [attr.aria-label]="t(unit.nameKey)"
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
          <span class="st__label-title">{{ t('dashboard.settings.autosave') }}</span>
          <span class="st__label-hint">{{ t('dashboard.settings.autosaveHint') }}</span>
        </div>
        <label class="st__control">
          <span class="ui-visually-hidden">{{ t('dashboard.settings.autosave') }}</span>
          <select uiInput [disabled]="saving()" (change)="onAutosave($event)">
            @for (seconds of intervals; track seconds) {
              <option [value]="seconds" [selected]="seconds === prefs().autosaveIntervalSec">{{ t('dashboard.settings.autosaveEvery', { seconds }) }}</option>
            }
          </select>
        </label>
      </div>

      <div class="st__field">
        <div class="st__label">
          <span class="st__label-title">{{ t('dashboard.settings.language') }}</span>
          <span class="st__label-hint">{{ t('dashboard.settings.languageHint') }}</span>
        </div>
        <label class="st__control">
          <span class="ui-visually-hidden">{{ t('dashboard.settings.language') }}</span>
          <select uiInput [disabled]="saving()" (change)="onLanguage($event)">
            @for (locale of locales; track locale.code) {
              <!--
                The option text is the language's own name and is deliberately
                NOT translated — someone hunting for their language scans for
                "Deutsch", not for whatever the current UI calls German. The
                English name rides along in aria-label for screen readers and
                for support tickets.
              -->
              <option
                [value]="locale.code"
                [selected]="locale.code === activeLocale()"
                [attr.aria-label]="locale.english"
              >{{ locale.label }}</option>
            }
          </select>
        </label>
      </div>

      <div class="st__field st__field--stack">
        <div class="st__label">
          <span class="st__label-title">{{ t('dashboard.settings.theme') }}</span>
          <span class="st__label-hint">{{ t('dashboard.settings.themeHint') }}</span>
        </div>
        <div class="st__themes" role="radiogroup" [attr.aria-label]="t('dashboard.settings.theme')">
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

    <!--
      Billing. Carries an id so /dashboard/settings/billing — the checkout
      return_url — can be scrolled to, and so the manage link is addressable.
    -->
    <section class="st__section" id="billing">
      <h2 class="st__heading">{{ t('dashboard.settings.billing') }}</h2>

      @if (!billingEnabled()) {
        <p class="st__note">{{ t('dashboard.settings.billingDisabled') }}</p>
      } @else {
        <div class="st__field">
          <div class="st__label">
            <span class="st__label-title">{{ t('dashboard.settings.currentPlan') }}</span>
            <span class="st__label-hint">{{ t(planHint().key, planHint().params) }}</span>
          </div>
          <div class="st__plan">
            <span class="st__plan-badge" [class.st__plan-badge--paid]="plan() !== 'free'">{{ t(planLabelKey()) }}</span>
            @if (billing().cancelAtPeriodEnd) {
              <span class="st__plan-warn">{{ t('dashboard.settings.cancelsAtPeriodEnd') }}</span>
            }
          </div>
        </div>

        <div class="st__field">
          <div class="st__label">
            <span class="st__label-title">{{ t('dashboard.settings.manage') }}</span>
            <span class="st__label-hint">{{ t('dashboard.settings.manageHint') }}</span>
          </div>
          <div class="st__actions">
            @if (plan() === 'free') {
              <a uiButton variant="primary" routerLink="/pricing">{{ t('dashboard.settings.viewPlans') }}</a>
            } @else {
              <button type="button" uiButton variant="secondary" [loading]="billingBusy()" (click)="openPortal()">
                {{ t('dashboard.settings.manageBilling') }}
              </button>
            }
            <!--
              Manual re-read. The browser's return from checkout regularly beats
              the webhook, so without a way to re-check, a user who has just
              paid can sit looking at "Free" with no recourse.
            -->
            <button type="button" uiButton variant="ghost" [loading]="refreshing()" (click)="refreshBilling()">
              {{ t('dashboard.recent.refresh') }}
            </button>
          </div>
        </div>
      }
    </section>

    <section class="st__section">
      <h2 class="st__heading">{{ t('dashboard.settings.emailNotifications') }}</h2>

      <div class="st__field">
        <div class="st__label">
          <span class="st__label-title">{{ t('dashboard.settings.shares') }}</span>
          <span class="st__label-hint">{{ t('dashboard.settings.sharesHint') }}</span>
        </div>
        <label class="st__switch">
          <span class="ui-visually-hidden">{{ t('dashboard.settings.sharesAria') }}</span>
          <input
            type="checkbox"
            role="switch"
            [checked]="prefs().emailOnShare"
            [disabled]="saving()"
            (change)="toggleEmail('emailOnShare', $event)"
          />
          <span class="st__switch-track" aria-hidden="true"><span class="st__switch-knob"></span></span>
        </label>
      </div>

      <div class="st__field">
        <div class="st__label">
          <span class="st__label-title">{{ t('dashboard.settings.orgActivity') }}</span>
          <span class="st__label-hint">{{ t('dashboard.settings.orgActivityHint') }}</span>
        </div>
        <label class="st__switch">
          <span class="ui-visually-hidden">{{ t('dashboard.settings.orgActivityAria') }}</span>
          <input
            type="checkbox"
            role="switch"
            [checked]="prefs().emailOnOrgActivity"
            [disabled]="saving()"
            (change)="toggleEmail('emailOnOrgActivity', $event)"
          />
          <span class="st__switch-track" aria-hidden="true"><span class="st__switch-knob"></span></span>
        </label>
      </div>

      <p class="st__note st__note--spaced">{{ t('dashboard.settings.invitesNote') }}</p>
    </section>

    <section class="st__section">
      <h2 class="st__heading">{{ t('dashboard.settings.account') }}</h2>
      @if (!auth.enabled()) {
        <p class="st__note">{{ t('dashboard.settings.accountsDisabled') }}</p>
      } @else if (!auth.isLoaded()) {
        <ui-skeleton width="100%" height="180px" radius="var(--ui-radius-lg)" />
      } @else if (auth.loadError(); as message) {
        <div class="pg__error" role="alert">
          <ui-icon name="alert" [size]="18" />
          <div>
            <p class="pg__error-title">{{ t('dashboard.settings.accountError') }}</p>
            <p class="pg__error-msg">{{ message }}</p>
          </div>
        </div>
      } @else {
        <dl class="st__facts">
          <dt>{{ t('common.email') }}</dt>
          <dd>{{ auth.userEmail() || '—' }}</dd>
          <dt>{{ t('dashboard.settings.signedInWith') }}</dt>
          <dd>
            @if (providers().length) {
              {{ providers().join(', ') }}
            } @else {
              {{ t('dashboard.settings.emailAndPassword') }}
            }
          </dd>
        </dl>
        <p class="st__note">
          {{ t('dashboard.settings.accountNote') }}
          <a routerLink="/dashboard/profile">{{ t('dashboard.settings.editName') }}</a>
        </p>

        @if (auth.hasPasswordIdentity()) {
          <div class="st__password">
            <h3 class="st__subheading">{{ t('common.password') }}</h3>
            @if (passwordChanged()) {
              <p class="st__ok" role="status"><ui-icon name="check" [size]="14" /> {{ t('dashboard.settings.passwordUpdated') }}</p>
            }
            <div class="st__password-row">
              <label class="ui-visually-hidden" for="st-password">{{ t('dashboard.settings.newPassword') }}</label>
              <input
                uiInput
                id="st-password"
                type="password"
                autocomplete="new-password"
                [placeholder]="t('dashboard.settings.newPassword')"
                [attr.minlength]="minPasswordLength"
                [value]="newPassword()"
                [disabled]="changingPassword()"
                (input)="newPassword.set(inputValue($event))"
              />
              <button
                type="button"
                uiButton
                variant="secondary"
                [disabled]="!canChangePassword()"
                [loading]="changingPassword()"
                (click)="changePassword()"
              >
                {{ t('dashboard.settings.changePassword') }}
              </button>
            </div>
            <p class="st__hint" [class.st__hint--bad]="!!passwordError()">
              {{ passwordError() ?? t('dashboard.settings.passwordMin', { min: minPasswordLength }) }}
            </p>
          </div>
        }
      }

      <div class="st__signout">
        <button type="button" uiButton variant="danger" (click)="signOut()">
          <ui-icon name="log-out" [size]="15" />
          {{ t('dashboard.settings.signOut') }}
        </button>
      </div>
    </section>
    </ng-container>
  `,
  styles: [
    `
      :host { display: block; }
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

      .st__plan { display: flex; align-items: center; gap: var(--ui-space-2); flex-wrap: wrap; }
      .st__plan-badge {
        display: inline-flex; align-items: center;
        padding: 2px 10px; border-radius: 999px;
        border: 1px solid var(--ui-border); background: var(--ui-surface-2);
        font-size: var(--ui-text-xs); font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase;
      }
      .st__plan-badge--paid { border-color: var(--ui-accent); color: var(--ui-accent); }
      .st__plan-warn { font-size: var(--ui-text-sm); color: var(--ui-warning, var(--ui-text-muted)); }
      .st__actions { display: flex; gap: var(--ui-space-2); flex-wrap: wrap; }
      .st__section {
        padding: var(--ui-space-5) var(--ui-space-6);
        margin-bottom: var(--ui-space-5);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl);
        background: var(--ui-surface);
      }
      .st__heading { margin: 0 0 var(--ui-space-4); font-size: var(--ui-text-base); font-weight: 600; color: var(--ui-text-strong); }
      .st__note { margin: 0; font-size: var(--ui-text-md); color: var(--ui-text-dim); }
      .st__note--spaced { padding-top: var(--ui-space-4); border-top: 1px solid var(--ui-border); font-size: var(--ui-text-sm); }

      /* A checkbox styled as a switch: the input stays the real control (so it
         keeps keyboard, label and screen-reader behaviour) and is drawn on top
         of the track at zero opacity rather than hidden, because a display:none
         input is unfocusable in some browsers. */
      .st__switch { position: relative; flex: 0 0 auto; display: inline-flex; cursor: pointer; }
      .st__switch input {
        position: absolute; inset: 0; margin: 0;
        width: 100%; height: 100%; opacity: 0; cursor: pointer;
      }
      .st__switch input:disabled { cursor: not-allowed; }
      .st__switch-track {
        display: block; width: 40px; height: 24px; padding: 3px;
        background: var(--ui-surface-raised); border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-full);
        transition: background .15s ease, border-color .15s ease;
      }
      .st__switch-knob {
        display: block; width: 16px; height: 16px;
        background: var(--ui-text-dim); border-radius: var(--ui-radius-full);
        transition: transform .15s ease, background .15s ease;
      }
      .st__switch input:checked + .st__switch-track { background: var(--ui-accent); border-color: var(--ui-accent); }
      .st__switch input:checked + .st__switch-track .st__switch-knob {
        background: var(--ui-on-accent); transform: translateX(16px);
      }
      .st__switch input:focus-visible + .st__switch-track { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .st__switch input:disabled + .st__switch-track { opacity: .6; }

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
export class SettingsPage {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly me = inject(MeService);
  private readonly theme = inject(ThemeService);
  private readonly language = inject(LanguageService);
  private readonly billingApi = inject(BillingApiService);
  private readonly notify = inject(NotificationService);
  private readonly transloco = inject(TranslocoService);

  protected readonly minPasswordLength = MIN_PASSWORD_LENGTH;
  protected readonly newPassword = signal('');
  protected readonly changingPassword = signal(false);
  protected readonly passwordChanged = signal(false);
  protected readonly passwordError = signal<string | null>(null);

  /** Provider names, title-cased for display (`google` → `Google`). */
  protected readonly providers = computed(() =>
    this.auth.identities().map((p) => p.charAt(0).toUpperCase() + p.slice(1)),
  );

  protected readonly canChangePassword = computed(
    () => !this.changingPassword() && this.newPassword().length >= MIN_PASSWORD_LENGTH,
  );

  protected readonly units = UNITS;
  protected readonly intervals = AUTOSAVE_INTERVALS;
  protected readonly themes = CAD_THEMES;
  protected readonly locales = this.language.locales;

  protected readonly prefs = computed(() => this.me.preferences());
  protected readonly activeThemeId = this.theme.themeId;
  protected readonly activeLocale = this.language.localeCode;

  // ── Billing ──────────────────────────────────────────────────────────────
  protected readonly billing = this.me.billing;
  protected readonly plan = this.me.plan;
  protected readonly billingEnabled = computed(() => this.billing().manageable || this.plan() !== 'free');
  protected readonly billingBusy = signal(false);
  protected readonly refreshing = signal(false);

  protected readonly planLabelKey = computed(() => {
    const plan = this.plan();
    return plan === 'free' ? 'dashboard.settings.plan.free' : plan === 'pro' ? 'dashboard.settings.plan.pro' : 'dashboard.settings.plan.team';
  });

  /** One line describing where the subscription stands — a key plus its params, resolved in the template. */
  protected readonly planHint = computed<{ key: string; params?: Record<string, string> }>(() => {
    const b = this.billing();
    if (this.plan() === 'free') {
      // Distinguish "never subscribed" from "subscription ended" — the second
      // is a person who may well want to come back, and telling them their
      // plan simply says "Free" reads like their payment vanished.
      return { key: b.status === 'cancelled' ? 'dashboard.settings.planHint.ended' : 'dashboard.settings.planHint.free' };
    }
    const when = b.currentPeriodEnd
      ? new Date(b.currentPeriodEnd).toLocaleDateString(this.language.localeCode())
      : null;
    const dated = (key: string, fallback: string) => (when ? { key, params: { date: when } } : { key: fallback });
    if (b.status === 'trialing') return dated('dashboard.settings.planHint.trialEnds', 'dashboard.settings.planHint.trial');
    if (b.status === 'past_due') return { key: 'dashboard.settings.planHint.pastDue' };
    if (b.cancelAtPeriodEnd) return dated('dashboard.settings.planHint.accessUntil', 'dashboard.settings.planHint.cancels');
    return dated('dashboard.settings.planHint.renews', 'dashboard.settings.planHint.active');
  });
  protected readonly saving = signal(false);
  protected readonly savedOnce = signal(false);

  constructor() {
    void this.me.load().catch(() => undefined);
  }

  protected inputValue(event: Event): string {
    this.passwordError.set(null);
    this.passwordChanged.set(false);
    return (event.target as HTMLInputElement).value;
  }

  /**
   * Sets a new password. Supabase keeps the current session valid afterwards, so
   * there is nothing to re-authenticate — the field is just cleared.
   */
  protected async changePassword(): Promise<void> {
    if (!this.canChangePassword()) return;
    this.changingPassword.set(true);
    this.passwordError.set(null);
    const result = await this.auth.updatePassword(this.newPassword());
    this.changingPassword.set(false);
    if (!result.ok) {
      this.passwordError.set(result.error);
      return;
    }
    this.newPassword.set('');
    this.passwordChanged.set(true);
  }

  /**
   * Saves one email toggle, putting the checkbox back if the PATCH fails.
   *
   * The revert has to touch the DOM directly: `[checked]` is bound to
   * `prefs()`, which only changes once the server has accepted the value, so
   * on failure the bound value never changed and Angular has nothing to
   * re-render — the box would sit visibly "on" while the account said "off".
   * Same idiom as the permission select in the share dialog.
   */
  protected async toggleEmail(key: 'emailOnShare' | 'emailOnOrgActivity', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    const ok = await this.save({ [key]: next });
    if (!ok) input.checked = !next;
  }

  protected onAutosave(event: Event): void {
    const seconds = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(seconds) && seconds > 0) void this.save({ autosaveIntervalSec: seconds });
  }

  /**
   * Apply the language locally first, then persist it — same order as
   * `pickTheme`, and for the same reason: the switch must feel instant, and a
   * failed PATCH should not have prevented the user from reading the UI in
   * their own language for the rest of the session.
   */
  protected onLanguage(event: Event): void {
    const code = (event.target as HTMLSelectElement).value;
    this.language.setLocale(code);
    void this.save({ locale: code });
  }

  /** Apply the theme locally first, then persist it. */
  protected pickTheme(id: string): void {
    this.theme.setTheme(id);
    void this.save({ theme: id });
  }

  /**
   * Open Dodo's hosted customer portal.
   *
   * A full navigation rather than a new tab: the link is single-use and
   * short-lived, and a blocked popup would look like a broken button.
   */
  protected async openPortal(): Promise<void> {
    if (this.billingBusy()) return;
    this.billingBusy.set(true);
    try {
      const { portalUrl } = await this.billingApi.createPortalSession();
      location.assign(portalUrl);
    } catch (e) {
      this.billingBusy.set(false);
      this.notify.error(messageOf(e));
    }
  }

  /** Re-read the subscription from the provider and patch the cached `/me`. */
  protected async refreshBilling(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      this.me.setBilling(await this.billingApi.refresh());
    } catch (e) {
      this.notify.error(messageOf(e));
    } finally {
      this.refreshing.set(false);
    }
  }

  /** Persists a patch. Returns whether it stuck, so a caller can revert. */
  protected async save(patch: Partial<PreferencesDto>): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    try {
      await this.me.updatePreferences(patch);
      this.savedOnce.set(true);
      return true;
    } catch (e) {
      this.notify.error(messageOf(e));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    this.me.invalidate();
    await this.auth.signOut();
  }
}
