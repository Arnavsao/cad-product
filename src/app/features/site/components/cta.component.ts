import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { SupabaseAuthService } from '../../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiSkeletonComponent } from '../../../shared/ui/skeleton.component';

/**
 * The auth-aware pair of calls to action every public page ends with.
 *
 * One component instead of the `@if (!auth.enabled()) … @else if …` block that
 * used to be copied into each page: signed-out visitors get sign-up + a
 * secondary link, signed-in ones go to the dashboard, embedded mode opens the
 * editor, and the buttons render as skeletons until the session is known so the
 * page never flashes the wrong pair.
 *
 * `primaryLabel` / `secondaryLabel` are display strings (pass `t('…')` from the
 * parent); unset, they fall back to translated defaults.
 */
@Component({
  selector: 'site-cta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoDirective, UiButtonDirective, UiSkeletonComponent],
  template: `
    <ng-container *transloco="let t">
    @if (!auth.enabled()) {
      <a uiButton variant="primary" [size]="size()" routerLink="/editor">{{ t('site.components.cta.openEditor') }}</a>
    } @else if (!auth.isLoaded()) {
      <ui-skeleton [width]="size() === 'lg' ? '150px' : '120px'" [height]="size() === 'lg' ? '44px' : '36px'" radius="var(--ui-radius-lg)" />
      <ui-skeleton [width]="size() === 'lg' ? '130px' : '100px'" [height]="size() === 'lg' ? '44px' : '36px'" radius="var(--ui-radius-lg)" />
    } @else if (auth.isSignedIn()) {
      <a uiButton variant="primary" [size]="size()" routerLink="/dashboard">{{ t('site.components.cta.goToDashboard') }}</a>
      <a uiButton [size]="size()" routerLink="/editor">{{ t('site.components.cta.openEditor') }}</a>
    } @else {
      <a uiButton variant="primary" [size]="size()" routerLink="/sign-up">{{ primaryLabel() ?? t('site.components.cta.createFreeAccount') }}</a>
      @if (secondaryLink()) {
        <a uiButton [size]="size()" [variant]="secondaryVariant()" [routerLink]="secondaryLink()">{{ secondaryLabel() ?? t('site.components.cta.seeHowItWorks') }}</a>
      }
    }
    </ng-container>
  `,
  host: { class: 'site-cta' },
  styles: [
    `
      :host { display: flex; flex-wrap: wrap; gap: var(--ui-space-3); min-height: 44px; }
      :host(.site-cta--center) { justify-content: center; }
    `,
  ],
})
export class SiteCtaComponent {
  protected readonly auth = inject(SupabaseAuthService);

  readonly primaryLabel = input<string | undefined>(undefined);
  readonly secondaryLabel = input<string | undefined>(undefined);
  readonly secondaryLink = input<string | null>('/product');
  readonly secondaryVariant = input<'secondary' | 'ghost'>('secondary');
  readonly size = input<'md' | 'lg'>('lg');
}
