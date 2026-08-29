import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { EllipseEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatLen, formatAngleDeg } from './draw-utils';

export type EllipseMode = 'center' | 'axis' | 'arc';

export class EllipseTool implements ITool {
  readonly name: string;
  private pts: IPoint[] = [];
  private cur: IPoint = { x: 0, y: 0 };

  constructor(private injector: Injector, private mode: EllipseMode = 'center') {
    this.name = mode === 'center' ? 'ellipse' : mode === 'axis' ? 'ellipse_axis' : 'ellipse_arc';
  }

  /** Maps the current runtime mode to the COMMAND_PROMPTS registry key. */
  getCommandId(): string {
    return this.mode === 'center' ? 'ellipse' :
           this.mode === 'axis'   ? 'ellipse_axis' : 'ellipse_arc';
  }

  /**
   * Mode-switch keyword options.  Only allowed before any points are collected.
   * 'A' = Arc mode (elliptical arc), 'C' = Center mode.
   */
  invokeOption(key: string): boolean {
    if (this.pts.length > 0) return false;
    switch (key.toUpperCase()) {
      case 'A':
        if (this.mode !== 'arc') {
          this.mode = 'arc'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      case 'C':
        if (this.mode !== 'center') {
          this.mode = 'center'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
        }
        return false;
      default:
        return false;
    }
  }

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  getPhase(): string | null {
    const len = this.pts.length;
    if (this.mode === 'center') {
      if (len === 0) return 'center';
      if (len === 1) return 'axis';
      if (len === 2) return 'dist';
    } else {
      // axis or arc
      if (len === 0) return 'axis1';
      if (len === 1) return 'axis2';
      if (len === 2) return 'dist';
      if (this.mode === 'arc') {
        if (len === 3) return 'startAng';
        if (len === 4) return 'endAng';
      }
    }
    return null;
  }

  onMouseDown(wx: number, wy: number): void {
    const phase = this.getPhase();
    if (!phase) return;

    if (phase === 'startAng' || phase === 'endAng') {
      // For angles, process typed values first if they exist
      const edits = this.dyn.editedValues();
      const angStr = edits['angle'];
      if (angStr !== undefined) {
        const val = evalExpression(angStr);
        if (val !== null) {
          // Angle is typed in degrees.
          // Note: In our system we just store the point mapped from that angle to let computeEllipse derive it.
          const { cx, cy } = this.getBaseGeometry();
          const r = 10; // arbitrary radius for the point
          this.pts.push({
            x: cx + r * Math.cos(val * Math.PI / 180),
            y: cy + r * Math.sin(val * Math.PI / 180)
          });
          this.checkCompletion();
          return;
        }
      }
    }

    this.pts.push({ x: wx, y: wy });
    this.checkCompletion();
  }

  private checkCompletion() {
    this.dyn.clearEdits();
    
    const isComplete = (this.mode === 'center' && this.pts.length === 3) ||
                       (this.mode === 'axis' && this.pts.length === 3) ||
                       (this.mode === 'arc' && this.pts.length === 5);

    if (isComplete) {
      const e = this.computeEllipse(true);
      if (e) {
        e.layer = this.doc.activeLayer;
        this.cmds.push(new AddEntityCmd(e, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
      }
      this.pts = [];
    }
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.pts.length > 0) this.vm.markDirty();
  }

  private getBaseGeometry(): { cx: number, cy: number, rx: number, rotation: number } {
    let cx = 0, cy = 0, rx = 0, rotation = 0;
    const len = this.pts.length;

    if (this.mode === 'center') {
      if (len > 0) {
        cx = this.pts[0].x;
        cy = this.pts[0].y;
      }
      if (len > 1) {
        const p1 = this.pts[1];
        rx = Math.hypot(p1.x - cx, p1.y - cy);
        rotation = Math.atan2(p1.y - cy, p1.x - cx);
      } else if (len === 1) {
        // live preview of major axis
        const cur = this.resolvePhasePoint(1);
        rx = Math.hypot(cur.x - cx, cur.y - cy);
        rotation = Math.atan2(cur.y - cy, cur.x - cx);
      }
    } else {
      // axis or arc
      if (len > 0) {
        const p0 = this.pts[0];
        const p1 = len > 1 ? this.pts[1] : this.resolvePhasePoint(1);
        cx = (p0.x + p1.x) / 2;
        cy = (p0.y + p1.y) / 2;
        rx = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2;
        rotation = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      }
    }
    return { cx, cy, rx, rotation };
  }

  private resolvePhasePoint(idx: number): IPoint {
    // If the user typed a value, project cur based on that typed value
    const edits = this.dyn.editedValues();
    const phase = this.getPhase();

    if (phase === 'axis' || phase === 'axis2') {
      const lenStr = edits['rx'] ?? edits['length'];
      if (lenStr !== undefined) {
        const val = evalExpression(lenStr);
        if (val !== null && val > 0) {
          const origin = this.mode === 'center' ? this.pts[0] : this.pts[0];
          const dx = this.cur.x - origin.x;
          const dy = this.cur.y - origin.y;
          const ang = Math.atan2(dy, dx);
          return {
            x: origin.x + val * Math.cos(ang),
            y: origin.y + val * Math.sin(ang)
          };
        }
      }
    }

    if (phase === 'startAng' || phase === 'endAng') {
      const angStr = edits['angle'];
      if (angStr !== undefined) {
        const val = evalExpression(angStr);
        if (val !== null) {
          const { cx, cy } = this.getBaseGeometry();
          return {
            x: cx + 10 * Math.cos(val * Math.PI / 180),
            y: cy + 10 * Math.sin(val * Math.PI / 180)
          };
        }
      }
    }

    return this.cur;
  }

  private getRy(cx: number, cy: number, rotation: number): number {
    const len = this.pts.length;
    let distPt = this.cur;
    if (this.mode === 'center' && len > 2) distPt = this.pts[2];
    if (this.mode !== 'center' && len > 2) distPt = this.pts[2];

    const edits = this.dyn.editedValues();
    const ryStr = edits['ry'] ?? edits['distance'];
    if (ryStr !== undefined) {
      const val = evalExpression(ryStr);
      if (val !== null && val > 0) return val;
    }

    // Distance from distPt to the major axis line
    const dx = distPt.x - cx;
    const dy = distPt.y - cy;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return Math.abs(-dx * sin + dy * cos);
  }

  private getParametricAngle(pt: IPoint, cx: number, cy: number, rx: number, ry: number, rotation: number): number {
    // Convert world point to local ellipse space
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;

    // t = atan2(y_local * rx, x_local * ry)
    let t = Math.atan2(ly * rx, lx * ry);
    if (t < 0) t += Math.PI * 2;
    return t;
  }

  private computeEllipse(final: boolean = false): EllipseEntity | null {
    const { cx, cy, rx, rotation } = this.getBaseGeometry();
    if (rx < 1e-6) return null;

    const len = this.pts.length;
    const phase = this.getPhase();

    // If we haven't reached the distance phase, we can't draw the full ellipse
    if ((this.mode === 'center' && len < 2) || (this.mode !== 'center' && len < 2)) {
      return null;
    }

    const ry = this.getRy(cx, cy, rotation);
    if (ry < 1e-6) return null;

    let startAngle = 0;
    let endAngle = Math.PI * 2;

    if (this.mode === 'arc') {
      if (len >= 3) {
        const pStart = len > 3 ? this.pts[3] : this.resolvePhasePoint(3);
        startAngle = this.getParametricAngle(pStart, cx, cy, rx, ry, rotation);

        if (len >= 4) {
          const pEnd = len > 4 ? this.pts[4] : this.resolvePhasePoint(4);
          endAngle = this.getParametricAngle(pEnd, cx, cy, rx, ry, rotation);
        } else {
          // While picking end angle, sweep from start to cursor
          endAngle = this.getParametricAngle(this.resolvePhasePoint(4), cx, cy, rx, ry, rotation);
        }
      }
    }

    return new EllipseEntity(cx, cy, rx, ry, rotation, startAngle, endAngle);
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.pts.length === 0) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]);

