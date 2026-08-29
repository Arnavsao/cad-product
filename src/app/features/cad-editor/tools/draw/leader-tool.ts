import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { LeaderEntity } from '../../core/models/entity-extended.model';
import type { IDimAnchor } from '../../core/models/dimension-style.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DynamicInputService } from '../../core/services/dynamic-input.service';
import { SnappingService } from '../../core/services/snapping.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { TextEditorService } from '../../features/text-editor/text-editor.service';
import { evalExpression, parseCadVector } from '../../core/utils/expression-parser';
import { formatLen, formatAngleDeg } from './draw-utils';

/**
 * AutoCAD-style 3-Click Multileader Tool.
 *
 *   1. Click â†’ Arrow head location (the tip pointing at the geometry).
 *   2. Click â†’ Bend / elbow point.
 *   3. Click â†’ Landing endpoint. Determines landingLength + attachmentSide,
 *              then drops into the universal inline text editor.
 *
 * Live preview throughout: arrow, leader segment, bend, horizontal landing,
 * and a text placeholder all redraw on every cursor move. Snapping, ortho,
 * polar and grid behave the same as any other draw tool because the canvas
 * routes mouse coords through `snap.resolve()` before delivery.
 *
 * Default arrow size + text height are derived from the current view scale,
 * so a freshly placed leader reads at a consistent ~screen-px size whether
 * the user is at 1:1 or 1:1000. Both still land on properties / grips so
 * everything is editable post-placement.
 */
export class LeaderTool implements ITool {
  readonly name: string;

  /** Arrow tip (pts[0]) and bend (pts[1]) are accumulated here. */
  private pts: IPoint[] = [];
  /** Live cursor in world coords â€” updated every onMouseMove. */
  private cur: IPoint = { x: 0, y: 0 };
  private phase: 'pick-arrow' | 'pick-bend' | 'pick-landing' = 'pick-arrow';

  /** Snap-captured anchor for associative attachment of the arrow tip. */
  private tipAnchor: IDimAnchor | null = null;
  /** Locked at activate-time so preview + commit use the same default. */
  private dynHeight = 2.5;
  private dynArrow = 2.5;

  constructor(private injector: Injector, private mode: 'mleader' | 'qleader' = 'mleader') {
    this.name = this.mode;
  }

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dyn() { return this.injector.get(DynamicInputService) as DynamicInputService; }
  private get snap() { return this.injector.get(SnappingService) as SnappingService; }
  private get textEditor() { return this.injector.get(TextEditorService) as TextEditorService; }

  /**
   * Text height ~ 18 screen px at activation, in world units. Mirrors the
   * TextEditorService formula so newly placed LEADER and TEXT annotations
   * stay visually balanced.
   */
  private dynamicDefaultHeight(): number {
    const TARGET_SCREEN_PX = 18;
    const scale = this.vm.scale || 1;
    const h = TARGET_SCREEN_PX / scale;
    return Number.isFinite(h) && h > 0 ? h : 2.5;
  }

  /**
   * Arrow size ~ 12 screen px at activation, in world units. Scales with
   * zoom so a tiny drawing doesn't get a giant arrow and a huge drawing
   * doesn't get a pinprick.
   */
  private dynamicArrowSize(): number {
    const TARGET_SCREEN_PX = 12;
    const scale = this.vm.scale || 1;
    const a = TARGET_SCREEN_PX / scale;
    return Number.isFinite(a) && a > 0 ? a : 2.5;
  }

  activate(): void {
    this.dynHeight = this.dynamicDefaultHeight();
    this.dynArrow = this.dynamicArrowSize();
  }

  onMouseDown(wx: number, wy: number): void {
    if (this.phase === 'pick-arrow') {
      this.pts.push({ x: wx, y: wy });

      // Capture associative attachment if the click landed on a snap point of
      // an existing entity. Resolves to live geometry on each redraw.
      const s = this.snap.current;
      if (s && typeof s.entityId === 'number' && typeof s.snapIndex === 'number') {
        this.tipAnchor = { entityId: s.entityId, snapIndex: s.snapIndex };
      }

      this.phase = 'pick-bend';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'pick-bend') {
      const bend = this.previewBend();
      this.pts.push(bend);
      this.phase = 'pick-landing';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return;
    }

    if (this.phase === 'pick-landing') {
      // Landing end is the cursor projected onto the bend's horizontal â€” the
      // model stores landing as `pts[last] + dir * landingLength` along the
      // X axis, so picking a vertical landing isn't representable. We honor
      // intent by using the cursor's X and the bend's Y.
      this.commitLeaderAt(wx);
    }
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    if (this.phase !== 'pick-arrow') this.vm.markDirty();
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'pick-arrow') return;
    if (!this.pts.length) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(240,160,48,0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);

