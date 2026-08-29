import { Component, inject , ChangeDetectionStrategy
} from '@angular/core';

import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ToolCatalogService } from '../../core/services/tool-catalog.service';
import { SafeHtmlPipe } from '../../shared/components/safe-html.pipe';
import { DocumentService } from '../../core/services/document.service';
import { HATCH_PATTERNS } from '../../core/registries/hatch-patterns';
import { ViewModelService } from '../../core/services/view-model.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cad-toolbar',
  standalone: true,
  imports: [SafeHtmlPipe],
  template: `
    <div class="cad-toolbar-wrap">
      @for (sec of sections; track sec) {
        <div class="toolbar-section">
          <div class="toolbar-section-buttons">
            @for (t of sec.tools; track t) {
              @if (t.subTools?.length || t.id === 'hatch') {
                <div class="tb-btn-group"
                  [class.large]="isLarge(t.id)"
                  [class.icon-only]="isIconOnly(t.id)"
                  [class.active]="isGroupActive(t)"
                  >
                  <button
                    type="button"
                    class="tb-btn main-btn"
                    [class.active]="isGroupActive(t)"
                    [class.stub]="getDisplayTool(t).stub"
                    [title]="getDisplayTool(t).stub ? getDisplayTool(t).title + ' (not yet implemented)' : getDisplayTool(t).title"
                    (click)="!getDisplayTool(t).stub && toolMgr.setTool(getDisplayTool(t).id)"
                    >
                    <div class="icon-wrap" [innerHTML]="getDisplayTool(t).svg | safeHtml"></div>
                    @if (!isLarge(t.id) && !isIconOnly(t.id) && t.id !== 'hatch') {
                      <div class="btn-text">{{ getShortTitle(getDisplayTool(t).title) }}</div>
                    }
                    @if (t.id === 'hatch') {
                      <div class="btn-text hatch-pattern-label">{{ doc.activeHatchPattern }}</div>
                    }
                    @if (isLarge(t.id) && !isIconOnly(t.id)) {
                      <div class="large-text-wrap">
                        <span class="btn-text">{{ getShortTitle(t.title) }}</span>
                        <span class="dropdown-arrow-inline">▼</span>
                      </div>
                    }
                  </button>
                  @if (!isLarge(t.id)) {
                    <div class="dropdown-arrow">▼</div>
                  }
                  @if (t.id === 'hatch') {
                    <div class="tb-dropdown" (mouseleave)="hoverHatchPattern(null)">
                      @for (p of hatchPatterns; track p) {
                        <button
                          class="tb-dropdown-item"
                          [class.active]="doc.activeHatchPattern === p"
                          (mouseenter)="hoverHatchPattern(p)"
                          (click)="setHatchPattern(p)"
                          >
                          <span class="label">{{ p }}</span>
                        </button>
                      }
                    </div>
                  } @else {
                    <div class="tb-dropdown">
                      @for (sub of t.subTools; track sub) {
                        <button
                          class="tb-dropdown-item"
                          [class.active]="toolMgr.isActive(sub.id)"
                          [class.stub]="sub.stub"
                          (click)="!sub.stub && toolMgr.setTool(sub.id)"
                          >
                          <span class="icon" [innerHTML]="sub.svg | safeHtml"></span>
                          <span class="label">{{ sub.title }}</span>
                        </button>
                      }
                    </div>
                  }
                </div>
              } @else {
                <button
                  type="button"
                  class="tb-btn single-btn"
                  [class.large]="isLarge(t.id)"
                  [class.icon-only]="isIconOnly(t.id)"
                  [class.active]="toolMgr.isActive(t.id)"
                  [class.stub]="t.stub"
                  [title]="t.stub ? t.title + ' (not yet implemented)' : t.title"
                  (click)="!t.stub && toolMgr.setTool(t.id)"
                  >
                  <div class="icon-wrap" [innerHTML]="t.svg | safeHtml"></div>
                  @if (!isIconOnly(t.id)) {
                    <div class="btn-text">{{ getShortTitle(t.title) }}</div>
                  }
                </button>
              }
            }
          </div>
          <!-- <span class="toolbar-section-label">{{ sec.label }}</span> -->
        </div>
      }
    </div>
    `,
  styles: [`
    .tb-btn.stub { opacity: 0.35; cursor: not-allowed; }
    .tb-btn.stub:hover { background: transparent !important; }

    :host {
      display: block;
      width: 100%;
    }

    .cad-toolbar-wrap {
      padding: 0 6px;
      height: var(--cad-toolbar-h, 68px);
      box-sizing: border-box;
      display: flex;
      flex-wrap: nowrap;
      overflow: visible;
      background: var(--cad-bg-panel);
      border-bottom: 1px solid var(--cad-border);
    }

    .toolbar-section {
      padding: 0 8px;
      border-right: 1px solid var(--cad-border);
      justify-content: space-between !important;
      height: 100%;
    }

    .toolbar-section-buttons {
      display: grid !important;
      grid-template-rows: repeat(2, 24px);
      grid-auto-flow: column dense;
      gap: 2px 4px;
      align-items: center;
      flex: 1;
      width: 100%;
      justify-content: space-evenly;
    }

    .toolbar-section-label {
      padding-bottom: 2px !important;
      color: var(--cad-text-dim) !important;
      font-size: 11px !important;
    }

    /* Common Button Styles */
    .tb-btn {
      background: transparent;
      border: none;
      color: var(--cad-text-secondary);
      cursor: pointer;
      border-radius: var(--cad-radius-sm);
      display: flex;
      align-items: center;
      justify-content: flex-start !important;
      transition: background 0.15s, color 0.15s;
    }
    .tb-btn:hover {
      background: var(--cad-bg-hover);
      color: var(--cad-text-primary);
    }
    .tb-btn.active {
      background: var(--cad-bg-active);
      color: var(--cad-accent);
    }

    /* Group Styles */
    .tb-btn-group {
      position: relative;
      display: flex;
      align-items: center;
      border-radius: var(--cad-radius-sm);
    }
    .tb-btn-group:hover {
      background: var(--cad-bg-hover);
    }
    .tb-btn-group.active {
      background: var(--cad-bg-active);
    }
    .tb-btn-group.active .main-btn {
      background: transparent;
      color: var(--cad-accent);
    }
    .tb-btn-group.active .dropdown-arrow,
    .tb-btn-group.active .dropdown-arrow-inline {
      color: var(--cad-accent);
    }

    /* SMALL BUTTONS (Default) */
    .tb-btn, .tb-btn-group {
      height: 20px;
      padding: 0 4px;
      width: auto !important;
    }
    .tb-btn.single-btn:not(.large) {
      height: 20px;
    }
    .tb-btn-group {
      flex-direction: row;
    }
    .tb-btn.main-btn {
      height: 100%;
      padding: 0 2px 0 4px;
      width: auto !important;
      flex-direction: row;
    }
    .tb-btn-group:hover .tb-btn.main-btn {
      background: transparent;
    }
    .tb-btn:not(.active) .icon-wrap {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tb-btn .btn-text {
      font-size: 11px;
      margin-left: 6px;
      white-space: nowrap;
    }
    .tb-btn.icon-only .btn-text,
    .tb-btn-group.icon-only .btn-text {
      display: none;
    }
    .hatch-pattern-label {
      display: block !important;
      max-width: 36px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 8px;
    }
    .dropdown-arrow {
      font-size: 7px;
      padding: 0 4px;
      color: var(--cad-text-secondary);
      pointer-events: none;
    }
    .tb-btn-group:hover .dropdown-arrow {
      color: var(--cad-text-primary);
    }

    /* LARGE BUTTONS */
    .tb-btn.large, .tb-btn-group.large {
      grid-row: span 2;
      height: 50px;
      flex-direction: column !important;
      justify-content: flex-end !important;
      min-width: 60px !important;
      width: auto !important;
      padding: 0 6px 0 6px !important;
    }
    .tb-btn-group.large .tb-btn.main-btn {
      flex-direction: column !important;
      justify-content: flex-end !important;
      height: 100%;
      width: 100%;
      padding: 0;
      margin-bottom: 0px;
    }
    .tb-btn.large .icon-wrap, .tb-btn-group.large .icon-wrap {
      width: 100%;
      flex: 1;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tb-btn.large .icon-wrap ::ng-deep svg, .tb-btn-group.large .icon-wrap ::ng-deep svg {
      width: 32px !important;
      height: 32px !important;
      stroke-width: 0.8 !important;
    }
    .tb-btn.large .btn-text, .tb-btn-group.large .btn-text {
      margin-left: 0;
      margin-top: 0px;
      margin-bottom: 0px;
      font-size: 10.5px;
      line-height: 1;
    }
    .large-text-wrap {
      display: flex;
      flex-direction: row;
      align-items: flex-end;
      justify-content: center;
      margin-bottom: 0px;
    }
    .large-text-wrap .btn-text {
      font-size: 10.5px;
      line-height: 1;
      margin: 0;
    }
    .large-text-wrap .dropdown-arrow-inline {
      font-size: 7px;
      line-height: 1;
      padding-left: 3px;
      padding-bottom: 1px;
      color: var(--cad-text-secondary);
    }
    .tb-btn-group:hover .dropdown-arrow-inline {
      color: var(--cad-text-primary);
    }

    /* DROPDOWN MENU */
    .tb-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      background-color: var(--cad-bg-panel-solid);
      min-width: 160px;
      box-shadow: var(--cad-shadow-float);
      border: 1px solid var(--cad-border);
      border-radius: var(--cad-radius-sm);
      z-index: 300;
      flex-direction: column;
      padding: 4px 0;
    }
    .toolbar-section:last-child .tb-dropdown {
      left: auto;
      right: 0;
    }
    .tb-btn-group:hover .tb-dropdown {
      display: flex;
    }
    .tb-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: transparent;
      border: none;
      color: var(--cad-text-primary);
      cursor: pointer;
      text-align: left;
      font-size: 11px;
    }
    .tb-dropdown-item:hover {
      background-color: var(--cad-bg-active);
      color: var(--cad-accent);
    }
    .tb-dropdown-item.stub { opacity: 0.5; cursor: not-allowed; }
    .tb-dropdown-item.stub:hover { background-color: transparent; color: var(--cad-text-primary); }
    .tb-dropdown-item .icon {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--cad-text-secondary);
    }
    .tb-dropdown-item:hover .icon {
      color: var(--cad-accent);
    }
    
    /* Responsive Toolbar: Hide small button labels on smaller screens */
    @media (max-width: 1550px) {
      .tb-btn:not(.large):not(.main-btn) .btn-text,
      .tb-btn-group:not(.large) .btn-text {
        display: none;
      }
      .toolbar-section {
        padding: 0 4px;
      }
    }
  `]
})
export class ToolbarComponent {
  protected toolMgr = inject(ToolManagerService);
  private catalog = inject(ToolCatalogService);
  protected doc = inject(DocumentService);
  protected vm = inject(ViewModelService);
  protected sections = this.catalog.getGrouped();

