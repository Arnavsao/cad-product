import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { CadAction, TargetSelector, EntityWhere } from '../models/ai-action.model';
import type { CadContextSnapshot } from '../models/ai-context.model';
import { AiModelService } from './ai-model.service';
import { AiToolRegistryService } from './ai-tool-registry.service';
import { COMPONENT_FAMILIES } from '../models/component-family.model';

export type GatewayResponse =
  | { type: 'actions'; actions: CadAction[] }
  | { type: 'clarify'; question: string; options?: string[] }
  | { type: 'error'; message: string };

// ── Color & entity type lookup tables ────────────────────────────────────────

const COLOR_MAP: Record<string, number> = {
  red: 1, yellow: 2, green: 3, cyan: 4, blue: 5, magenta: 6,
  white: 7, black: 7, gray: 8, grey: 8, orange: 30, pink: 210, brown: 34,
  purple: 6, lime: 3,
};

/** User term → DXF entity type(s). null value means "all types". */
const TYPE_MAP: Record<string, string[] | null> = {
  line: ['LINE'], lines: ['LINE'],
  circle: ['CIRCLE'], circles: ['CIRCLE'],
  arc: ['ARC'], arcs: ['ARC'],
  text: ['TEXT', 'MTEXT'], texts: ['TEXT', 'MTEXT'],
  label: ['TEXT', 'MTEXT'], labels: ['TEXT', 'MTEXT'],
  dimension: ['DIMENSION'], dimensions: ['DIMENSION'], dim: ['DIMENSION'], dims: ['DIMENSION'],
  polyline: ['LWPOLYLINE', 'POLYLINE'], polylines: ['LWPOLYLINE', 'POLYLINE'],
  hatch: ['HATCH'], hatches: ['HATCH'],
  point: ['POINT'], points: ['POINT'],
  ellipse: ['ELLIPSE'], ellipses: ['ELLIPSE'],
  spline: ['SPLINE'], splines: ['SPLINE'],
  block: ['INSERT'], blocks: ['INSERT'], insert: ['INSERT'],
  entity: null, entities: null, object: null, objects: null, everything: null, all: null,
};

// ── Mock command parser ───────────────────────────────────────────────────────

const COLOR_WORDS = Object.keys(COLOR_MAP).join('|');
const TYPE_WORDS = Object.keys(TYPE_MAP).join('|');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractEntityTypes(prompt: string): string[] | null {
  for (const [word, types] of Object.entries(TYPE_MAP)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(prompt)) return types;
  }
  return null; // null = could not determine specific type
}

/** "selected", "the selection", "these", "them", "it" → operate on what is selected. */
function refersToSelection(lower: string): boolean {
  return /\b(selected|selection|these|those|them|this|it|highlighted|chosen)\b/.test(lower);
}

/** "all", "every", "everything", "entire drawing" → operate on the whole drawing. */
function refersToEverything(lower: string): boolean {
  return /\b(all|every|everything|entire|whole)\b/.test(lower);
}

/**
 * A colour used as an adjective on a noun is a FILTER, not a destination:
 * "delete the red lines", "change all blue text to green". Returns the ACI
 * and the matched phrase so callers can strip it before reading the target colour.
 */
function extractColorFilter(lower: string): { color: number; phrase: string } | null {
  const m = new RegExp(`\\b(${COLOR_WORDS})\\s+(${TYPE_WORDS}|ones?|things?)\\b`).exec(lower);
  if (!m) return null;
  return { color: COLOR_MAP[m[1]], phrase: m[0] };
}

function extractColor(prompt: string): number | string | null {
  // Hex color first — it is unambiguous.
  const hexMatch = /#([0-9a-f]{6})\b/i.exec(prompt);
  if (hexMatch) return `#${hexMatch[1].toLowerCase()}`;
  // ACI number literal ("color 3", "colour index 3", "aci 3")
  const numMatch = /\b(?:colou?r|aci)\s*(?:index|number|no\.?)?\s*(\d{1,3})\b/i.exec(prompt);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 0 && n <= 255) return n;
  }
  // Named ACI color — take the LAST one so "red lines to blue" → blue even
  // when the filter phrase was not stripped.
  const re = new RegExp(`\\b(${COLOR_WORDS})\\b`, 'gi');
  let last: string | null = null;
  for (let m = re.exec(prompt); m; m = re.exec(prompt)) last = m[1].toLowerCase();
  return last ? COLOR_MAP[last] : null;
}

