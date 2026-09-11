import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { SignInHandoffService } from './core/auth/sign-in-handoff.service';
import { SupabaseAuthService } from './core/auth/supabase-auth.service';
import { ThemeService } from './features/cad-editor/core/services/theme.service';
import { NotificationDisplayComponent } from './shared/components/notification-display/notification-display';
import { RouteProgressComponent } from './shared/components/route-progress/route-progress.component';
import { UiLogoLoaderComponent } from './shared/ui/logo-loader.component';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    NotificationDisplayComponent,
    RouteProgressComponent,
    TranslocoDirective,
    UiLogoLoaderComponent,
  ],
  template: `
    <app-route-progress />
    <router-outlet />
    <app-notification-display />

    <!-- Sits above the outlet so it survives /auth/callback → /dashboard, which
         is the whole point: the wait spans that navigation. -->
    @if (handoff.active()) {
      <div class="signin-handoff" *transloco="let t">
        <ui-logo-loader [size]="84" [label]="t('auth.callback.completing')" />
      </div>
    }
  `,
  styles: [`
    .signin-handoff {
      position: fixed;
      inset: 0;
      display: grid;
      place-content: center;
      /* Above the route-progress bar (2000) — that bar is suppressed while this
         is up anyway — but below dialogs, which sit higher still. */
      z-index: 2100;
      background: var(--ui-bg);
    }
  `],
})
export class App {
  protected readonly handoff = inject(SignInHandoffService);

  constructor() {
    // Instantiate the theme at the root so `--color-*` tokens, `color-scheme`
    // and the `dark-theme` class are on the document for every route (landing,
    // auth, dashboard) — not only once the editor has been visited.
    inject(ThemeService);
    // Start loading Supabase auth in the background. Never awaited here: the
    // landing page must paint immediately; guards await `load()` when they need it.
    void inject(SupabaseAuthService).load();
  }
}
