import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiSkeletonComponent } from '../../shared/ui/skeleton.component';

/**
 * Public landing page (`/`). Static content so it paints before auth has
 * loaded; the call-to-action area renders skeletons until `isLoaded()` and
 * then shows Sign in / Create account, or — in embedded mode — a single
 * "Open editor". Signed-in visitors are forwarded to the dashboard.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent, UiSkeletonComponent],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage {
  protected readonly auth = inject(SupabaseAuthService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();

  constructor() {
    effect(() => {
      if (this.auth.isLoaded() && this.auth.isSignedIn()) {
        void this.router.navigateByUrl('/dashboard', { replaceUrl: true });
      }
    });
  }
}
