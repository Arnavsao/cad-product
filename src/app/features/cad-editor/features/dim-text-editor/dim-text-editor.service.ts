import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

import { CommandStackService } from '../../core/services/command-stack.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ModifyGeometryCmd } from '../../core/models/command.model';
import { DocumentService } from '../../core/services/document.service';
import { snapshotEntity } from '../../tools/geometry-utils';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DimensionEntity } from '../../core/models/entity-extended.model';

export interface IDimTextEditorState {
  entity: DimensionEntity;
  originalSnapshot: Record<string, unknown> | null;
  /** Screen coordinates of the double-click that triggered edit mode. */
  clickSx: number;
  clickSy: number;
  measuredText: string;
}

@Injectable({ providedIn: 'root' })
export class DimTextEditorService {
  state = signal<IDimTextEditorState | null>(null);

  constructor(
    private cmds: CommandStackService,
    private vm: ViewModelService,
    private doc: DocumentService,
    private tools: ToolManagerService
  ) { }

  openForEdit(entity: DimensionEntity, clickSx: number, clickSy: number): void {
    this.doc.clearSelection();
    this.state.set({ 
      entity, 
      originalSnapshot: this.snapshotDimensionEntity(entity), 
      clickSx, 
      clickSy,
      measuredText: typeof entity.getMeasurementText === 'function' ? entity.getMeasurementText(this.doc as any) : ''
    });
  }

  commit(newTextOverride: string | null): void {
    const s = this.state();
    if (!s || !s.entity || !s.originalSnapshot) {
      this.cancel();
      return;
    }

    let finalOverride = newTextOverride;
    if (finalOverride && s.measuredText && finalOverride.includes(s.measuredText)) {
      finalOverride = finalOverride.replace(s.measuredText, '<>');
    }
    if (finalOverride === '<>') finalOverride = null;

    const after = this.snapshotDimensionEntity(s.entity);
    // apply the new text override to the after snapshot
    after['textOverride'] = finalOverride;
    
    // restore original temporarily so command executes properly
    this.restoreSnap(s.entity, s.originalSnapshot);
    
    this.cmds.push(new ModifyGeometryCmd(
      s.entity, 
      s.originalSnapshot, 
      after, 
      { markDirty: () => this.vm.markContentDirty() }
    ));

    this.state.set(null);
    this.tools.setTool('select');
    this.vm.markDirty();
  }

  cancel(): void {
    const s = this.state();
    if (s && s.entity && s.originalSnapshot) {
      this.restoreSnap(s.entity, s.originalSnapshot);
    }
    this.state.set(null);
    this.tools.setTool('select');
    this.vm.markDirty();
  }

  private snapshotDimensionEntity(ent: DimensionEntity): Record<string, unknown> {
    const base = snapshotEntity(ent);
    const props = ['textOverride'];
    for (const p of props) {
      if ((ent as any)[p] !== undefined) base[p] = (ent as any)[p];
    }
    return base;
  }

  private restoreSnap(ent: any, snap: Record<string, unknown>): void {
    for (const k in snap) {
      const v = snap[k];
      if (Array.isArray(v)) ent[k] = v.map((p: any) => p && typeof p === 'object' ? { ...p } : p);
      else if (v && typeof v === 'object') ent[k] = { ...(v as object) };
      else ent[k] = v;
    }
    ent.refreshCaches?.();
  }
}
