import { findDrawingTemplate, DRAWING_TEMPLATES } from './drawing-template.model';

describe('findDrawingTemplate', () => {
  it('matches an exact GAD keyword', () => {
    const t = findDrawingTemplate('box culvert GAD');
    expect(t?.id).toBe('box-culvert-gad');
  });

  it('is case-insensitive', () => {
    expect(findDrawingTemplate('BOX CULVERT GAD')?.id).toBe('box-culvert-gad');
  });

  it('matches the retaining wall template', () => {
    expect(findDrawingTemplate('retaining wall drawing')?.id).toBe('retaining-wall-gad');
  });

  it('matches drainage layout', () => {
    expect(findDrawingTemplate('drainage layout')?.id).toBe('drainage-gad');
  });

  it('matches a noisier phrase via token overlap', () => {
    const t = findDrawingTemplate('please make me a drainage gad sheet');
    expect(t?.id).toBe('drainage-gad');
  });

  it('returns null for an unknown drawing', () => {
    expect(findDrawingTemplate('spaceship blueprint')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(findDrawingTemplate('')).toBeNull();
    expect(findDrawingTemplate('   ')).toBeNull();
  });

  it('every template references valid sub-views with grid slots', () => {
    for (const tpl of DRAWING_TEMPLATES) {
      expect(tpl.subViews.length).toBeGreaterThan(0);
      for (const sv of tpl.subViews) {
        expect(sv.familyId).toBeTruthy();
        expect(sv.col).toBeGreaterThanOrEqual(0);
        expect(sv.row).toBeGreaterThanOrEqual(0);
        expect(sv.title.length).toBeGreaterThan(0);
      }
      expect(tpl.gutter).toBeGreaterThan(0);
    }
  });
});
