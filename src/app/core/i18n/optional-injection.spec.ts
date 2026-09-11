import { EnvironmentInjector, inject, provideZonelessChangeDetection, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { injectTranslocoOptional, translateOr } from './translate-or';

/**
 * The editor is embeddable in a host that never calls `provideI18n()`, and many
 * editor specs construct components bare. Both must render English instead of
 * failing to inject, so this pins the behaviour the fallback path depends on.
 *
 * It matters because `TranslocoService` is `providedIn: 'root'`: the injector
 * always has a provider for it, and only Transloco declaring its own
 * dependencies optional keeps a bare `inject` from throwing. If a future
 * version stops doing that, this spec fails and `injectTranslocoOptional`'s
 * try/catch becomes load-bearing rather than belt-and-braces.
 */
describe('Transloco injection without provideTransloco', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  const injectWith = <T>(fn: () => T): T =>
    runInInjectionContext(TestBed.inject(EnvironmentInjector), fn);

  it('resolves to null rather than throwing', () => {
    expect(injectWith(() => inject(TranslocoService, { optional: true }))).toBeNull();
  });

  it('resolves to null through the helper too', () => {
    expect(injectWith(() => injectTranslocoOptional())).toBeNull();
  });

  it('renders the English literal when no translation service is present', () => {
    const transloco = injectWith(() => injectTranslocoOptional());
    expect(translateOr(transloco, 'editor.tool.line.title', 'Line')).toBe('Line');
  });
});
