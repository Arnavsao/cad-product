import { AppEnvironment } from './environment.model';

/**
 * Production configuration. `apiUrl` is swapped in at build time via
 * `fileReplacements` in angular.json; override it per deployment by editing
 * this file in your release pipeline or by templating it before `ng build`.
 */
export const environment: AppEnvironment = {
  production: true,
  appName: 'CADOnline',
  apiUrl: '/api/v1',
  defaultOllamaUrl: 'http://localhost:11434',
};