/** Case-insensitive lookup of a candidate against the drawing's layer names. */
function matchKnownLayer(candidate: string, knownLayers: string[]): string | null {
  const c = candidate.trim().toLowerCase().replace(/^["']|["']$/g, '');
  return knownLayers.find(n => n.toLowerCase() === c) ?? null;
}

/**
 * Find a known layer name mentioned anywhere in the prompt. Whole-word only,
 * longest first, and one-character names ("0", "A") only count right after the
 * word "layer" — otherwise a layer called "0" would match "500".
 */
function findKnownLayer(prompt: string, knownLayers: string[]): string | null {
  const lower = prompt.toLowerCase();
  const sorted = [...knownLayers].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const n = escapeRe(name.toLowerCase());
    const re = name.length > 1
      ? new RegExp(`(^|[^a-z0-9_])${n}(?![a-z0-9_])`)
      : new RegExp(`\\blayer\\s+["']?${n}(?![a-z0-9_])`);
    if (re.test(lower)) return name;
  }
  return null;
}

function extractLayerName(prompt: string, knownLayers: string[]): string | null {
  // An explicit "layer X" wins when X is a real layer.
  const m = /\blayer\s+["']?([a-z0-9_\-.]+)["']?/i.exec(prompt);
  if (m) {
    const known = matchKnownLayer(m[1], knownLayers);
    if (known) return known;
  }
  const known = findKnownLayer(prompt, knownLayers);
  if (known) return known;
  return m ? m[1] : null;
}

/**
 * A layer used as a SCOPE, not a destination: "on layer DIM", "in layer WALLS",
 * "of layer 0". "to layer X" is deliberately excluded — that is where entities go.
 */
function extractLayerScope(prompt: string, knownLayers: string[]): string | null {
  const m = /\b(?:on|in|from|of|inside)\s+(?:the\s+)?layer\s+["']?([a-z0-9_\-.]+)["']?/i.exec(prompt);
  if (!m) return null;
  return matchKnownLayer(m[1], knownLayers) ?? m[1];
}

/** Standard DXF lineweights in hundredths of a millimetre. */
const DXF_LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

function snapLineweight(hundredths: number): number {
  let best = DXF_LINEWEIGHTS[0];
  for (const lw of DXF_LINEWEIGHTS) {
    if (Math.abs(lw - hundredths) < Math.abs(best - hundredths)) best = lw;
  }
  return best;
}

/**
 * Lineweight in hundredths of a mm (DXF convention). Accepts "0.25mm", "0.5",
 * "25" (already hundredths), and the words thin/medium/thick/heavy.
 */
function extractLineweight(prompt: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?)?\b/i.exec(prompt);
  if (m) {
    const val = parseFloat(m[1]);
    // A decimal without a unit ("0.5") can only sensibly be millimetres.
    const isMm = !!m[2] || (m[1].includes('.') && val < 3);
    return snapLineweight(isMm ? Math.round(val * 100) : Math.round(val));
  }
  const lower = prompt.toLowerCase();
  if (/\b(hairline|thinnest)\b/.test(lower)) return 0;
  if (/\b(thin|fine|light)\b/.test(lower)) return 13;
  if (/\b(medium|normal|default)\b/.test(lower)) return 25;
  if (/\b(thick|heavy|bold|thicker|heavier)\b/.test(lower)) return 50;
  return null;
}

/**
 * Build the target selector for an entity-level command from whatever the user
 * said about WHICH entities: a type ("circles"), a colour adjective ("red lines"),
 * a layer scope ("on layer DIM"), a reference to the selection, or "everything".
 *
 * `fallback` decides what an unqualified command ("delete", "make it red") means
 * when nothing is selected: the whole drawing, or ask.
 */
function buildEntityTarget(
  prompt: string,
  ctx: CadContextSnapshot,
  fallback: 'all' | 'clarify',
): { target: TargetSelector | null; colorFilter: { color: number; phrase: string } | null } {
  const lower = prompt.toLowerCase();
  const layerNames = ctx.layers.map(l => l.name);
  const colorFilter = extractColorFilter(lower);
  const types = extractEntityTypes(lower);
  const layerScope = extractLayerScope(prompt, layerNames);

  if (!types && !colorFilter && !layerScope) {
    if (refersToSelection(lower) && !refersToEverything(lower)) return { target: { kind: 'selection' }, colorFilter };
    if (refersToEverything(lower)) return { target: { kind: 'all' }, colorFilter };
    if (ctx.selection.count > 0) return { target: { kind: 'selection' }, colorFilter };
    return { target: fallback === 'all' ? { kind: 'all' } : null, colorFilter };
  }

  const where: EntityWhere = { visibleOnly: true };
  if (types) where.type = types;
  if (layerScope) where.layer = [layerScope];
  if (colorFilter) where.color = [colorFilter.color];
  return { target: { kind: 'query', where }, colorFilter };
}

/**
 * Parse a distance with an optional unit into drawing units.
 * ASSUMPTION: drawings are in millimetres (typical for these bridge GADs), so
 * "5m" → 5000, "5cm" → 50, "5mm"/"5" → 5.
 */
function extractDistanceUnits(prompt: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(meters?|metres?|m|centimet(?:er|re)s?|cm|millimet(?:er|re)s?|mm)?\b/i.exec(prompt);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'm' || unit.startsWith('meter') || unit.startsWith('metre')) return val * 1000;
  if (unit === 'cm' || unit.startsWith('centim')) return val * 10;
  return val; // mm or unitless
}

function extractDirection(prompt: string): 'left' | 'right' | 'up' | 'down' | null {
  // The LAST direction word is the destination: "move the right view to the left".
  const re = /\b(left|right|up|upward|upwards|north|down|downward|downwards|south)(?:wards?)?\b/gi;
  let last: string | null = null;
  for (let m = re.exec(prompt); m; m = re.exec(prompt)) last = m[1].toLowerCase();
  if (!last) return null;
  if (last === 'left' || last === 'right') return last;
  if (last.startsWith('up') || last === 'north') return 'up';
  return 'down';
}

/**
 * Extract a single dimension value (in mm), distinguishing:
 *   - noun keywords (keyword-first):  "thickness 500mm", "height of 3m"
 *   - adjective keywords (number-first): "2m wide", "1.5m high"
 * Adjective matching is tried first so "2m wide 1.5m high" binds each number to
 * its adjacent adjective. Noun matching covers the "<noun> <num>" phrasing.
 */
function extractDimension(prompt: string, nounKw: string[], adjKw: string[] = []): number | null {
  const toMm = (numStr: string, unit: string): number => {
    let v = parseFloat(numStr);
    const u = unit.toLowerCase();
    if (u === 'm') v *= 1000;
    else if (u === 'cm') v *= 10;
    return v;
  };

  if (adjKw.length) {
    const m = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)?\\s+(?:${adjKw.join('|')})\\b`, 'i').exec(prompt);
    if (m) return toMm(m[1], m[2] || '');
  }

  if (nounKw.length) {
    const m = new RegExp(`\\b(?:${nounKw.join('|')})\\s*(?:of\\s+)?(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)?`, 'i').exec(prompt);
    if (m) return toMm(m[1], m[2] || '');
  }

  return null;
}



function extractAlignEdge(prompt: string): 'left' | 'right' | 'top' | 'bottom' | 'centerx' | 'centery' {
  const p = prompt.toLowerCase();
  if (/\bleft\b/.test(p)) return 'left';
  if (/\bright\b/.test(p)) return 'right';
  if (/\btop\b/.test(p)) return 'top';
  if (/\bbottom\b/.test(p)) return 'bottom';
  if (/\b(center|centre)\b/.test(p)) {
    if (/\bvertical/.test(p)) return 'centery';
    if (/\bhorizontal/.test(p)) return 'centerx';
    return 'centery';
  }
  // Default for a bare "align all views": line them up on a common centerline.
  return 'centery';
}

function extractAxis(prompt: string): 'horizontal' | 'vertical' {
  const p = prompt.toLowerCase();
  if (/\b(vertical|vertically|column|stack)\b/.test(p)) return 'vertical';
  return 'horizontal';
}

function extractViewQuery(prompt: string): string | null {
  const p = prompt.toLowerCase();
  const m = /\b(top|bottom|left|right|first|last)\b\s*(?:view|drawing)?/.exec(p);
  if (m) return m[1];
  const named = /\b(?:view|drawing)\s+["']?([a-z0-9_\-.]+)["']?/i.exec(prompt);
  if (named) return named[1];
  return null;
}

export function parseMockCommand(
  prompt: string,
  ctx: CadContextSnapshot,
): GatewayResponse {
  const p = prompt.trim();
  const lower = p.toLowerCase();
  const layerNames = ctx.layers.map(l => l.name);

  // ── SELECT ────────────────────────────────────────────────────────────────
  if (/\bselect\b/.test(lower) && !/\b(deselect|unselect)\b/.test(lower)) {
    const { target } = buildEntityTarget(p, ctx, 'all');
    return {
      type: 'actions',
      actions: [{
        action: 'query.selectEntities',
        target: target ?? { kind: 'all' },
        parameters: { mode: /\b(add|also|too|as well)\b/.test(lower) ? 'add' : 'replace' },
        metadata: { intentText: p, confidence: 0.92 },
      }],
    };
  }

  // ── DELETE / ERASE / REMOVE ───────────────────────────────────────────────
  if (/\b(delete|erase|remove)\b/.test(lower)) {
    const { target } = buildEntityTarget(p, ctx, 'clarify');
    if (!target) {
      return { type: 'clarify', question: 'Delete what? Select something first, or name it (e.g., "delete all text", "delete the red lines").' };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'entities.delete',
        target,
        parameters: {},
        metadata: { intentText: p, confidence: 0.9, requiresConfirmation: true },
      }],
    };
  }

  // ── CHANGE COLOR ──────────────────────────────────────────────────────────
  // Runs before CHANGE LAYER so "change the color of layer DIM to red" recolours
  // instead of moving everything onto DIM. A colour adjective on a noun ("red
  // lines") is a filter; the destination colour is whatever remains.
  {
    const mentionsColor = /\b(colou?r|aci)\b/.test(lower) || /#[0-9a-f]{6}\b/i.test(p) ||
      new RegExp(`\\b(${COLOR_WORDS})\\b`).test(lower);
    const explicit = /\bcolou?r\b/.test(lower);
    const toLayer = /\bto\s+(?:the\s+)?layer\b/.test(lower) && !explicit;
    // A bare colour word inside another command ("hide layer RED", "insert a
    // white box culvert") is not a recolour request.
    const otherCommand = !explicit &&
      /\b(hide|show|lock|unlock|freeze|thaw|isolate|rename|zoom|move|align|distribute|spacing|insert|place|generate|replace|swap|dimension)\b/.test(lower);
    // A verb (or "to") is required: a bare "red" is an answer to a question,
    // handled by the follow-up merge, not an order to repaint the drawing.
    const hasIntent = explicit || /\b(change|make|set|turn|paint|recolou?r|to|into|become|should be)\b/.test(lower);
    if (mentionsColor && hasIntent && !toLayer && !otherCommand) {
      const { target, colorFilter } = buildEntityTarget(p, ctx, 'all');
      const rest = colorFilter ? p.replace(new RegExp(colorFilter.phrase, 'i'), ' ') : p;
      const color = extractColor(rest);
      if (color === null) {
        return { type: 'clarify', question: 'What color should I change them to? (e.g., red, blue, ACI 3, or a hex like #ff0000)' };
      }
      return {
        type: 'actions',
        actions: [{
          action: 'entities.changeColor',
          target: target ?? { kind: 'all' },
          parameters: { color },
          metadata: { intentText: p, confidence: 0.91, requiresConfirmation: true },
        }],
      };
    }
  }

  // ── CHANGE LAYER (move to layer / assign layer) ───────────────────────────
  if (/\b(move|change|assign|put|set|transfer|send)\b.*\blayer\b|\blayer\b.*(change|set)/.test(lower) &&
      !/\b(hide|show|lock|unlock|freeze|thaw|isolate|visible|rename)\b/.test(lower)) {
    // The destination is "to layer X" when present; otherwise the last layer named.
    const dest = /\b(?:to|onto|into|on)\s+(?:the\s+)?layer\s+["']?([a-z0-9_\-.]+)["']?/i.exec(p);
    const layerName = dest
      ? (matchKnownLayer(dest[1], layerNames) ?? dest[1])
      : extractLayerName(p, layerNames);
    if (!layerName) {
      return { type: 'clarify', question: 'Which layer should I move the entities to?' };
    }
    // Strip the destination so it is not mistaken for a layer scope filter.
    const scopePrompt = dest ? p.replace(dest[0], ' ') : p;
    const { target } = buildEntityTarget(scopePrompt, ctx, 'clarify');
    if (!target) {
      return { type: 'clarify', question: `Which entities should go to layer ${layerName}? Select them first, or name them (e.g., "move all text to layer ${layerName}").` };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'entities.changeLayer',
        target,
        parameters: { layer: layerName },
        metadata: { intentText: p, confidence: 0.88 },
      }],
    };
  }

  // ── CHANGE LINEWEIGHT ─────────────────────────────────────────────────────
  // "thickness" only means lineweight when NOT inserting/generating a component
  // (those use thickness as a geometry parameter).
  const componentCtx = /\b(insert|add|place|put|draw|generate|create|build|replace|wall|culvert|channel|chamber|pipe|component)\b/.test(lower);
  if (/\b(lineweight|line\s*weight|lw|line\s*thickness|pen\s*width)\b/.test(lower) ||
      (/\b(thickness|thick|thicker|thin|thinner|bold|bolder|heavy|heavier|hairline)\b/.test(lower) && !componentCtx)) {
    const lw = extractLineweight(p);
    if (lw === null) {
      return { type: 'clarify', question: 'What lineweight should I set? (e.g., 0.25mm, 25, or "thick")' };
    }
    const { target } = buildEntityTarget(p, ctx, 'clarify');
    if (!target) {
      return { type: 'clarify', question: 'Which entities should get that lineweight? Select them first, or name them (e.g., "set all lines to 0.5mm").' };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'entities.changeLineweight',
        target,
        parameters: { lineWeight: lw },
        metadata: { intentText: p, confidence: 0.87 },
      }],
    };
  }

  // ── HIDE / SHOW LAYER ─────────────────────────────────────────────────────
  if (/\b(hide|show|invisible|visible)\b/.test(lower) && /\blayer\b/.test(lower)) {
    const visible = /\b(show|visible)\b/.test(lower);
    const layerName = extractLayerName(p, layerNames);
    if (!layerName) {
      return { type: 'clarify', question: `Which layer do you want to ${visible ? 'show' : 'hide'}?` };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'layer.setVisible',
        target: { kind: 'layer', layer: layerName },
        parameters: { visible },
        metadata: { intentText: p, confidence: 0.92 },
      }],
    };
  }

  // ── RENAME LAYER ──────────────────────────────────────────────────────────
  if (/\brename\b/.test(lower) && /\blayer\b/.test(lower)) {
    // "rename layer OLD to NEW"
    const m = /\brename\s+layer\s+["']?([a-z0-9_\-.]+)["']?\s+(?:to|as)\s+["']?([a-z0-9_\-.]+)["']?/i.exec(p);
    if (!m) {
      return { type: 'clarify', question: 'Which layer should I rename, and to what? (e.g., "rename layer DIM to ANNOT")' };
    }
    const fromName = layerNames.find(n => n.toLowerCase() === m[1].toLowerCase()) ?? m[1];
    return {
      type: 'actions',
      actions: [{
        action: 'layer.rename',
        target: { kind: 'layer', layer: fromName },
        parameters: { to: m[2] },
        metadata: { intentText: p, confidence: 0.9, requiresConfirmation: true },
      }],
    };
  }

  // ── ZOOM TO VIEW ──────────────────────────────────────────────────────────
  if (/\bzoom\b/.test(lower) && !/\b(extents?|all|out|in)\b/.test(lower)) {
    const viewQuery = extractViewQuery(p) ?? '';
    if (!viewQuery) {
      return { type: 'clarify', question: 'Which view should I zoom to? (e.g., "zoom to top view")' };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'view.zoomTo',
        target: { kind: 'all' },
        parameters: { view: viewQuery },
        metadata: { intentText: p, confidence: 0.9 },
      }],
    };
  }

  // ── ADD DIMENSION ─────────────────────────────────────────────────────────
  if (/\b(dimension|dimensions|dim)\b/.test(lower) &&
      /\b(add|place|put|draw|insert|create)\b/.test(lower)) {
    const direction = /\bvertical/.test(lower) ? 'vertical' : 'horizontal';
    return {
      type: 'actions',
      actions: [{
        action: 'annotation.addDimension',
        target: { kind: 'selection' },
        parameters: { direction },
        metadata: { intentText: p, confidence: 0.82 },
      }],
    };
  }

  // ── LOCK / UNLOCK LAYER ───────────────────────────────────────────────────
  if (/\b(lock|unlock)\b/.test(lower) && /\blayer\b/.test(lower)) {
    const locked = /\block\b/.test(lower) && !/\bunlock\b/.test(lower);
    const layerName = extractLayerName(p, layerNames);
    if (!layerName) {
      return { type: 'clarify', question: `Which layer do you want to ${locked ? 'lock' : 'unlock'}?` };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'layer.lock',
        target: { kind: 'layer', layer: layerName },
        parameters: { locked },
        metadata: { intentText: p, confidence: 0.92 },
      }],
    };
  }

  // ── FREEZE / THAW LAYER (map to setVisible) ───────────────────────────────
  if (/\b(freeze|thaw)\b/.test(lower) && /\blayer\b/.test(lower)) {
    const visible = /\bthaw\b/.test(lower);
    const layerName = extractLayerName(p, layerNames);
    if (!layerName) {
      return { type: 'clarify', question: `Which layer do you want to ${visible ? 'thaw' : 'freeze'}?` };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'layer.setVisible',
        target: { kind: 'layer', layer: layerName },
        parameters: { visible },
        metadata: { intentText: p, confidence: 0.88 },
      }],
    };
  }

  // ── ISOLATE (view or layer) ───────────────────────────────────────────────
  if (/\b(isolate)\b/.test(lower)) {
    // "isolate the top view" / "isolate view X" → view.isolate
    const isView = /\b(view|drawing)\b/.test(lower) ||
      (/\b(top|bottom|left|right|first|last)\b/.test(lower) && !/\blayer\b/.test(lower));
    if (isView) {
      const viewQuery = extractViewQuery(p);
      if (viewQuery) {
        return {
          type: 'actions',
          actions: [{
            action: 'view.isolate',
            target: { kind: 'all' },
            parameters: { view: viewQuery },
            metadata: { intentText: p, confidence: 0.88, requiresConfirmation: true },
          }],
        };
      }
    }
    const layerName = extractLayerName(p, layerNames);
    if (!layerName) {
      return { type: 'clarify', question: 'Which layer or view do you want to isolate?' };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'layer.isolate',
        target: { kind: 'layer', layer: layerName },
        parameters: {},
        metadata: { intentText: p, confidence: 0.9 },
      }],
    };
  }

  // ── GENERATE COMPLETE DRAWING (GAD) ───────────────────────────────────────
  if (/\b(generate|create|produce|make|build)\b/.test(lower) &&
      /\b(gad|drawing|general arrangement|layout|sheet)\b/.test(lower)) {
    // Strip the verb so the template matcher sees the subject.
    const query = p.replace(/\b(generate|create|produce|make|build)\b/gi, '').trim();

    // Extract overall dimension params (clear width / height).
    const genParams: Record<string, number> = {};
    const gw = extractDimension(p, ['clear\\s*width', 'width'], ['wide']);
    const gh = extractDimension(p, ['clear\\s*height', 'height'], ['high', 'tall']);
    if (gw !== null) genParams['clearWidth'] = gw;
    if (gh !== null) genParams['clearHeight'] = gh;

    return {
      type: 'actions',
      actions: [{
        action: 'generate.drawing',
        target: { kind: 'all' },
        parameters: { query, params: genParams },
        metadata: { intentText: p, confidence: 0.8, requiresConfirmation: true },
      }],
    };
  }

  // ── AUTO-REORGANIZE / PACK LAYOUT ─────────────────────────────────────────
  if (/\b(reorganize|reorganise|auto.?layout|pack|rearrange|tidy)\b/.test(lower) ||
      (/\b(arrange|layout|organize|organise)\b/.test(lower) && /\bview/.test(lower))) {
    const colMatch = /\b(\d+)\s*col(?:umn)?s?\b/i.exec(p);
    const cols = colMatch ? parseInt(colMatch[1], 10) : 0;
    return {
      type: 'actions',
      actions: [{
        action: 'views.autoLayout',
        target: { kind: 'all' },
        parameters: { columns: cols },
        metadata: { intentText: p, confidence: 0.88, requiresConfirmation: true },
      }],
    };
  }

  // ── CENTER ALL VIEWS ──────────────────────────────────────────────────────
  if (/\bcenter\b/.test(lower) && /\b(all|views?|drawings?)\b/.test(lower) &&
      !/\b(align)\b/.test(lower)) {
    return {
      type: 'actions',
      actions: [{
        action: 'views.center',
        target: { kind: 'all' },
        parameters: {},
        metadata: { intentText: p, confidence: 0.88 },
      }],
    };
  }

  // ── VALIDATE / CHECK LAYOUT ───────────────────────────────────────────────
  if (/\b(validate|check|audit|inspect|report)\b/.test(lower) && /\b(layout|views?|spacing|overlap)\b/.test(lower)) {
    return {
      type: 'actions',
      actions: [{
        action: 'layout.validate',
        target: { kind: 'all' },
        parameters: {},
        metadata: { intentText: p, confidence: 0.93 },
      }],
    };
  }

  // ── INSERT / ADD COMPONENT ────────────────────────────────────────────────
  if (/\b(insert|add|place|put|draw)\b/.test(lower) &&
      /\b(retaining wall|culvert|drain|channel|chamber|pipe|component|symbol|block)\b/.test(lower)) {
    // Extract component type from the prompt.
    const componentTerms = [
      'retaining wall', 'box culvert', 'pipe culvert',
      'drainage channel', 'drain channel', 'inspection chamber',
      'culvert', 'channel', 'drain', 'chamber',
    ];
    let query = '';
    for (const term of componentTerms) {
      if (lower.includes(term)) { query = term; break; }
    }
    if (!query) query = p.replace(/\b(insert|add|place|put|draw)\b/gi, '').trim();

    // Extract key params: thickness / height / width / diameter / depth.
    const paramMatches: Record<string, number> = {};
    const dimKeywords: [string, string[], string[]][] = [
      ['thickness', ['thickness', 'thick'], []],
      ['height', ['height', 'ht'], ['high', 'tall']],
      ['width', ['width'], ['wide']],
      ['diameter', ['diameter', 'dia'], []],
      ['depth', ['depth'], ['deep']],
    ];
    for (const [key, nouns, adjs] of dimKeywords) {
      const val = extractDimension(p, nouns, adjs);
      if (val !== null) paramMatches[key] = val;
    }

    return {
      type: 'actions',
      actions: [{
        action: 'library.insert',
        target: { kind: 'all' },
        parameters: { query, params: paramMatches, at: { x: 0, y: 0 } },
        metadata: { intentText: p, confidence: 0.84, requiresConfirmation: true },
      }],
    };
  }

  // ── REPLACE ───────────────────────────────────────────────────────────────
  if (/\b(replace|swap|substitute)\b/.test(lower)) {
    const withMatch = /\bwith\s+(.+)$/i.exec(p);
    const replacement = withMatch ? withMatch[1].trim() : '';
    if (!replacement) {
      return { type: 'clarify', question: 'What should I replace the selection with? (e.g., "replace with box culvert 2m wide")' };
    }
    return {
      type: 'actions',
      actions: [{
        action: 'entities.replace',
        target: { kind: 'selection' },
        parameters: { with: replacement },
        metadata: { intentText: p, confidence: 0.82, requiresConfirmation: true },
      }],
    };
  }

  // ── ALIGN VIEWS ───────────────────────────────────────────────────────────
  if (/\balign\b/.test(lower) || (/\b(center|centre)\b/.test(lower) && /\bview/.test(lower))) {
    const edge = extractAlignEdge(p);
    return {
      type: 'actions',
      actions: [{
        action: 'views.align',
        target: { kind: 'all' },
        parameters: { edge },
        metadata: { intentText: p, confidence: 0.86 },
      }],
    };
  }

  // ── DISTRIBUTE VIEWS (even / equal / match spacing) ───────────────────────
  if (/\b(distribute|spread)\b/.test(lower) ||
      /\b(even|evenly|equal|equally)\b.*\b(spac|gap|distribut)/.test(lower) ||
      /\bmatch\s+spacing\b/.test(lower)) {
    const axis = extractAxis(p);
    return {
      type: 'actions',
      actions: [{
        action: 'views.distribute',
        target: { kind: 'all' },
        parameters: { axis },
        metadata: { intentText: p, confidence: 0.85 },
      }],
    };
  }

  // ── SET VIEW SPACING (fixed gap) ──────────────────────────────────────────
  if (/\b(spacing|gap)\b/.test(lower) || (/\bspace\b/.test(lower) && /\bbetween\b/.test(lower))) {
    const spacing = extractDistanceUnits(p);
    if (spacing === null) {
      return { type: 'clarify', question: 'What spacing (gap) should I set between the views? (e.g., 2m)' };
    }
    const axis = extractAxis(p);
    return {
      type: 'actions',
      actions: [{
        action: 'views.space',
        target: { kind: 'all' },
        parameters: { axis, spacing },
        metadata: { intentText: p, confidence: 0.84 },
      }],
    };
  }

  // ── MOVE (a view, or the current selection) ───────────────────────────────
  if (/\bmove\b/.test(lower)) {
    const direction = extractDirection(p);
    const distance = extractDistanceUnits(p);
    if (!direction || distance === null) {
      return { type: 'clarify', question: 'How far and in which direction should I move it? (e.g., "5m to the right")' };
    }

    const isView = /\b(view|drawing)\b/.test(lower) || /\b(top|bottom)\b/.test(lower);
    if (isView) {
      const viewQuery = extractViewQuery(p);
      if (!viewQuery) {
        return { type: 'clarify', question: 'Which view should I move? (e.g., "top view", "first view", or a label)' };
      }
      return {
        type: 'actions',
        actions: [{
          action: 'views.move',
          target: { kind: 'all' },
          parameters: { view: viewQuery, distance, direction },
          metadata: { intentText: p, confidence: 0.86 },
        }],
      };
    }

    return {
      type: 'actions',
      actions: [{
        action: 'entities.move',
        target: { kind: 'selection' },
        parameters: { distance, direction },
        metadata: { intentText: p, confidence: 0.85 },
      }],
    };
  }

  // ── Fallback: could not parse ─────────────────────────────────────────────
  return {
    type: 'clarify',
    question: `I'm not sure how to handle: "${p}". Try commands like "change all circles to red", "hide layer DIM", or "delete all text".`,
  };
}

