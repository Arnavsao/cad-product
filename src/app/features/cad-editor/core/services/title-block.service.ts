/**
 * TitleBlockService
 *
 * Manages title block templates and inserts them into layout paper space.
 *
 * Title blocks are composed as arrays of paper-space entity-compatible objects.
 * For the v1 implementation they are created directly as drawing entities using
 * the existing entity model classes.
 *
 * Built-in templates cover A0–A4 standard ISO borders.
 */
import { Injectable, inject } from '@angular/core';
import { LayoutManagerService } from './layout-manager.service';
import type { Layout } from '../models/layout.model';
import { ViewModelService } from './view-model.service';

/** A minimal paper-space entity representation for title blocks. */
interface ITitleBlockEntity {
  type: 'rect' | 'line' | 'text';
  // rect fields
  x?: number; y?: number; w?: number; h?: number;
  // line fields
  x1?: number; y1?: number; x2?: number; y2?: number;
  // text fields
  text?: string; fontSize?: number; align?: 'left' | 'center' | 'right';
  // common
  color?: string;
  lineWidth?: number;
}

export interface ITitleBlockTemplate {
  name: string;
  /** ISO paper size this template is designed for. */
  paperKey: string;
  /** Paper width in mm. */
  paperW: number;
  /** Paper height in mm. */
  paperH: number;
  /** Entities to draw. */
  entities: ITitleBlockEntity[];
}

@Injectable({ providedIn: 'root' })
export class TitleBlockService {
  private layoutMgr = inject(LayoutManagerService);
  private vm        = inject(ViewModelService);

  /** Pre-built title block templates. */
  readonly templates: ReadonlyArray<ITitleBlockTemplate> = [
    this._buildTemplate('A4 Standard',  'A4', 297, 210),
    this._buildTemplate('A3 Standard',  'A3', 420, 297),
    this._buildTemplate('A2 Standard',  'A2', 594, 420),
    this._buildTemplate('A1 Standard',  'A1', 841, 594),
    this._buildTemplate('A0 Standard',  'A0', 1189, 841),
  ];

  /**
   * Insert a named title block template into the active layout as a
   * TitleBlockDrawable that the PaperSpaceRendererService will draw.
   * (In v1 the drawing is handled inline by this service as a canvas draw
   *  callback attached to a layout-level hook. Phase 6+ will integrate with
   *  the full paper-space entity pipeline.)
   */
  insertIntoLayout(templateName: string, layout: Layout): boolean {
    const tmpl = this.templates.find((t) => t.name === templateName);
    if (!tmpl) return false;
    // Store template ref on the layout for rendering
    (layout as any)._titleBlock = tmpl;
    this.vm.markDirty();
    this.layoutMgr.bump();
    return true;
  }

  clearFromLayout(layout: Layout): void {
    delete (layout as any)._titleBlock;
    this.vm.markDirty();
    this.layoutMgr.bump();
  }

  getTitleBlock(layout: Layout): ITitleBlockTemplate | null {
    return (layout as any)._titleBlock ?? null;
  }

  /**
   * Draw a title block template directly onto a canvas context.
   * Called by PaperSpaceRendererService after the main sheet render.
   *
   * @param ctx     Canvas context
   * @param tmpl    Template to draw
   * @param mm2s    Convert paper-mm to screen-px
   * @param pxPerMm Screen pixels per paper-mm (for line widths / font sizes)
   */
  draw(
    ctx: CanvasRenderingContext2D,
    tmpl: ITitleBlockTemplate,
    mm2s: (mmX: number, mmY: number) => { x: number; y: number },
    pxPerMm: number,
  ): void {
    ctx.save();
    for (const ent of tmpl.entities) {
      this._drawEntity(ctx, ent, mm2s, pxPerMm);
    }
    ctx.restore();
  }

