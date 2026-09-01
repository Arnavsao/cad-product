import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { initSentry } from './app/core/errors/sentry.init';

initSentry();

bootstrapApplication(App, appConfig).catch(err => console.error('[CAD] bootstrap failed', err));