/**
 * Local parsing with clarify follow-ups: when the previous assistant turn was a
 * question ("What color?") and the user answers with a fragment ("red"), the
 * fragment alone will not parse — so retry with the previous prompt prepended
 * ("change the selected lines" + "red"). `history` already ends with the
 * current user prompt, so the previous exchange sits two entries back.
 */
export function parseLocalWithFollowUp(
  prompt: string,
  context: CadContextSnapshot,
  history: Array<{ role: string; content: string }>,
): GatewayResponse {
  const direct = parseMockCommand(prompt, context);
  if (direct.type !== 'clarify') return direct;

  const prev = history.filter(h => h.role === 'user');
  const lastAssistant = [...history].reverse().find(h => h.role === 'assistant');
  const previousPrompt = prev.length >= 2 ? prev[prev.length - 2].content : null;
  const askedQuestion = !!lastAssistant && /\?\s*$/.test(lastAssistant.content.trim());
  if (!previousPrompt || !askedQuestion) return direct;

  const merged = parseMockCommand(`${previousPrompt} ${prompt}`, context);
  return merged.type === 'actions' ? merged : direct;
}

// ── Gateway service ───────────────────────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterChoice { message?: { content?: string }; }
interface OpenRouterResponse { choices?: OpenRouterChoice[]; error?: { message?: string }; }

