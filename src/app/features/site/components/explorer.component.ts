import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { COMMAND_GROUPS, type CommandGroup } from '../data/site-content';
import { SiteScreenComponent } from './screen.component';
import { SiteTab, SiteTabsComponent } from './tabs.component';

/** Which real screenshot best illustrates each command group. */
const SHOTS: Record<string, { src: string; alt: string; title: string }> = {
  draw: { src: '/site/editor-model.webp', alt: 'The CADO editor with a bridge general-arrangement drawing open: draw and modify ribbons above, layers and properties rail on the left, command line below.', title: 'RTM-S&C-GAD-BR-NO.384.dxf — Model' },
  annotate: { src: '/site/editor-detail.webp', alt: 'Zoomed into the drawing: dimension strings, notes and a schedule table rendered with their own fonts and lineweights.', title: 'RTM-S&C-GAD-BR-NO.384.dxf — Model, 1:20' },
  modify: { src: '/site/editor-model.webp', alt: 'The editor toolbar with Move, Copy, Array, Rotate, Mirror, Trim, Fillet, Offset, Join, Match Properties and Explode.', title: 'RTM-S&C-GAD-BR-NO.384.dxf — Model' },
  blocks: { src: '/site/editor-blocks.webp', alt: 'The Blocks palette listing the block definitions in the drawing, beside the canvas.', title: 'Blocks palette' },
  layouts: { src: '/site/editor-layout.webp', alt: 'A paper-space layout tab: the sheet with a viewport framing the model, and the Model and Layout1 tabs in the status bar.', title: 'RTM-S&C-GAD-BR-NO.384.dxf — Layout1' },
  files: { src: '/site/editor-plot.webp', alt: 'The Plot dialog with paper size, orientation, scale and output format options over the drawing.', title: 'Plot — PDF / PNG / DXF' },
  ai: { src: '/site/editor-ai.webp', alt: 'The AI Agent panel open beside the drawing, ready for a plain-language instruction.', title: 'AI Agent' },
};

/**
 * The feature explorer: one tab per command group, each showing the group's
 * summary, its commands with their aliases, and the screenshot where you would
 * find them. Shared by the home page (horizontal) and the features page
 * (vertical, with hints), so the two never list different commands.
 */
@Component({
  selector: 'site-explorer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiButtonDirective, UiIconComponent, SiteScreenComponent, SiteTabsComponent],
  template: `
    <site-tabs [tabs]="tabs()" [(active)]="active" [orientation]="orientation()" label="Command groups">
      <div class="ex" [class.ex--stacked]="orientation() === 'vertical'">
        <div class="ex__copy">
          <p class="site-eyebrow">{{ group().label }}</p>
          <h3 class="site-h3 ex__title">{{ group().hint }}</h3>
          <p class="site-body">{{ group().summary }}</p>
          <ul class="ex__list">
            @for (cmd of shown(); track cmd.name) {
              <li class="ex__cmd">
                <span class="ex__name">{{ cmd.name }}</span>
                <span class="ex__aliases">
                  @for (a of cmd.aliases; track a) { <kbd class="site-kbd">{{ a }}</kbd> }
                </span>
                <span class="ex__what">{{ cmd.what }}</span>
              </li>
            }
          </ul>
          <div class="ex__foot">
            @if (group().commands.length > limit()) {
              <button type="button" uiButton variant="ghost" size="sm" (click)="toggleAll()">
                {{ showAll() ? 'Show fewer' : 'All ' + group().commands.length + ' commands' }}
                <ui-icon [name]="showAll() ? 'chevron-up-down' : 'chevron-right'" [size]="14" />
              </button>
            }
            <a class="site-link ex__docs" routerLink="/docs" fragment="commands">Command reference <ui-icon name="chevron-right" [size]="14" /></a>
          </div>
        </div>
        <div class="ex__shot">
          <site-screen [src]="shot().src" [alt]="shot().alt" [title]="shot().title" ratio="16 / 10" />
        </div>
      </div>
    </site-tabs>
  `,
  styles: [
    `
      :host { display: block; }
      .ex {
        display: grid;
        grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
        gap: clamp(20px, 3vw, 40px);
        align-items: start;
      }
      .ex--stacked { grid-template-columns: minmax(0, 1fr); }
      .ex__title { margin-top: 10px; }
      .ex__list { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 2px; }
      .ex__cmd {
        display: grid;
        grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
        column-gap: 12px;
        row-gap: 3px;
        padding: 9px 10px;
        border-radius: var(--ui-radius-md);
        font-size: var(--ui-text-sm);
        transition: background var(--ui-dur-fast);
      }
      .ex__cmd:hover { background: var(--ui-hover); }
      .ex__name { font-weight: 600; color: var(--ui-text-strong); }
      .ex__aliases { display: flex; flex-wrap: wrap; gap: 4px; align-content: start; }
      .ex__what { grid-column: 1 / -1; color: var(--ui-text-dim); line-height: 1.45; }
      .ex__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; }
      .ex__docs { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ui-text-sm); font-weight: 500; }
      .ex__shot { position: sticky; top: calc(var(--site-header-h) + 16px); }

      @media (max-width: 960px) {
        .ex { grid-template-columns: minmax(0, 1fr); }
        .ex__shot { position: static; order: -1; }
      }
      @media (max-width: 480px) {
        .ex__cmd { grid-template-columns: minmax(0, 1fr); }
      }
    `,
  ],
})
export class SiteExplorerComponent {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  /** Commands shown before "All n commands" expands the list. */
  readonly limit = input(6);
  readonly initial = input('draw');

  protected readonly groups = COMMAND_GROUPS;
  protected readonly active = signal('draw');
  protected readonly showAll = signal(false);

  protected readonly tabs = computed<SiteTab[]>(() =>
    this.groups.map((g) => ({ id: g.id, label: g.label, icon: g.icon, hint: this.orientation() === 'vertical' ? g.hint : undefined })),
  );
  protected readonly group = computed<CommandGroup>(() => this.groups.find((g) => g.id === this.active()) ?? this.groups[0]);
  protected readonly shown = computed(() => (this.showAll() ? this.group().commands : this.group().commands.slice(0, this.limit())));
  protected readonly shot = computed(() => SHOTS[this.group().id] ?? SHOTS['draw']);

  constructor() {
    // `initial` is a plain input; read it once the component exists.
    queueMicrotask(() => {
      if (this.groups.some((g) => g.id === this.initial())) this.active.set(this.initial());
    });
  }

  protected toggleAll(): void {
    this.showAll.update((v) => !v);
  }
}
