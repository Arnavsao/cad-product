import { AppEnvironment } from './environment.model';

/** Development configuration (used by `ng serve` and development builds). */
export const environment: AppEnvironment = {
  production: false,
  appName: 'CADOnline',
  apiUrl: 'http://localhost:3000/api/v1',
  defaultOllamaUrl: 'http://localhost:11434',
};
