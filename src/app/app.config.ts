import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/http/auth.interceptor';
import { GlobalErrorHandler } from './core/errors/global-error.handler';
import { AUTH_TOKEN_PROVIDER } from './core/config/auth-token.provider';
import { SupabaseAuthTokenProvider } from './core/auth/supabase-token.provider';
import { SelectivePreloadStrategy } from './core/routing/selective-preload.strategy';
import { TranslatedTitleStrategy } from './core/routing/translated-title.strategy';
import { provideI18n } from './core/i18n/provide-i18n';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withPreloading(SelectivePreloadStrategy),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      // Native cross-document morphing between routes that share an element
      // (the brand mark carries `view-transition-name: cado-brand`). The
      // initial navigation is skipped on purpose: the landing page's first
      // paint is a budget worth protecting, and there is no outgoing state to
      // morph from on a cold load. Motion is dropped under
      // `prefers-reduced-motion` in `blueprint.scss`.
      withViewTransitions({ skipInitialTransition: true }),
    ),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Transloco + the resolved UI language. Must come after provideHttpClient:
    // the translation loader is an HttpClient consumer.
    ...provideI18n(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // Route `title`s are translation keys; see the strategy for the two
    // surfaces (site, editor) that manage their own tab title.
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    // Bearer tokens come from the Supabase session. Embedding hosts may override this provider.
    { provide: AUTH_TOKEN_PROVIDER, useExisting: SupabaseAuthTokenProvider },
  ],
};
