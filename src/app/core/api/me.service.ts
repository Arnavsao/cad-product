import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ThemeService } from '../../features/cad-editor/core/services/theme.service';
import { HttpManagerService } from '../services/http-manager.service';
import { CompleteOnboardingRequest, MeDto, PreferencesDto } from './api.models';

/** Preferences assumed before `/me` has answered (and for embedded mode). */
export const DEFAULT_PREFERENCES: PreferencesDto = {
  units: 'mm',
  theme: 'cad-dark',
  role: null,
  defaultTemplate: 'blank',
  autosaveIntervalSec: 30,
  uiState: null,
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
  private readonly injector = inject(Injector);

  private inflight: Promise<MeDto> | null = null;

  /** Latest `/me` payload, or null before the first load / after `invalidate()`. */
  readonly me = signal<MeDto | null>(null);
  /** True once the user completed onboarding. False while unknown. */
  readonly onboarded = computed(() => this.me()?.onboarded ?? false);
  /** Effective preferences — server values when known, sensible defaults otherwise. */
  readonly preferences = computed<PreferencesDto>(() => this.me()?.preferences ?? DEFAULT_PREFERENCES);

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

  /** Push preferences into the running editor services (theme, autosave). */
  applyPreferences(prefs: PreferencesDto): void {
    if (prefs.theme) this.theme.setTheme(prefs.theme); // unknown ids are ignored by ThemeService
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
