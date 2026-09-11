import { ErrorHandler, Injectable, Injector, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { NotificationService } from '../services/notification.service';
import { environment } from '../../../environments/environment';
import { reportError } from './sentry.init';

/**
 * Last-resort error handler: logs every uncaught error and surfaces a single,
 * non-technical toast so the user knows something went wrong without the app
 * appearing frozen. Errors are throttled so a render loop cannot spam toasts.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private notify = inject(NotificationService);
  // Resolved lazily: the ErrorHandler is created before most of the injector,
  // and pulling Transloco (and its HTTP loader) in eagerly here would widen
  // the set of things whose construction failure has no handler.
  private readonly injector = inject(Injector);
  private lastToastAt = 0;

  handleError(error: unknown): void {
    console.error('[CAD] Uncaught error:', error);
    reportError(error);
    const now = Date.now();
    if (now - this.lastToastAt < 5000) return;
    this.lastToastAt = now;
    const message = environment.production
      ? this.fallbackMessage()
      : `Unexpected error: ${(error as Error)?.message ?? String(error)}`;
    this.notify.error(message, 6000);
  }

  /** Translated where possible; the English literal if the failure was in i18n itself. */
  private fallbackMessage(): string {
    try {
      return this.injector.get(TranslocoService).translate('app.uncaughtError');
    } catch {
      return 'Something went wrong. Your drawing is still open — try the action again.';
    }
  }
}
