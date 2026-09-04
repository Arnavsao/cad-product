import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { UiLogoComponent } from '../../shared/ui/logo.component';

/**
 * Two-column frame for the auth pages: a brand rail (≥960px) with the value
 * proposition on the left, the projected form card on the right. Below 960px
 * the rail collapses to a compact brand row above the card.
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIconComponent, UiLogoComponent],
  template: `
    <div class="auth">
      <aside class="auth__rail">
        <a class="brand" routerLink="/" aria-label="CADO home">
          <span class="brand__mark" aria-hidden="true"><ui-logo [size]="16" /></span>
          <span class="brand__name">{{ appName }}</span>
        </a>
        <div class="auth__pitch">
          <h1>2D CAD that lives in your browser.</h1>
          <p>
            Draft with object snaps and associative dimensions, move DXF files in and out, and pick up exactly where
            you left off — on any machine.
          </p>
          <ul class="auth__points">
            <li><ui-icon name="check" [size]="14" /> DXF import and export</li>
            <li><ui-icon name="check" [size]="14" /> Layouts and PDF plotting</li>
            <li><ui-icon name="check" [size]="14" /> Autosave, recovery and cloud drawings</li>
          </ul>
        </div>
        <p class="auth__foot">&copy; {{ year }} {{ appName }}</p>
      </aside>

      <main class="auth__main">
        <div class="auth__topbar">
          <a class="brand brand--compact" routerLink="/" aria-label="CADO home">
            <span class="brand__mark" aria-hidden="true"><ui-logo [size]="16" /></span>
            <span class="brand__name">{{ appName }}</span>
          </a>
          <a class="auth__back" routerLink="/"><ui-icon name="back" [size]="14" /> Back to home</a>
        </div>
        <div class="auth__card">
          <ng-content />
        </div>
      </main>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100%; }
      .auth {
        display: flex;
        min-height: 100vh;
        background: var(--ui-bg);
        color: var(--ui-text);
        font-family: var(--ui-font);
      }
      .auth__rail {
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 40px;
        width: 42%;
        min-width: 360px;
        max-width: 520px;
        padding: 40px 44px;
        background: var(--ui-surface);
        border-right: 1px solid var(--ui-border);
        overflow: hidden;
      }
      .auth__rail::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(to right, var(--ui-border) 1px, transparent 1px),
          linear-gradient(to bottom, var(--ui-border) 1px, transparent 1px);
        background-size: 24px 24px;
        opacity: .5;
        mask-image: radial-gradient(ellipse 90% 80% at 30% 100%, #000 0%, transparent 80%);
      }
      .auth__rail > * { position: relative; }
      .auth__pitch h1 {
        margin: 0;
        font-size: clamp(26px, 2.6vw, 34px);
        line-height: 1.12;
        font-weight: 700;
        letter-spacing: -.02em;
        color: var(--ui-text-strong);
        text-wrap: balance;
      }
      .auth__pitch p { margin: 16px 0 0; font-size: 15px; line-height: 1.55; color: var(--ui-text-dim); max-width: 46ch; }
      .auth__points { list-style: none; margin: 28px 0 0; padding: 0; display: grid; gap: 10px; font-size: var(--ui-text-base); }
      .auth__points li { display: flex; align-items: center; gap: 10px; }
      .auth__points ui-icon { color: var(--ui-success); }
      .auth__foot { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .auth__main {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 24px clamp(16px, 4vw, 48px) 48px;
      }
      .auth__topbar {
        width: 100%;
        max-width: 480px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 36px;
      }
      .auth__back {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        font-size: var(--ui-text-md);
        color: var(--ui-text-dim);
        text-decoration: none;
        border-radius: var(--ui-radius-sm);
      }
      .auth__back:hover { color: var(--ui-text); }
      .auth__back:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
      .auth__card {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 100%;
        max-width: 480px;
        padding: 24px 0;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--ui-text-strong);
        text-decoration: none;
        font-weight: 600;
        font-size: var(--ui-text-base);
        letter-spacing: -.01em;
      }
      .brand:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 4px; border-radius: var(--ui-radius-sm); }
      .brand__mark {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: var(--ui-radius-md);
        background: var(--ui-accent);
        color: var(--ui-on-accent);
      }
      .brand--compact { display: none; }

      @media (max-width: 959px) {
        .auth__rail { display: none; }
        .brand--compact { display: inline-flex; }
      }
    `,
  ],
})
export class AuthLayoutComponent {
  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();
}