  private _drawEntity(
    ctx: CanvasRenderingContext2D,
    ent: ITitleBlockEntity,
    mm2s: (mmX: number, mmY: number) => { x: number; y: number },
    pxPerMm: number,
  ): void {
    ctx.strokeStyle = ent.color ?? '#222';
    ctx.fillStyle   = ent.color ?? '#222';
    ctx.lineWidth   = (ent.lineWidth ?? 0.5) * pxPerMm;

    if (ent.type === 'rect' && ent.x != null && ent.y != null && ent.w != null && ent.h != null) {
      const tl = mm2s(ent.x, ent.y + ent.h);
      const br = mm2s(ent.x + ent.w, ent.y);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    } else if (ent.type === 'line' && ent.x1 != null && ent.y1 != null) {
      const p1 = mm2s(ent.x1, ent.y1);
      const p2 = mm2s(ent.x2!, ent.y2!);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

    } else if (ent.type === 'text' && ent.x != null && ent.y != null && ent.text) {
      const pt = mm2s(ent.x, ent.y);
      const fs = (ent.fontSize ?? 3) * pxPerMm;
      ctx.font      = `${fs}px Inter, Segoe UI, system-ui, sans-serif`;
      ctx.textAlign = (ent.align ?? 'left') as CanvasTextAlign;
      ctx.fillText(ent.text, pt.x, pt.y);
    }
  }

  // ─── Template builder ──────────────────────────────────────────────────────

  private _buildTemplate(
    name: string,
    paperKey: string,
    w: number,
    h: number,
  ): ITitleBlockTemplate {
    const m = 10; // margin
    const ents: ITitleBlockEntity[] = [];

    // Outer border (heavy line)
    ents.push({ type: 'rect', x: m, y: m, w: w - 2 * m, h: h - 2 * m, lineWidth: 0.7 });

    // Title block area: bottom-right rectangle 120mm wide, 40mm tall
    const tbX = w - m - 120;
    const tbY = m;
    const tbW = 120;
    const tbH = 40;

    // Main title block border
    ents.push({ type: 'rect', x: tbX, y: tbY, w: tbW, h: tbH, lineWidth: 0.5 });

    // Horizontal dividers inside title block
    ents.push({ type: 'line', x1: tbX, y1: tbY + tbH * 0.5, x2: tbX + tbW, y2: tbY + tbH * 0.5, lineWidth: 0.3 });
    ents.push({ type: 'line', x1: tbX, y1: tbY + tbH * 0.75, x2: tbX + tbW, y2: tbY + tbH * 0.75, lineWidth: 0.3 });

    // Vertical divider in lower half
    ents.push({ type: 'line', x1: tbX + tbW / 2, y1: tbY + tbH * 0.5, x2: tbX + tbW / 2, y2: tbY + tbH, lineWidth: 0.3 });

    // Labels
    ents.push({ type: 'text', text: 'DRAWING TITLE', x: tbX + 2, y: tbY + tbH - 3, fontSize: 2.5, color: '#888' });
    ents.push({ type: 'text', text: '(title)', x: tbX + tbW / 2, y: tbY + tbH - 3 - tbH * 0.25, fontSize: 4, color: '#222', align: 'center' });
    ents.push({ type: 'text', text: 'SCALE', x: tbX + 2, y: tbY + tbH * 0.75 - 1, fontSize: 2, color: '#888' });
    ents.push({ type: 'text', text: 'DATE', x: tbX + tbW / 2 + 2, y: tbY + tbH * 0.75 - 1, fontSize: 2, color: '#888' });
    ents.push({ type: 'text', text: 'REV', x: tbX + 2, y: tbY + tbH * 0.5 - 1, fontSize: 2, color: '#888' });
    ents.push({ type: 'text', text: `${paperKey}`, x: tbX + tbW - 3, y: tbY + tbH - 3, fontSize: 3, color: '#555', align: 'right' });

    return { name, paperKey, paperW: w, paperH: h, entities: ents };
  }
}
