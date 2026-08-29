import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ClerkService } from './core/auth/clerk.service';
import { ThemeService } from './features/cad-editor/core/services/theme.service';
import { NotificationDisplayComponent } from './shared/components/notification-display/notification-display';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NotificationDisplayComponent],
  template: `
    <router-outlet />
    <app-notification-display />
  `,
})
export class App {
  constructor() {
    // Instantiate the theme at the root so `--color-*` tokens, `color-scheme`
    // and the `dark-theme` class are on the document for every route (landing,
    // auth, dashboard) — not only once the editor has been visited.
    inject(ThemeService);
    // Start loading Clerk in the background. Never awaited here: the landing
    // page must paint immediately; guards await `load()` when they need it.
    void inject(ClerkService).load();
  }
}
