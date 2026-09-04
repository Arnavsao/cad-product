import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { MeService } from '../../core/api/me.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { ThemeService } from '../cad-editor/core/services/theme.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiLogoComponent } from '../../shared/ui/logo.component';
import { OnboardingDraft, roleOf } from './onboarding.model';
import { OnboardingDefaultsStepComponent } from './steps/defaults-step.component';
import { OnboardingFinishStepComponent } from './steps/finish-step.component';
import { OnboardingProfileStepComponent } from './steps/profile-step.component';

const STEP_TITLES = ['Profile', 'Defaults', 'Finish'] as const;
const LAST_STEP = STEP_TITLES.length;

/**
 * Three-step first-run wizard (`/onboarding`).
 *
 * Design decisions:
 *  - **One draft signal, dumb steps.** Every step renders `draft()` and emits a
 *    patch; nothing is committed until Finish, so Back never loses input and
 *    there is exactly one place that assembles the request.
 *  - **Theme is applied optimistically.** Picking a tile calls `ThemeService`
 *    immediately (the preview is the running app) and is persisted afterwards
 *    with `PATCH /me/preferences`; failing to persist it never blocks the flow.
 *  - **Never a dead end.** Nothing is required: Continue always works, "Skip for
 *    now" posts sensible defaults, and an API failure shows an inline error with
 *    Retry instead of leaving the user stranded on a spinner.
 */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiButtonDirective,
    UiIconComponent,
    UiLogoComponent,
    OnboardingProfileStepComponent,
    OnboardingDefaultsStepComponent,
    OnboardingFinishStepComponent,
  ],
  template: `
    <div class="ob">
      <header class="ob__top">
        <a class="brand" routerLink="/" aria-label="CADO home">
          <span class="brand__mark" aria-hidden="true"><ui-logo [size]="16" /></span>
          <span class="brand__name">{{ appName }}</span>
        </a>
        <button type="button" uiButton variant="ghost" size="sm" [disabled]="submitting()" (click)="skip()">
          Skip for now
        </button>
      </header>

      <main class="ob__main">
        <div class="ob__card" (keydown.enter)="onEnter($event)">
          <ol class="ob-progress" aria-label="Onboarding progress">
            @for (title of titles; track title; let i = $index) {
              <li
                class="ob-progress__item"
                [class.ob-progress__item--on]="step() === i + 1"
                [class.ob-progress__item--done]="step() > i + 1"
                [attr.aria-current]="step() === i + 1 ? 'step' : null"
              >
                <span class="ob-progress__num">
                  @if (step() > i + 1) {
                    <ui-icon name="check" [size]="13" />
                  } @else {
                    {{ i + 1 }}
                  }
                </span>
                <span class="ob-progress__label">{{ title }}</span>
              </li>
            }
          </ol>

          <div class="ob-step">
            @switch (step()) {
              @case (1) {
                <app-onboarding-profile-step [draft]="draft()" (patch)="applyPatch($event)" />
              }
              @case (2) {
                <app-onboarding-defaults-step [draft]="draft()" (patch)="applyPatch($event)" />
              }
              @default {
                <app-onboarding-finish-step [draft]="draft()" />
              }
            }
          </div>

          @if (error(); as message) {
            <p class="ob-error" role="alert">
              <ui-icon name="alert" [size]="15" />
              <span>{{ message }}</span>
            </p>
          }

          <footer class="ob__actions">
            <button type="button" uiButton variant="ghost" [disabled]="step() === 1 || submitting()" (click)="back()">
              <ui-icon name="back" [size]="15" />
              Back
            </button>
            <span class="ob__count">Step {{ step() }} of {{ lastStep }}</span>
            @if (step() < lastStep) {
              <button type="button" uiButton variant="primary" (click)="next()">
                Continue
                <ui-icon name="chevron-right" [size]="15" />
              </button>
            } @else {
              <button type="button" uiButton variant="primary" [loading]="submitting()" [disabled]="submitting()" (click)="finish()">
                {{ error() ? 'Try again' : 'Go to dashboard' }}
              </button>
            }
          </footer>
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100%; }
      .ob {
        display: flex; flex-direction: column; min-height: 100vh;
        background: var(--ui-bg); color: var(--ui-text); font-family: var(--ui-font);
      }
      .ob__top {
        display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4);
        padding: 20px clamp(20px, 5vw, 48px);
      }
      /*
       * align-items: center is what stops the card being stranded at the top of
       * a tall viewport: the wrapper is min-height: 100vh, so without it the
       * card sat under the header and left the whole lower half empty. The old
       * margin-top on the card is gone for the same reason — it was pushing
       * against a box that is now centred.
       */
      .ob__main {
        flex: 1; display: flex; align-items: center; justify-content: center;
        padding: clamp(16px, 4vh, 40px) 20px clamp(32px, 6vh, 56px);
      }
      .ob__card {
        width: 100%; max-width: 560px;
        padding: clamp(24px, 4vw, 36px);
        background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-xl);
        box-shadow: var(--ui-shadow-panel);
      }
      .ob__actions {
        display: flex; align-items: center; gap: var(--ui-space-3);
        margin-top: var(--ui-space-8); padding-top: var(--ui-space-5);
        border-top: 1px solid var(--ui-border);
      }
      .ob__count { flex: 1; text-align: center; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .ob-progress { display: flex; gap: var(--ui-space-2); list-style: none; margin: 0 0 var(--ui-space-2); padding: 0; }
      .ob-progress__item {
        display: flex; align-items: center; gap: 8px; flex: 1;
        font-size: var(--ui-text-sm); color: var(--ui-text-dim);
      }
      .ob-progress__num {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 22px; height: 22px; border-radius: var(--ui-radius-full);
        border: 1px solid var(--ui-border); background: var(--ui-surface-raised);
        font-size: var(--ui-text-xs); font-weight: 600;
      }
      .ob-progress__item--on { color: var(--ui-text-strong); }
      .ob-progress__item--on .ob-progress__num { border-color: var(--ui-accent); color: var(--ui-accent); background: var(--ui-accent-tint); }
      .ob-progress__item--done .ob-progress__num { border-color: transparent; background: var(--ui-accent); color: var(--ui-on-accent); }
      .ob-progress__label { white-space: nowrap; }

      .ob-step { padding-top: var(--ui-space-4); }
      .ob-error {
        display: flex; align-items: flex-start; gap: 8px;
        margin: var(--ui-space-5) 0 0; padding: 10px 12px;
        border: 1px solid var(--ui-danger); border-radius: var(--ui-radius-md);
        background: var(--ui-danger-tint); color: var(--ui-text);
        font-size: var(--ui-text-md);
      }
      .ob-error ui-icon { color: var(--ui-danger); flex: 0 0 auto; margin-top: 1px; }

      .brand {
        display: inline-flex; align-items: center; gap: 10px;
        color: var(--ui-text-strong); text-decoration: none; font-weight: 600;
        font-size: var(--ui-text-base); letter-spacing: -.01em;
      }
      .brand:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 4px; border-radius: var(--ui-radius-sm); }
      .brand__mark {
        display: grid; place-items: center; width: 28px; height: 28px;
        border-radius: var(--ui-radius-md); background: var(--ui-accent); color: var(--ui-on-accent);
      }

      @media (max-width: 520px) {
        .ob-progress__label { display: none; }
        .ob-progress__item { flex: 0 0 auto; }
      }
    `,
  ],
})
export class OnboardingPage {
  private readonly me = inject(MeService);
  private readonly auth = inject(SupabaseAuthService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;
  protected readonly titles = STEP_TITLES;
  protected readonly lastStep = LAST_STEP;

  protected readonly step = signal(1);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly draft = signal<OnboardingDraft>({
    firstName: '',
    lastName: '',
    roleChoice: null,
    units: this.me.preferences().units,
    themeId: this.theme.themeId(),
  });

  /** Set once the user edits a name field, so the prefill stops overwriting it. */
  private namesTouched = false;

  constructor() {
    void this.me.load().catch(() => undefined);

    // The session resolves after the first paint; prefill the name fields then,
    // unless the user has already typed something.
    effect(() => {
      const profile = this.me.me()?.user ?? null;
      const first = this.auth.userFirstName() || (profile?.firstName ?? '');
      const last = this.auth.userLastName() || (profile?.lastName ?? '');
      untracked(() => {
        if (this.namesTouched || (!first && !last)) return;
        this.draft.update((d) => ({ ...d, firstName: d.firstName || first, lastName: d.lastName || last }));
      });
    });
  }

  protected applyPatch(patch: Partial<OnboardingDraft>): void {
    if ('firstName' in patch || 'lastName' in patch) this.namesTouched = true;
    this.draft.update((d) => ({ ...d, ...patch }));
    if (patch.themeId) this.theme.setTheme(patch.themeId);
  }

  protected next(): void {
    this.error.set(null);
    this.step.update((s) => Math.min(LAST_STEP, s + 1));
  }

  protected back(): void {
    this.error.set(null);
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** Enter advances, except when the focus is already on something that handles it. */
  protected onEnter(event: Event): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA') return;
    event.preventDefault();
    if (this.step() < LAST_STEP) this.next();
    else void this.finish();
  }

  /** Accept the defaults and get out of the way. */
  protected skip(): void {
    void this.submit(true);
  }

  protected finish(): void {
    void this.submit(false);
  }

  private async submit(skipped: boolean): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    const draft = this.draft();

    try {
      if (!skipped) await this.syncName(draft);
      await this.me.completeOnboarding({
        role: skipped ? 'other' : roleOf(draft.roleChoice),
        units: skipped ? 'mm' : draft.units,
        defaultTemplate: 'blank',
      });
      if (!skipped && draft.themeId && draft.themeId !== this.me.preferences().theme) {
        // Cosmetic only — the theme is already applied locally.
        await this.me.updatePreferences({ theme: draft.themeId }).catch(() => undefined);
      }
      await this.router.navigateByUrl('/dashboard');
    } catch (e) {
      this.error.set(e instanceof Error && e.message ? e.message : 'We could not save your preferences. Please try again.');
      this.step.set(LAST_STEP);
    } finally {
      this.submitting.set(false);
    }
  }

  /** Push an edited name back to Supabase. Never fatal — the profile page can fix it later. */
  private async syncName(draft: OnboardingDraft): Promise<void> {
    if (!this.auth.enabled()) return;
    if (!this.auth.user()) return;
    const first = draft.firstName.trim();
    const last = draft.lastName.trim();
    // Skip the round trip (and the session refresh it forces) when nothing changed.
    if (first === this.auth.userFirstName() && last === this.auth.userLastName()) return;
    try {
      await this.auth.updateName(first, last);
    } catch (e) {
      console.warn('[CAD] could not update the profile name', e);
    }
  }
}
