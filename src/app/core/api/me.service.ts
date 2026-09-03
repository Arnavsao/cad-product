import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LanguageService } from '../i18n/language.service';
import { ThemeService } from '../../features/cad-editor/core/services/theme.service';
import { HttpManagerService } from '../services/http-manager.service';
import { BillingStateDto, CompleteOnboardingRequest, MeDto, PreferencesDto } from './api.models';

/**
 * Billing state assumed before `/me` has answered (and in embedded mode).
 *
 * Free rather than null so nothing downstream has to handle "unknown plan".
 * The pessimistic default is the right one: briefly showing Free to a Pro user
 * while `/me` is in flight is a cosmetic glitch, whereas briefly showing Pro to
 * a Free user would flash paid features they do not have.
 */
export const DEFAULT_BILLING: BillingStateDto = {
  plan: 'free',
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  manageable: false,
};

/** Preferences assumed before `/me` has answered (and for embedded mode). */
export const DEFAULT_PREFERENCES: PreferencesDto = {
  units: 'mm',
  theme: 'cad-dark',
  // Not the resolved browser language: this default only applies before `/me`
  // answers, and LanguageService has already picked the right language from
  // localStorage or the browser by then. Putting anything else here would make
  // `applyPreferences` fight that choice on every load.
  locale: 'en',
  role: null,
  defaultTemplate: 'blank',
  autosaveIntervalSec: 30,
  uiState: null,
  // Assume opted in, matching the server's column default: the toggles must not
  // flash "off" while `/me` is in flight and then flip on when it answers.
  emailOnShare: true,
  emailOnOrgActivity: true,
};

/**
 * The signed-in user's profile and preferences (`/me`).
 *
 * Design decisions:
 *  - **One cached record, deduped loads.** Guards, the dashboard shell and the
 *    settings page all need `/me`; `load()` returns the cached value or joins
 *    the in-flight request so a navigation never issues it twice. `invalidate()`
 *    forces the next `load()` to refetch (after onboarding, sign-out …).
 *  - **Preferences are applied, not just stored.** Whenever a `/me` response or
 *    a preferences update arrives, the theme is pushed to `ThemeService` and the
 *    autosave interval to `AutosaveService`, so the editor reflects the account
 *    settings without each page having to remember to do so.
 *  - **Autosave is reached lazily.** `AutosaveService` pulls in the export and
 *    document stack — most of the editor. A static import here would drag all
 *    of that into the initial bundle via the route guards, so it is loaded with
 *    a dynamic import the first time an interval actually has to be applied.
 */
@Injectable({ providedIn: 'root' })
export class MeService {
  private readonly api = inject(HttpManagerService);
  private readonly theme = inject(ThemeService);
  private readonly language = inject(LanguageService);
  private readonly injector = inject(Injector);

  private inflight: Promise<MeDto> | null = null;

  /** Latest `/me` payload, or null before the first load / after `invalidate()`. */
  readonly me = signal<MeDto | null>(null);
  /** True once the user completed onboarding. False while unknown. */
  readonly onboarded = computed(() => this.me()?.onboarded ?? false);
  /** Effective preferences — server values when known, sensible defaults otherwise. */
  readonly preferences = computed<PreferencesDto>(() => this.me()?.preferences ?? DEFAULT_PREFERENCES);

  /** Current plan and period. Free until `/me` says otherwise. */
  readonly billing = computed<BillingStateDto>(() => this.me()?.billing ?? DEFAULT_BILLING);

  /** The effective plan, for feature checks and the plan badge. */
  readonly plan = computed(() => this.billing().plan);

  /** True on any paid plan. */
  readonly isPaid = computed(() => this.plan() !== 'free');

  /** Cached `/me`, fetching once if needed. Concurrent callers share one request. */
  load(): Promise<MeDto> {
    const cached = this.me();
    if (cached) return Promise.resolve(cached);
    if (!this.inflight) {
      this.inflight = this.fetch().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Drop the cached record so the next `load()` hits the API. */
  invalidate(): void {
    this.me.set(null);
  }

  /** `invalidate()` + `load()`. */
  refresh(): Promise<MeDto> {
    this.invalidate();
    return this.load();
  }

  /** `POST /me/onboarding` — idempotent on the server; updates the cache. */
  async completeOnboarding(req: CompleteOnboardingRequest): Promise<MeDto> {
    const me = await firstValueFrom(this.api.post<MeDto>('me/onboarding', req));
    this.me.set(me);
    this.applyPreferences(me.preferences);
    return me;
  }

  /** `PATCH /me/preferences` — partial update; applies theme + autosave interval. */
  async updatePreferences(patch: Partial<PreferencesDto>): Promise<PreferencesDto> {
    const prefs = await firstValueFrom(this.api.patch<PreferencesDto>('me/preferences', patch));
    this.me.update((m) => (m ? { ...m, preferences: prefs } : m));
    this.applyPreferences(prefs);
    return prefs;
  }

  /**
   * Replace the cached billing state after a checkout return or a portal visit.
   *
   * Patches the cached `/me` rather than invalidating it: re-reading all of
   * `/me` would refetch the workspace list and usage for a change that touched
   * one field, and would make the settings pane flash its skeletons.
   */
  setBilling(billing: BillingStateDto): void {
    this.me.update((m) => (m ? { ...m, billing } : m));
  }

  /** Push preferences into the running editor services (theme, autosave). */
  applyPreferences(prefs: PreferencesDto): void {
    if (prefs.theme) this.theme.setTheme(prefs.theme); // unknown ids are ignored by ThemeService
    if (prefs.locale) this.language.setLocale(prefs.locale); // unknown codes are ignored by LanguageService
    if (prefs.autosaveIntervalSec > 0) void this.applyAutosaveInterval(prefs.autosaveIntervalSec);
  }

  private async fetch(): Promise<MeDto> {
    const me = await firstValueFrom(this.api.get<MeDto>('me'));
    this.me.set(me);
    this.applyPreferences(me.preferences);
    return me;
  }

  private async applyAutosaveInterval(sec: number): Promise<void> {
    try {
      const { AutosaveService } = await import('../../features/cad-editor/core/services/autosave.service');
      this.injector.get(AutosaveService).setIntervalMs(sec * 1000);
    } catch (e) {
      console.warn('[CAD] could not apply autosave interval', e);
    }
  }
}
