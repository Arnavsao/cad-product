import { DxfOle2FrameHandler } from './dxf-extra-handlers';

/** Feeds a group list through a handler the way dxf-parser's scanner would. */
function scannerOver(groups: Array<[number, any]>) {
  let i = 0;
  return {
    next() { const g = groups[i++] ?? [0, 'EOF']; return { code: g[0], value: g[1] }; },
    isEOF() { return i > groups.length; },
    lastReadGroup: { code: 0, value: '' },
  };
}

/** A minimal but valid 1×1 24-bit BMP (58 bytes), as hex. */
function tinyBmpHex(): string {
  const bytes = [
    0x42, 0x4d, 58, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0,   // BITMAPFILEHEADER: 'BM', size 58, reserved, offbits 54
    40, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 24, 0,   // BITMAPINFOHEADER: 40, w 1, h 1, planes 1, bpp 24
    0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0xff, 0x00, 0x00, 0x00,                             // one blue pixel + row padding
  ];
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

describe('DxfOle2FrameHandler', () => {
  it('extracts the embedded BMP and both corners', () => {
    // OLE header noise in front, then the picture — as a pasted signature is stored.
    const noise = '0102030405060708090a0b0c0d0e0f4d42';  // includes a decoy "MB"
    const groups: Array<[number, any]> = [
      [8, 'TLBK'], [10, 775.9], [20, 55.15], [11, 784.4], [21, 50.7],
      [310, noise + tinyBmpHex().slice(0, 40)], [310, tinyBmpHex().slice(40)],
      [0, 'SEQEND'],
    ];
    const ent = new DxfOle2FrameHandler().parseEntity(scannerOver(groups), { code: 0, value: 'OLE2FRAME' });
    expect(ent.upperLeft).toEqual({ x: 775.9, y: 55.15 });
    expect(ent.lowerRight).toEqual({ x: 784.4, y: 50.7 });
    expect(typeof ent.bmpBase64).toBe('string');
    expect(atob(ent.bmpBase64).slice(0, 2)).toBe('BM');
    expect(atob(ent.bmpBase64).length).toBe(58);
  });

  it('leaves bmpBase64 unset when there is no picture', () => {
    const ent = new DxfOle2FrameHandler().parseEntity(
      scannerOver([[10, 0], [20, 0], [11, 1], [21, 1], [310, 'DEADBEEF'], [0, 'X']]),
      { code: 0, value: 'OLE2FRAME' },
    );
    expect(ent.bmpBase64).toBeUndefined();
  });
});
