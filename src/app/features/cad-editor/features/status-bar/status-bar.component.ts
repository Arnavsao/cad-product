import {
  Component, ElementRef, HostListener, Input, inject, signal, ChangeDetectionStrategy
} from '@angular/core';

import { OBJECT_SNAP_MODES, ObjectSnapMode, SnappingService } from '../../core/services/snapping.service';
import { DocumentService } from '../../core/services/document.service';
import { LayoutManagerService } from '../../core/services/layout-manager.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cad-status-bar',
  standalone: true,
  imports: [],
  template: `
    <div class="cad-status-bar">
      <!-- Right: coords + snap badges -->
      <div class="status-right">
        <span class="status-coords">
          X <span>{{ vm.cursorX() }}</span>
          &nbsp;&nbsp;
          Y <span>{{ vm.cursorY() }}</span>
        </span>
        <!-- Workspace mode indicator -->
        @if (!layoutMgr.isModelSpace()) {
          <span
            class="status-badge on"
            [style.color]="layoutMgr.workspaceMode() === 'MSPACE' ? '#f0a030' : '#499bea'"
            [title]="layoutMgr.workspaceMode() === 'MSPACE' ? 'Model Space (through viewport) — dblclick outside to return to Paper Space' : 'Paper Space — dblclick viewport to enter Model Space'"
          >{{ layoutMgr.workspaceMode() }}</span>
        }
        @if (layoutMgr.isModelSpace() || layoutMgr.workspaceMode() === 'MSPACE') {
          <div class="status-badge" style="min-width: 10px;display: flex; align-items: center; gap: 4px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 8px;" title="Annotation Scale (CANNOSCALE)">
            <select
              [value]="doc.activeFile.cannoScale"
              (change)="onAnnoScaleChange($event)"
              style="background: transparent; color: inherit; border: none; font: inherit; outline: none; padding: 0;"
            >
              <option [value]="1.0" style="color: black;">1:1</option>
              <option [value]="0.5" style="color: black;">1:2</option>
              <option [value]="0.2" style="color: black;">1:5</option>
              <option [value]="0.1" style="color: black;">1:10</option>
              <option [value]="0.05" style="color: black;">1:20</option>
              <option [value]="0.02" style="color: black;">1:50</option>
              <option [value]="0.01" style="color: black;">1:100</option>
            </select>
          </div>
        }
        <div class="osnap-control">
          <button
            type="button"
            class="status-badge osnap-main"
            [class.on]="snap.osnapEnabled()"
            (click)="snap.toggleOsnap()"
            title="Object Snap (F3)"
          >OSNAP</button>
          <button
            type="button"
            class="status-badge osnap-arrow"
            [class.on]="snap.osnapEnabled()"
            (click)="toggleOsnapMenu($event)"
            title="Object Snap Settings"
            aria-label="Object Snap Settings"
          >▾</button>
          @if (osnapMenuOpen()) {
            <div class="osnap-menu" role="menu">
              @for (mode of objectSnapModes; track mode.id) {
                <button
                  type="button"
                  class="osnap-menu-item"
                  role="menuitemcheckbox"
                  [attr.aria-checked]="snap.isObjectSnapEnabled(mode.id)"
                  (click)="toggleObjectSnap(mode.id, $event)"
                >
                  <span class="osnap-check">{{ snap.isObjectSnapEnabled(mode.id) ? '✓' : '' }}</span>
                  <span class="osnap-icon">{{ mode.icon }}</span>
                  <span>{{ mode.label }}</span>
                </button>
              }
              <div class="osnap-menu-separator"></div>
              <button type="button" class="osnap-menu-footer" (click)="enableAllObjectSnaps($event)">Object Snap Settings...</button>
            </div>
          }
        </div>
        <button
          type="button"
          class="status-badge"
          [class.on]="snap.gridEnabled()"
          (click)="snap.toggleGrid()"
          title="Grid (F7)"
        >SNAP &amp; GRID</button>
        <button
          type="button"
          class="status-badge"
          [class.on]="snap.isOrthoActive()"
          [class.override]="snap.orthoOverride()"
          (click)="snap.toggleOrtho()"
          title="Ortho (F8) — hold Shift to temporarily invert"
        >ORTHO</button>
        <button
          type="button"
          class="status-badge"
          [class.on]="snap.otrackEnabled()"
          (click)="snap.toggleOtrack()"
          title="Object Snap Tracking (F11)"
        >OTRACK</button>
        <button
          type="button"
          class="status-badge"
          [class.on]="snap.polarEnabled()"
          (click)="snap.togglePolar()"
          title="Polar tracking (F10)"
        >POLAR</button>
        <button
          type="button"
          class="status-badge"
          [class.on]="dynInput.dynEnabled()"
          (click)="dynInput.toggleDyn()"
          title="Dynamic Input — cursor command box (F12)"
        >DYN</button>
      </div>
    </div>
  `,
  styles: [`
    .osnap-control {
      position: relative;
      display: inline-flex;
      align-items: stretch;
    }

    .osnap-main {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }

    .osnap-arrow {
      min-width: 18px;
      padding-left: 3px;
      padding-right: 3px;
      border-left: 1px solid rgba(255,255,255,0.14);
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }

    .osnap-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 4px);
      z-index: 10000;
      min-width: 210px;
      padding: 4px 0;
      background: #46556b;
      color: #fff;
      border: 1px solid rgba(0,0,0,0.45);
      box-shadow: 0 8px 22px rgba(0,0,0,0.35);
      font: 12px/1.25 system-ui, sans-serif;
    }

    .osnap-menu-item,
    .osnap-menu-footer {
      width: 100%;
      height: 27px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      color: inherit;
      background: transparent;
      border: 0;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }

    .osnap-menu-item:hover,
    .osnap-menu-footer:hover {
      background: rgba(255,255,255,0.12);
    }

    .osnap-check {
      width: 12px;
      color: #fff;
      font-weight: 700;
    }

    .osnap-icon {
      width: 18px;
      opacity: 0.92;
      text-align: center;
      font-size: 15px;
    }

    .osnap-menu-separator {
      height: 1px;
      background: rgba(0,0,0,0.38);
      margin: 3px 0;
    }

    .osnap-menu-footer {
      height: 26px;
      padding-left: 32px;
    }
  `],
})
export class StatusBarComponent {
  protected snap: SnappingService = inject(SnappingService);
  protected doc: DocumentService = inject(DocumentService);
  protected layoutMgr: LayoutManagerService = inject(LayoutManagerService);
  protected vm: ViewModelService = inject(ViewModelService);
  protected dynInput: DynamicInputService = inject(DynamicInputService);
  private host: ElementRef<HTMLElement> = inject(ElementRef<HTMLElement>);
  protected osnapMenuOpen = signal(false);
  protected objectSnapModes = OBJECT_SNAP_MODES;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.osnapMenuOpen.set(false);
  }

  toggleOsnapMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.osnapMenuOpen.update((open) => !open);
  }

  toggleObjectSnap(mode: ObjectSnapMode, event: MouseEvent): void {
    event.stopPropagation();
    this.snap.toggleObjectSnap(mode);
  }

  enableAllObjectSnaps(event: MouseEvent): void {
    event.stopPropagation();
    this.snap.setAllObjectSnaps(true);
    this.osnapMenuOpen.set(false);
  }

  onAnnoScaleChange(event: Event): void {
    const el = event.target as HTMLSelectElement;
    const val = parseFloat(el.value);
    if (!isNaN(val) && val > 0) {
      this.doc.activeFile.cannoScale = val;
      this.doc.bump();
      this.vm.markDirty();
    }
  }
}

