import { AppEnvironment } from './environment.model';

/** Development configuration (used by `ng serve` and development builds). */
export const environment: AppEnvironment = {
  production: false,
  appName: 'CADOnline',
  // Relative on purpose: `ng serve` forwards `/api` to http://localhost:3000 via proxy.conf.json.
  apiUrl: '/api/v1',
  defaultOllamaUrl: 'http://localhost:11434',
  // Paste your Supabase project URL and anon key here (Dashboard → Settings → API).
  // Leaving EITHER empty keeps auth disabled: the app boots straight into /editor
  // (embedded mode). Both values are public by design.
  supabaseUrl: 'https://tbeayjdllyfbulkhhrtu.supabase.co',
  supabaseAnonKey: 'sb_publishable_Wf6Ee_VgfonFAFGxNOc6eg_Az5OREDN',
  // Leave empty in dev — you don't want local stack traces landing in Sentry.
  sentryDsn: '',
};
