import { AppEnvironment } from './environment.model';

/**
 * Production configuration. Swapped in at build time via `fileReplacements`
 * in angular.json; override values per deployment by templating this file in
 * your release pipeline before `ng build`.
 */
export const environment: AppEnvironment = {
  production: true,
  appName: 'CADO',
  // Relative: nginx proxies `/api/` to the API container (see nginx.conf).
  apiUrl: '/api/v1',
  defaultOllamaUrl: 'http://localhost:11434',
  // Same Supabase project as development. Both values are public by design
  // (the anon key is the browser-side "publishable" key; RLS is what protects
  // data), so they are committed rather than injected. Leaving EITHER empty
  // switches the whole app into embedded mode — no sign-in, no onboarding, no
  // dashboard, straight to /editor — which is what shipped on the first deploy.
  supabaseUrl: 'https://tbeayjdllyfbulkhhrtu.supabase.co',
  supabaseAnonKey: 'sb_publishable_Wf6Ee_VgfonFAFGxNOc6eg_Az5OREDN',
  // Templated in CI with your Sentry project DSN. Empty = no external error
  // reporting (GlobalErrorHandler still logs to console + shows a toast).
  sentryDsn: '',
};