@Injectable({ providedIn: 'root' })
export class LlmGatewayService {
  private http = inject(HttpClient);
  private modelSvc = inject(AiModelService);
  private registry = inject(AiToolRegistryService);

  async call(
    prompt: string,
    context: CadContextSnapshot,
    history: Array<{ role: string; content: string }>,
  ): Promise<GatewayResponse> {
    const model = this.modelSvc.selected;

    // ── Local regex parser ───────────────────────────────────────────────────
    if (model.kind === 'local' || !model.slug) {
      await new Promise(r => setTimeout(r, 200));
      return parseLocalWithFollowUp(prompt, context, history);
    }

    // ── Resolve endpoint + auth for the chosen backend ───────────────────────
    let url: string;
    let authHeader: Record<string, string>;

    if (model.kind === 'ollama') {
      const base = this.modelSvc.ollamaUrl();
      if (!base) {
        return { type: 'error', message: 'No Ollama server URL set. Open settings (⚙) and enter your server address.' };
      }
      // Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions.
      url = `${base}/v1/chat/completions`;
      authHeader = { Authorization: 'Bearer ollama' }; // token ignored by Ollama
    } else {
      // OpenRouter
      const apiKey = this.modelSvc.apiKey();
      if (!apiKey) {
        return {
          type: 'error',
          message: 'No OpenRouter API key set. Open settings (⚙) and paste your key, or switch to a local model.',
        };
      }
      url = OPENROUTER_URL;
      authHeader = {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://cadonline.app',
        'X-Title': 'CADO Assistant',
      };
    }

    // ── OpenAI-compatible chat completion (OpenRouter + Ollama) ──────────────
    try {
      const systemPrompt = this._buildSystemPrompt(context);
      const messages = [
        { role: 'system', content: systemPrompt },
        // Keep the last few turns for context (cap to limit tokens).
        ...history.slice(-6),
        { role: 'user', content: prompt },
      ];

      const body = {
        model: model.slug,
        messages,
        temperature: 0.1,
        stream: false,
        response_format: { type: 'json_object' },
      };

      const resp = await firstValueFrom(
        this.http.post<OpenRouterResponse>(url, body, {
          headers: { 'Content-Type': 'application/json', ...authHeader },
        }),
      );

      if (resp.error?.message) {
        return { type: 'error', message: `Model error: ${resp.error.message}` };
      }

      const content = resp.choices?.[0]?.message?.content;
      if (!content) {
        return { type: 'error', message: 'The model returned an empty response.' };
      }

      return this._parseModelJson(content, prompt);
    } catch (err: unknown) {
      const msg = this._httpErrorMessage(err, model.kind);
      return { type: 'error', message: msg };
    }
  }