    const { cx, cy, rx, rotation } = this.getBaseGeometry();
    const c = this.vm.w2s(cx, cy);

    // Draw major axis tracking line
    const phase = this.getPhase();
    if (phase === 'axis' || phase === 'axis2') {
      ctx.beginPath();
      const p0 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      const p1 = this.resolvePhasePoint(1);
      const p1s = this.vm.w2s(p1.x, p1.y);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1s.x, p1s.y);
      ctx.stroke();
    }

    // Draw full ellipse preview
    const e = this.computeEllipse();
    if (e) {
      const sRx = e.rx * this.vm.scale;
      const sRy = e.ry * this.vm.scale;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, sRx, Math.max(1, sRy), -e.rotation, -e.startAngle, -e.endAngle, true);
      ctx.stroke();
    }

    ctx.restore();
  }

  getDynamicInputState(): IDynamicInputState | null {
    const phase = this.getPhase();
    if (!phase) return null;

    if (phase === 'axis' || phase === 'axis2') {
      const origin = this.pts[0];
      const dx = this.cur.x - origin.x;
      const dy = this.cur.y - origin.y;
      const len = Math.hypot(dx, dy);
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: this.mode === 'center' ? 'rx' : 'length',
        fields: [
          { key: this.mode === 'center' ? 'rx' : 'length', label: 'Length', liveValue: formatLen(len), width: 80 },
        ],
      };
    }

    if (phase === 'dist') {
      const { cx, cy, rotation } = this.getBaseGeometry();
      const ry = this.getRy(cx, cy, rotation);
      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'distance',
        fields: [
          { key: 'distance', label: 'Distance', liveValue: formatLen(ry), width: 80 },
        ],
      };
    }

    if (phase === 'startAng' || phase === 'endAng') {
      const { cx, cy, rx, rotation } = this.getBaseGeometry();
      const ry = this.getRy(cx, cy, rotation);
      
      const t = this.getParametricAngle(this.cur, cx, cy, rx, ry, rotation);
      // Display the true angle in world space relative to positive X for user convenience,
      // or angle relative to major axis? Standard CAD displays absolute angle in polar tracking.
      const dx = this.cur.x - cx;
      const dy = this.cur.y - cy;
      let angDeg = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angDeg < 0) angDeg += 360;

      return {
        wx: this.cur.x,
        wy: this.cur.y,
        primaryFieldKey: 'angle',
        fields: [
          { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(angDeg), suffix: 'Â°', width: 80 },
        ],
      };
    }

    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    const phase = this.getPhase();
    if (!phase) return false;

    if (phase === 'axis' || phase === 'axis2') {
      const lenStr = values['rx'] ?? values['length'];
      const val = evalExpression(lenStr ?? '');
      if (val !== null && val > 0) {
        // synthesize a click
        const origin = this.pts[0];
        const dx = this.cur.x - origin.x;
        const dy = this.cur.y - origin.y;
        const ang = Math.atan2(dy, dx);
        this.onMouseDown(origin.x + val * Math.cos(ang), origin.y + val * Math.sin(ang));
        return true;
      }
    }

    if (phase === 'dist') {
      const distStr = values['distance'] ?? values['ry'];
      const val = evalExpression(distStr ?? '');
      if (val !== null && val > 0) {
        // synthesize a point that yields this distance
        const { cx, cy, rotation } = this.getBaseGeometry();
        // Point along minor axis
        const pt = {
          x: cx - val * Math.sin(rotation),
          y: cy + val * Math.cos(rotation)
        };
        this.onMouseDown(pt.x, pt.y);
        return true;
      }
    }

    if (phase === 'startAng' || phase === 'endAng') {
      const angStr = values['angle'];
      const val = evalExpression(angStr ?? '');
      if (val !== null) {
        const { cx, cy } = this.getBaseGeometry();
        const pt = {
          x: cx + 10 * Math.cos(val * Math.PI / 180),
          y: cy + 10 * Math.sin(val * Math.PI / 180)
        };
        this.onMouseDown(pt.x, pt.y);
        return true;
      }
    }

    return false;
  }

  getAnchor(): IPoint | null { 
    return this.pts.length > 0 ? this.pts[this.pts.length - 1] : null; 
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.deactivate();
      this.tools.setTool('select');
      return;
    }
    
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const edits = this.dyn.editedValues();
      if (Object.keys(edits).length > 0 && this.commitDynamicInput(edits)) {
        return;
      }
      this.deactivate();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.pts = [];
    this.dyn.clearEdits();
    this.dyn.setState(null);
    this.vm.markDirty();
  }
}
