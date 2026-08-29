import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { LineEntity, type Entity, type IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { ModifyGeometryCmd, AddEntityCmd, CompoundCmd, type ICommand } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';
import { snapshotEntity } from '../geometry-utils';

export class ChamferTool implements ITool {
  readonly name = 'chamfer';
  private dist1 = 0;
  private dist2 = 0;
  
  private first: LineEntity | null = null;
  private clickA: IPoint | null = null;
  
  private second: LineEntity | null = null;
  private clickB: IPoint | null = null;
  
  private hovered: LineEntity | null = null;
  
  private previewLine: LineEntity | null = null;
  private previewOps: { ent: Entity, after: any }[] = [];
  
  private waitingForDist = false;
  private activeDistIndex: 1 | 2 = 1;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get di() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void { this.reset(); }
  deactivate(): void { this.reset(); }

  private reset() {
    this.first = null;
    this.clickA = null;
    this.second = null;
    this.clickB = null;
    this.hovered = null;
    this.previewLine = null;
    this.previewOps = [];
    this.waitingForDist = false;
    this.activeDistIndex = 1;
    this.vm.markDirty();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    
    if (this.waitingForDist) {
      this.commitChamfer();
      return;
    }

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit || !(hit.entity instanceof LineEntity)) return;

    if (!this.first) {
      this.first = hit.entity;
      this.clickA = { x: wx, y: wy };
      this.vm.markDirty();
      return;
    }

    this.second = hit.entity;
    this.clickB = { x: wx, y: wy };

    if (this.first === this.second) {
      this.reset();
      return;
    }

    this.updatePreview(wx, wy);
    this.waitingForDist = true;
    setTimeout(() => this.di.focusPrimaryField(), 10);
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.waitingForDist) return;

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    const hitLine = hit?.entity instanceof LineEntity ? hit.entity : null;

    if (this.hovered !== hitLine) {
      this.hovered = hitLine;
      if (this.first) {
        this.updatePreview(wx, wy);
      }
      this.vm.markDirty();
    } else if (this.first && this.hovered) {
      // Re-evaluate if moving along hovered line
      this.updatePreview(wx, wy);
    }
  }

  getPhase(): string | null {
    if (!this.first) return 'first';
    if (!this.second && !this.waitingForDist) return 'second';
    return null;
  }

  /**
   * Handle option chips/keys.
   * 'D' at the first phase opens the distance input (same as pressing D on keyboard).
   */
  invokeOption(key: string): boolean {
    if (key.toUpperCase() === 'D' && !this.waitingForDist) {
      this.waitingForDist = true;
      this.activeDistIndex = 1;
      this.vm.markDirty();
      setTimeout(() => this.di.focusPrimaryField(), 10);
      return true;
    }
    return false;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.reset();
      this.tools.setTool('select');
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (this.waitingForDist) {
        this.commitChamfer();
        return true;
      }
    }
    if (e.key.toUpperCase() === 'D' && !this.waitingForDist) {
      this.waitingForDist = true;
      this.activeDistIndex = 1;
      this.vm.markDirty();
      setTimeout(() => this.di.focusPrimaryField(), 10);
      return true;
    }
    return false;
  }

  getAnchor(): IPoint | null { return this.clickB; }

  getDynamicInputState(): any {
    if (this.waitingForDist) {
      let cx = this.cur.x, cy = this.cur.y;
      if (this.clickB) { cx = this.clickB.x; cy = this.clickB.y; }

      const primary = this.activeDistIndex === 1 ? 'dist1' : 'dist2';
      return {
        wx: cx,
        wy: cy,
        primaryFieldKey: primary,
        fields: [
          { key: 'dist1', liveValue: this.dist1.toFixed(2), label: 'Dist 1', width: 70 },
          { key: 'dist2', liveValue: this.dist2.toFixed(2), label: 'Dist 2', width: 70 }
        ]
      };
    }
    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.waitingForDist) return false;
    
    if (values['dist1'] !== undefined) {
      const v = parseFloat(values['dist1']);
      if (Number.isFinite(v) && v >= 0) this.dist1 = v;
    }
    if (values['dist2'] !== undefined) {
      const v = parseFloat(values['dist2']);
      if (Number.isFinite(v) && v >= 0) {
        this.dist2 = v;
      } else {
        this.dist2 = this.dist1; // default dist2 to dist1 if unspecified
      }
    } else {
      this.dist2 = this.dist1;
    }

    if (this.activeDistIndex === 1 && Object.keys(values).length === 1 && values['dist1']) {
       // just committed dist1, let them type dist2
       this.activeDistIndex = 2;
       this.vm.markDirty();
       return true;
    }

    if (this.first && this.second && this.clickA && this.clickB) {
      this.commitChamfer();
    } else {
      this.waitingForDist = false;
      this.activeDistIndex = 1;
      this.vm.markDirty();
    }
    return true;
  }

  private updatePreview(wx: number, wy: number): void {
    this.previewLine = null;
    this.previewOps = [];
    if (!this.first) return;
    const secondEnt = this.second || this.hovered;
    if (!secondEnt) return;

    const clickB = this.clickB || { x: wx, y: wy };
    this.solveChamfer(this.first, secondEnt, this.dist1, this.dist2, this.clickA!, clickB);
    this.vm.markDirty();
  }

  private commitChamfer(): void {
    if (this.first && this.second && this.clickA && this.clickB) {
      this.updatePreview(this.clickB.x, this.clickB.y);
      
      const cmdsList: ICommand[] = [];
      for (const op of this.previewOps) {
        const before = snapshotEntity(op.ent);
        cmdsList.push(new ModifyGeometryCmd(op.ent, before, op.after, { markDirty: () => this.vm.markContentDirty() }));
      }
      
      if (this.previewLine) {
        this.previewLine.layer = this.first.layer;
        cmdsList.push(new AddEntityCmd(this.previewLine, this.doc.getFileOfEntity(this.first) ?? this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      }

      if (cmdsList.length > 0) {
        this.cmds.push(new CompoundCmd(cmdsList));
      }
    }
    this.reset();
  }

  private lineLineIntersection(a: LineEntity, b: LineEntity): { x: number; y: number } | null {
    const dAx = a.x2 - a.x1, dAy = a.y2 - a.y1;
    const dBx = b.x2 - b.x1, dBy = b.y2 - b.y1;
    const det = dAx * dBy - dAy * dBx;
    if (Math.abs(det) < 1e-10) return null;
    const tA = ((b.x1 - a.x1) * dBy - (b.y1 - a.y1) * dBx) / det;
    return { x: a.x1 + tA * dAx, y: a.y1 + tA * dAy };
  }

  private solveChamfer(lineA: LineEntity, lineB: LineEntity, d1: number, d2: number, clA: IPoint, clB: IPoint): void {
    const ix = this.lineLineIntersection(lineA, lineB);
    if (!ix) return;

    const dAx = lineA.x2 - lineA.x1, dAy = lineA.y2 - lineA.y1;
    const dBx = lineB.x2 - lineB.x1, dBy = lineB.y2 - lineB.y1;
    const lenA = Math.hypot(dAx, dAy), lenB = Math.hypot(dBx, dBy);
    const uAx = dAx / lenA, uAy = dAy / lenA;
    const uBx = dBx / lenB, uBy = dBy / lenB;

    if (d1 < 0.0001 && d2 < 0.0001) {
      // 0 distance chamfer = extend/trim to intersection
      const dA1 = Math.hypot(lineA.x1 - ix.x, lineA.y1 - ix.y);
      const dA2 = Math.hypot(lineA.x2 - ix.x, lineA.y2 - ix.y);
      const dAc = Math.hypot(clA.x - ix.x, clA.y - ix.y);
      const keepA1 = (Math.hypot(lineA.x1 - clA.x, lineA.y1 - clA.y) < Math.hypot(lineA.x2 - clA.x, lineA.y2 - clA.y)) 
                     || (dA1 > dAc && dA1 > dA2);
      const afterA = keepA1 ? { x1: lineA.x1, y1: lineA.y1, x2: ix.x, y2: ix.y } : { x1: ix.x, y1: ix.y, x2: lineA.x2, y2: lineA.y2 };

      const dB1 = Math.hypot(lineB.x1 - ix.x, lineB.y1 - ix.y);
      const dB2 = Math.hypot(lineB.x2 - ix.x, lineB.y2 - ix.y);
      const dBc = Math.hypot(clB.x - ix.x, clB.y - ix.y);
      const keepB1 = (Math.hypot(lineB.x1 - clB.x, lineB.y1 - clB.y) < Math.hypot(lineB.x2 - clB.x, lineB.y2 - clB.y))
                     || (dB1 > dBc && dB1 > dB2);
      const afterB = keepB1 ? { x1: lineB.x1, y1: lineB.y1, x2: ix.x, y2: ix.y } : { x1: ix.x, y1: ix.y, x2: lineB.x2, y2: lineB.y2 };

      this.previewOps.push({ ent: lineA, after: afterA });
      this.previewOps.push({ ent: lineB, after: afterB });
      return;
    }

    // Determine direction from intersection towards clicks
    const dirAx = clA.x - ix.x, dirAy = clA.y - ix.y;
    const dotA = dirAx * uAx + dirAy * uAy;
    const signA = dotA >= 0 ? 1 : -1;

    const dirBx = clB.x - ix.x, dirBy = clB.y - ix.y;
    const dotB = dirBx * uBx + dirBy * uBy;
    const signB = dotB >= 0 ? 1 : -1;

    // The points where the chamfer starts on each line
    const ptA = { x: ix.x + signA * uAx * d1, y: ix.y + signA * uAy * d1 };
    const ptB = { x: ix.x + signB * uBx * d2, y: ix.y + signB * uBy * d2 };

    // Trim lines
    const dA1 = Math.hypot(lineA.x1 - ix.x, lineA.y1 - ix.y);
    const dA2 = Math.hypot(lineA.x2 - ix.x, lineA.y2 - ix.y);
    const keepA1 = (signA === 1 && dA1 > dA2) || (signA === -1 && dA1 < dA2) || Math.hypot(lineA.x1 - ptA.x, lineA.y1 - ptA.y) < Math.hypot(lineA.x2 - ptA.x, lineA.y2 - ptA.y);
    
    // Simplistic keep determination: keep the endpoint that is NOT the intersection direction endpoint.
    // Wait, better: we keep the endpoint that is furthest in the direction of the click, OR if the click is between intersection and endpoint, keep the endpoint.
    // Actually, AutoCAD just trims from the chamfer point to the intersection. So the new endpoint is ptA. The other endpoint stays the same.
    // Which endpoint stays the same? The one furthest from the intersection in the signA direction.
    let afterA = { x1: lineA.x1, y1: lineA.y1, x2: ptA.x, y2: ptA.y };
    if (dotA * (lineA.x1 - ix.x) * uAx + dotA * (lineA.y1 - ix.y) * uAy > 
        dotA * (lineA.x2 - ix.x) * uAx + dotA * (lineA.y2 - ix.y) * uAy) {
      afterA = { x1: lineA.x1, y1: lineA.y1, x2: ptA.x, y2: ptA.y };
    } else {
      afterA = { x1: ptA.x, y1: ptA.y, x2: lineA.x2, y2: lineA.y2 };
    }

    let afterB = { x1: lineB.x1, y1: lineB.y1, x2: ptB.x, y2: ptB.y };
    if (dotB * (lineB.x1 - ix.x) * uBx + dotB * (lineB.y1 - ix.y) * uBy > 
        dotB * (lineB.x2 - ix.x) * uBx + dotB * (lineB.y2 - ix.y) * uBy) {
      afterB = { x1: lineB.x1, y1: lineB.y1, x2: ptB.x, y2: ptB.y };
    } else {
      afterB = { x1: ptB.x, y1: ptB.y, x2: lineB.x2, y2: lineB.y2 };
    }

    this.previewOps.push({ ent: lineA, after: afterA });
    this.previewOps.push({ ent: lineB, after: afterB });

    this.previewLine = new LineEntity(ptA.x, ptA.y, ptB.x, ptB.y);
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.first || this.previewOps.length === 0) return;

    ctx.save();
    
    // Draw trimmed segments in highlight
    ctx.strokeStyle = 'rgba(48,160,240,0.8)';
    ctx.lineWidth = 2;
    for (const op of this.previewOps) {
      ctx.beginPath();
      const p1 = this.vm.w2s(op.after.x1, op.after.y1);
      const p2 = this.vm.w2s(op.after.x2, op.after.y2);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Draw the chamfer line
    if (this.previewLine) {
      ctx.strokeStyle = 'rgba(240,160,48,0.9)';
      ctx.beginPath();
      const p1 = this.vm.w2s(this.previewLine.x1, this.previewLine.y1);
      const p2 = this.vm.w2s(this.previewLine.x2, this.previewLine.y2);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.restore();
  }
}
