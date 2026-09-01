import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { CadContextService } from './cad-context.service';
import { DocumentService } from '../../../core/services/document.service';
import { LineEntity, CircleEntity } from '../../../core/models/entity.model';

describe('CadContextService', () => {
  let ctx: CadContextService;
  let doc: DocumentService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    ctx = TestBed.inject(CadContextService);
    doc = TestBed.inject(DocumentService);
    doc.clear();
  });

  it('builds a snapshot with the required shape', () => {
    const snap = ctx.build();
    expect(snap.schemaVersion).toBe(1);
    expect(snap.summary).toBeDefined();
    expect(snap.layers.length).toBeGreaterThan(0);
    expect(Array.isArray(snap.views)).toBeTrue();
    expect(snap.selection.count).toBe(0);
  });

  it('summarises entities by type', () => {
    doc.addEntity(new LineEntity(0, 0, 10, 0));
    doc.addEntity(new LineEntity(0, 5, 10, 5));
    doc.addEntity(new CircleEntity(5, 5, 2));
    doc.bump();

    const snap = ctx.build();
    expect(snap.summary.entityCount).toBe(3);
    expect(snap.summary.byType['LINE']).toBe(2);
    expect(snap.summary.byType['CIRCLE']).toBe(1);
  });

  it('detects clustered geometry as a view', () => {
    // Two tight clusters far apart → two detected views.
    doc.addEntity(new LineEntity(0, 0, 10, 0));
    doc.addEntity(new LineEntity(0, 0, 0, 10));
    doc.addEntity(new LineEntity(100000, 0, 100010, 0));
    doc.addEntity(new LineEntity(100000, 0, 100000, 10));
    doc.bump();

    const snap = ctx.build();
    expect(snap.views.length).toBeGreaterThanOrEqual(2);
    for (const v of snap.views) {
      expect(v.entityCount).toBeGreaterThan(0);
      expect(v.bbox).toBeDefined();
    }
  });

  it('reflects the current selection', () => {
    const line = doc.addEntity(new LineEntity(0, 0, 10, 0));
    doc.setSelection([line]);
    doc.bump();

    const snap = ctx.build();
    expect(snap.selection.count).toBe(1);
    expect(snap.selection.ids).toContain(line.id);
  });
});
