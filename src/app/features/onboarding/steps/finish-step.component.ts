import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { CAD_THEMES } from '../../cad-editor/core/services/theme.service';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { OnboardingDraft, roleLabelKey, unitChoice } from '../onboarding.model';

/** Step 3 — read-back of everything the wizard is about to POST. */
@Component({
  selector: 'app-onboarding-finish-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiIconComponent],
  template: `
    <ng-container *transloco="let t">
    <h2 class="ob-step__title">{{ t('onboarding.finish.title') }}</h2>
    <p class="ob-step__sub">{{ t('onboarding.finish.subtitle') }}</p>

    <dl class="ob-summary">
      <div class="ob-summary__row">
        <dt>{{ t('onboarding.finish.name') }}</dt>
        <dd>{{ fullName() || t('onboarding.finish.notSpecified') }}</dd>
      </div>
      <div class="ob-summary__row">
        <dt>{{ t('onboarding.finish.role') }}</dt>
        <dd>{{ t(roleKey()) }}</dd>
      </div>
      <div class="ob-summary__row">
        <dt>{{ t('onboarding.finish.units') }}</dt>
        @if (unit(); as u) {
          <dd>{{ t('onboarding.finish.unitsValue', { name: t(u.nameKey), abbr: u.label }) }}</dd>
        } @else {
          <dd>{{ draft().units }}</dd>
        }
      </div>
      <div class="ob-summary__row">
        <dt>{{ t('onboarding.finish.appearance') }}</dt>
        <dd>{{ theme() }}</dd>
      </div>
      <div class="ob-summary__row">
        <dt>{{ t('onboarding.finish.template') }}</dt>
        <dd>{{ t('onboarding.finish.blankDrawing') }}</dd>
      </div>
    </dl>

    <p class="ob-note">
      <ui-icon name="cloud" [size]="15" />
      {{ t('onboarding.finish.note') }}
    </p>
    </ng-container>
  `,
  styles: [
    `
      :host { display: block; }
      .ob-summary {
        margin: var(--ui-space-6) 0 0;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-lg);
        overflow: hidden;
      }
      .ob-summary__row {
        display: flex; align-items: center; justify-content: space-between; gap: var(--ui-space-4);
        padding: 11px 16px;
        border-bottom: 1px solid var(--ui-border);
        font-size: var(--ui-text-md);
      }
      .ob-summary__row:last-child { border-bottom: 0; }
      .ob-summary dt { color: var(--ui-text-dim); }
      .ob-summary dd { margin: 0; font-weight: 500; color: var(--ui-text-strong); text-align: right; }
      .ob-note {
        display: flex; align-items: center; gap: 8px;
        margin: var(--ui-space-4) 0 0;
        font-size: var(--ui-text-sm); color: var(--ui-text-dim);
      }
      .ob-note ui-icon { color: var(--ui-accent); }
    `,
  ],
})
export class OnboardingFinishStepComponent {
  readonly draft = input.required<OnboardingDraft>();

  protected readonly fullName = computed(() => `${this.draft().firstName} ${this.draft().lastName}`.trim());
  protected readonly roleKey = computed(() => roleLabelKey(this.draft().roleChoice));
  protected readonly unit = computed(() => unitChoice(this.draft().units));
  protected readonly theme = computed(() => CAD_THEMES.find((t) => t.id === this.draft().themeId)?.name ?? 'CAD Dark');
}