  readonly hatchPatterns: string[] = (() => {
    const names = Object.keys(HATCH_PATTERNS);
    names.sort((a, b) => (a === 'SOLID' ? -1 : b === 'SOLID' ? 1 : a.localeCompare(b)));
    return names;
  })();

  private largeTools = new Set(['line', 'polyline', 'circle', 'arc', 'erase', 'text', 'dimension', 'mleader', 'dimjogged']);
  private iconOnlyTools = new Set(['rect', 'ellipse', 'spline', 'point', 'table', 'image', 'symbol']);

  private groupActiveTool = new Map<string, any>();

  getDisplayTool(t: any): any {
    if (this.toolMgr.isActive(t.id)) {
      return t;
    }
    if (t.subTools) {
      for (const sub of t.subTools) {
        if (this.toolMgr.isActive(sub.id)) {
          this.groupActiveTool.set(t.id, sub);
          return sub;
        }
      }
    }
    return this.groupActiveTool.get(t.id) || t;
  }

  isGroupActive(t: any): boolean {
    if (this.toolMgr.isActive(t.id)) return true;
    if (t.subTools) {
      return t.subTools.some((sub: any) => this.toolMgr.isActive(sub.id));
    }
    return false;
  }

  isLarge(id: string): boolean {
    return this.largeTools.has(id);
  }

