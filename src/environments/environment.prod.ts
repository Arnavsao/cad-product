import { AppEnvironment } from './environment.model';

/**
 * Production configuration. Swapped in at build time via `fileReplacements`
 * in angular.json; override values per deployment by templating this file in
 * your release pipeline before `ng build`.
 */
export const environment: AppEnvironment = {
  production: true,
  appName: 'CADOnline',
  // Relative: nginx proxies `/api/` to the API container (see nginx.conf).
  apiUrl: '/api/v1',
  defaultOllamaUrl: 'http://localhost:11434',
  // Templated in CI with the production project's URL and anon key.
  // Either left empty = embedded mode (no auth).
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Templated in CI with your Sentry project DSN. Empty = no external error
  // reporting (GlobalErrorHandler still logs to console + shows a toast).
  sentryDsn: '',
};
