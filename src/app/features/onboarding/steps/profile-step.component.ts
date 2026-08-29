import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { UiInputDirective } from '../../../shared/ui/input.directive';
import { OnboardingDraft, ROLE_CHOICES, RoleChoiceId } from '../onboarding.model';

/**
 * Step 1 — who the user is. Presentational: it renders the draft and emits
 * patches, so the wizard keeps the single source of truth.
 */
@Component({
  selector: 'app-onboarding-profile-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiInputDirective],
  template: `
    <h2 class="ob-step__title">Let's set up your workspace</h2>
    <p class="ob-step__sub">We use your name on drawings you share. You can change all of this later in Settings.</p>

    <div class="ob-names">
      <label class="ob-field">
        <span class="ob-field__label">First name</span>
        <input
          uiInput
          type="text"
          autocomplete="given-name"
          [value]="draft().firstName"
          (input)="patch.emit({ firstName: value($event) })"
        />
      </label>
      <label class="ob-field">
        <span class="ob-field__label">Last name</span>
        <input
          uiInput
          type="text"
          autocomplete="family-name"
          [value]="draft().lastName"
          (input)="patch.emit({ lastName: value($event) })"
        />
      </label>
    </div>

    <fieldset class="ob-chips">
      <legend class="ob-field__label">What best describes your work?</legend>
      <div class="ob-chips__row">
        @for (choice of roles; track choice.id) {
          <button
            type="button"
            class="ob-chip"
            [class.ob-chip--on]="draft().roleChoice === choice.id"
            [attr.aria-pressed]="draft().roleChoice === choice.id"
            (click)="pick(choice.id)"
          >
            {{ choice.label }}
          </button>
        }
      </div>
    </fieldset>
  `,
  styles: [
    `
      :host { display: block; }
      .ob-names { display: grid; grid-template-columns: 1fr 1fr; gap: var(--ui-space-3); margin-top: var(--ui-space-6); }
      .ob-field { display: block; }
      .ob-field__label {
        display: block; margin-bottom: 6px; padding: 0;
        font-size: var(--ui-text-sm); font-weight: 600; letter-spacing: .02em; color: var(--ui-text-dim);
      }
      .ob-chips { border: 0; margin: var(--ui-space-6) 0 0; padding: 0; }
      .ob-chips__row { display: flex; flex-wrap: wrap; gap: var(--ui-space-2); }
      .ob-chip {
        height: 34px; padding: 0 16px;
        border: 1px solid var(--ui-border); border-radius: var(--ui-radius-full);
        background: var(--ui-surface-raised); color: var(--ui-text);
        font: 500 var(--ui-text-md) / 1 var(--ui-font); cursor: pointer;
        transition: background var(--ui-dur-fast), border-color var(--ui-dur-fast), color var(--ui-dur-fast);
      }
      .ob-chip:hover { background: var(--ui-hover); border-color: var(--ui-border-strong); }
      .ob-chip:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
      .ob-chip--on {
        background: var(--ui-accent-tint); border-color: var(--ui-accent); color: var(--ui-text-strong);
      }
      @media (max-width: 520px) { .ob-names { grid-template-columns: 1fr; } }
    `,
  ],
})
export class OnboardingProfileStepComponent {
  readonly draft = input.required<OnboardingDraft>();
  readonly patch = output<Partial<OnboardingDraft>>();

  protected readonly roles = ROLE_CHOICES;

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected pick(id: RoleChoiceId): void {
    this.patch.emit({ roleChoice: this.draft().roleChoice === id ? null : id });
  }
}
