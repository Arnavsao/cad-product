export interface AppEnvironment {
  production: boolean;
  /** Product name shown in the shell and document titles. */
  appName: string;
  /**
   * Base URL of the optional CAD backend (L-section generation, AI audit log,
   * file uploads). Leave empty to run fully offline — backend-dependent
   * features report a friendly error instead of failing silently.
   */
  apiUrl: string;
  /** Default Ollama endpoint offered in the AI panel settings. */
  defaultOllamaUrl: string;
}
