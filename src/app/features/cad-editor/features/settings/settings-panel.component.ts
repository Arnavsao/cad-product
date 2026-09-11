import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CadThemeKind, ICadTheme, ThemeService } from '../../core/services/theme.service';
import { UiIconComponent } from '../../../../shared/ui/icon.component';
import { TranslocoDirective } from '@jsverse/transloco';

interface IThemeGroup {
  kind: CadThemeKind;
  /** Translation key of the group heading. */
  labelKey: string;
  themes: readonly ICadTheme[];
}

/**
 * Settings drawer. Currently one section: the colour-theme picker, modelled on
 * the editor-style theme lists — themes grouped by ground, each row previewing
 * its own colours so the list reads as a palette rather than as names.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-settings-panel',
  standalone: true,
  imports: [UiIconComponent, TranslocoDirective],
  template: `
    <div class="set-panel" *transloco="let t">
      <div class="set-section">
        <div class="set-section-head">
          <span class="set-section-title">{{ t('editor.ui.settings.colorTheme') }}</span>
          <span class="set-section-value">{{ theme.theme().name }}</span>
        </div>

        <input
          class="set-filter"
          type="search"
          autocomplete="off"
          spellcheck="false"
          [placeholder]="t('editor.ui.settings.searchThemes')"
          [value]="filter()"
          (input)="onFilter($event)" />

        @for (group of groups(); track group.kind) {
          <div class="set-group-label">{{ t(group.labelKey) }}</div>
          <!-- Named 'item', not 't': the *transloco 'let t' above is in scope here. -->
          @for (item of group.themes; track item.id) {
            <button
              type="button"
              class="theme-row"
              [class.active]="item.id === theme.themeId()"
              [attr.aria-pressed]="item.id === theme.themeId()"
              [title]="item.name"
              (click)="theme.setTheme(item.id)">
              <span class="theme-swatch" [style.background]="item.swatch[0]" [style.border-color]="item.swatch[1]">
                <span class="sw-bar" [style.background]="item.swatch[1]"></span>
                <span class="sw-dot" [style.background]="item.swatch[2]"></span>
              </span>
              <span class="theme-name">{{ item.name }}</span>
              @if (item.id === theme.themeId()) {
                <span class="theme-check" aria-hidden="true"><ui-icon name="check" [size]="12" /></span>
              }
            </button>
          }
        }

        @if (!groups().length) {
          <div class="muted-text set-empty">{{ t('editor.ui.settings.noThemeMatches', { query: filter() }) }}</div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .set-panel { padding: 10px 12px 16px; }

    .set-section-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }

    .set-section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--cad-text-primary);
    }

    .set-section-value {
      font-size: 11px;
      color: var(--cad-text-dim);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .set-filter {
      width: 100%;
      padding: 5px 8px;
      margin-bottom: 10px;
      font-size: 11px;
      font-family: var(--cad-font-ui);
      color: var(--cad-text-primary);
      background: var(--cad-bg-input);
      border: 1px solid var(--cad-border);
      border-radius: var(--cad-radius-sm);
      outline: none;
    }

    .set-filter:focus { border-color: var(--cad-accent); }

    .set-group-label {
      margin: 10px 0 4px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--cad-text-dim);
    }

    .theme-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 5px 6px;
      border: 1px solid transparent;
      border-radius: var(--cad-radius-sm);
      background: transparent;
      color: var(--cad-text-primary);
      font-size: 12px;
      font-family: var(--cad-font-ui);
      text-align: left;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }

    .theme-row:hover { background: var(--cad-bg-hover); }

    .theme-row.active {
      background: var(--cad-accent-tint);
      border-color: var(--cad-accent);
    }

    .theme-row:focus-visible {
      outline: 2px solid var(--cad-accent);
      outline-offset: -2px;
    }

    /* Miniature of the theme: canvas ground, chrome bar, accent dot. */
    .theme-swatch {
      position: relative;
      flex: 0 0 auto;
      width: 30px;
      height: 20px;
      border: 1px solid var(--cad-border);
      border-radius: 3px;
      overflow: hidden;
    }

    .sw-bar {
      position: absolute;
      inset: 0 0 auto 0;
      height: 6px;
    }

    .sw-dot {
      position: absolute;
      left: 4px;
      bottom: 4px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .theme-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .theme-check {
      flex: 0 0 auto;
      font-size: 11px;
      color: var(--cad-accent);
    }

    .set-empty { padding: 8px 2px; font-size: 11px; }
  `],
})
export class SettingsPanelComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly filter = signal('');

  /** Themes split by ground, filtered by the search box. Empty groups drop out. */
  protected readonly groups = computed<IThemeGroup[]>(() => {
    const q = this.filter().trim().toLowerCase();
    const match = (t: ICadTheme) => !q || t.name.toLowerCase().includes(q);
    const defs: { kind: CadThemeKind; labelKey: string }[] = [
      { kind: 'dark', labelKey: 'editor.ui.settings.darkThemes' },
      { kind: 'light', labelKey: 'editor.ui.settings.lightThemes' },
    ];
    return defs
      .map(({ kind, labelKey }) => ({ kind, labelKey, themes: this.theme.themes.filter((t) => t.kind === kind && match(t)) }))
      .filter((g) => g.themes.length > 0);
  });

  protected onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }
}
