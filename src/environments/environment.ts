import { AppEnvironment } from './environment.model';

/** Development configuration (used by `ng serve` and development builds). */
export const environment: AppEnvironment = {
  production: false,
  appName: 'CADOnline',
  // Relative on purpose: `ng serve` forwards `/api` to http://localhost:3000 via proxy.conf.json.
  apiUrl: '/api/v1',
  defaultOllamaUrl: 'http://localhost:11434',
  // Paste your Clerk dev instance key here (`pk_test_…`, from the Clerk dashboard → API keys).
  // Leaving it empty keeps auth disabled: the app boots straight into /editor (embedded mode).
  clerkPublishableKey: '',
  // Leave empty in dev — you don't want local stack traces landing in Sentry.
  sentryDsn: '',
};