  // ── System prompt ──────────────────────────────────────────────────────────

  private _buildSystemPrompt(ctx: CadContextSnapshot): string {
    const tools = this.registry.getToolDescriptions();
    const layerList = ctx.layers.map(l =>
      `${l.name}${l.locked ? ' (locked)' : ''}${l.visible ? '' : ' (hidden)'}`,
    ).join(', ') || 'Layer 0';
    const typeHist = Object.entries(ctx.summary.byType)
      .map(([t, n]) => `${t}:${n}`).join(', ') || 'none';
    const viewList = ctx.views.map(v =>
      `"${v.label}" (${v.entityCount} ents)`,
    ).join(', ') || 'none detected';
    const families = COMPONENT_FAMILIES.map(f =>
      `${f.id} (${f.params.filter(p => p.key !== 'layer').map(p => p.key).join(', ')})`,
    ).join('; ');

    return [
      'You are a CAD assistant that converts natural-language drawing commands into a strict JSON action plan.',
      'You NEVER produce geometry coordinates yourself. You ONLY emit tool actions; deterministic CAD services do the work.',
      '',
      'Respond with ONE JSON object and NOTHING else. Two valid shapes:',
      '1) {"type":"actions","actions":[ {"action":"<toolId>","target":<TargetSelector>,"parameters":{...},"metadata":{"intentText":"<user text>","confidence":0..1,"requiresConfirmation":<bool>}} ]}',
      '2) {"type":"clarify","question":"<one short question>"}',
      '',
      'TargetSelector is one of:',
      '  {"kind":"selection"} | {"kind":"all"} | {"kind":"ids","ids":[..]} |',
      '  {"kind":"layer","layer":"<name>"} |',
      '  {"kind":"query","where":{"type":["CIRCLE"],"layer":["L1"],"visibleOnly":true}}',
      '',
      'Available tools:',
      tools,
      '',
      'Parametric component families for library.insert (all lengths in millimetres):',
      `  ${families}`,
      'Complete-drawing templates for generate.drawing: box culvert GAD, retaining wall GAD, drainage layout.',
      'Colors are AutoCAD ACI integers: red=1 yellow=2 green=3 cyan=4 blue=5 magenta=6 white=7. Or a hex string like "#ff0000".',
      'Convert metres to millimetres (5m -> 5000). Lineweights are hundredths of mm (0.25mm -> 25).',
      'Set requiresConfirmation:true for delete, replace, mass recolor, layout changes, and auto-layout.',
      'Targeting: a colour or type adjective ("red lines", "all text") is a query filter; "on layer X" filters by layer; "to layer X" is a destination.',
      'If the user says "selected/these/them" or something is selected and no entities are named, target {"kind":"selection"}.',
      'When the user answers a clarifying question with a fragment ("red", "5m right"), combine it with their previous request.',
      'If the command is ambiguous or a required value is missing, return a clarify object instead of guessing.',
      '',
      '── Current drawing context ──',
      `Active layer: ${ctx.activeLayer}`,
      `Layers: ${layerList}`,
      `Entity counts by type: ${typeHist}`,
      `Current selection: ${ctx.selection.count} entit${ctx.selection.count === 1 ? 'y' : 'ies'}`,
      `Detected views (${ctx.views.length}): ${viewList}`,
    ].join('\n');
  }

