import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { SupabaseAuthService, type OAuthProvider } from '../../core/auth/supabase-auth.service';
import { UiButtonDirective } from '../../shared/ui/button.directive';

interface BrandPath {
  d: string;
  /** Omit to inherit `currentColor` (mono marks like GitHub / Apple). */
  fill?: string;
}

interface ProviderOption {
  id: OAuthProvider;
  label: string;
  /** Inline brand mark — the providers' own glyphs, not our icon set. */
  paths: readonly BrandPath[];
}

/**
 * Provider brand marks are inlined rather than added to `ui-icon`: that set is
 * a single-stroke 24×24 system inheriting `currentColor`, and third-party logos
 * are filled shapes with prescribed colours that would not fit it.
 */
const PROVIDERS: readonly ProviderOption[] = [
  {
    id: 'google',
    label: 'Google',
    // The Google "G" is four coloured wedges; drawing only one of them renders a
    // broken logo, so all four are here.
    paths: [
      {
        fill: '#4285F4',
        d: 'M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.58v2.98h3.86c2.26-2.08 3.59-5.15 3.59-8.8Z',
      },
      {
        fill: '#34A853',
        d: 'M12 24c3.24 0 5.96-1.08 7.93-2.93l-3.86-2.98c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.72-4.96H1.3v3.09A11.99 11.99 0 0 0 12 24Z',
      },
      {
        fill: '#FBBC05',
        d: 'M5.28 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.3a11.99 11.99 0 0 0 0 10.74l3.98-3.09Z',
      },
      {
        fill: '#EA4335',
        d: 'M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.3 6.63l3.98 3.09C6.22 6.87 8.87 4.75 12 4.75Z',
      },
    ],
  },
  {
    id: 'github',
    label: 'GitHub',
    paths: [
      {
        d: 'M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-1.95c-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.3 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.48 3.14-1.18 3.14-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.2.66.8.55A11.5 11.5 0 0 0 23.5 12A11.5 11.5 0 0 0 12 .5Z',
      },
    ],
  },
  {
    id: 'azure',
    label: 'Microsoft',
    // The Microsoft logo is four coloured squares (the "Windows" mark) — Supabase
    // calls this provider `azure` (Microsoft Entra ID / Azure AD), which is what
    // backs "Sign in with Microsoft" everywhere; there is no separate Windows provider.
    paths: [
      { fill: '#F25022', d: 'M1 1h10.4v10.4H1z' },
      { fill: '#7FBA00', d: 'M12.6 1H23v10.4H12.6z' },
      { fill: '#00A4EF', d: 'M1 12.6h10.4V23H1z' },
      { fill: '#FFB900', d: 'M12.6 12.6H23V23H12.6z' },
    ],
  },
];

/**
 * Social sign-in buttons.
 *
 * Providers are configured in the Supabase dashboard, not here — a provider that
 * has not been enabled there returns an error on click. `available` therefore
 * exists so a project without, say, Apple set up can hide that button instead of
 * shipping a control that always fails.
 */
@Component({
  selector: 'app-oauth-buttons',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective],
  template: `
    <div class="auth-providers">
      @for (provider of visible(); track provider.id) {
        <button
          type="button"
          uiButton
          variant="secondary"
          class="auth-provider"
          [disabled]="!!busy()"
          [loading]="busy() === provider.id"
          (click)="start(provider.id)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            @for (path of provider.paths; track path.d) {
              <path [attr.d]="path.d" [attr.fill]="path.fill ?? 'currentColor'" />
            }
          </svg>
          {{ verb() }} with {{ provider.label }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .auth-providers { display: grid; gap: var(--ui-space-3); }
      .auth-provider { width: 100%; justify-content: center; }
      svg { flex: 0 0 auto; }
    `,
  ],
})
export class OAuthButtonsComponent {
  private readonly auth = inject(SupabaseAuthService);

  /** Which providers to show. Trim this when one is not configured upstream. */
  readonly available = input<readonly OAuthProvider[]>(['google', 'github', 'azure']);
  /** "Continue" on sign-in, "Sign up" on sign-up. */
  readonly verb = input<string>('Continue');
  /** Where to return after the provider round trip. */
  readonly redirectAfter = input<string | undefined>(undefined);

  /** Emitted with a user-safe message when the redirect could not be started. */
  readonly failed = output<string>();

  protected readonly busy = signal<OAuthProvider | null>(null);

  protected visible(): ProviderOption[] {
    const allowed = this.available();
    return PROVIDERS.filter((p) => allowed.includes(p.id));
  }

  protected async start(provider: OAuthProvider): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(provider);
    const result = await this.auth.signInWithOAuth(provider, this.redirectAfter());
    if (!result.ok) {
      this.failed.emit(result.error ?? 'Could not start sign-in.');
      this.busy.set(null);
    }
    // On success the browser navigates away, so `busy` stays set deliberately —
    // clearing it would flash the buttons back to life mid-redirect.
  }
}
