import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  duration: number;
}

/** Signal-based toast queue rendered by `NotificationDisplayComponent`. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly notifications = signal<Notification[]>([]);
  private idCounter = 0;

  success(message: string, duration = 4000): void { this.show(message, 'success', duration); }
  error(message: string, duration = 5000): void { this.show(message, 'error', duration); }
  info(message: string, duration = 4000): void { this.show(message, 'info', duration); }
  warning(message: string, duration = 4000): void { this.show(message, 'warning', duration); }

  remove(id: string): void {
    this.notifications.update(list => list.filter(n => n.id !== id));
  }

  private show(message: string, type: NotificationType, duration: number): void {
    const id = `notification-${++this.idCounter}`;
    this.notifications.update(list => [...list, { id, message, type, duration }]);
    setTimeout(() => this.remove(id), duration);
  }
}
