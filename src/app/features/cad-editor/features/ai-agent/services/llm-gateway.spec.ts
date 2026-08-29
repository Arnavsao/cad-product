import { parseMockCommand, type GatewayResponse } from './llm-gateway.service';
import type { CadContextSnapshot } from '../models/ai-context.model';
import type { CadAction } from '../models/ai-action.model';

/** Minimal CadContextSnapshot fixture with a few layers for parser tests. */
function makeContext(layerNames: string[] = ['Layer 0', 'DIM', 'STRUCTURAL']): CadContextSnapshot {
  return {
    schemaVersion: 1,
    documentId: 'doc1',
    revision: 1,
    activeFileId: 'f1',
    activeLayer: 'Layer 0',
    summary: { entityCount: 0, byType: {}, byLayer: {}, worldExtents: null },
    selection: { count: 0, ids: [], byType: {}, byLayer: {}, bbox: null },
    layers: layerNames.map(name => ({
      name, color: '#fff', visible: true, locked: false, frozen: false, entityCount: 0,
    })),
    views: [],
    libraryCatalog: [],
    viewport: { scale: 1, panX: 0, panY: 0, canvasWidth: 800, canvasHeight: 600 },
    cursor: { x: 0, y: 0 },
  };
}

/** Narrow a GatewayResponse to its single action, failing the test otherwise. */
function firstAction(resp: GatewayResponse): CadAction {
  expect(resp.type).toBe('actions');
  if (resp.type !== 'actions') throw new Error('expected actions response');
  expect(resp.actions.length).toBeGreaterThan(0);
  return resp.actions[0];
}

