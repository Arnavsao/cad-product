import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { hitTestAll, getSelectedEntities } from '../select/select-tool';
import { formatAngleDeg } from '../draw/draw-utils';
import { entityArea, entityLength, formatArea, formatMeasure } from './measure-geom';

/**
 * AutoCAD-style LIST (inquiry) command tool.
 *
 * Single phase `select`: LIST works on the current selection. When nothing is
 * pre-selected the user clicks entities to build a set and presses Enter to
 * produce the report; Escape cancels.
 *
 * AutoCAD's LIST opens a scrolling text window. There is no equivalent surface
 * here and `NotificationService` only carries a single-line toast, so the full
 * multi-line report is written with `console.info` (the pragmatic stand-in for
 * the AutoCAD text window) and a one-line summary goes to the toast.
 *
 * Strictly read-only: nothing is added to the document and nothing is pushed
 * onto the command stack.
 */
export class ListTool implements ITool {
  readonly name = 'list';

  /** Full text of the last report, for anyone that later grows a text window. */
  static lastReport = '';

  private targets: Entity[] = [];
  /** True once the pre-selection has been reported, so we stop re-reporting. */
  private done = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get notify() { return this.injector.get(NotificationService) as NotificationService; }

  activate(): void {
    this.done = false;
    this.targets = getSelectedEntities(this.doc);
    if (this.targets.length) {
      this.report();
      this.finish();
    }
  }

