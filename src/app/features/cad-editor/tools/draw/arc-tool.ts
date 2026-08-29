import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { ArcEntity, LineEntity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { evalExpression } from '../../core/utils/expression-parser';
import { formatLen, formatAngleDeg } from './draw-utils';

function isAngleBetween(a: number, sa: number, ea: number, testCCW: boolean): boolean {
  const norm = (v: number) => ((v % 360) + 360) % 360;
  const s = norm(sa), e = norm(ea), t = norm(a);
  if (testCCW) {
    const sweep = (e - s + 360) % 360 || 360;
    return ((t - s + 360) % 360) <= sweep;
  }
  const sweep = (s - e + 360) % 360 || 360;
  return ((s - t + 360) % 360) <= sweep;
}

export type ArcMode = '3p' | 'sce' | 'sca' | 'scl' | 'cse' | 'csa' | 'csl'
                    | 'sea' | 'sed' | 'ser' | 'cont';

export class ArcTool implements ITool {
  readonly name = 'arc';
  private pts: IPoint[] = [];
  private cur: IPoint = { x: 0, y: 0 };

  // For 'cont' mode: locked start point and tangent direction (degrees)
  private contStart: IPoint | null = null;
  private contDir = 0;

  constructor(private injector: Injector, private mode: ArcMode = '3p') {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }

  activate(): void {
    if (this.mode === 'cont') {
      const params = this.getContParams();
      if (params) { this.contStart = params.start; this.contDir = params.dirDeg; }
      else { this.contStart = null; }
      this.vm.markDirty();
    }
  }

  /** Maps the current runtime mode to the COMMAND_PROMPTS registry key. */
  getCommandId(): string {
    const map: Record<ArcMode, string> = {
      '3p':  'arc',     sce: 'arc_sce', sca: 'arc_sca', scl: 'arc_scl',
      cse:   'arc_cse', csa: 'arc_csa', csl: 'arc_csl',
      sea:   'arc_sea', sed: 'arc_sed', ser: 'arc_ser', cont: 'arc_cont',
    };
    return map[this.mode] ?? 'arc';
  }

  /**
   * Mode-switch keyword options.  Only allowed before any points are collected
   * so the user can choose a different arc method at the first prompt.
   * 'C' = Center-first approach â†’ switches to cse (Centerâ€“Startâ€“End).
   */
  invokeOption(key: string): boolean {
    if (this.pts.length > 0 || this.contStart) return false;
    switch (key.toUpperCase()) {
      case 'C': // Center-first â†’ Centerâ€“Startâ€“End
        this.mode = 'cse'; this.dyn.clearEdits(); this.vm.markDirty(); return true;
      default:
        return false;
    }
  }

  getPhase(): string | null {
    if (this.mode === '3p')
      return this.pts.length === 0 ? 'p1' : (this.pts.length === 1 ? 'p2' : 'p3');

    if (this.mode === 'sea') {
      if (this.pts.length === 0) return 'start';
      if (this.pts.length === 1) return 'end';
      return 'angle';
    }
    if (this.mode === 'sed') {
      if (this.pts.length === 0) return 'start';
      if (this.pts.length === 1) return 'end';
      return 'direction';
    }
    if (this.mode === 'ser') {
      if (this.pts.length === 0) return 'start';
      if (this.pts.length === 1) return 'end';
      return 'radius';
    }
    if (this.mode === 'cont') {
      return this.contStart ? 'end' : 'idle';
    }

    // SC / CS modes
    const isSC = this.mode.startsWith('sc');
    if (this.pts.length === 0) return isSC ? 'start' : 'center';
    if (this.pts.length === 1) return isSC ? 'center' : 'start';
    if (this.mode.endsWith('e')) return 'end';
    if (this.mode.endsWith('a')) return 'angle';
    if (this.mode.endsWith('l')) return 'length';
    return null;
  }

  onMouseDown(wx: number, wy: number): void {
    const pt = { x: wx, y: wy };

    if (this.mode === 'cont') {
      if (!this.contStart) return;
      this.pts.push(pt);
    } else {
      this.pts.push(pt);
    }
    this.dyn.clearEdits();

    const res = this.computeArc();
    if (res && res.done) {
      if (res.arc) {
        res.arc.layer = this.doc.activeLayer;
        this.cmds.push(new AddEntityCmd(res.arc, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
        // Chain cont: update start/direction to end of just-placed arc
        if (this.mode === 'cont') {
          this.contStart = res.arc.getEndPoint();
          this.contDir = res.arc.ccw ? res.arc.endAngle + 90 : res.arc.endAngle - 90;
        }
      }
      this.pts = [];
      this.dyn.clearEdits();
    }
    this.vm.markDirty();
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.pts.length > 0 || this.mode === 'cont') this.vm.markDirty();
  }

  private computeArc(): { arc: ArcEntity | null, done: boolean } | null {
    // â”€â”€ 3-point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.mode === '3p') {
      if (this.pts.length === 0) return null;
      if (this.pts.length === 1) return { arc: null, done: false };
      const p1 = this.pts[0], p2 = this.pts[1];
      const done = this.pts.length >= 3;
      const p3 = done ? this.pts[2] : this.cur;
      const edits = this.dyn.editedValues();
      const typedR = evalExpression(edits['radius'] ?? '');
      const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const arc = (!done && typedR !== null && Number.isFinite(typedR) && typedR >= chord / 2 - 1e-9)
        ? this.buildArcFromChordRadius(p1, p2, typedR, p3)
        : this.make3PArc(p1, p2, p3);
      return { arc, done };
    }

    // â”€â”€ Start, End, Angle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.mode === 'sea') {
      if (this.pts.length === 0) return null;
      if (this.pts.length === 1) return { arc: null, done: false };
      const S = this.pts[0], E = this.pts[1];
      const edits = this.dyn.editedValues();
      const typedA = evalExpression(edits['angle'] ?? '');
      const done = this.pts.length >= 3;
      const angleDeg = typedA ?? this.seaLiveAngle(S, E, this.cur);
      return { arc: this.buildArcSEA(S, E, angleDeg), done };
    }

    // â”€â”€ Start, End, Direction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.mode === 'sed') {
      if (this.pts.length === 0) return null;
      if (this.pts.length === 1) return { arc: null, done: false };
      const S = this.pts[0], E = this.pts[1];
      const edits = this.dyn.editedValues();
      const typedD = evalExpression(edits['direction'] ?? '');
      const done = this.pts.length >= 3;
      const dirDeg = typedD ?? Math.atan2(this.cur.y - S.y, this.cur.x - S.x) * 180 / Math.PI;
      return { arc: this.buildArcSED(S, E, dirDeg), done };
    }

    // â”€â”€ Start, End, Radius â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.mode === 'ser') {
      if (this.pts.length === 0) return null;
      if (this.pts.length === 1) return { arc: null, done: false };
      const S = this.pts[0], E = this.pts[1];
      const edits = this.dyn.editedValues();
      const typedR = evalExpression(edits['radius'] ?? '');
      const done = this.pts.length >= 3;
      const chord = Math.hypot(E.x - S.x, E.y - S.y);
      let arc: ArcEntity | null;
      if (typedR !== null && typedR >= chord / 2 - 1e-9) {
        arc = this.buildArcFromChordRadius(S, E, typedR, this.cur);
      } else {
        arc = this.make3PArc(S, this.cur, E);
      }
      return { arc, done };
    }

    // â”€â”€ Continue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.mode === 'cont') {
      if (!this.contStart) return null;
      const E = this.pts.length >= 1 ? this.pts[0] : this.cur;
      const done = this.pts.length >= 1;
      const arc = this.buildArcSED(this.contStart, E, this.contDir);
      return arc ? { arc, done } : { arc: null, done: false };
    }

    // â”€â”€ SC / CS modes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.pts.length === 0) return null;
    if (this.pts.length === 1) return { arc: null, done: false };

    const isSC = this.mode.startsWith('sc');
    const start = isSC ? this.pts[0] : this.pts[1];
    const center = isSC ? this.pts[1] : this.pts[0];
    const r = Math.hypot(start.x - center.x, start.y - center.y);
    const sa = Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI;

    const done = this.pts.length >= 3;
    const p3 = done ? this.pts[2] : this.cur;
    const edits = this.dyn.editedValues();

    if (this.mode.endsWith('e')) {
      const ea = Math.atan2(p3.y - center.y, p3.x - center.x) * 180 / Math.PI;
      return { arc: new ArcEntity(center.x, center.y, r, sa, ea, true), done };
    }
    if (this.mode.endsWith('a')) {
      let sweep = Math.atan2(p3.y - center.y, p3.x - center.x) * 180 / Math.PI - sa;
      sweep = ((sweep % 360) + 360) % 360;
      const typedA = evalExpression(edits['angle'] ?? '');
      if (typedA !== null) sweep = typedA;
      return { arc: new ArcEntity(center.x, center.y, r, sa, sa + sweep, sweep >= 0), done };
    }
    if (this.mode.endsWith('l')) {
      let len = Math.hypot(p3.x - start.x, p3.y - start.y);
      const typedL = evalExpression(edits['length'] ?? '');
      if (typedL !== null && typedL > 0) len = typedL;
      len = Math.min(len, 2 * r);
      let sweep = 2 * Math.asin(len / (2 * r)) * 180 / Math.PI;
      const curAng = Math.atan2(p3.y - center.y, p3.x - center.x) * 180 / Math.PI - sa;
      const ccw = ((curAng % 360) + 360) % 360 <= 180;
      if (!ccw) sweep = -sweep;
      return { arc: new ArcEntity(center.x, center.y, r, sa, sa + sweep, ccw), done };
    }
    return null;
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    const res = this.computeArc();

    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();

    if (this.mode === '3p' && this.pts.length > 0) {
      const p1 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      const second = this.pts.length >= 2 ? this.pts[1] : this.effectivePhase1End();
      const p2 = this.vm.w2s(second.x, second.y);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else if ((this.mode === 'sea' || this.mode === 'sed' || this.mode === 'ser') && this.pts.length > 0) {
      // Show line between collected points; cursor tracks the 3rd param visually
      const p1 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      ctx.moveTo(p1.x, p1.y);
      if (this.pts.length >= 2) {
        const p2 = this.vm.w2s(this.pts[1].x, this.pts[1].y);
        ctx.lineTo(p2.x, p2.y);
      } else {
        const pc = this.vm.w2s(this.cur.x, this.cur.y);
        ctx.lineTo(pc.x, pc.y);
      }
      ctx.stroke();
    } else if (this.mode === 'cont' && this.contStart) {
      const p1 = this.vm.w2s(this.contStart.x, this.contStart.y);
      const p2 = this.vm.w2s(this.cur.x, this.cur.y);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    } else if (this.mode !== '3p' && this.mode !== 'sea' && this.mode !== 'sed'
               && this.mode !== 'ser' && this.mode !== 'cont' && this.pts.length > 0) {
      // SC / CS modes
      const p1 = this.vm.w2s(this.pts[0].x, this.pts[0].y);
      const p2 = this.vm.w2s(this.pts.length >= 2 ? this.pts[1].x : this.cur.x,
                              this.pts.length >= 2 ? this.pts[1].y : this.cur.y);
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      if (this.pts.length >= 2) {
        const isSC = this.mode.startsWith('sc');
        const ctr = isSC ? this.pts[1] : this.pts[0];
        const c = this.vm.w2s(ctr.x, ctr.y);
        const cur = this.vm.w2s(this.cur.x, this.cur.y);
        ctx.moveTo(c.x, c.y); ctx.lineTo(cur.x, cur.y);
      }
      ctx.stroke();
    }

    if (res?.arc) {
      const arc = res.arc;
      const c = this.vm.w2s(arc.cx, arc.cy);
      const r = arc.r * this.vm.scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, (-arc.startAngle * Math.PI) / 180, (-arc.endAngle * Math.PI) / 180, arc.ccw);
      ctx.strokeStyle = 'rgba(240,160,48,0.85)';
      ctx.setLineDash([8, 4]);
      ctx.stroke();
    }

    ctx.restore();
  }

  getDynamicInputState(): IDynamicInputState | null {
    // â”€â”€ 3p â”€â”€
    if (this.mode === '3p') {
      if (this.pts.length === 1) {
        const end = this.effectivePhase1End();
        const dx = end.x - this.pts[0].x, dy = end.y - this.pts[0].y;
        return {
          wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'chord',
          fields: [
            { key: 'chord', label: 'Chord', liveValue: formatLen(Math.hypot(dx, dy)), width: 80 },
            { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(Math.atan2(dy, dx) * 180 / Math.PI), suffix: 'Â°', width: 60 },
          ],
        };
      }
      if (this.pts.length === 2) {
        const chord = Math.hypot(this.pts[1].x - this.pts[0].x, this.pts[1].y - this.pts[0].y);
        const res = this.computeArc();
        return {
          wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'radius',
          fields: [
            { key: 'chord_ro', label: 'Chord', liveValue: formatLen(chord), readonly: true, width: 80 },
            { key: 'radius', label: 'Radius', liveValue: (res?.arc) ? formatLen(res.arc.r) : '', width: 80 },
          ],
        };
      }
      return null;
    }

    // â”€â”€ SEA â”€â”€
    if (this.mode === 'sea' && this.pts.length === 2) {
      const S = this.pts[0], E = this.pts[1];
      const liveAngle = this.seaLiveAngle(S, E, this.cur);
      return {
        wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'angle',
        fields: [{ key: 'angle', label: 'Angle', liveValue: formatAngleDeg(liveAngle), suffix: 'Â°', width: 80 }],
      };
    }

    // â”€â”€ SED â”€â”€
    if (this.mode === 'sed' && this.pts.length === 2) {
      const S = this.pts[0];
      const liveDir = Math.atan2(this.cur.y - S.y, this.cur.x - S.x) * 180 / Math.PI;
      return {
        wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'direction',
        fields: [{ key: 'direction', label: 'Direction', liveValue: formatAngleDeg(liveDir), suffix: 'Â°', width: 80 }],
      };
    }

    // â”€â”€ SER â”€â”€
    if (this.mode === 'ser' && this.pts.length === 2) {
      const S = this.pts[0], E = this.pts[1];
      const liveArc = this.make3PArc(S, this.cur, E);
      return {
        wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'radius',
        fields: [{ key: 'radius', label: 'Radius', liveValue: liveArc ? formatLen(liveArc.r) : '', width: 80 }],
      };
    }

    // â”€â”€ SC/CS angle or length â”€â”€
    if (this.pts.length === 2) {
      if (this.mode.endsWith('a')) {
        const isSC = this.mode.startsWith('sc');
        const start = isSC ? this.pts[0] : this.pts[1];
        const center = isSC ? this.pts[1] : this.pts[0];
        const sa = Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI;
        let sweep = Math.atan2(this.cur.y - center.y, this.cur.x - center.x) * 180 / Math.PI - sa;
        sweep = ((sweep % 360) + 360) % 360;
        return {
          wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'angle',
          fields: [{ key: 'angle', label: 'Angle', liveValue: formatAngleDeg(sweep), suffix: 'Â°', width: 80 }],
        };
      }
      if (this.mode.endsWith('l')) {
        const isSC = this.mode.startsWith('sc');
        const start = isSC ? this.pts[0] : this.pts[1];
        const len = Math.hypot(this.cur.x - start.x, this.cur.y - start.y);
        return {
          wx: this.cur.x, wy: this.cur.y, primaryFieldKey: 'length',
          fields: [{ key: 'length', label: 'Length', liveValue: formatLen(len), width: 80 }],
        };
      }
    }
    return null;
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.mode === '3p') {
      if (this.pts.length === 1) {
        const end = this.resolvePhase1Endpoint(values);
        if (!end) return false;
        this.pts.push(end); this.dyn.clearEdits(); this.vm.markDirty();
        return true;
      }
      if (this.pts.length === 2) {
        const chord = Math.hypot(this.pts[1].x - this.pts[0].x, this.pts[1].y - this.pts[0].y);
        const typedR = evalExpression(values['radius'] ?? '');
        if (typedR === null || !Number.isFinite(typedR) || typedR < chord / 2 - 1e-9) return false;
        const arc = this.buildArcFromChordRadius(this.pts[0], this.pts[1], typedR, this.cur);
        if (!arc) return false;
        arc.layer = this.doc.activeLayer;
        this.cmds.push(new AddEntityCmd(arc, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
        this.pts = []; this.dyn.clearEdits(); this.vm.markDirty();
        return true;
      }
      return false;
    }

    // SEA / SED / SER: after 2 pts, commit the typed value by simulating a click
    if ((this.mode === 'sea' || this.mode === 'sed' || this.mode === 'ser') && this.pts.length === 2) {
      this.onMouseDown(this.cur.x, this.cur.y);
      return true;
    }

    // SC/CS angle/length
    if (this.pts.length === 2 && (this.mode.endsWith('a') || this.mode.endsWith('l'))) {
      this.onMouseDown(this.cur.x, this.cur.y);
      return true;
    }
    return false;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.pts = [];
      this.dyn.clearEdits();
      this.vm.markDirty();
      this.tools.setTool('select');
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const edits = this.dyn.editedValues();
      if (Object.keys(edits).length > 0 && this.commitDynamicInput(edits)) return;
      this.pts = [];
      this.dyn.clearEdits();
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  getAnchor(): IPoint | null { return this.pts.length > 0 ? this.pts[this.pts.length - 1] : null; }

  deactivate(): void {
    this.pts = [];
    this.contStart = null;
    this.dyn.clearEdits();
    this.dyn.setState(null);
  }

  // â”€â”€ 3p helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private effectivePhase1End(): IPoint {
    const p1 = this.pts[0];
    if (!p1) return this.cur;
    const dx = this.cur.x - p1.x, dy = this.cur.y - p1.y;
    const edits = this.dyn.editedValues();
    const len = evalExpression(edits['chord'] ?? '') ?? Math.hypot(dx, dy);
    const ang = evalExpression(edits['angle'] ?? '') ?? Math.atan2(dy, dx) * 180 / Math.PI;
    if (!Number.isFinite(len) || len <= 0) return this.cur;
    const rad = ang * Math.PI / 180;
    return { x: p1.x + len * Math.cos(rad), y: p1.y + len * Math.sin(rad) };
  }

  private resolvePhase1Endpoint(values: Record<string, string>): IPoint | null {
    const p1 = this.pts[0];
    if (!p1) return null;
    const liveDx = this.cur.x - p1.x, liveDy = this.cur.y - p1.y;
    const len = evalExpression(values['chord'] ?? '') ?? Math.hypot(liveDx, liveDy);
    const ang = evalExpression(values['angle'] ?? '') ?? Math.atan2(liveDy, liveDx) * 180 / Math.PI;
    if (!Number.isFinite(len) || len <= 0) return null;
    const rad = ang * Math.PI / 180;
    return { x: p1.x + len * Math.cos(rad), y: p1.y + len * Math.sin(rad) };
  }

  private buildArcFromChordRadius(p1: IPoint, p2: IPoint, radius: number, cursor: IPoint): ArcEntity | null {
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (chord < 1e-9 || radius < chord / 2 - 1e-9) return null;
    const ux = (p2.x - p1.x) / chord, uy = (p2.y - p1.y) / chord;
    const nx = -uy, ny = ux;
    const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    const side = ((cursor.x - midX) * nx + (cursor.y - midY) * ny) >= 0 ? 1 : -1;
    const h = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
    const bulge = { x: midX + side * (radius - h) * nx, y: midY + side * (radius - h) * ny };
    return this.make3PArc(p1, bulge, p2);
  }

  private make3PArc(p1: IPoint, pMid: IPoint, p3: IPoint): ArcEntity | null {
    if (Math.hypot(p3.x - pMid.x, p3.y - pMid.y) < 1e-6) return this.semicircleFromDiameter(p1, pMid, true);
    if (Math.hypot(p3.x - p1.x, p3.y - p1.y) < 1e-6) return this.semicircleFromDiameter(p1, pMid, true);
    const ax = p1.x, ay = p1.y, bx = pMid.x, by = pMid.y, cx = p3.x, cy = p3.y;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-6) return this.semicircleFromDiameter(p1, p3, true);
    const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
    const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
    const r = Math.hypot(ax - ux, ay - uy);
    const ang = (px: number, py: number) => (Math.atan2(py - uy, px - ux) * 180) / Math.PI;
    const sa = ang(ax, ay), ma = ang(bx, by), ea = ang(cx, cy);
    return new ArcEntity(ux, uy, r, sa, ea, isAngleBetween(ma, sa, ea, true));
  }

  private semicircleFromDiameter(p1: IPoint, p2: IPoint, preferCCW = true): ArcEntity | null {
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (chord < 1e-9) return null;
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2, r = chord / 2;
    const sa = (Math.atan2(p1.y - cy, p1.x - cx) * 180) / Math.PI;
    const ea = (Math.atan2(p2.y - cy, p2.x - cx) * 180) / Math.PI;
    return new ArcEntity(cx, cy, r, sa, ea, preferCCW);
  }

  // â”€â”€ SEA helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Included angle (degrees) encoded by cursor position relative to chord SE.
   *  Positive = CCW arc bulging toward cursor, negative = CW. */
  private seaLiveAngle(S: IPoint, E: IPoint, cursor: IPoint): number {
    const chord = Math.hypot(E.x - S.x, E.y - S.y);
    if (chord < 1e-9) return 0;
    const midX = (S.x + E.x) / 2, midY = (S.y + E.y) / 2;
    const nx = -(E.y - S.y) / chord, ny = (E.x - S.x) / chord; // left-perp of Sâ†’E
    const sagitta = (cursor.x - midX) * nx + (cursor.y - midY) * ny;
    // Cursor on same side as sagitta â†’ CCW arc, opposite â†’ CW
    return -4 * Math.atan2(sagitta, chord / 2) * 180 / Math.PI;
  }

  /** Build arc from start S, end E, and included central angle (degrees). */
  private buildArcSEA(S: IPoint, E: IPoint, angleDeg: number): ArcEntity | null {
    const chord = Math.hypot(E.x - S.x, E.y - S.y);
    if (chord < 1e-9 || Math.abs(angleDeg) < 0.01) return null;
    const angleRad = Math.abs(angleDeg) * Math.PI / 180;
    const R = chord / (2 * Math.sin(angleRad / 2));
    const h = Math.sqrt(Math.max(0, R * R - (chord / 2) * (chord / 2)));
    const midX = (S.x + E.x) / 2, midY = (S.y + E.y) / 2;
    const ux = (E.x - S.x) / chord, uy = (E.y - S.y) / chord;
    const nx = -uy, ny = ux; // left-perp
    const ccw = angleDeg > 0;
    // For CCW arc: center is on the +n side; arc bulges toward -n side
    const side = ccw ? 1 : -1;
    const cx = midX + side * h * nx, cy = midY + side * h * ny;
    const sa = Math.atan2(S.y - cy, S.x - cx) * 180 / Math.PI;
    const ea = Math.atan2(E.y - cy, E.x - cx) * 180 / Math.PI;
    return new ArcEntity(cx, cy, R, sa, ea, ccw);
  }

  // â”€â”€ SED helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Build arc from start S, end E, and tangent direction at S (degrees from +X). */
  private buildArcSED(S: IPoint, E: IPoint, dirDeg: number): ArcEntity | null {
    const dirRad = dirDeg * Math.PI / 180;
    // Left-perpendicular to tangent direction = center direction
    const nx = -Math.sin(dirRad), ny = Math.cos(dirRad);
    const dx = S.x - E.x, dy = S.y - E.y;
    const dDotN = dx * nx + dy * ny;
    if (Math.abs(dDotN) < 1e-9) return null; // Sâ†’E parallel to tangent â†’ straight line
    const t = -(dx * dx + dy * dy) / (2 * dDotN);
    const cx = S.x + t * nx, cy = S.y + t * ny;
    const R = Math.abs(t);
    if (R < 1e-9) return null;
    const sa = Math.atan2(S.y - cy, S.x - cx) * 180 / Math.PI;
    const ea = Math.atan2(E.y - cy, E.x - cx) * 180 / Math.PI;
    return new ArcEntity(cx, cy, R, sa, ea, t > 0);
  }

  // â”€â”€ Continue helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private getContParams(): { start: IPoint; dirDeg: number } | null {
    const entities = this.doc.activeFile.entities;
    if (!entities.length) return null;
    const last = entities[entities.length - 1];
    if (last instanceof ArcEntity) {
      const end = last.getEndPoint();
      const dirDeg = last.ccw ? last.endAngle + 90 : last.endAngle - 90;
      return { start: end, dirDeg };
    }
    if (last instanceof LineEntity) {
      const end = { x: last.x2, y: last.y2 };
      const dirDeg = Math.atan2(last.y2 - last.y1, last.x2 - last.x1) * 180 / Math.PI;
      return { start: end, dirDeg };
    }
    return null;
  }
}