  // ── Response parsing ─────────────────────────────────────────────────────────

  private _parseModelJson(raw: string, prompt: string): GatewayResponse {
    const json = this._extractJson(raw);
    if (!json) {
      return { type: 'error', message: 'Could not parse the model response as JSON.' };
    }

    try {
      const obj = JSON.parse(json) as Record<string, unknown>;

      if (obj['type'] === 'clarify' && typeof obj['question'] === 'string') {
        return { type: 'clarify', question: obj['question'] as string };
      }

      if (obj['type'] === 'actions' && Array.isArray(obj['actions'])) {
        const actions = (obj['actions'] as CadAction[]).map(a => this._normaliseAction(a, prompt));
        if (!actions.length) {
          return { type: 'clarify', question: 'I could not turn that into an action. Could you rephrase?' };
        }
        return { type: 'actions', actions };
      }

      return { type: 'error', message: 'The model response did not match the expected format.' };
    } catch {
      return { type: 'error', message: 'The model returned invalid JSON.' };
    }
  }

  /** Pull the first balanced {...} block, tolerating ```json fences or prose. */
  private _extractJson(text: string): string | null {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fence ? fence[1] : text;
    const start = candidate.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < candidate.length; i++) {
      const c = candidate[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return candidate.slice(start, i + 1);
      }
    }
    return null;
  }

  /** Guarantee required metadata fields so downstream validation never throws. */
  private _normaliseAction(a: CadAction, prompt: string): CadAction {
    return {
      action: a.action,
      target: a.target ?? { kind: 'selection' },
      parameters: a.parameters ?? {},
      metadata: {
        intentText: a.metadata?.intentText ?? prompt,
        confidence: typeof a.metadata?.confidence === 'number' ? a.metadata.confidence : 0.8,
        requiresConfirmation: a.metadata?.requiresConfirmation,
        rationale: a.metadata?.rationale,
        groupId: a.metadata?.groupId,
      },
    };
  }

  private _httpErrorMessage(err: unknown, kind: 'openrouter' | 'ollama'): string {
    const e = err as { status?: number; error?: { error?: { message?: string } } };

    if (kind === 'ollama') {
      if (e?.status === 0) {
        return 'Cannot reach the Ollama server. Check the URL in settings (⚙), that the server is running, and that OLLAMA_ORIGINS allows this app. If the app is served over HTTPS, the browser will block an http:// server (mixed content).';
      }
      if (e?.status === 404) return 'Ollama: model not found (404). Make sure the model is pulled on the server (ollama list).';
      if (e?.status === 500) return 'Ollama server error (500). The model may be loading or out of memory — try again in a moment.';
    } else {
      if (e?.status === 401) return 'OpenRouter rejected the API key (401). Check the key in settings.';
      if (e?.status === 402) return 'OpenRouter: insufficient credits / rate limited (402) for this free model.';
      if (e?.status === 404) return 'Model not found (404). The free slug may have changed — see openrouter.ai/models.';
      if (e?.status === 429) return 'Rate limited (429). Wait a moment, switch models, or use a local Ollama model.';
    }

    const apiMsg = e?.error?.error?.message;
    if (apiMsg) return `Model request failed: ${apiMsg}`;
    return err instanceof Error ? err.message : 'Model request failed.';
  }
}
