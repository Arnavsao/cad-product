import { Directive, booleanAttribute, input } from '@angular/core';

export type UiButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type UiButtonSize = 'sm' | 'md' | 'lg';

/**
 * Button primitive. Applied to a native `<button>` or `<a>` so semantics,
 * keyboard handling and `disabled` stay native; the directive only adds the
 * `.ui-btn*` classes styled in `shared/ui/ui.scss`.
 *
 * ```html
 * <button uiButton variant="primary" [loading]="saving()">Save</button>
 * <a uiButton variant="ghost" size="sm" routerLink="/dashboard">Back</a>
 * <button uiButton iconOnly aria-label="More"><ui-icon name="more" /></button>
 * ```
 */
@Directive({
  selector: 'button[uiButton], a[uiButton]',
  standalone: true,
  host: {
    class: 'ui-btn',
    '[class.ui-btn--primary]': 'variant() === "primary"',
    '[class.ui-btn--secondary]': 'variant() === "secondary"',
    '[class.ui-btn--ghost]': 'variant() === "ghost"',
    '[class.ui-btn--danger]': 'variant() === "danger"',
    '[class.ui-btn--sm]': 'size() === "sm"',
    '[class.ui-btn--lg]': 'size() === "lg"',
    '[class.ui-btn--icon]': 'iconOnly()',
    '[class.ui-btn--loading]': 'loading()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    '[attr.aria-disabled]': 'loading() ? "true" : null',
  },
})
export class UiButtonDirective {
  readonly variant = input<UiButtonVariant>('secondary');
  readonly size = input<UiButtonSize>('md');
  /** Shows a spinner, hides the label and blocks pointer events. Pair with `[disabled]` for forms. */
  readonly loading = input(false, { transform: booleanAttribute });
  /** Square button holding a single icon. Remember an `aria-label`. */
  readonly iconOnly = input(false, { transform: booleanAttribute });
}