    // Leader spine: arrow tip â†’ bend â†’ (landing in phase 3).
    ctx.beginPath();
    const tip = this.vm.w2s(this.pts[0].x, this.pts[0].y);
    ctx.moveTo(tip.x, tip.y);

    let bend: IPoint;
    if (this.phase === 'pick-bend') {
      bend = this.previewBend();
    } else {
      bend = this.pts[1];
    }
    const sBend = this.vm.w2s(bend.x, bend.y);
    ctx.lineTo(sBend.x, sBend.y);

    if (this.phase === 'pick-landing') {
      const landing = this.previewLanding();
      const sLand = this.vm.w2s(landing.x, landing.y);
      ctx.lineTo(sLand.x, sLand.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow head â€” drawn in solid orange so the user sees the final
    // direction while still placing the bend.
    const arrowFromW = bend;
    const adx = this.vm.w2s(arrowFromW.x, arrowFromW.y).x - tip.x;
    const ady = this.vm.w2s(arrowFromW.x, arrowFromW.y).y - tip.y;
    const aLen = Math.hypot(adx, ady);
    if (aLen > 1e-6) {
      const ux = adx / aLen;
      const uy = ady / aLen;
      const sizePx = Math.max(6, this.dynArrow * this.vm.scale);
      const baseX = tip.x + ux * sizePx;
      const baseY = tip.y + uy * sizePx;
      const halfW = sizePx * 0.35;
      ctx.fillStyle = 'rgba(240,160,48,0.85)';
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(baseX - uy * halfW, baseY + ux * halfW);
      ctx.lineTo(baseX + uy * halfW, baseY - ux * halfW);
      ctx.closePath();
      ctx.fill();
    }

    // Text placeholder â€” orange rect at the landing end so the user sees
    // where the annotation will land before they commit.
    if (this.phase === 'pick-landing' && this.mode === 'mleader') {
      const landing = this.previewLanding();
      const dir = landing.x >= this.pts[1].x ? 1 : -1;
      const pad = this.dynHeight * 0.25;
      const insWorld = { x: landing.x + dir * pad, y: landing.y };
      const ins = this.vm.w2s(insWorld.x, insWorld.y);
      const hPx = Math.max(8, this.dynHeight * this.vm.scale);
      const wPx = hPx * 6; // rough placeholder width
      ctx.strokeStyle = 'rgba(240,160,48,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rx = dir === 1 ? ins.x : ins.x - wPx;
      ctx.rect(rx, ins.y - hPx / 2, wPx, hPx);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(240,160,48,0.6)';
      ctx.font = `${hPx}px Arial`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = dir === 1 ? 'left' : 'right';
      ctx.fillText('Text', ins.x, ins.y);
    }

    ctx.restore();
  }

  getPhase(): string {
    if (this.phase === 'pick-arrow') return 'start';
    if (this.phase === 'pick-bend') return 'next';
    return 'end';
  }

  getAnchor(): IPoint | null {
    if (this.phase === 'pick-bend') return this.pts[0];
    if (this.phase === 'pick-landing') return this.pts[1];
    return null;
  }

  /** Phase-2 endpoint: live cursor unless dynamic-input froze length / angle. */
  private previewBend(): IPoint {
    const anchor = this.getAnchor();
    if (!anchor) return this.cur;
    const edits = this.dyn.editedValues();
    if (!edits['length'] && !edits['angle']) return this.cur;

    const dx = this.cur.x - anchor.x;
    const dy = this.cur.y - anchor.y;
    const liveLen = Math.hypot(dx, dy);
    const liveAng = Math.atan2(dy, dx) * 180 / Math.PI;
    const len = evalExpression(edits['length'] ?? '') ?? liveLen;
    const ang = evalExpression(edits['angle'] ?? '') ?? liveAng;
    if (!Number.isFinite(len) || len <= 0) return this.cur;
    const rad = ang * Math.PI / 180;
    return { x: anchor.x + len * Math.cos(rad), y: anchor.y + len * Math.sin(rad) };
  }

  /**
   * Phase-3 landing endpoint. Always sits on the bend's horizontal â€” the
   * AutoCAD-style landing is a straight horizontal segment. Honors typed
   * length via dynamic input.
   */
  private previewLanding(): IPoint {
    const bend = this.pts[1];
    const edits = this.dyn.editedValues();
    const liveLen = Math.abs(this.cur.x - bend.x);
    const live: IPoint = { x: this.cur.x, y: bend.y };
    if (!edits['landing']) return live;
    const typed = evalExpression(edits['landing'] ?? '');
    if (typed === null || !Number.isFinite(typed) || typed <= 0) return live;
    const dir = this.cur.x >= bend.x ? 1 : -1;
    return { x: bend.x + dir * typed, y: bend.y };
  }

  getDynamicInputState(): IDynamicInputState | null {
    if (this.phase === 'pick-arrow') return null;

    if (this.phase === 'pick-bend') {
      const anchor = this.pts[0];
      const end = this.previewBend();
      const dx = end.x - anchor.x;
      const dy = end.y - anchor.y;
      return {
        wx: end.x,
        wy: end.y,
        primaryFieldKey: 'length',
        fields: [
          { key: 'length', label: 'Length', liveValue: formatLen(Math.hypot(dx, dy)), width: 80 },
          { key: 'angle', label: 'Angle', liveValue: formatAngleDeg(Math.atan2(dy, dx) * 180 / Math.PI), suffix: 'Â°', width: 60 },
        ],
      };
    }

    // pick-landing
    const bend = this.pts[1];
    const landing = this.previewLanding();
    return {
      wx: landing.x,
      wy: landing.y,
      primaryFieldKey: 'landing',
      fields: [
        { key: 'landing', label: 'Landing', liveValue: formatLen(Math.abs(landing.x - bend.x)), width: 80 },
      ],
    };
  }

  commitDynamicInput(values: Record<string, string>): boolean {
    if (this.phase === 'pick-bend') {
      const anchor = this.pts[0];
      const widthRaw = values['length'] ?? '';
      const vec = parseCadVector(widthRaw);
      let endpoint: IPoint;
      if (vec) {
        if (vec.kind === 'cartesian' && vec.dx !== undefined && vec.dy !== undefined) {
          endpoint = { x: anchor.x + vec.dx, y: anchor.y + vec.dy };
        } else if (vec.kind === 'polar' && vec.length !== undefined && vec.angleDeg !== undefined) {
          const rad = vec.angleDeg * Math.PI / 180;
          endpoint = { x: anchor.x + vec.length * Math.cos(rad), y: anchor.y + vec.length * Math.sin(rad) };
        } else {
          return false;
        }
      } else {
        endpoint = this.previewBend();
      }
      if (Math.hypot(endpoint.x - anchor.x, endpoint.y - anchor.y) < 1e-9) return false;
      this.pts.push(endpoint);
      this.phase = 'pick-landing';
      this.dyn.clearEdits();
      this.vm.markDirty();
      return true;
    }

    if (this.phase === 'pick-landing') {
      const bend = this.pts[1];
      const raw = values['landing'] ?? '';
      const typed = evalExpression(raw);
      if (typed === null || !Number.isFinite(typed) || typed <= 0) return false;
      const dir = this.cur.x >= bend.x ? 1 : -1;
      this.commitLeaderAt(bend.x + dir * typed);
      return true;
    }

    return false;
  }

  /**
   * Build the LeaderEntity, push AddEntityCmd, and open the inline editor.
   * `landingX` is the world-X the user just clicked (or typed). We derive
   * `landingLength` + `attachmentSide` from it so the entity's existing
   * `landingEnd()` resolves to the same point.
   */
  private commitLeaderAt(landingX: number): void {
    const bend = this.pts[1];
    const dx = landingX - bend.x;
    const attachmentSide: 'left' | 'right' = dx >= 0 ? 'right' : 'left';
    const landingLength = Math.max(0, Math.abs(dx));

    const lead = new LeaderEntity([...this.pts], '', this.dynHeight);
    lead.layer = this.doc.activeLayer;
    lead.attachmentSide = attachmentSide;
    lead.landingLength = landingLength > 1e-9 ? landingLength : this.dynHeight * 2;
    lead.arrowSize = this.dynArrow;
    lead.arrowType = 'closed';
    if (this.tipAnchor) lead.anchor = this.tipAnchor;

    this.cmds.push(new AddEntityCmd(lead, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));

    this.reset();
    this.tools.setTool('select');
    
    if (this.mode === 'mleader') {
      // Drop straight into the universal text editor â€” same modal as TEXT /
      // MTEXT. setTimeout defers so the tool switch flushes first.
      setTimeout(() => this.textEditor.openForEdit(lead), 0);
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.reset();
      this.tools.setTool('select');
      return;
    }
    if (e.key === 'Backspace') {
      if (this.phase === 'pick-landing') {
        this.pts.pop();
        this.phase = 'pick-bend';
        this.dyn.clearEdits();
        this.vm.markDirty();
      } else if (this.phase === 'pick-bend') {
        this.pts.pop();
        this.phase = 'pick-arrow';
        this.tipAnchor = null;
        this.dyn.clearEdits();
        this.vm.markDirty();
      }
    }
  }

  private reset(): void {
    this.pts = [];
    this.phase = 'pick-arrow';
    this.tipAnchor = null;
    this.dyn.clearEdits();
    this.vm.markDirty();
  }

  deactivate(): void {
    this.reset();
    this.dyn.setState(null);
  }
}
