import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Section heading: eyebrow, title, one-paragraph lede. Rendered as an `h2` by
 * default; pass `level="1"` for a page's own heading so the outline stays one
 * `h1` per page.
 */
@Component({
  selector: 'site-heading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (eyebrow()) { <p class="site-eyebrow">{{ eyebrow() }}</p> }
    @if (level() === 1) {
      <h1 class="site-h1" [id]="id() || null">{{ title() }}</h1>
    } @else {
      <h2 class="site-h2" [id]="id() || null">{{ title() }}</h2>
    }
    @if (lede()) { <p class="site-lede" [class.site-lede--center]="align() === 'center'">{{ lede() }}</p> }
    <ng-content />
  `,
  host: {
    class: 'site-heading',
    // The `title` input would otherwise stay on the host as a native attribute
    // and show as a browser tooltip over every heading.
    '[attr.title]': 'null',
    '[class.site-heading--center]': 'align() === "center"',
  },
  styles: [
    `
      :host { display: block; max-width: 760px; }
      :host(.site-heading--center) { margin-inline: auto; text-align: center; }
      .site-lede--center { margin-inline: auto; }
    `,
  ],
})
export class SiteHeadingComponent {
  readonly eyebrow = input('');
  readonly title = input.required<string>();
  readonly lede = input('');
  readonly align = input<'start' | 'center'>('start');
  readonly level = input<1 | 2>(2);
  readonly id = input('');
}
