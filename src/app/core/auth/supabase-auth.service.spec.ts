import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SupabaseAuthService } from './supabase-auth.service';

/**
 * The parts of the auth service that are ours rather than the SDK's: the
 * embedded-mode gate, and the normalisation of Supabase's `user_metadata` into
 * the first/last name fields our schema and forms use.
 *
 * The SDK is never constructed here — `load()` short-circuits while the
 * environment is unconfigured, which is exactly the property that keeps unit
 * tests (and the dashboard shell spec) offline.
 */
describe('SupabaseAuthService', () => {
  let service: SupabaseAuthService;

  const build = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SupabaseAuthService,
        { provide: Router, useValue: { navigateByUrl: jasmine.createSpy('navigateByUrl') } },
      ],
    });
    return TestBed.inject(SupabaseAuthService);
  };

  /** Sets the signed-in user without touching the SDK. */
  const setUser = (metadata: Record<string, unknown>, email = 'user@example.com') => {
    (service as unknown as { user: { set(v: unknown): void } }).user.set({
      id: '00000000-0000-4000-8000-000000000001',
      email,
      user_metadata: metadata,
      identities: [],
    });
  };

  beforeEach(() => {
    service = build();
  });

  // ── embedded mode ─────────────────────────────────────────────────────────

  describe('embedded mode', () => {
    const original = { url: environment.supabaseUrl, key: environment.supabaseAnonKey };
    afterEach(() => {
      environment.supabaseUrl = original.url;
      environment.supabaseAnonKey = original.key;
    });

    it('is disabled when both values are empty', () => {
      environment.supabaseUrl = '';
      environment.supabaseAnonKey = '';
      expect(build().enabled()).toBeFalse();
    });

    it('is disabled when only the URL is set — a half-config must not look configured', () => {
      environment.supabaseUrl = 'https://x.supabase.co';
      environment.supabaseAnonKey = '';
      expect(build().enabled()).toBeFalse();
    });

    it('is disabled when only the anon key is set', () => {
      environment.supabaseUrl = '';
      environment.supabaseAnonKey = 'anon';
      expect(build().enabled()).toBeFalse();
    });

    it('is enabled only with both', () => {
      environment.supabaseUrl = 'https://x.supabase.co';
      environment.supabaseAnonKey = 'anon';
      expect(build().enabled()).toBeTrue();
    });

    it('returns no bearer token while disabled, without constructing a client', async () => {
      environment.supabaseUrl = '';
      environment.supabaseAnonKey = '';
      await expectAsync(build().getToken()).toBeResolvedTo(null);
    });

    it('load() resolves and marks itself loaded while disabled', async () => {
      environment.supabaseUrl = '';
      environment.supabaseAnonKey = '';
      const s = build();
      await expectAsync(s.load()).toBeResolved();
      expect(s.isLoaded()).toBeTrue();
      expect(s.loadError()).toBeNull();
    });
  });

  // ── profile normalisation ─────────────────────────────────────────────────

  describe('name from user_metadata', () => {
    it('is empty when there is no user', () => {
      expect(service.userFirstName()).toBe('');
      expect(service.userLastName()).toBe('');
      expect(service.userEmail()).toBe('');
    });

    it('splits an OAuth full_name on the first space', () => {
      setUser({ full_name: 'Ada Lovelace' });
      expect(service.userFirstName()).toBe('Ada');
      expect(service.userLastName()).toBe('Lovelace');
    });

    it('keeps a multi-word surname intact', () => {
      setUser({ full_name: 'Ada Lovelace King' });
      expect(service.userFirstName()).toBe('Ada');
      expect(service.userLastName()).toBe('Lovelace King');
    });

    it('handles a single-word name', () => {
      setUser({ full_name: 'Prince' });
      expect(service.userFirstName()).toBe('Prince');
      expect(service.userLastName()).toBe('');
    });

    it('falls back to `name` when `full_name` is absent', () => {
      setUser({ name: 'Grace Hopper' });
      expect(service.userFirstName()).toBe('Grace');
      expect(service.userLastName()).toBe('Hopper');
    });

    it('prefers explicit first/last over the split — our own form writes those', () => {
      setUser({ full_name: 'Wrong Name', first_name: 'Ada', last_name: 'Lovelace' });
      expect(service.userFirstName()).toBe('Ada');
      expect(service.userLastName()).toBe('Lovelace');
    });

    it('tolerates extra whitespace', () => {
      setUser({ full_name: '  Ada   Lovelace  ' });
      expect(service.userFirstName()).toBe('Ada');
      expect(service.userLastName()).toBe('Lovelace');
    });

    it('treats a blank metadata value as absent', () => {
      setUser({ full_name: '   ' });
      expect(service.userFirstName()).toBe('');
      expect(service.userLastName()).toBe('');
    });

    it('reads the avatar from either avatar_url or picture', () => {
      setUser({ avatar_url: 'https://example.com/a.png' });
      expect(service.userAvatarUrl()).toBe('https://example.com/a.png');

      setUser({ picture: 'https://example.com/b.png' });
      expect(service.userAvatarUrl()).toBe('https://example.com/b.png');

      setUser({});
      expect(service.userAvatarUrl()).toBeNull();
    });

    it('exposes the email', () => {
      setUser({}, 'ada@example.com');
      expect(service.userEmail()).toBe('ada@example.com');
    });
  });

  // ── identities ────────────────────────────────────────────────────────────

  describe('identities', () => {
    const setIdentities = (providers: string[]) => {
      (service as unknown as { user: { set(v: unknown): void } }).user.set({
        id: 'x',
        email: 'a@b.c',
        user_metadata: {},
        identities: providers.map((provider) => ({ provider })),
      });
    };

    it('lists OAuth providers and omits `email`', () => {
      setIdentities(['email', 'google', 'github']);
      expect(service.identities()).toEqual(['google', 'github']);
    });

    it('offers a password change when the account has an email identity', () => {
      setIdentities(['email', 'google']);
      expect(service.hasPasswordIdentity()).toBeTrue();
    });

    it('hides the password change for an OAuth-only account', () => {
      setIdentities(['google']);
      expect(service.hasPasswordIdentity()).toBeFalse();
    });

    it('assumes a password when identities are unknown, rather than hiding the form', () => {
      setIdentities([]);
      expect(service.hasPasswordIdentity()).toBeTrue();
    });
  });
});
