import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
export class App {}
