import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Units } from '../../../core/api/api.models';
import { CAD_THEMES, ICadTheme } from '../../cad-editor/core/services/theme.service';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { OnboardingDraft, UNIT_CHOICES } from '../onboarding.model';

/** The two grounds offered during onboarding; the full picker lives in Settings. */
const PREVIEW_THEME_IDS = ['cad-dark', 'cad-light'] as const;

/**
 * Step 2 — drawing defaults. Units feed `$INSUNITS` on new documents; the theme
 * is applied live by the wizard as soon as a tile is chosen, so the preview is
 * the app itself rather than a picture of it.
 */
@Component({
  selector: 'app-onboarding-defaults-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    <h2 class="ob-step__title">Pick your defaults</h2>
    <p class="ob-step__sub">New drawings start with these. Both can be changed per drawing at any time.</p>

    <div class="ob-block">
      <span class="ob-block__label" id="ob-units-label">Drawing units</span>
      <div class="ob-seg" role="radiogroup" aria-labelledby="ob-units-label">
        @for (unit of units; track unit.id) {
          <button
            type="button"
            role="radio"
            class="ob-seg__btn"
            [class.ob-seg__btn--on]="draft().units === unit.id"
            [attr.aria-checked]="draft().units === unit.id"
            [attr.aria-label]="unit.name"
            (click)="pickUnits(unit.id)"
          >
            {{ unit.label }}
          </button>
        }
      </div>
      <p class="ob-block__hint">{{ unitName() }}</p>
    </div>

    <div class="ob-block">
      <span class="ob-block__label" id="ob-theme-label">Appearance</span>
      <div class="ob-themes" role="radiogroup" aria-labelledby="ob-theme-label">
        @for (theme of themes; track theme.id) {
          <button
            type="button"
            role="radio"
            class="ob-theme"
            [class.ob-theme--on]="draft().themeId === theme.id"
            [attr.aria-checked]="draft().themeId === theme.id"
            (click)="patch.emit({ themeId: theme.id })"
          >
            <span class="ob-theme__tile" [style.background]="theme.swatch[0]" aria-hidden="true">
              <span class="ob-theme__bar" [style.background]="theme.swatch[1]">
                <span class="ob-theme__dot" [style.background]="theme.swatch[2]"></span>
              </span>
              <span class="ob-theme__grid" [style.color]="theme.canvas.gridMajor"></span>
              <span class="ob-theme__line" [style.background]="theme.canvas.entityDefault"></span>
            </span>
            <span class="ob-theme__name">
              {{ theme.name }}
              @if (draft().themeId === theme.id) {
                <ui-icon name="check" [size]="14" />
              }
            </span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .ob-block { margin-top: var(--ui-space-6); }
      .ob-block__label {
        display: block; margin-bottom: 8px;
        font-size: var(--ui-text-sm); font-weight: 600; letter-spacing: .02em; color: var(--ui-text-dim);
      }
      .ob-block__hint { margin: 8px 0 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .ob-seg {
        display: inline-flex; padding: 3px; gap: 2px;
        background: var(--ui-surface-raised); border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md);
      }
      .ob-seg__btn {
        min-width: 54px; height: 30px; padding: 0 12px;
        border: 0; border-radius: var(--ui-radius-sm);
        background: transparent; color: var(--ui-text-dim);
        font: 500 var(--ui-text-md) / 1 var(--ui-font-mono); cursor: pointer;
        transition: background var(--ui-dur-fast), color var(--ui-dur-fast);
      }
      .ob-seg__btn:hover { color: var(--ui-text); }
      .ob-seg__btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .ob-seg__btn--on { background: var(--ui-accent); color: var(--ui-on-accent); }

      .ob-themes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ui-space-3); }
      .ob-theme {
        display: block; padding: 8px; text-align: left; cursor: pointer;
        background: var(--ui-surface-raised); color: var(--ui-text);
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        transition: border-color var(--ui-dur-fast), box-shadow var(--ui-dur-fast);
      }
      .ob-theme:hover { border-color: var(--ui-border-strong); }
      .ob-theme:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .ob-theme--on { border-color: var(--ui-accent); box-shadow: var(--ui-focus-ring); }
      .ob-theme__tile {
        position: relative; display: block; height: 82px; overflow: hidden;
        border-radius: var(--ui-radius-md);
      }
      .ob-theme__bar { position: absolute; inset: 0 0 auto 0; height: 16px; display: flex; align-items: center; padding-left: 6px; }
      .ob-theme__dot { width: 7px; height: 7px; border-radius: 50%; }
      .ob-theme__grid {
        position: absolute; inset: 16px 0 0 0;
        background-image:
          linear-gradient(to right, currentColor 1px, transparent 1px),
          linear-gradient(to bottom, currentColor 1px, transparent 1px);
        background-size: 13px 13px;
        opacity: .5;
      }
      .ob-theme__line { position: absolute; left: 18%; right: 22%; top: 62%; height: 2px; border-radius: 2px; }
      .ob-theme__name {
        display: flex; align-items: center; justify-content: space-between; gap: 6px;
        padding: 8px 4px 2px; font-size: var(--ui-text-md); font-weight: 500;
      }
      .ob-theme--on .ob-theme__name { color: var(--ui-accent); }
      @media (max-width: 520px) { .ob-themes { grid-template-columns: 1fr; } }
    `,
  ],
})
export class OnboardingDefaultsStepComponent {
  readonly draft = input.required<OnboardingDraft>();
  readonly patch = output<Partial<OnboardingDraft>>();

  protected readonly units = UNIT_CHOICES;
  protected readonly themes: readonly ICadTheme[] = CAD_THEMES.filter((t) =>
    (PREVIEW_THEME_IDS as readonly string[]).includes(t.id),
  );

  protected unitName(): string {
    return UNIT_CHOICES.find((u) => u.id === this.draft().units)?.name ?? '';
  }

  protected pickUnits(units: Units): void {
    this.patch.emit({ units });
  }
}
