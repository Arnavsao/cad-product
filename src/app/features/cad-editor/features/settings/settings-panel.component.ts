import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { CadThemeKind, ICadTheme, ThemeService } from '../../core/services/theme.service';

interface IThemeGroup {
  kind: CadThemeKind;
  label: string;
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
  imports: [],
  template: `
    <div class="set-panel">
      <div class="set-section">
        <div class="set-section-head">
          <span class="set-section-title">Color Theme</span>
          <span class="set-section-value">{{ theme.theme().name }}</span>
        </div>

        <input
          class="set-filter"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Search themes…"
          [value]="filter()"
          (input)="onFilter($event)" />

        @for (group of groups(); track group.kind) {
          <div class="set-group-label">{{ group.label }}</div>
          @for (t of group.themes; track t.id) {
            <button
              type="button"
              class="theme-row"
              [class.active]="t.id === theme.themeId()"
              [attr.aria-pressed]="t.id === theme.themeId()"
              [title]="t.name"
              (click)="theme.setTheme(t.id)">
              <span class="theme-swatch" [style.background]="t.swatch[0]" [style.border-color]="t.swatch[1]">
                <span class="sw-bar" [style.background]="t.swatch[1]"></span>
                <span class="sw-dot" [style.background]="t.swatch[2]"></span>
              </span>
              <span class="theme-name">{{ t.name }}</span>
              @if (t.id === theme.themeId()) {
                <span class="theme-check" aria-hidden="true">✓</span>
              }
            </button>
          }
        }

        @if (!groups().length) {
          <div class="muted-text set-empty">No theme matches “{{ filter() }}”.</div>
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
    const defs: { kind: CadThemeKind; label: string }[] = [
      { kind: 'dark', label: 'Dark themes' },
      { kind: 'light', label: 'Light themes' },
    ];
    return defs
      .map(({ kind, label }) => ({ kind, label, themes: this.theme.themes.filter((t) => t.kind === kind && match(t)) }))
      .filter((g) => g.themes.length > 0);
  });

  protected onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }
}
