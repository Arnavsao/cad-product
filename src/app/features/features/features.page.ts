import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiGridBackdropComponent } from '../../shared/ui/grid-backdrop.component';
import { UiLogoComponent } from '../../shared/ui/logo.component';
import { UiRevealDirective } from '../../shared/ui/reveal.directive';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';

/**
 * Public features page (`/features`).
 *
 * One scroll-drawn diagram per capability, each drafted in the same visual
 * language as the landing hero: every figure is a `.ui-sheet` publishing its own
 * view timeline, so each assembles independently as it reaches the viewport
 * rather than all four firing at once (see `blueprint.scss`).
 *
 * Deliberately has no logic beyond the shared header: like the landing page it
 * must paint before auth resolves, so the call to action renders a skeleton
 * until `isLoaded()`.
 */
@Component({
  selector: 'app-features',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    UiButtonDirective,
    UiGridBackdropComponent,
    UiLogoComponent,
    UiRevealDirective,
    UiSkeletonComponent,
  ],
  templateUrl: './features.page.html',
  styleUrl: './features.page.scss',
})
export class FeaturesPage {
  protected readonly auth = inject(SupabaseAuthService);
  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();
}
