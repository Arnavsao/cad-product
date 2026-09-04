import { decodeDxfBytes, dxfDecoderLabel, sniffDxfCodePage, sniffDxfVersion } from './dxf-text-decoder';

function bytesOf(s: string, cp1252 = false): ArrayBuffer {
  if (!cp1252) return new TextEncoder().encode(s).buffer as ArrayBuffer;
  // Encode as windows-1252 by hand: every char here is either ASCII or Latin-1.
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out.buffer;
}

const HEADER_1252 = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1018\n9\n$DWGCODEPAGE\n3\nANSI_1252\n0\nENDSEC\n';

describe('dxf-text-decoder', () => {
  it('reads the declared code page and version', () => {
    expect(sniffDxfCodePage(HEADER_1252)).toBe('ANSI_1252');
    expect(sniffDxfVersion(HEADER_1252)).toBe('AC1018');
  });

  it('maps a pre-R2007 ANSI code page to a decoder label', () => {
    expect(dxfDecoderLabel('ANSI_1252', 'AC1018')).toBe('windows-1252');
    expect(dxfDecoderLabel('ANSI_932', 'AC1015')).toBe('shift_jis');
  });

  it('treats R2007+ as UTF-8 whatever the header claims', () => {
    expect(dxfDecoderLabel('ANSI_1252', 'AC1021')).toBeNull();
    expect(dxfDecoderLabel('ANSI_1252', 'AC1032')).toBeNull();
  });

  it('decodes a 1252 file so a degree sign survives', () => {
    // 6°18'44" stored as byte 0xB0 used to arrive as U+FFFD.
    const text = decodeDxfBytes(bytesOf(HEADER_1252 + '1\n6°18\'44"\n', true));
    expect(text).toContain('6°18\'44"');
    expect(text).not.toContain('�');
  });

  it('prefers UTF-8 when the bytes are valid UTF-8, even if the header says 1252', () => {
    const text = decodeDxfBytes(bytesOf(HEADER_1252 + '1\nΔ 6°\n'));
    expect(text).toContain('Δ 6°');
  });

  it('decodes ASCII-only content identically either way', () => {
    expect(decodeDxfBytes(bytesOf('0\nSECTION\n'))).toBe('0\nSECTION\n');
  });
});
