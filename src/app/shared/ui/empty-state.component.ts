import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIconComponent, UiIconName } from './icon.component';

/**
 * Centered placeholder for empty lists / folders. Project actions into it.
 *
 * ```html
 * <ui-empty-state icon="folder" heading="This folder doesn't contain any files"
 *                 description="Create a drawing or upload a DXF to get started.">
 *   <button uiButton variant="primary">New drawing</button>
 * </ui-empty-state>
 * ```
 */
@Component({
  selector: 'ui-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIconComponent],
  template: `
    <div class="es" role="status">
      @if (icon(); as i) {
        <div class="es__icon"><ui-icon [name]="i" [size]="26" [strokeWidth]="1.5" /></div>
      }
      <h3 class="es__title">{{ heading() }}</h3>
      @if (description()) {
        <p class="es__desc">{{ description() }}</p>
      }
      <div class="es__actions"><ng-content /></div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .es {
        display: flex; flex-direction: column; align-items: center; text-align: center;
        padding: var(--ui-space-12) var(--ui-space-6);
        color: var(--ui-text-dim);
      }
      .es__icon {
        display: grid; place-items: center;
        width: 56px; height: 56px; margin-bottom: var(--ui-space-4);
        border-radius: var(--ui-radius-full);
        background: var(--ui-hover); color: var(--ui-text-dim);
        border: 1px solid var(--ui-border);
      }
      .es__title { margin: 0; font: 600 var(--ui-text-lg) / var(--ui-leading-tight) var(--ui-font); color: var(--ui-text); }
      .es__desc { margin: var(--ui-space-2) 0 0; max-width: 42ch; font-size: var(--ui-text-md); line-height: var(--ui-leading); }
      .es__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--ui-space-2); margin-top: var(--ui-space-5); }
      .es__actions:empty { display: none; }
    `,
  ],
})
export class UiEmptyStateComponent {
  readonly icon = input<UiIconName | null>(null);
  readonly heading = input.required<string>();
  readonly description = input<string>('');
}
