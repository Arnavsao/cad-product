import { Directive, booleanAttribute, input } from '@angular/core';

/**
 * Text-control primitive for `<input>`, `<select>` and `<textarea>`.
 * Opts the element into the app-wide form baseline (see styles.scss, which is
 * scoped to `.cad-editor-root` and `[uiInput]` so it never leaks into third-party
 * mounted forms) and adds focus/invalid styling from `shared/ui/ui.scss`.
 *
 * ```html
 * <input uiInput type="text" placeholder="Drawing name" [invalid]="nameTaken()" />
 * ```
 */
@Directive({
  selector: 'input[uiInput], select[uiInput], textarea[uiInput]',
  standalone: true,
  host: {
    class: 'ui-input',
    '[class.ui-input--invalid]': 'invalid()',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
  },
})
export class UiInputDirective {
  readonly invalid = input(false, { transform: booleanAttribute });
}
