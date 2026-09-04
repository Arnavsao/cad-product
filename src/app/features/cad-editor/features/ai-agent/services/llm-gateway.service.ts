import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { CadAction, TargetSelector } from '../models/ai-action.model';
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

function extractEntityTypes(prompt: string): string[] | null {
  for (const [word, types] of Object.entries(TYPE_MAP)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(prompt)) return types;
  }
  return null; // null = could not determine specific type
}

function extractColor(prompt: string): number | string | null {
  // Named ACI color
  for (const [name, num] of Object.entries(COLOR_MAP)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(prompt)) return num;
  }
  // Hex color
  const hexMatch = /#([0-9a-f]{6})/i.exec(prompt);
  if (hexMatch) return `#${hexMatch[1]}`;
  // ACI number literal (e.g., "color 3" or "aci 3")
  const numMatch = /\bcolor\s+(\d{1,3})\b/i.exec(prompt);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 0 && n <= 255) return n;
  }
  return null;
}

function extractLayerName(prompt: string, knownLayers: string[]): string | null {
  const lower = prompt.toLowerCase();
  // First: exact match against known layer names (longest first to avoid partial)
  const sorted = [...knownLayers].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  // Fallback: word(s) after "layer" keyword
  const m = /\blayer\s+["']?([a-z0-9_\-.]+)["']?/i.exec(prompt);
  return m ? m[1] : null;
}

function extractLineweight(prompt: string): number | null {
  const m = /\b(\d{1,4})\s*(mm|cm)?\b/i.exec(prompt);
  if (!m) return null;
  let val = parseInt(m[1], 10);
  if (m[2]?.toLowerCase() === 'mm') val = val * 100; // convert mm to hundredths of mm
  // Valid DXF lineweights: 0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211,-1,-2,-3
  return val;
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
  if (/\bright\b/i.test(prompt)) return 'right';
  if (/\bleft\b/i.test(prompt)) return 'left';
  if (/\b(up|upward|upwards|north)\b/i.test(prompt)) return 'up';
  if (/\b(down|downward|downwards|south)\b/i.test(prompt)) return 'down';
  return null;
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
  if (/\bselect\b/.test(lower)) {
    const types = extractEntityTypes(lower);
    const target: TargetSelector = types
      ? { kind: 'query', where: { type: types, visibleOnly: true } }
      : { kind: 'all' };
    return {
      type: 'actions',
      actions: [{
        action: 'query.selectEntities',
        target,
        parameters: { mode: 'replace' },
        metadata: { intentText: p, confidence: 0.92 },
      }],
    };
  }

  // ── DELETE / ERASE / REMOVE ───────────────────────────────────────────────
  if (/\b(delete|erase|remove)\b/.test(lower)) {
    const types = extractEntityTypes(lower);
    const target: TargetSelector = types
      ? { kind: 'query', where: { type: types, visibleOnly: true } }
      : { kind: 'selection' };
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

  // ── CHANGE LAYER (move to layer / assign layer) ───────────────────────────
  if (/\b(move|change|assign|put|set)\b.*\blayer\b|\blayer\b.*(change|set)/.test(lower) &&
      !/\b(hide|show|lock|unlock|freeze|isolate|visible|rename)\b/.test(lower)) {
    const layerName = extractLayerName(p, layerNames);
    if (!layerName) {
      return { type: 'clarify', question: 'Which layer should I move the entities to?' };
    }
    const types = extractEntityTypes(lower);
    const target: TargetSelector = types
      ? { kind: 'query', where: { type: types, visibleOnly: true } }
      : { kind: 'selection' };
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

  // ── CHANGE COLOR ──────────────────────────────────────────────────────────
  if ((/\b(color|colour|red|yellow|green|cyan|blue|magenta|white|black|orange|gray|grey|pink|brown|purple|lime)\b/.test(lower) ||
       /#[0-9a-f]{6}/i.test(p)) &&
      /\b(change|make|set|turn|all|to)\b/.test(lower)) {
    const color = extractColor(p);
    if (color === null) {
      return { type: 'clarify', question: 'What color should I change the entities to? (e.g., red, blue, or a hex like #ff0000)' };
    }
    const types = extractEntityTypes(lower);
    const target: TargetSelector = types
      ? { kind: 'query', where: { type: types, visibleOnly: true } }
      : { kind: 'all' };
    return {
      type: 'actions',
      actions: [{
        action: 'entities.changeColor',
        target,
        parameters: { color },
        metadata: { intentText: p, confidence: 0.91, requiresConfirmation: true },
      }],
    };
  }

  // ── CHANGE LINEWEIGHT ─────────────────────────────────────────────────────
  // "thickness" only means lineweight when NOT inserting/generating a component
  // (those use thickness as a geometry parameter).
  const componentCtx = /\b(insert|add|place|put|draw|generate|create|build|replace|wall|culvert|channel|chamber|pipe|component)\b/.test(lower);
  if (/\b(lineweight|line\s*weight|lw)\b/.test(lower) ||
      (/\bthickness\b/.test(lower) && !componentCtx)) {
    const lw = extractLineweight(p);
    if (lw === null) {
      return { type: 'clarify', question: 'What lineweight should I set? (e.g., 25 for 0.25mm)' };
    }
    const types = extractEntityTypes(lower);
    const target: TargetSelector = types
      ? { kind: 'query', where: { type: types, visibleOnly: true } }
      : { kind: 'selection' };
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
      return parseMockCommand(prompt, context);
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
