import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { UiButtonDirective } from '../../shared/ui/button.directive';
import { UiDialogRef } from '../../shared/ui/dialog/ui-dialog-ref';
import { UiIconComponent } from '../../shared/ui/icon.component';
import { CURRENT_VERSION } from './release-notes';

/**
 * About — version and links. A dialog rather than a route because it is a
 * glance, not a destination: nobody deep-links to an About page or expects Back
 * to leave one.
 */
@Component({
  selector: 'app-about-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, RouterLink, UiButtonDirective, UiIconComponent],
  template: `
    <div class="ui-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" cdkTrapFocus>
      <header class="ui-dialog__header">
        <h2 [id]="titleId">About {{ appName }}</h2>
        <button type="button" uiButton variant="ghost" size="sm" iconOnly aria-label="Close" (click)="ref.close()">
          <ui-icon name="close" />
        </button>
      </header>

      <div class="ui-dialog__body">
        <div class="ab__brand">
          <span class="ab__mark" aria-hidden="true"><ui-icon name="grid" [size]="20" /></span>
          <div>
            <p class="ab__name">{{ appName }}</p>
            <p class="ab__tag">2D CAD in the browser</p>
          </div>
        </div>

        <dl class="ab__facts">
          <dt>Version</dt>
          <dd>{{ version }}</dd>
          <dt>Build</dt>
          <dd>{{ buildMode }}</dd>
        </dl>

        <nav class="ab__links" aria-label="About links">
          <a routerLink="/whats-new" (click)="ref.close()">What's New</a>
          <a routerLink="/pricing" (click)="ref.close()">Plans &amp; pricing</a>
          <a routerLink="/terms" (click)="ref.close()">Terms</a>
          <a routerLink="/privacy" (click)="ref.close()">Privacy</a>
        </nav>

        <p class="ab__legal">© {{ year }} {{ appName }}. All rights reserved.</p>
      </div>

      <footer class="ui-dialog__footer">
        <button type="button" uiButton variant="secondary" (click)="openFeedback()">Send feedback</button>
        <button type="button" uiButton (click)="ref.close()">Close</button>
      </footer>
    </div>
  `,
  styles: [
    `
      .ab__brand { display: flex; align-items: center; gap: var(--ui-space-3); margin-bottom: var(--ui-space-5); }
      .ab__mark {
        display: grid; place-items: center; width: 40px; height: 40px;
        border-radius: var(--ui-radius-lg); background: var(--ui-accent); color: var(--ui-on-accent); flex: 0 0 auto;
      }
      .ab__name { margin: 0; font-size: var(--ui-text-lg); font-weight: 600; color: var(--ui-text-strong); }
      .ab__tag { margin: 0; font-size: var(--ui-text-sm); color: var(--ui-text-dim); }

      .ab__facts {
        display: grid; grid-template-columns: auto 1fr; gap: 6px var(--ui-space-4);
        margin: 0 0 var(--ui-space-5); font-size: var(--ui-text-sm);
      }
      .ab__facts dt { color: var(--ui-text-dim); }
      .ab__facts dd { margin: 0; font-family: var(--ui-font-mono); color: var(--ui-text-strong); }

      .ab__links { display: flex; flex-wrap: wrap; gap: var(--ui-space-4); margin-bottom: var(--ui-space-4); }
      .ab__links a { font-size: var(--ui-text-sm); color: var(--ui-accent); text-decoration: none; }
      .ab__links a:hover { text-decoration: underline; }

      .ab__legal { margin: 0; font-size: var(--ui-text-xs); color: var(--ui-text-dim); }
    `,
  ],
})
export class AboutDialogComponent {
  protected readonly ref = inject(UiDialogRef<void>);
  private readonly router = inject(Router);

  protected readonly titleId = 'about-dialog-title';
  protected readonly appName = environment.appName;
  protected readonly version = CURRENT_VERSION;
  protected readonly buildMode = environment.production ? 'production' : 'development';
  protected readonly year = new Date().getFullYear();

  protected openFeedback(): void {
    this.ref.close();
    void this.router.navigateByUrl('/dashboard/feedback');
  }
}
