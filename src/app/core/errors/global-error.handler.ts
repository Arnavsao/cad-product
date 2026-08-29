import { ErrorHandler, Injectable, inject } from '@angular/core';
import { NotificationService } from '../services/notification.service';
import { environment } from '../../../environments/environment';

/**
 * Last-resort error handler: logs every uncaught error and surfaces a single,
 * non-technical toast so the user knows something went wrong without the app
 * appearing frozen. Errors are throttled so a render loop cannot spam toasts.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private notify = inject(NotificationService);
  private lastToastAt = 0;

  handleError(error: unknown): void {
    console.error('[CAD] Uncaught error:', error);
    const now = Date.now();
    if (now - this.lastToastAt < 5000) return;
    this.lastToastAt = now;
    const message = environment.production
      ? 'Something went wrong. Your drawing is still open — try the action again.'
      : `Unexpected error: ${(error as Error)?.message ?? String(error)}`;
    this.notify.error(message, 6000);
  }
}
