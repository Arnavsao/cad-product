import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
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
 */
@Component({
  selector: 'site-cta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiSkeletonComponent],
  template: `
    @if (!auth.enabled()) {
      <a uiButton variant="primary" [size]="size()" routerLink="/editor">Open the editor</a>
    } @else if (!auth.isLoaded()) {
      <ui-skeleton [width]="size() === 'lg' ? '150px' : '120px'" [height]="size() === 'lg' ? '44px' : '36px'" radius="var(--ui-radius-lg)" />
      <ui-skeleton [width]="size() === 'lg' ? '130px' : '100px'" [height]="size() === 'lg' ? '44px' : '36px'" radius="var(--ui-radius-lg)" />
    } @else if (auth.isSignedIn()) {
      <a uiButton variant="primary" [size]="size()" routerLink="/dashboard">Go to dashboard</a>
      <a uiButton [size]="size()" routerLink="/editor">Open the editor</a>
    } @else {
      <a uiButton variant="primary" [size]="size()" routerLink="/sign-up">{{ primaryLabel() }}</a>
      @if (secondaryLink()) {
        <a uiButton [size]="size()" [variant]="secondaryVariant()" [routerLink]="secondaryLink()">{{ secondaryLabel() }}</a>
      }
    }
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

  readonly primaryLabel = input('Create a free account');
  readonly secondaryLabel = input('See how it works');
  readonly secondaryLink = input<string | null>('/product');
  readonly secondaryVariant = input<'secondary' | 'ghost'>('secondary');
  readonly size = input<'md' | 'lg'>('lg');
}
