import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  /** Total lifetime in ms; the toast's progress bar runs over this. */
  duration: number;
  /** True while the pointer rests on the toast and the countdown is held. */
  paused: boolean;
}

/** At most this many toasts are on screen; the oldest are dropped first. */
const MAX_VISIBLE = 4;

/**
 * Signal-based toast queue rendered by `NotificationDisplayComponent`.
 *
 * Every toast auto-dismisses, but the countdown pauses while the pointer is on
 * it — a message you are reading should not vanish under your cursor — and
 * resumes with whatever time was left when you move away.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly notifications = signal<Notification[]>([]);
  private idCounter = 0;
  private readonly timers = new Map<string, { handle: ReturnType<typeof setTimeout>; endsAt: number; remaining: number }>();

  success(message: string, duration = 4000): void { this.show(message, 'success', duration); }
  error(message: string, duration = 6000): void { this.show(message, 'error', duration); }
  info(message: string, duration = 4000): void { this.show(message, 'info', duration); }
  warning(message: string, duration = 5000): void { this.show(message, 'warning', duration); }

  remove(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer.handle);
    this.timers.delete(id);
    this.notifications.update((list) => list.filter((n) => n.id !== id));
  }

  /** Hold the countdown (pointer over the toast). */
  pause(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    timer.remaining = Math.max(0, timer.endsAt - Date.now());
    this.setPaused(id, true);
  }

  /** Resume the countdown with the time that was left. */
  resume(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    timer.endsAt = Date.now() + timer.remaining;
    timer.handle = setTimeout(() => this.remove(id), timer.remaining);
    this.setPaused(id, false);
  }

  private show(message: string, type: NotificationType, duration: number): void {
    const id = `notification-${++this.idCounter}`;
    this.notifications.update((list) => {
      const next = [...list, { id, message, type, duration, paused: false }];
      // Drop the oldest beyond the cap so a burst of errors cannot wall the screen.
      while (next.length > MAX_VISIBLE) {
        const dropped = next.shift()!;
        const t = this.timers.get(dropped.id);
        if (t) clearTimeout(t.handle);
        this.timers.delete(dropped.id);
      }
      return next;
    });
    this.timers.set(id, {
      handle: setTimeout(() => this.remove(id), duration),
      endsAt: Date.now() + duration,
      remaining: duration,
    });
  }

  private setPaused(id: string, paused: boolean): void {
    this.notifications.update((list) => list.map((n) => (n.id === id ? { ...n, paused } : n)));
  }
}
