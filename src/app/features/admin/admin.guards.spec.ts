import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { MeService } from '../../core/api/me.service';
import { SupabaseAuthService } from '../../core/auth/supabase-auth.service';
import { adminGuard } from './admin.guards';

/** Runs the guard the way the router does, inside an injection context. */
function runGuard(): Promise<boolean | UrlTree> {
  return TestBed.runInInjectionContext(() => adminGuard({} as never, { url: '/admin' } as never)) as Promise<
    boolean | UrlTree
  >;
}

function meWith(platformRole: string) {
  return { user: { id: 'u1', platformRole } } as never;
}

describe('adminGuard', () => {
  let auth: jasmine.SpyObj<SupabaseAuthService>;
  let me: jasmine.SpyObj<MeService>;

  function configure(options: { enabled?: boolean; signedIn?: boolean } = {}): void {
    auth = jasmine.createSpyObj<SupabaseAuthService>(
      'SupabaseAuthService',
      ['load'],
      { enabled: signal(options.enabled ?? true), isSignedIn: signal(options.signedIn ?? true) },
    );
    auth.load.and.resolveTo();
    me = jasmine.createSpyObj<MeService>('MeService', ['load']);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: SupabaseAuthService, useValue: auth },
        { provide: MeService, useValue: me },
      ],
    });
  }

  it('admits a support user', async () => {
    configure();
    me.load.and.resolveTo(meWith('support'));
    expect(await runGuard()).toBe(true);
  });

  it('admits an owner', async () => {
    configure();
    me.load.and.resolveTo(meWith('owner'));
    expect(await runGuard()).toBe(true);
  });

  it('sends a plain user to the dashboard rather than to sign-in', async () => {
    configure();
    me.load.and.resolveTo(meWith('user'));
    const result = await runGuard();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('sends a signed-out visitor to sign-in, carrying the destination', async () => {
    configure({ signedIn: false });
    const result = await runGuard();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toContain('/sign-in');
  });

  it('redirects when /me fails rather than admitting on an unknown role', async () => {
    configure();
    me.load.and.rejectWith(new Error('offline'));
    const result = await runGuard();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/dashboard');
  });

  it('refuses in embedded mode, where there are no accounts at all', async () => {
    configure({ enabled: false });
    const result = await runGuard();
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/dashboard');
    expect(me.load).not.toHaveBeenCalled();
  });
});
