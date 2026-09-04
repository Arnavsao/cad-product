import { FontResolverService } from './font-resolver.service';

/**
 * The STYLE table stores a font *file name*, not a CSS family. Returning the
 * filename produced `ctx.font = '12px times.ttf'`, an unparseable shorthand
 * that the canvas ignores outright — leaving text in whatever font happened to
 * be set last, and poisoning the layout cache with those metrics.
 */
describe('FontResolverService.resolve', () => {
  const FILENAME = /\.(ttf|ttc|otf|shx|fon)/i;

  it('maps TrueType file names to a real family', () => {
    expect(FontResolverService.resolve('arial.ttf')).toContain('Arial');
    expect(FontResolverService.resolve('times.ttf')).toContain('Times New Roman');
    expect(FontResolverService.resolve('ARIALN.TTF')).toContain('Arial Narrow');
    // AutoCAD's bundled Romantic is a roman serif, not a script face.
    expect(FontResolverService.resolve('romantic.ttf')).toContain('serif');
    expect(FontResolverService.resolve('romantic.ttf')).not.toContain('cursive');
  });

  it('is case-insensitive about the extension', () => {
    expect(FontResolverService.resolve('Times.TTF'))
      .toBe(FontResolverService.resolve('times.ttf'));
  });

  it('still maps SHX names', () => {
    expect(FontResolverService.resolve('romans.shx')).toContain('sans-serif'); // Roman Simplex is a stroke sans
    expect(FontResolverService.resolve('romanc.shx')).toContain('Times New Roman');
    expect(FontResolverService.resolve('txt.shx')).toContain('monospace');
    expect(FontResolverService.resolve('isocp')).toContain('Arial');
  });

  it('strips the style flags an MTEXT \\f code carries', () => {
    expect(FontResolverService.resolve('Arial|b1|i0|c0|p34')).toContain('Arial');
  });

  it('infers a matching generic for an unmapped font file', () => {
    expect(FontResolverService.resolve('MinionPro.otf')).toContain('serif');
    expect(FontResolverService.resolve('courbd.ttf')).toContain('monospace');
  });

  it('quotes a multi-word family and gives it a fallback', () => {
    const r = FontResolverService.resolve('Times New Roman');
    expect(r).toContain('"Times New Roman"');
    expect(r).toContain('serif');
  });

  it('leaves an existing font stack alone', () => {
    const stack = 'Arial, Helvetica, sans-serif';
    expect(FontResolverService.resolve(stack)).toBe(stack);
  });

  it('falls back for empty input', () => {
    expect(FontResolverService.resolve(null)).toContain('sans-serif');
    expect(FontResolverService.resolve(undefined)).toContain('sans-serif');
    expect(FontResolverService.resolve('')).toContain('sans-serif');
  });

  it('never returns something ctx.font would reject', () => {
    const inputs = [
      'arial.ttf', 'times.ttf', 'ARIALN.TTF', 'romantic.ttf', 'romans.shx',
      'whatever.shx', 'Unknown.ttf', 'simsun.ttc', 'weird.fon',
      'Times New Roman', 'Arial', null, undefined, '', '   ',
    ];
    for (const input of inputs) {
      expect(FontResolverService.resolve(input)).not.toMatch(FILENAME);
    }
  });

  it('always ends in a CSS generic, so it resolves off Windows too', () => {
    const generics = /(sans-serif|serif|monospace|cursive)$/;
    for (const input of ['arial.ttf', 'romans.shx', 'gbcbig.shx', 'isocp.shx', null]) {
      expect(FontResolverService.resolve(input)).toMatch(generics);
    }
  });
});
