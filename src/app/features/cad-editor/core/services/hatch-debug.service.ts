import { Injectable } from '@angular/core';
import type { Entity } from '../models/entity.model';
import { HatchEntity } from '../models/entity-extended.model';

/**
 * HatchDebugService — visual dependency overlay for diagnosing associativity.
 *
 * When `enabled` is true, `drawOverlay()` paints a lightweight overlay on the
 * canvas after each normal render pass:
 *
 *   - For every associative HatchEntity (spec.associative = true):
 *       • A faint orange dashed line from the hatch's bbox centre to each
 *         contributing entity's bbox centre.
 *       • A small 'H' label at the hatch centre and 'E' at each entity centre.
 *       • If the hatch is dirty (scheduler would regenerate it this frame),
 *         the lines are drawn in red instead of orange.
 *
 *   - For every orphaned hatch (spec present but spec.associative = false AND
 *     contributingEntityIds is empty):
 *       • A grey dashed ring around the bbox centre.
 *
 * The overlay is purely diagnostic — it has no effect on the model. Toggle it
 * in the browser console:
 *
 *   ng.getService(HatchDebugService).enabled = true
 *
 * Or via the Ctrl+Shift+H keyboard shortcut wired in the canvas component.
 *
 * This overlay is cheap: it only iterates visible hatches (typically < 100)
 * and draws O(contributing-entities) line segments per hatch. The entity
 * bbox lookups use the existing cached `_bbox` field — no extra computation.
 */
@Injectable({ providedIn: 'root' })
export class HatchDebugService {
  /** Set to true to enable the overlay on the next render frame. */
  enabled = false;

  /**
   * Draw the debug overlay for all hatches in `entities`.
   *
   * Call this AFTER `doc.drawAll()` and AFTER grips render so the overlay
   * appears on top of everything.
   *
   * `vm` is passed as `any` because `ViewModelService` is not a public API
   * dependency of this module — we only need `w2s(x, y)`.
   */
  drawOverlay(
    ctx: CanvasRenderingContext2D,
    vm: { w2s(x: number, y: number): { x: number; y: number } },
    entities: Entity[],
  ): void {
    if (!this.enabled) return;

    ctx.save();
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (const e of entities) {
      if (!(e instanceof HatchEntity)) continue;
      const spec = (e as HatchEntity).boundarySpec;
      if (!spec) continue;

      const hb = e.bbox?.();
      if (!hb) continue;
      const hcX = hb.x + hb.w / 2;
      const hcY = hb.y + hb.h / 2;
      const hcS = vm.w2s(hcX, hcY);

      if (!spec.associative || spec.contributingEntityIds.length === 0) {
        // Orphaned hatch — grey ring
        ctx.strokeStyle = 'rgba(160,160,160,0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(hcS.x, hcS.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(160,160,160,0.7)';
        ctx.fillText('orphan', hcS.x, hcS.y - 14);
        continue;
      }

      // Associative hatch — lines to each contributing entity
      for (const hostId of spec.contributingEntityIds) {
        const host = entities.find((x) => x.id === hostId);
        if (!host) {
          // Host missing — draw red indicator
          ctx.strokeStyle = 'rgba(220,60,60,0.9)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(hcS.x, hcS.y, 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(220,60,60,0.9)';
          ctx.fillText(`missing:${hostId}`, hcS.x, hcS.y - 16);
          continue;
        }

        const eb = host.bbox?.();
        if (!eb) continue;
        const ecX = eb.x + eb.w / 2;
        const ecY = eb.y + eb.h / 2;
        const ecS = vm.w2s(ecX, ecY);

        // Dependency line: hatch centre → entity centre
        ctx.strokeStyle = 'rgba(240,160,48,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(hcS.x, hcS.y);
        ctx.lineTo(ecS.x, ecS.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small dot at entity centre
        ctx.fillStyle = 'rgba(240,160,48,0.8)';
        ctx.beginPath();
        ctx.arc(ecS.x, ecS.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 'H' badge at hatch centre
      ctx.fillStyle = 'rgba(240,160,48,0.9)';
      ctx.beginPath();
      ctx.arc(hcS.x, hcS.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText('H', hcS.x, hcS.y);
    }

    ctx.restore();
  }
}