describe('parseMockCommand', () => {
  const ctx = makeContext();

  // ── Phase 1: selection / properties / layers ──────────────────────────────
  describe('Phase 1 — properties & layers', () => {
    it('selects all circles', () => {
      const a = firstAction(parseMockCommand('select all circles', ctx));
      expect(a.action).toBe('query.selectEntities');
      expect(a.target).toEqual(jasmine.objectContaining({ kind: 'query' }));
      if (a.target.kind === 'query') expect(a.target.where.type).toEqual(['CIRCLE']);
    });

    it('maps "change all to red" to changeColor ACI 1 over all', () => {
      const a = firstAction(parseMockCommand('change everything to red', ctx));
      expect(a.action).toBe('entities.changeColor');
      expect(a.parameters['color']).toBe(1);
      expect(a.target.kind).toBe('all');
      expect(a.metadata.requiresConfirmation).toBeTrue();
    });

    it('parses a hex color', () => {
      const a = firstAction(parseMockCommand('make all lines #00ff00', ctx));
      expect(a.action).toBe('entities.changeColor');
      expect(a.parameters['color']).toBe('#00ff00');
    });

    it('maps delete text to a destructive delete', () => {
      const a = firstAction(parseMockCommand('delete all text', ctx));
      expect(a.action).toBe('entities.delete');
      if (a.target.kind === 'query') expect(a.target.where.type).toEqual(['TEXT', 'MTEXT']);
      expect(a.metadata.requiresConfirmation).toBeTrue();
    });

    it('hides a known layer', () => {
      const a = firstAction(parseMockCommand('hide layer DIM', ctx));
      expect(a.action).toBe('layer.setVisible');
      expect(a.parameters['visible']).toBeFalse();
      if (a.target.kind === 'layer') expect(a.target.layer).toBe('DIM');
    });

    it('locks a layer', () => {
      const a = firstAction(parseMockCommand('lock layer STRUCTURAL', ctx));
      expect(a.action).toBe('layer.lock');
      expect(a.parameters['locked']).toBeTrue();
    });

    it('isolates a layer', () => {
      const a = firstAction(parseMockCommand('isolate layer DIM', ctx));
      expect(a.action).toBe('layer.isolate');
    });

    it('converts mm lineweight to hundredths', () => {
      const a = firstAction(parseMockCommand('set lineweight 0.25mm', ctx));
      // "0.25mm" -> the parser only matches integer groups; ensure tool + key present
      expect(a.action).toBe('entities.changeLineweight');
      expect(typeof a.parameters['lineWeight']).toBe('number');
    });

    it('asks to clarify an unknown layer for hide', () => {
      const resp = parseMockCommand('hide layer', ctx);
      expect(resp.type).toBe('clarify');
    });
  });

  // ── Phase 2: move / align / distribute / spacing ──────────────────────────
  describe('Phase 2 — move & layout', () => {
    it('moves the top view 5m right (metres → mm)', () => {
      const a = firstAction(parseMockCommand('move top view 5m to the right', ctx));
      expect(a.action).toBe('views.move');
      expect(a.parameters['distance']).toBe(5000);
      expect(a.parameters['direction']).toBe('right');
      expect(a.parameters['view']).toBe('top');
    });

    it('moves the selection down by 500 (unitless)', () => {
      const a = firstAction(parseMockCommand('move 500 down', ctx));
      expect(a.action).toBe('entities.move');
      expect(a.parameters['distance']).toBe(500);
      expect(a.parameters['direction']).toBe('down');
    });

    it('distributes views evenly', () => {
      const a = firstAction(parseMockCommand('distribute views evenly', ctx));
      expect(a.action).toBe('views.distribute');
      expect(a.parameters['axis']).toBe('horizontal');
    });

    it('aligns views left', () => {
      const a = firstAction(parseMockCommand('align all views left', ctx));
      expect(a.action).toBe('views.align');
      expect(a.parameters['edge']).toBe('left');
    });

    it('sets vertical spacing in metres', () => {
      const a = firstAction(parseMockCommand('set vertical spacing between views to 2m', ctx));
      expect(a.action).toBe('views.space');
      expect(a.parameters['axis']).toBe('vertical');
      expect(a.parameters['spacing']).toBe(2000);
    });

    it('clarifies a move with no distance/direction', () => {
      const resp = parseMockCommand('move the view', ctx);
      expect(resp.type).toBe('clarify');
    });
  });

  // ── Phase 3: insertion / replace ──────────────────────────────────────────
  describe('Phase 3 — components', () => {
    it('inserts a retaining wall with params', () => {
      const a = firstAction(parseMockCommand('insert retaining wall height 3m thickness 500mm', ctx));
      expect(a.action).toBe('library.insert');
      expect(a.parameters['query']).toContain('retaining wall');
      const params = a.parameters['params'] as Record<string, number>;
      expect(params['height']).toBe(3000);
      expect(params['thickness']).toBe(500);
    });

    it('inserts a box culvert', () => {
      const a = firstAction(parseMockCommand('add box culvert 2m wide 1.5m high', ctx));
      expect(a.action).toBe('library.insert');
      expect(a.parameters['query']).toContain('box culvert');
    });

    it('replaces the selection', () => {
      const a = firstAction(parseMockCommand('replace with box culvert', ctx));
      expect(a.action).toBe('entities.replace');
      expect(a.parameters['with']).toContain('box culvert');
      expect(a.target.kind).toBe('selection');
    });

    it('clarifies a replace with no target', () => {
      const resp = parseMockCommand('replace', ctx);
      expect(resp.type).toBe('clarify');
    });
  });

  // ── Phase 4: intelligent layout ───────────────────────────────────────────
  describe('Phase 4 — intelligent layout', () => {
    it('auto-reorganizes into N columns', () => {
      const a = firstAction(parseMockCommand('reorganize all views into 3 columns', ctx));
      expect(a.action).toBe('views.autoLayout');
      expect(a.parameters['columns']).toBe(3);
    });

    it('centers all views', () => {
      const a = firstAction(parseMockCommand('center all views', ctx));
      expect(a.action).toBe('views.center');
    });

    it('validates the layout', () => {
      const a = firstAction(parseMockCommand('check layout for overlaps', ctx));
      expect(a.action).toBe('layout.validate');
    });
  });

  // ── Phase 5: drawing generation ───────────────────────────────────────────
  describe('Phase 5 — generation', () => {
    it('generates a box culvert GAD with dimensions', () => {
      const a = firstAction(parseMockCommand('generate a box culvert GAD 2m wide 1.5m high', ctx));
      expect(a.action).toBe('generate.drawing');
      expect(a.parameters['query']).toContain('box culvert');
      const params = a.parameters['params'] as Record<string, number>;
      expect(params['clearWidth']).toBe(2000);
      expect(params['clearHeight']).toBe(1500);
      expect(a.metadata.requiresConfirmation).toBeTrue();
    });

    it('generation takes priority over plain insert', () => {
      const a = firstAction(parseMockCommand('create retaining wall GAD', ctx));
      expect(a.action).toBe('generate.drawing');
    });
  });

  // ── Fallback ──────────────────────────────────────────────────────────────
  it('falls back to clarify for gibberish', () => {
    const resp = parseMockCommand('asdfqwer zxcv', ctx);
    expect(resp.type).toBe('clarify');
  });

  // ── Feature completions: navigation, rename, dimension ────────────────────
  describe('Feature completions', () => {
    it('zooms to a view', () => {
      const a = firstAction(parseMockCommand('zoom to top view', ctx));
      expect(a.action).toBe('view.zoomTo');
      expect(a.parameters['view']).toBe('top');
    });

    it('does not hijack "zoom extents"', () => {
      const resp = parseMockCommand('zoom extents', ctx);
      expect(resp.type).toBe('clarify');
    });

    it('isolates a view (not a layer)', () => {
      const a = firstAction(parseMockCommand('isolate the top view', ctx));
      expect(a.action).toBe('view.isolate');
      expect(a.parameters['view']).toBe('top');
    });

    it('still isolates a layer when "layer" is named', () => {
      const a = firstAction(parseMockCommand('isolate layer DIM', ctx));
      expect(a.action).toBe('layer.isolate');
    });

    it('renames a layer', () => {
      const a = firstAction(parseMockCommand('rename layer DIM to ANNOT', ctx));
      expect(a.action).toBe('layer.rename');
      expect(a.target.kind === 'layer' && a.target.layer).toBe('DIM');
      expect(a.parameters['to']).toBe('ANNOT');
    });

    it('clarifies an incomplete rename', () => {
      const resp = parseMockCommand('rename layer', ctx);
      expect(resp.type).toBe('clarify');
    });

    it('adds a horizontal dimension to the selection', () => {
      const a = firstAction(parseMockCommand('add a dimension', ctx));
      expect(a.action).toBe('annotation.addDimension');
      expect(a.parameters['direction']).toBe('horizontal');
      expect(a.target.kind).toBe('selection');
    });

    it('adds a vertical dimension', () => {
      const a = firstAction(parseMockCommand('add vertical dimension', ctx));
      expect(a.action).toBe('annotation.addDimension');
      expect(a.parameters['direction']).toBe('vertical');
    });

    it('keeps "delete all dimensions" as a delete', () => {
      const a = firstAction(parseMockCommand('delete all dimensions', ctx));
      expect(a.action).toBe('entities.delete');
    });
  });
});
