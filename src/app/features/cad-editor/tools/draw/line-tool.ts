import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { LineEntity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression, parseCadVector } from '../../core/utils/expression-parser';
import { formatLen, formatAngleDeg } from './draw-utils';

export class LineTool implements ITool {
  readonly name = 'line';
  private p1: IPoint | null = null;
  private cur: IPoint = { x: 0, y: 0 };
  /** First click of the current LINE command â€” needed for Close. */
  private startPt: IPoint | null = null;
  /** Previous from-points in order, used to walk back on Undo. */
  private history: IPoint[] = [];

  private doc: DocumentService;
  private vm: ViewModelService;
  private cmds: CommandStackService;
  private tools: ToolManagerService;
  private dyn: DynamicInputService;

  constructor(injector: Injector) {
    this.doc = injector.get(DocumentService);
    this.vm = injector.get(ViewModelService);
    this.cmds = injector.get(CommandStackService);
    this.tools = injector.get(ToolManagerService);
    this.dyn = injector.get(DynamicInputService);
  }

  onMouseDown(wx: number, wy: number): void {
    const pt = { x: wx, y: wy };
    if (!this.p1) {
      this.p1 = pt;
      this.startPt = pt;
      this.history = [];
    } else {
      const endpoint = this.previewEnd();
      if (Math.hypot(endpoint.x - this.p1.x, endpoint.y - this.p1.y) > 1e-9) {
        this.history.push({ ...this.p1 });
        this.placeAt(endpoint);
      } else {
        // Zero-distance click: restart chain from the new point.
        this.p1 = pt;
        this.startPt = pt;
        this.history = [];
      }
    }
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  private placeAt(pt: IPoint): void {
    if (!this.p1) return;
    const e = new LineEntity(this.p1.x, this.p1.y, pt.x, pt.y);
    e.layer = this.doc.activeLayer;
    this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    this.p1 = pt;
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.p1) this.vm.markDirty();
  }

  /** Derive (length, angleDeg) from effective field values, falling back to cursor. */
  private effectiveLengthAngle(): { length: number; angleDeg: number } {
    if (!this.p1) return { length: 0, angleDeg: 0 };
    const dx = this.cur.x - this.p1.x;
    const dy = this.cur.y - this.p1.y;
    const liveLen = Math.hypot(dx, dy);
    const liveAng = Math.atan2(dy, dx) * 180 / Math.PI;

    let length = liveLen;
    let angleDeg = liveAng;

    const editedLen = this.dyn.editedValues()['length'];
    if (editedLen !== undefined) {
      const n = evalExpression(editedLen);
      if (n !== null && n > 0) length = n;
    }
    const editedAng = this.dyn.editedValues()['angle'];
    if (editedAng !== undefined) {
      const n = evalExpression(editedAng);
      if (n !== null) angleDeg = n;
    }
    return { length, angleDeg };
  }

  private previewEnd(): IPoint {
    if (!this.p1) return this.cur;
    const { length, angleDeg } = this.effectiveLengthAngle();
    if (length <= 0) return this.cur;
    const rad = angleDeg * Math.PI / 180;
    return { x: this.p1.x + length * Math.cos(rad), y: this.p1.y + length * Math.sin(rad) };
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.p1) return;
    const endpoint = this.previewEnd();
    const a = this.vm.w2s(this.p1.x, this.p1.y);
    const b = this.vm.w2s(endpoint.x, endpoint.y);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.restore();
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (!this.p1) return null;
    const { length, angleDeg } = this.effectiveLengthAngle();
    return {
      wx: this.cur.x,
      wy: this.cur.y,
      primaryFieldKey: 'length',
      fields: [
        { key: 'length', label: 'Length', liveValue: formatLen(length), width: 80 },
        { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(angleDeg), suffix: 'Â°', width: 60 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (!this.p1) return false;
    // Allow CAD vector syntax in either field as a power-user shortcut.
    const vec = parseCadVector(values['length'] ?? '');
    if (vec) {
      const endpoint = vecToEndpoint(this.p1, vec, values['angle'] ?? '');
      if (endpoint && Math.hypot(endpoint.x - this.p1.x, endpoint.y - this.p1.y) > 1e-9) {
        this.placeAt(endpoint);
        this.dyn.clearEdits();
        this.vm.markDirty();
        return true;
      }
    }
    const endpoint = this.previewEnd();
    if (Math.hypot(endpoint.x - this.p1.x, endpoint.y - this.p1.y) < 1e-9) return false;
    this.placeAt(endpoint);
    this.dyn.clearEdits();
    this.vm.markDirty();
    return true;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.cancelLine();
      this.tools.setTool('select');
    }
  }

  getPhase(): string | null {
    return this.p1 ? 'next' : 'first';
  }

  invokeOption(key: string): boolean {
    switch (key) {
      case 'U': return this.undoSegment();
      case 'C': return this.closeLine();
      default:  return false;
    }
  }

  private undoSegment(): boolean {
    if (!this.p1) return false;
    if (this.history.length === 0) {
      // No segments placed yet â€” cancel the first-point pick.
      this.p1 = null;
      this.startPt = null;
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }
    this.cmds.undo();
    this.p1 = this.history.pop()!;
    this.dyn.clearEdits();
    this.vm.markDirty();
    return true;
  }

  private closeLine(): boolean {
    if (!this.p1 || !this.startPt || this.history.length === 0) return false;
    if (Math.hypot(this.p1.x - this.startPt.x, this.p1.y - this.startPt.y) > 1e-9) {
      const e = new LineEntity(this.p1.x, this.p1.y, this.startPt.x, this.startPt.y);
      e.layer = this.doc.activeLayer;
      this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
    }
    this.cancelLine();
    this.tools.setTool('select');
    return true;
  }

  private cancelLine(): void {
    this.p1 = null;
    this.startPt = null;
    this.history = [];
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  getAnchor(): IPoint | null { return this.p1; }

  deactivate(): void {
    this.p1 = null;
    this.startPt = null;
    this.history = [];
    this.dyn.clearEdits();
    this.dyn.setState(null);
    this.vm.markDirty();
  }
}

function vecToEndpoint(p1: IPoint, vec: ReturnType<typeof parseCadVector>, angleFieldText: string): IPoint | null {
  if (!vec) return null;
  if (vec.kind === 'cartesian' && vec.dx !== undefined && vec.dy !== undefined) {
    return { x: p1.x + vec.dx, y: p1.y + vec.dy };
  }
  if (vec.kind === 'polar' && vec.length !== undefined && vec.angleDeg !== undefined) {
    const rad = vec.angleDeg * Math.PI / 180;
    return { x: p1.x + vec.length * Math.cos(rad), y: p1.y + vec.length * Math.sin(rad) };
  }
  return null;
}
