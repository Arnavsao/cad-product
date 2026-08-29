import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { ModifyPropertiesCmd, CompoundCmd } from '../../core/models/command.model';
import type { ICommand } from '../../core/models/command.model';
import { hitTestAll } from '../select/select-tool';

export class MatchPropTool implements ITool {
  readonly name = 'matchprop';
  private sourceEntity: Entity | null = null;
  private hoverEntity: Entity | null = null;
  private hoverSnapshot: Record<string, unknown> | null = null;
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  private snapshotProperties(e: Entity): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    const ent = e as any;
    const props = [
      'layer', 'colorNumber', 'color', 'lineType', 'lineTypeScale', 'lineWeight',
      'transparency', 'pattern', 'scale', 'angle', 'solid', 'doubleHatch', 'backgroundColor', 'hatchStyle', 'patternSpacing', 'islandDetection',
      'font', 'bold', 'italic', 'underline', 'strikethrough', 'justify', 'lineSpacing', 'charSpacing', 'height', 'widthFactor', 'obliqueAngle',
      'styleName', 'arrowType', 'arrowSize', 'extensionGap', 'extensionPast', 'unitFormat', 'unitPrecision', 'unitPrefix', 'unitSuffix', 'decimalSeparator', 'suppressTrailingZeros', 'roundOff'
    ];
    for (const key of props) {
      if (ent[key] !== undefined) snap[key] = ent[key];
    }
    return snap;
  }

  activate(): void {
    this.sourceEntity = null;
    this.hoverEntity = null;
    this.hoverSnapshot = null;
  }

  deactivate(): void {
    this.revertHover();
    this.dyn.clearEdits();
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number, e: MouseEvent): void {
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!this.sourceEntity) {
      if (hit && hit.entity) {
        this.sourceEntity = hit.entity;
        this.vm.markDirty();
      }
      return;
    }

    if (this.sourceEntity && this.hoverEntity && this.hoverSnapshot) {
      // Revert temporary properties for Command capture
      this.revertHover();
      
      const target = hitTestAll(this.doc, this.vm, sx, sy)?.entity;
      if (target) {
        const propsToCopy = this.getCompatibleProperties(this.sourceEntity, target);
        const cmdsList: ICommand[] = [];
        
        for (const p of propsToCopy) {
          const srcVal = (this.sourceEntity as any)[p];
          if (srcVal !== undefined && srcVal !== (target as any)[p]) {
            cmdsList.push(new ModifyPropertiesCmd(
              [target],
              p,
              srcVal,
              [{ id: target.id, value: (target as any)[p] }],
              { markDirty: () => this.vm.markContentDirty(), refreshProperties: () => {} }
            ));
          }
        }

        if (cmdsList.length > 0) {
          const compound = new CompoundCmd(cmdsList);
          compound.execute();
          this.cmds.push(compound);
        }
        
        this.hoverEntity = null;
        this.hoverSnapshot = null;
        
        // Immediately re-trigger hover to keep preview active if cursor hasn't moved
        this.onMouseMove(wx, wy, sx, sy);
      }
    }
  }

  onMouseMove(wx: number, wy: number, sx: number, sy: number): void {
    this.cur = { x: wx, y: wy };
    
    if (this.sourceEntity) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      const newHover = hit ? hit.entity : null;
      
      if (newHover !== this.hoverEntity) {
        this.revertHover();
        
        if (newHover && newHover !== this.sourceEntity) {
          this.hoverEntity = newHover;
          this.hoverSnapshot = this.snapshotProperties(newHover);
          this.applyProperties(this.sourceEntity, newHover);
          this.vm.markDirty();
        }
      }
    }
  }

  private revertHover(): void {
    if (this.hoverEntity && this.hoverSnapshot) {
      const e = this.hoverEntity as any;
      const snap = this.hoverSnapshot;
      for (const k in snap) {
        if (Array.isArray(snap[k])) {
          e[k] = snap[k].map((p: any) => ({ ...p }));
        } else if (snap[k] && typeof snap[k] === 'object') {
          e[k] = { ...snap[k] };
        } else {
          e[k] = snap[k];
        }
      }
      this.hoverEntity.refreshCaches();
      this.vm.markDirty();
      this.hoverEntity = null;
      this.hoverSnapshot = null;
    }
  }

  private applyProperties(src: any, dest: any): void {
    const props = this.getCompatibleProperties(src, dest);
    for (const p of props) {
      if (src[p] !== undefined) {
        if (dest.applyPropertyChange) dest.applyPropertyChange(p, src[p]);
        else dest[p] = src[p];
      }
    }
  }

  private getCompatibleProperties(src: any, dest: any): string[] {
    const props: string[] = [];
    
    // 1. General Properties (always copied)
    props.push('layer', 'colorNumber', 'color', 'lineType', 'lineTypeScale', 'lineWeight');

    // 2. Hatch -> Hatch
    if (src.type === 'HATCH' && dest.type === 'HATCH') {
      props.push('transparency', 'pattern', 'scale', 'angle', 'solid', 'doubleHatch', 'backgroundColor', 'hatchStyle', 'patternSpacing', 'islandDetection');
    }

    // 3. Text -> Text
    if (src.type === 'TEXT' && dest.type === 'TEXT') {
      props.push('font', 'bold', 'italic', 'underline', 'strikethrough', 'justify', 'lineSpacing', 'charSpacing', 'height', 'widthFactor', 'obliqueAngle');
    }

    // 4. Dimension -> Dimension
    if (src.type === 'DIMENSION' && dest.type === 'DIMENSION') {
      props.push('styleName', 'arrowType', 'arrowSize', 'extensionGap', 'extensionPast', 'unitFormat', 'unitPrecision', 'unitPrefix', 'unitSuffix', 'decimalSeparator', 'suppressTrailingZeros', 'roundOff');
    }

    return props;
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.sourceEntity) return;

    // We need an insertion point or center point of the source entity
    let srcPoint: IPoint = { x: 0, y: 0 };
    if ('x' in this.sourceEntity && 'y' in this.sourceEntity) {
      srcPoint = { x: (this.sourceEntity as any).x, y: (this.sourceEntity as any).y };
    } else if ('cx' in this.sourceEntity && 'cy' in this.sourceEntity) {
      srcPoint = { x: (this.sourceEntity as any).cx, y: (this.sourceEntity as any).cy };
    } else if ('x1' in this.sourceEntity && 'y1' in this.sourceEntity) {
      srcPoint = { x: ((this.sourceEntity as any).x1 + (this.sourceEntity as any).x2) / 2, y: ((this.sourceEntity as any).y1 + (this.sourceEntity as any).y2) / 2 };
    } else if ('pts' in this.sourceEntity && (this.sourceEntity as any).pts.length > 0) {
      srcPoint = (this.sourceEntity as any).pts[0];
    }

    const a = this.vm.w2s(srcPoint.x, srcPoint.y);
    const b = this.vm.w2s(this.cur.x, this.cur.y);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(255,165,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();

    // Draw paint brush icon at cursor
    ctx.translate(b.x + 15, b.y + 15);
    ctx.scale(0.8, 0.8);
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(5, -10);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,165,0,0.8)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5, 5);
    ctx.lineTo(-2, 12);
    ctx.lineTo(2, 12);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fillStyle = '#666';
    ctx.fill();
    ctx.restore();
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.revertHover();
      this.dyn.clearEdits();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  getPhase(): string {
    return this.sourceEntity ? 'dest' : 'source';
  }

  getAnchor(): IPoint | null { return null; }

  getDynamicInputState(): IDynamicInputState | null {
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'info',
      fields: [
        {
          key: 'info',
          label: 'MATCHPROP',
          liveValue: this.sourceEntity ? 'Select destination object(s)' : 'Select source object',
          width: 200,
          readonly: true,
        }
      ],
    };
  }

  commitDynamicInput(): boolean {
    return false;
  }
}
