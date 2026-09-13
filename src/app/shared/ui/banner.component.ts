import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type UiBannerTone = 'info' | 'warning';

/**
 * A full-width notice above the app.
 *
 * Dismissal is the caller's business: this component says when the reader asked
 * it to go away, and whoever mounted it decides whether that should be
 * remembered. A banner that hid itself permanently on first click would be
 * wrong for a maintenance warning and right for a product note, and that is not
 * a decision a presentational component can make.
 */
@Component({
  selector: 'ui-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="banner" [class.banner--warning]="tone() === 'warning'" role="status">
      <span class="banner__text"><ng-content /></span>
      @if (linkUrl(); as href) {
        <a class="banner__link" [href]="href">{{ linkLabel() }}</a>
      }
      @if (dismissible()) {
        <button type="button" class="banner__close" aria-label="Dismiss" (click)="dismissed.emit()">×</button>
      }
    </div>
  `,
  styles: [
    `
      .banner {
        display: flex;
        align-items: center;
        gap: var(--ui-space-3);
        padding: 8px var(--ui-space-5);
        background: var(--ui-surface-2);
        border-bottom: 1px solid var(--ui-border);
        color: var(--ui-text);
        font-size: var(--ui-text-sm);
      }
      .banner--warning {
        background: color-mix(in srgb, var(--ui-warning, #d29922) 16%, var(--ui-surface-2));
        border-bottom-color: color-mix(in srgb, var(--ui-warning, #d29922) 45%, transparent);
      }
      .banner__text {
        min-width: 0;
      }
      .banner__link {
        color: var(--ui-accent);
        white-space: nowrap;
      }
      .banner__close {
        margin-left: auto;
        background: none;
        border: 0;
        color: var(--ui-text-dim);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        padding: 0 4px;
      }
      .banner__close:hover {
        color: var(--ui-text);
      }
    `,
  ],
})
export class UiBannerComponent {
  readonly tone = input<UiBannerTone>('info');
  readonly linkUrl = input<string | null>(null);
  readonly linkLabel = input('Read more');
  readonly dismissible = input(true);

  readonly dismissed = output<void>();
}
