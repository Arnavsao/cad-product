import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withPreloading } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/http/auth.interceptor';
import { GlobalErrorHandler } from './core/errors/global-error.handler';
import { AUTH_TOKEN_PROVIDER } from './core/config/auth-token.provider';
import { ClerkAuthTokenProvider } from './core/auth/clerk-token.provider';
import { SelectivePreloadStrategy } from './core/routing/selective-preload.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withPreloading(SelectivePreloadStrategy),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Bearer tokens come from the Clerk session. Embedding hosts may override this provider.
    { provide: AUTH_TOKEN_PROVIDER, useExisting: ClerkAuthTokenProvider },
  ],
};
