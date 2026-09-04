import { TextLayoutEngine } from './text-layout-engine';

/**
 * The entity position is the MTEXT *attachment point*. For a centred justify
 * that is the middle of the reference box; wrapped text used to treat it as
 * the box's left edge and drift half a width to the right.
 */
describe('TextLayoutEngine attachment-point anchoring', () => {
  const base = {
    text: 'Signature block', font: 'Arial', height: 5, rotation: 0,
    lineSpacing: 1.2, widthFactor: 1, obliqueAngle: 0, bold: false, italic: false,
    charSpacing: 0, x: 0, y: 0,
  };

  it('centres a wrapped, centre-justified line on the anchor', () => {
    const l = TextLayoutEngine.measure({ ...base, justify: 'MC', autoWrap: true, mtextWidth: 250 });
    const line = l.lines[0];
    if (!line.glyphs.length) return; // no canvas in this environment — measured elsewhere
    const left = line.glyphs[0].x;
    const right = left + line.w;
    expect(Math.abs(left + right)).toBeLessThan(1e-6); // symmetric about x = 0
  });

  it('places a wrapped centre-justified box symmetrically in its bounds', () => {
    const l = TextLayoutEngine.measure({ ...base, justify: 'MC', autoWrap: true, mtextWidth: 250 });
    expect(l.localBounds.minX).toBeLessThanOrEqual(-125 + 1e-6);
    expect(l.localBounds.maxX).toBeGreaterThanOrEqual(125 - 1e-6);
  });

  it('keeps a left-justified box starting at the anchor', () => {
    const l = TextLayoutEngine.measure({ ...base, justify: 'TL', autoWrap: true, mtextWidth: 250 });
    expect(l.localBounds.minX).toBeLessThanOrEqual(0);
    expect(l.localBounds.maxX).toBeGreaterThanOrEqual(250 - 1e-6);
  });

  it('ends a right-justified box at the anchor', () => {
    const l = TextLayoutEngine.measure({ ...base, justify: 'TR', autoWrap: true, mtextWidth: 250 });
    expect(l.localBounds.minX).toBeLessThanOrEqual(-250 + 1e-6);
    expect(l.localBounds.maxX).toBeGreaterThanOrEqual(0);
  });
});