  isIconOnly(id: string): boolean {
    return this.iconOnlyTools.has(id);
  }

  setHatchPattern(pattern: string): void {
    this.doc.previewHatchPattern = null;
    this.doc.activeHatchPattern = pattern;
    if (this.toolMgr.activeToolName() === 'hatch') {
      const ht = this.toolMgr.activeTool as any;
      if (ht && typeof ht.applyPatternToLast === 'function') {
        ht.applyPatternToLast(pattern);
      }
    } else {
      this.toolMgr.setTool('hatch');
    }
    this.vm.markDirty();
  }

  hoverHatchPattern(pattern: string | null): void {
    if (this.doc.previewHatchPattern !== pattern) {
      this.doc.previewHatchPattern = pattern;
      if (this.toolMgr.activeToolName() === 'hatch') {
        const ht = this.toolMgr.activeTool as any;
        if (ht && typeof ht.previewPatternOnLast === 'function') {
          ht.previewPatternOnLast(pattern);
        } else {
          this.vm.markDirty();
        }
      }
    }
  }

  getShortTitle(title: string): string {
    // Return text before the parenthesis (e.g. "Line (L)" -> "Line")
    let short = title.split('(')[0].trim();
    // if there's an em dash, strip it too
    return short.split('—')[0].trim();
  }
}
