import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd, CompoundCmd, ICommand } from '../../core/models/command.model';
import { getSelectedEntities, hitTestAll } from '../select/select-tool';
import { mirrorEntityInPlace, snapshotEntity } from '../geometry-utils';
import { drawTransformGhost, commitEntityTransforms } from '../drag-preview';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatLen, formatAngleDeg } from '../draw/draw-utils';

export class MirrorTool implements ITool {
  readonly name = 'mirror';
  private p1: IPoint | null = null;
  private p2: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  private targets: Entity[] = [];
  private snapshots: { ent: Entity; snap: Record<string, unknown> }[] = [];
  /** Default to No (keep original objects) to match AutoCAD. */
  private keepOriginals = true;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void {
    this.targets = getSelectedEntities(this.doc);
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (!this.targets.length) this.targets = getSelectedEntities(this.doc);
    if (!this.targets.length) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) { hit.entity.selected = true; this.targets = [hit.entity]; this.vm.markContentDirty(); }
      return;
    }

    if (!this.p1) {
      this.p1 = { x: wx, y: wy };
      this.snapshots = this.targets.map((ent) => ({ ent, snap: snapshotEntity(ent) }));
      // Unlike move/rotate/scale, mirror keeps the original visible during drag.
      this.dyn.clearEdits();
      return;
    }

    if (!this.p2) {
      this.lockMirrorAxis(wx, wy);
    }
  }

  private lockMirrorAxis(x2: number, y2: number): boolean {
    if (!this.p1) return false;
    this.p2 = { x: x2, y: y2 };
    
    // Ensure the dynamic input state switches to the Yes/No prompt
    this.dyn.setState(this.getDynamicInputState());
    this.dyn.clearEdits();
    this.dyn.focusPrimaryField();
    this.vm.markDirty();
    return true;
  }

  private executeMirror(): boolean {
    if (!this.p1 || !this.p2) return false;
    const x1 = this.p1.x;
    const y1 = this.p1.y;
    const x2 = this.p2.x;
    const y2 = this.p2.y;

    if (this.keepOriginals) {
      // Add mirrored clones
      const commands: ICommand[] = [];
      for (const ent of this.targets) {
        const clone = ent.clone();
        mirrorEntityInPlace(clone, x1, y1, x2, y2);
        const file = this.doc.getFileOfEntity(ent) ?? this.doc.activeFile;
        commands.push(new AddEntityCmd(clone, file, { markDirty: () => this.vm.markContentDirty() }));
      }
      this.cmds.push(new CompoundCmd(commands));
    } else {
      // Erase source: mutate originals into their mirrored versions. They were
      // never touched during the drag (ghost-only preview), so apply once and
      // record as a single atomic undo step.
      commitEntityTransforms(
        this.snapshots,
        (ent) => mirrorEntityInPlace(ent, x1, y1, x2, y2),
        this.cmds,
        this.vm,
      );
    }

    // Unselect everything to return to neutral state
    this.targets.forEach(t => t.selected = false);

    this.cleanup();
    this.dyn.clearEdits();
    this.tools.setTool('select');
    this.vm.markDirty();
    return true;
  }

  onMouseMove(wx: number, wy: number): void {
    if (this.p2) return; // Ignore movement when axis is locked
    this.cur = { x: wx, y: wy };
    this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    const p2ToUse = this.p2 || this.cur;
    
    const a = this.vm.w2s(this.p1.x, this.p1.y);
    const b = this.vm.w2s(p2ToUse.x, p2ToUse.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(255,255,0,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.restore();

    // Render fully mirrored ghost entities â€” no clones, no mutation
    // (composed view transform). Skip until the axis has a finite length.
    const axisLen = Math.hypot(p2ToUse.x - this.p1.x, p2ToUse.y - this.p1.y);
    if (axisLen > 1e-9) {
      ctx.save();
      // Full opacity when axis is locked to show final result clearly,
      // otherwise 50% opacity during dragging.
      ctx.globalAlpha = this.p2 ? 1.0 : 0.5;
      drawTransformGhost(ctx, this.vm, this.doc, this.targets, {
        kind: 'mirror', x1: this.p1.x, y1: this.p1.y, x2: p2ToUse.x, y2: p2ToUse.y,
      });
      ctx.restore();
    }
  }

  getAnchor(): IPoint | null { return this.p1; }

  getPhase(): string {
    if (!this.targets.length) return 'select';
    if (!this.p1) return 'first';
    if (!this.p2) return 'second';
    return 'erase';
  }

  /**
   * Handle option chips/keys.
   * At the 'erase' phase (mirror line set), Y/N decide whether originals are kept.
   */
  invokeOption(key: string): boolean {
    if (this.getPhase() !== 'erase') return false;
    const k = key.toUpperCase();
    if (k === 'Y') { this.keepOriginals = false; return this.executeMirror(); }
    if (k === 'N') { this.keepOriginals = true;  return this.executeMirror(); }
    return false;
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.p1) return null;
    
    if (this.p2) {
      return {
        wx: this.p2.x,
        wy: this.p2.y,
        primaryFieldKey: 'erase',
        fields: [
          { key: 'erase', label: 'Erase source objects? [y/n]', liveValue: 'N', width: 60 }
        ]
      };
    } else {
      const dx = this.cur.x - this.p1.x;
      const dy = this.cur.y - this.p1.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'length',
        fields: [
          { key: 'length', label: 'Length', liveValue: formatLen(len), width: 80 },
          { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(ang), suffix: 'Â°', width: 60 },
        ],
      };
    }
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.p1) return false;
    
    if (this.p2) {
      const ans = (values['erase'] || 'N').trim().toUpperCase();
      this.keepOriginals = (ans !== 'Y' && ans !== 'YES');
      return this.executeMirror();
    } else {
      const liveDx = this.cur.x - this.p1.x;
      const liveDy = this.cur.y - this.p1.y;
      const liveAng = Math.atan2(liveDy, liveDx) * 180 / Math.PI;
      const liveLen = Math.hypot(liveDx, liveDy);
      const len = evalExpression(values['length'] ?? '') ?? liveLen;
      const ang = evalExpression(values['angle'] ?? '') ?? liveAng;
      if (!Number.isFinite(len) || len <= 0) return false;
      const rad = ang * Math.PI / 180;
      return this.lockMirrorAxis(this.p1.x + len * Math.cos(rad), this.p1.y + len * Math.sin(rad));
    }
  }

  private cleanup(): void {
    this.p1 = null;
    this.p2 = null;
    this.snapshots = [];
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.abort();
      return;
    }
    
    if (this.p2) {
      const key = e.key.toUpperCase();
      if (key === 'Y') {
        this.keepOriginals = false;
        this.executeMirror();
      } else if (key === 'N' || e.key === 'Enter' || e.key === ' ') {
        this.keepOriginals = true;
        this.executeMirror();
      }
      return;
    }
    
    if ((e.key === 'Enter' || e.key === ' ') && this.p1 && !this.p2) {
      this.lockMirrorAxis(this.cur.x, this.cur.y);
    }
  }
  
  private abort(): void {
    this.cleanup();
    this.vm.markDirty();
    this.tools.setTool('select');
  }

  deactivate(): void {
    this.cleanup();
  }
}