  deactivate(): void {
    this.targets = [];
    this.done = false;
  }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e && e.button !== 0) return;
    if (this.done) return;

    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (!hit) return;
    if (this.targets.indexOf(hit.entity) === -1) {
      hit.entity.selected = true;
      this.targets.push(hit.entity);
      this.vm.markContentDirty();
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.finish();
      return;
    }
    if (e.key === 'Enter') {
      if (this.targets.length) this.report();
      else this.notify.warning('LIST — no objects selected.');
      this.finish();
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    // Nothing to preview: selection highlight is drawn by the renderer.
    // Still normalise the context per the shared tool contract.
    ctx.save();
    ctx.setLineDash([]);
    ctx.restore();
  }

  getAnchor(): IPoint | null { return null; }

  getPhase(): string | null { return 'select'; }

  getCommandId(): string { return 'list'; }

  getCursor(): string { return 'pickbox'; }

  getStatusText(): string {
    return `LIST — ${this.targets.length} object(s) selected; Enter to report, Esc to cancel`;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private finish(): void {
    this.done = true;
    this.targets = [];
    this.tools.setTool('select');
  }

  private report(): void {
    const blocks = this.targets.map((e) => this.describe(e));
    const text = blocks.join('\n\n');
    ListTool.lastReport = text;
    console.info(`[LIST] ${this.targets.length} object(s)\n\n${text}`);
    const first = this.targets[0];
    this.notify.info(
      this.targets.length === 1
        ? `${first.type} on layer "${first.layer}" — see console for the full listing.`
        : `Listed ${this.targets.length} objects — see console for the full listing.`,
      6000,
    );
  }

  /** Build the AutoCAD-style multi-line block for one entity. */
  private describe(e: Entity): string {
    const file = this.doc.activeFile;
    const lines: string[] = [];

    lines.push(`${e.type}    Handle = ${e.handle ?? '(none)'}   Id = ${e.id}`);
    lines.push(`  Layer:      ${e.layer}`);
    lines.push(`  Space:      ${e.inPaperSpace ? 'Paper space' : 'Model space'}`);
    lines.push(`  Color:      ${this.colorLabel(e)} (${this.safeColor(e, file)})`);
    lines.push(`  Linetype:   ${e.lineType ?? 'BYLAYER'}   Scale: ${formatMeasure(e.lineTypeScale ?? 1, 4)}`);
    lines.push(`  Lineweight: ${this.lineWeightLabel(e.lineWeight)}`);

    switch (e.type) {
      case 'LINE': {
        const l = e as any;
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        lines.push(`  from point: X = ${formatMeasure(l.x1)}   Y = ${formatMeasure(l.y1)}   Z = 0.0000`);
        lines.push(`  to point:   X = ${formatMeasure(l.x2)}   Y = ${formatMeasure(l.y2)}   Z = 0.0000`);
        lines.push(`  Length:     ${formatMeasure(Math.hypot(dx, dy))}`);
        lines.push(`  Angle in XY Plane: ${formatAngleDeg((Math.atan2(dy, dx) * 180) / Math.PI)}°`);
        lines.push(`  Delta X = ${formatMeasure(dx)}, Delta Y = ${formatMeasure(dy)}, Delta Z = 0.0000`);
        break;
      }

      case 'CIRCLE': {
        const c = e as any;
        lines.push(`  center point: X = ${formatMeasure(c.cx)}   Y = ${formatMeasure(c.cy)}   Z = 0.0000`);
        lines.push(`  radius:        ${formatMeasure(c.r)}`);
        lines.push(`  diameter:      ${formatMeasure(c.r * 2)}`);
        lines.push(`  circumference: ${formatMeasure(2 * Math.PI * c.r)}`);
        lines.push(`  area:          ${formatArea(Math.PI * c.r * c.r)}`);
        break;
      }

      case 'ARC': {
        const a = e as any;
        const sweep = typeof a.getSweep === 'function' ? a.getSweep() : a.endAngle - a.startAngle;
        lines.push(`  center point: X = ${formatMeasure(a.cx)}   Y = ${formatMeasure(a.cy)}   Z = 0.0000`);
        lines.push(`  radius:       ${formatMeasure(a.r)}`);
        lines.push(`  start angle:  ${formatAngleDeg(a.startAngle)}°`);
        lines.push(`  end angle:    ${formatAngleDeg(a.endAngle)}°`);
        lines.push(`  included angle: ${formatAngleDeg(sweep)}°   (${a.ccw ? 'counterclockwise' : 'clockwise'})`);
        lines.push(`  length:       ${formatMeasure((Math.abs(sweep) * Math.PI) / 180 * a.r)}`);
        break;
      }

      case 'POLYLINE':
      case 'LWPOLYLINE': {
        const p = e as any;
        const len = entityLength(e);
        const area = entityArea(e);
        lines.push(`  vertices:  ${(p.pts ?? []).length}`);
        lines.push(`  closed:    ${p.closed ? 'Yes' : 'No'}`);
        if (p.bulges?.some((b: number) => Math.abs(b) > 1e-9)) lines.push('  contains arc (bulge) segments');
        if (typeof p.globalWidth === 'number' && p.globalWidth) lines.push(`  width:     ${formatMeasure(p.globalWidth)}`);
        lines.push(`  length:    ${len === null ? 'n/a' : formatMeasure(len)}`);
        lines.push(`  area:      ${area === null ? 'n/a (open)' : formatArea(area)}`);
        break;
      }

      case 'TEXT': {
        const t = e as any;
        lines.push(`  contents:  "${t.text ?? ''}"`);
        lines.push(`  position:  X = ${formatMeasure(t.x)}   Y = ${formatMeasure(t.y)}   Z = 0.0000`);
        lines.push(`  height:    ${formatMeasure(t.height ?? 0)}`);
        lines.push(`  rotation:  ${formatAngleDeg(((t.rotation ?? 0) * 180) / Math.PI)}°`);
        lines.push(`  style:     ${t.font ?? 'Arial'}${t.isMText ? ' (MTEXT)' : ''}`);
        lines.push(`  justify:   ${t.justify ?? 'BL'}   width factor: ${formatMeasure(t.widthFactor ?? 1, 4)}`);
        break;
      }

      case 'INSERT': {
        const b = e as any;
        lines.push(`  block name: ${b.blockName}`);
        lines.push(`  at point:   X = ${formatMeasure(b.x)}   Y = ${formatMeasure(b.y)}   Z = 0.0000`);
        lines.push(`  X scale factor: ${formatMeasure(b.sx ?? 1)}   Y scale factor: ${formatMeasure(b.sy ?? 1)}`);
        lines.push(`  rotation angle: ${formatAngleDeg(b.rotation ?? 0)}°`);
        if (b.attribs?.length) lines.push(`  attributes: ${b.attribs.length}`);
        break;
      }

      case 'ELLIPSE': {
        const el = e as any;
        const len = entityLength(e);
        const area = entityArea(e);
        lines.push(`  center point: X = ${formatMeasure(el.cx)}   Y = ${formatMeasure(el.cy)}   Z = 0.0000`);
        lines.push(`  major radius: ${formatMeasure(Math.max(el.rx, el.ry))}`);
        lines.push(`  minor radius: ${formatMeasure(Math.min(el.rx, el.ry))}`);
        lines.push(`  rotation:     ${formatAngleDeg(((el.rotation ?? 0) * 180) / Math.PI)}°`);
        lines.push(`  perimeter:    ${len === null ? 'n/a' : formatMeasure(len)}`);
        lines.push(`  area:         ${area === null ? 'n/a' : formatArea(area)}`);
        break;
      }

      case 'SPLINE': {
        const s = e as any;
        lines.push(`  degree:         ${s.degree ?? 3}`);
        lines.push(`  control points: ${(s.controlPoints ?? []).length}`);
        const len = entityLength(e);
        lines.push(`  length:         ${len === null ? 'n/a' : formatMeasure(len)}`);
        break;
      }

      case 'HATCH': {
        const h = e as any;
        const area = entityArea(e);
        lines.push(`  pattern:   ${h.pattern}   scale: ${formatMeasure(h.scale ?? 1)}   angle: ${formatAngleDeg(h.angle ?? 0)}°`);
        lines.push(`  solid fill: ${h.isSolid ? 'Yes' : 'No'}   associative: ${h.associative ? 'Yes' : 'No'}`);
        lines.push(`  area:      ${area === null ? 'n/a (associative boundary)' : formatArea(area)}`);
        break;
      }

      case 'POINT': {
        const p = e as any;
        lines.push(`  at point: X = ${formatMeasure(p.x)}   Y = ${formatMeasure(p.y)}   Z = 0.0000`);
        break;
      }

      default: {
        const len = entityLength(e);
        const area = entityArea(e);
        if (len !== null) lines.push(`  length: ${formatMeasure(len)}`);
        if (area !== null) lines.push(`  area:   ${formatArea(area)}`);
        break;
      }
    }

    const bb = typeof e.bbox === 'function' ? e.bbox() : null;
    if (bb) {
      lines.push(
        `  extents:  min (${formatMeasure(bb.x)}, ${formatMeasure(bb.y)})  ` +
        `max (${formatMeasure(bb.x + bb.w)}, ${formatMeasure(bb.y + bb.h)})`,
      );
    }

    return lines.join('\n');
  }

  private colorLabel(e: Entity): string {
    if (e.color) return e.color;
    if (e.colorNumber === 256) return 'BYLAYER';
    if (e.colorNumber === 0) return 'BYBLOCK';
    return `ACI ${e.colorNumber}`;
  }

  private safeColor(e: Entity, file: unknown): string {
    try {
      return e.resolvedColor(file as any);
    } catch {
      return 'unresolved';
    }
  }

  private lineWeightLabel(lw: number): string {
    if (lw === -1 || lw === undefined || lw === null) return 'BYLAYER';
    if (lw === -2) return 'BYBLOCK';
    if (lw === -3) return 'DEFAULT';
    return `${(lw / 100).toFixed(2)} mm`;
  }
}
