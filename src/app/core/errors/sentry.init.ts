import { environment } from '../../../environments/environment';

/**
 * Optional crash reporting via Sentry. Fully inert when `environment.sentryDsn`
 * is empty (today's default): `@sentry/browser` is never even downloaded,
 * because the import below is dynamic and only reached when a DSN exists —
 * bundlers code-split it into its own lazy chunk, so it costs nothing in the
 * common case. Wrapped in try/catch throughout so a bad DSN, an ad-blocker,
 * or a network failure can never itself become an uncaught error.
 */
let sentryReady: typeof import('@sentry/browser') | null = null;

export function initSentry(): void {
  if (!environment.sentryDsn) return;
  import('@sentry/browser')
    .then((Sentry) => {
      Sentry.init({
        dsn: environment.sentryDsn,
        environment: environment.production ? 'production' : 'development',
        // Errors only — no session replay or performance tracing, to keep this
        // a pure crash-reporting integration with no extra runtime cost.
        integrations: [],
      });
      sentryReady = Sentry;
    })
    .catch((err) => {
      console.warn('[CAD] Sentry failed to initialise; error reporting stays local-only.', err);
    });
}

export function reportError(error: unknown): void {
  try {
    sentryReady?.captureException(error);
  } catch {
    // Reporting must never itself throw.
  }
}
