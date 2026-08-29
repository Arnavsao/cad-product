import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-notification-display',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notification-container" role="status" aria-live="polite">
      @for (n of notifications.notifications(); track n.id) {
        <div class="notification" [class]="'notification notification-' + n.type" (click)="notifications.remove(n.id)">
          <div class="notification-icon" aria-hidden="true">
            @switch (n.type) {
              @case ('success') { <span>✓</span> }
              @case ('info') { <span>ⓘ</span> }
              @default { <span>!</span> }
            }
          </div>
          <div class="notification-message">{{ n.message }}</div>
          <button type="button" class="notification-close" aria-label="Dismiss"
                  (click)="notifications.remove(n.id); $event.stopPropagation()">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .notification-container { position: fixed; top: 24px; right: 24px; z-index: 2000; display: flex; flex-direction: column; gap: 12px; pointer-events: none; }
    .notification { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0,0,0,.15); font-size: 13px; font-weight: 500; min-width: 300px; max-width: 400px; pointer-events: auto; cursor: pointer; color: #fff; animation: slideIn .3s cubic-bezier(.34,1.56,.64,1); }
    @keyframes slideIn { from { transform: translateX(420px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    .notification-success { background: linear-gradient(135deg, #10b981, #059669); }
    .notification-error   { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .notification-warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
    .notification-info    { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .notification-icon { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; font-weight: 700; font-size: 14px; }
    .notification-message { flex: 1; line-height: 1.4; }
    .notification-close { background: none; border: none; color: inherit; cursor: pointer; font-size: 12px; padding: 0; flex-shrink: 0; opacity: .7; transition: opacity .2s; }
    .notification-close:hover { opacity: 1; }
    @media (max-width: 600px) { .notification-container { top: 12px; right: 12px; left: 12px; } .notification { min-width: unset; max-width: unset; } }
  `],
})
export class NotificationDisplayComponent {
  protected notifications = inject(NotificationService);
}
