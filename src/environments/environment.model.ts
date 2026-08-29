export interface AppEnvironment {
  production: boolean;
  /** Product name shown in the shell and document titles. */
  appName: string;
  /**
   * Base URL of the CADOnline API. Relative `/api/v1` in both dev (proxied by
   * `ng serve` via proxy.conf.json) and prod (nginx `location /api/`), so the
   * browser never makes a cross-origin request and CORS stays out of the picture.
   */
  apiUrl: string;
  /** Default Ollama endpoint offered in the AI panel settings. */
  defaultOllamaUrl: string;
  /**
   * Clerk publishable key (`pk_test_…` / `pk_live_…`). This key is public by
   * design and safe to commit. An empty string disables authentication and the
   * dashboard: the app runs in *embedded mode*, where `/editor` boots without a
   * sign-in and the API is never called with a bearer token.
   */
  clerkPublishableKey: string;
}
