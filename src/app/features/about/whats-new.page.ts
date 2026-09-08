import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../environments/environment';
import { UiIconComponent, type UiIconName } from '../../shared/ui/icon.component';
import { SiteClosingComponent } from '../site/components/closing.component';
import { SiteHeadingComponent } from '../site/components/heading.component';
import { RELEASE_NOTES, type ReleaseChangeKind } from './release-notes';

const KIND_LABEL: Record<ReleaseChangeKind, string> = {
  added: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
};

const KIND_ICON: Record<ReleaseChangeKind, UiIconName> = {
  added: 'sparkle',
  improved: 'refresh',
  fixed: 'check',
};

/**
 * `/whats-new` — release notes.
 *
 * Public: linked from the Help menu and About, but it is also the page you send
 * someone who is deciding whether to sign up, so it must not sit behind the auth
 * guard. Content comes from the typed `RELEASE_NOTES` const, not from parsing
 * `CHANGELOG.md` at runtime.
 */
@Component({
  selector: 'app-whats-new-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, UiIconComponent, SiteClosingComponent, SiteHeadingComponent],
  template: `
    <div class="wn">
      <main class="wn__main">
        <site-heading [level]="1" eyebrow="Release notes" title="What's new" lede="Everything we have shipped, newest first. The engineering changelog behind these notes lives in the repository." />

        @for (release of releases; track release.version) {
          <section class="wn__release">
            <header class="wn__release-head">
              <h2 class="wn__version">{{ release.version }}</h2>
              <time class="wn__date" [attr.datetime]="release.date">{{ release.date | date: 'longDate' }}</time>
            </header>
            @if (release.summary) {
              <p class="wn__summary">{{ release.summary }}</p>
            }
            <ul class="wn__changes">
              @for (change of release.changes; track change.title) {
                <li class="wn__change">
                  <span class="wn__badge" [attr.data-kind]="change.kind">
                    <ui-icon [name]="iconFor(change.kind)" [size]="12" />
                    {{ labelFor(change.kind) }}
                  </span>
                  <div class="wn__change-body">
                    <p class="wn__change-title">{{ change.title }}</p>
                    <p class="wn__change-detail">{{ change.detail }}</p>
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      </main>
      <site-closing title="Try the latest build." sub="Every release is live for everyone the moment it ships. There is nothing to download." secondaryLabel="About CADO" secondaryLink="/about" />

    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: var(--ui-bg); color: var(--ui-text); }
      .wn { display: flex; flex-direction: column; min-height: 100vh; }

      .wn__main { flex: 1; width: 100%; max-width: 760px; margin: 0 auto; padding: clamp(48px, 10vh, 96px) var(--site-gutter) var(--ui-space-6); }
      site-heading { display: block; margin-bottom: var(--ui-space-10); }

      .wn__release { margin-bottom: var(--ui-space-12); }
      .wn__release-head { display: flex; align-items: baseline; gap: var(--ui-space-3); margin-bottom: var(--ui-space-2); }
      .wn__version { margin: 0; font-size: var(--ui-text-xl); font-weight: 700; color: var(--ui-text-strong); }
      .wn__date { font-size: var(--ui-text-sm); color: var(--ui-text-dim); }
      .wn__summary { margin: 0 0 var(--ui-space-5); font-size: var(--ui-text-md); color: var(--ui-text-dim); line-height: var(--ui-leading); }

      .wn__changes { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--ui-space-4); }
      .wn__change { display: flex; align-items: flex-start; gap: var(--ui-space-4); }
      .wn__badge {
        display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
        min-width: 86px; padding: 3px 9px;
        border-radius: var(--ui-radius-full);
        font-size: var(--ui-text-xs); font-weight: 600;
        background: var(--ui-hover); color: var(--ui-text-dim);
      }
      .wn__badge[data-kind='added'] { background: var(--ui-accent-tint); color: var(--ui-accent); }
      .wn__badge[data-kind='improved'] { background: var(--ui-warning-tint); color: var(--ui-warning); }
      .wn__badge[data-kind='fixed'] { background: var(--ui-success-tint); color: var(--ui-success); }

      .wn__change-body { min-width: 0; }
      .wn__change-title { margin: 0; font-size: var(--ui-text-md); font-weight: 600; color: var(--ui-text-strong); }
      .wn__change-detail { margin: 2px 0 0; font-size: var(--ui-text-md); color: var(--ui-text-dim); line-height: var(--ui-leading); }

      @media (max-width: 560px) {
        .wn__change { flex-direction: column; gap: 6px; }
      }
    `,
  ],
})
export class WhatsNewPage {
  protected readonly releases = RELEASE_NOTES;
  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();


  protected labelFor(kind: ReleaseChangeKind): string {
    return KIND_LABEL[kind];
  }

  protected iconFor(kind: ReleaseChangeKind): UiIconName {
    return KIND_ICON[kind];
  }
}
