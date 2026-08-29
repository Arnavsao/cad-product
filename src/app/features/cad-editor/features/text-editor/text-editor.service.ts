import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

import type { IPoint } from '../../core/models/entity.model';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ModifyGeometryCmd, AddEntityCmd } from '../../core/models/command.model';
import { DocumentService } from '../../core/services/document.service';
import { snapshotEntity } from '../../tools/geometry-utils';
import { ToolManagerService } from '../../core/services/tool-manager.service';

import { TextEntity, LeaderEntity, DimensionEntity } from '../../core/models/entity-extended.model';

/**
 * Universal text editor target â€” any entity that exposes the standard
 * text-style fields (text/height/font/bold/italic/...). Today: TextEntity
 * (TEXT/MTEXT) and LeaderEntity (LEADER annotations) and DimensionEntity.
 */
export type EditableTextEntity = TextEntity | LeaderEntity | DimensionEntity;

export interface ITextEditorState {
  entity: EditableTextEntity;
  isNew: boolean;
  originalSnapshot: Record<string, unknown> | null;
  placement: IPoint | null;
  /** Screen coordinates of the double-click that triggered edit mode (for caret positioning). */
  clickSx?: number;
  clickSy?: number;
}

@Injectable({ providedIn: 'root' })
export class TextEditorService {
  state = signal<ITextEditorState | null>(null);

  /** Emits whenever a ribbon control changes a formatting property */
  formatChanged = new Subject<void>();

  /** Emits when a symbol is requested to be inserted at caret */
  insertSymbolRequested = new Subject<string>();

  /** Emits when a list type toggle is requested */
  toggleListTypeRequested = new Subject<string>();

  constructor(
    private cmds: CommandStackService,
    private vm: ViewModelService,
    private doc: DocumentService,
    private tools: ToolManagerService
  ) { }


  openForNew(placement: IPoint, mtextWidth?: number): void {
    const ent = new TextEntity(placement.x, placement.y, '');
    ent.layer = this.doc.activeLayerName;
    ent.height = this.dynamicDefaultHeight();
    if (mtextWidth !== undefined && mtextWidth > 0) {
      ent.autoWrap = true;
      ent.mtextWidth = mtextWidth;
    }
    this.state.set({ entity: ent, isNew: true, originalSnapshot: null, placement });
  }

  /**
   * View-scale-derived default height so new text reads at a consistent
   * on-screen size (~18 screen px) regardless of zoom â€” mirrors the formula
   * LeaderTool uses so TEXT and LEADER annotations stay visually balanced.
   */
  private dynamicDefaultHeight(): number {
    const TARGET_SCREEN_PX = 18;
    const scale = this.vm.scale || 1;
    const h = TARGET_SCREEN_PX / scale;
    return Number.isFinite(h) && h > 0 ? h : 2.5;
  }

  openForEdit(entity: EditableTextEntity, clickSx?: number, clickSy?: number): void {
    this.doc.clearSelection();
    this.state.set({ entity, isNew: false, originalSnapshot: this.snapshotTextEntity(entity), placement: null, clickSx, clickSy });
  }

  commit(): void {
    const s = this.state();
    if (!s || !s.entity) return;

    // remove trailing newlines etc if empty
    if (!s.entity.text.trim()) {
      this.cancel();
      return;
    }

    if (s.isNew) {
      s.entity.refreshCaches();
      this.cmds.push(new AddEntityCmd(s.entity, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    } else if (s.originalSnapshot) {
      const after = this.snapshotTextEntity(s.entity);
      // restore original temporarily so command executes properly
      this.restoreSnap(s.entity, s.originalSnapshot);
      this.cmds.push(new ModifyGeometryCmd(s.entity, s.originalSnapshot, after, { markDirty: () => this.vm.markContentDirty() }));
    }

    this.state.set(null);
    this.tools.setTool('select');
    this.vm.markDirty();
  }

  cancel(): void {
    const s = this.state();
    if (s && !s.isNew && s.entity && s.originalSnapshot) {
      this.restoreSnap(s.entity, s.originalSnapshot);
    }
    this.state.set(null);
    this.tools.setTool('select');
    this.vm.markDirty();
  }

  private snapshotTextEntity(ent: EditableTextEntity): Record<string, unknown> {
    const base = snapshotEntity(ent);
    // Union of TextEntity + LeaderEntity style props â€” copy whichever are defined.
    const props = [
      'text', 'font', 'height', 'bold', 'italic', 'underline', 'strikethrough',
      'justify', 'lineSpacing', 'charSpacing', 'widthFactor', 'obliqueAngle',
      'mtextWidth', 'autoWrap', 'rotation', 'textColor',
      'attachmentSide', 'landingLength', 'arrowSize',
    ];
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
    ent.refreshCaches();
  }

  // â”€â”€ Formatter Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  updateProp(ent: any, key: string, val: any): void {
    ent[key] = val;
    ent.refreshCaches?.();
    this.vm.markContentDirty();
    this.formatChanged.next();
  }

  getHoriz(ent: any): 'left' | 'center' | 'right' {
    const h = ent?.justify?.[1] ?? 'L';
    return h === 'L' ? 'left' : (h === 'R' ? 'right' : 'center');
  }

  getVert(ent: any): 'top' | 'middle' | 'bottom' {
    const j = ent?.justify?.[0] ?? 'B';
    return j === 'T' ? 'top' : (j === 'M' ? 'middle' : 'bottom');
  }

  setHoriz(ent: any, align: string): void {
    const h = align === 'center' ? 'C' : (align === 'right' ? 'R' : 'L');
    const v = ent?.justify?.[0] ?? 'B';
    const newJ = v + h;
    if (ent.justify === newJ) return;

    this.adjustJustifyPreservingPosition(ent, newJ);
  }

  setVert(ent: any, align: string): void {
    const v = align === 'top' ? 'T' : (align === 'middle' ? 'M' : 'B');
    const h = ent?.justify?.[1] ?? 'L';
    const newJ = v + h;
    if (ent.justify === newJ) return;

    this.adjustJustifyPreservingPosition(ent, newJ);
  }

  private adjustJustifyPreservingPosition(ent: any, newJustify: string): void {
    if (typeof ent.getLayout === 'function') {
      ent._cachedBbox = null;
      const l1 = ent.getLayout();
      ent.justify = newJustify;
      ent._cachedBbox = null;
      const l2 = ent.getLayout();

      const cx1 = (l1.worldBounds.minX + l1.worldBounds.maxX) / 2;
      const cy1 = (l1.worldBounds.minY + l1.worldBounds.maxY) / 2;
      const cx2 = (l2.worldBounds.minX + l2.worldBounds.maxX) / 2;
      const cy2 = (l2.worldBounds.minY + l2.worldBounds.maxY) / 2;

      ent.x -= (cx2 - cx1);
      ent.y -= (cy2 - cy1);
    } else {
      ent.justify = newJustify;
    }
    this.updateProp(ent, 'justify', ent.justify);
  }

  getTextColor(ent: any): string {
    if (this.isLeader(ent)) {
      return ent.textColor || '#ffffff';
    }
    return ent.color || '#ffffff';
  }

  setTextColor(ent: any, color: string): void {
    if (this.isLeader(ent)) {
      this.updateProp(ent, 'textColor', color);
    } else {
      this.updateProp(ent, 'color', color);
    }
  }

  isLeader(ent: any): boolean {
    return ent?.type === 'LEADER';
  }
}

