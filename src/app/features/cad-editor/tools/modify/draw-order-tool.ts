import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { DrawOrderService } from '../../core/services/draw-order.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { getSelectedEntities, hitTestAll } from '../select/select-tool';

export enum DrawOrderMode {
  WAITING_MOVERS,
  WAITING_OPTION,
  WAITING_REFERENCE_ABOVE,
  WAITING_REFERENCE_UNDER,
}

export class DrawOrderTool implements ITool {
  readonly name = 'draworder';
  mode = DrawOrderMode.WAITING_MOVERS;
  
  movers: Entity[] = [];
  
  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get drawOrder() { return this.injector.get(DrawOrderService) as DrawOrderService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }
  
  activate(): void {
    const selected = getSelectedEntities(this.doc);
    if (selected.length > 0) {
      this.movers = selected;
      this.mode = DrawOrderMode.WAITING_OPTION;
    } else {
      this.mode = DrawOrderMode.WAITING_MOVERS;
    }
  }

  /** Called by right-click menu to jump straight into Above/Under selection */
  activateWithMode(movers: Entity[], mode: DrawOrderMode): void {
    this.movers = movers;
    this.mode = mode;
    this.dyn.clearEdits();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number): void {
    if (this.mode === DrawOrderMode.WAITING_MOVERS) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) {
        this.movers.push(hit.entity);
        hit.entity.selected = true;
        this.vm.markContentDirty();
        // AutoCAD lets you select multiple, but we'll jump to options for simplicity
        this.mode = DrawOrderMode.WAITING_OPTION;
        this.dyn.clearEdits();
      }
      return;
    }

    if (this.mode === DrawOrderMode.WAITING_REFERENCE_ABOVE || this.mode === DrawOrderMode.WAITING_REFERENCE_UNDER) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) {
        const ref = hit.entity;
        if (this.mode === DrawOrderMode.WAITING_REFERENCE_ABOVE) {
          this.drawOrder.bringAbove(this.movers, ref, this.doc.activeFile);
        } else {
          this.drawOrder.sendUnder(this.movers, ref, this.doc.activeFile);
        }
        this.finish();
      }
    }
  }

  onMouseMove(): void {}

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.finish();
    }
    if ((e.key === 'Enter' || e.key === ' ') && this.mode === DrawOrderMode.WAITING_MOVERS && this.movers.length > 0) {
       this.mode = DrawOrderMode.WAITING_OPTION;
       this.dyn.clearEdits();
    }
  }

  getPhase(): string { return 'select'; }

  getDynamicInputState(): IDynamicInputState | null {
    if (this.mode === DrawOrderMode.WAITING_MOVERS) {
      return { wx: 0, wy: 0, primaryFieldKey: 'msg', fields: [{ key: 'msg', label: 'Select objects', liveValue: '', width: 100 }] };
    }
    if (this.mode === DrawOrderMode.WAITING_OPTION) {
      return {
        wx: 0, wy: 0, primaryFieldKey: 'opt',
        fields: [{ key: 'opt', label: 'Enter option [F]ront/[B]ack/[A]bove/[U]nder/[Fw]Forward/[Bw]Backward', liveValue: '', width: 200 }]
      };
    }
    if (this.mode === DrawOrderMode.WAITING_REFERENCE_ABOVE) {
      return { wx: 0, wy: 0, primaryFieldKey: 'msg', fields: [{ key: 'msg', label: 'Select reference object to move above', liveValue: '', width: 220 }] };
    }
    if (this.mode === DrawOrderMode.WAITING_REFERENCE_UNDER) {
      return { wx: 0, wy: 0, primaryFieldKey: 'msg', fields: [{ key: 'msg', label: 'Select reference object to move under', liveValue: '', width: 220 }] };
    }
    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.mode === DrawOrderMode.WAITING_OPTION) {
      const opt = (values['opt'] || '').toLowerCase().trim();
      // Single letter shortcuts
      if (opt === 'f') {
        this.drawOrder.bringToFront(this.movers, this.doc.activeFile);
        this.finish();
      } else if (opt === 'b') {
        this.drawOrder.sendToBack(this.movers, this.doc.activeFile);
        this.finish();
      } else if (opt === 'a') {
        this.mode = DrawOrderMode.WAITING_REFERENCE_ABOVE;
        this.dyn.clearEdits();
      } else if (opt === 'u') {
        this.mode = DrawOrderMode.WAITING_REFERENCE_UNDER;
        this.dyn.clearEdits();
      } else if (opt === 'fw' || opt === 'forward') {
        this.drawOrder.bringForward(this.movers, this.doc.activeFile);
        this.finish();
      } else if (opt === 'bw' || opt === 'backward') {
        this.drawOrder.sendBackward(this.movers, this.doc.activeFile);
        this.finish();
      }
      return true;
    }
    return false;
  }

  private finish(): void {
    this.movers = [];
    this.dyn.clearEdits();
    this.tools.setTool('select');
  }

  deactivate(): void {
    this.movers = [];
    this.dyn.clearEdits();
  }
}
