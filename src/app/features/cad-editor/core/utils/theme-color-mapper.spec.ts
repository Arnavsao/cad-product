import {
  canvasIsLight,
  displayColor,
  getPaintSurface,
  mapColorForDisplay,
  setPaintSurface,
  withPaintSurface,
} from './theme-color-mapper';

describe('theme-color-mapper', () => {
  afterEach(() => setPaintSurface(null));

  describe('mapColorForDisplay', () => {
    it('swaps stored white to black on a light surface and keeps it on a dark one', () => {
      expect(mapColorForDisplay('#ffffff', { lightCanvas: true })).toBe('#000000');
      expect(mapColorForDisplay('#FFF',    { lightCanvas: true })).toBe('#000000');
      expect(mapColorForDisplay('#ffffff', { lightCanvas: false })).toBe('#ffffff');
    });

    it('maps stored black to the contrasting default as well', () => {
      expect(mapColorForDisplay('#000000', { lightCanvas: false })).toBe('#ffffff');
      expect(mapColorForDisplay('#000',    { lightCanvas: true })).toBe('#000000');
    });

    it('passes every other colour through untouched', () => {
      expect(mapColorForDisplay('#00ffff', { lightCanvas: true })).toBe('#00ffff');
      expect(mapColorForDisplay('#ff0000', { lightCanvas: false })).toBe('#ff0000');
    });
  });

  describe('paint-surface override', () => {
    it('follows the theme when no override is set', () => {
      expect(getPaintSurface()).toBeNull();
    });

    it('forces a light surface while a layout sheet is painted', () => {
      setPaintSurface('light');
      expect(canvasIsLight()).toBeTrue();
      // Stored white (ACI 7 default) must become black on the white paper.
      expect(displayColor('#ffffff')).toBe('#000000');
    });

    it('can force a dark surface too', () => {
      setPaintSurface('dark');
      expect(canvasIsLight()).toBeFalse();
      expect(displayColor('#000000')).toBe('#ffffff');
    });

    it('print mode still wins over the override', () => {
      setPaintSurface('dark');
      expect(canvasIsLight({ isPrintMode: true })).toBeTrue();
    });

    it('withPaintSurface restores the previous override, including on throw', () => {
      setPaintSurface('dark');
      const result = withPaintSurface('light', () => canvasIsLight());
      expect(result).toBeTrue();
      expect(getPaintSurface()).toBe('dark');

      expect(() => withPaintSurface('light', () => { throw new Error('boom'); })).toThrowError('boom');
      expect(getPaintSurface()).toBe('dark');
    });
  });
});
