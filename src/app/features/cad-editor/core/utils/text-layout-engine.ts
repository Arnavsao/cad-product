import { splitTextLines } from './text-control-codes';
export interface IGlyphPosition {
  char: string;
  charIndex: number; // Index in the original string (including newlines)
  x: number;         // X coordinate in unrotated world space relative to insertion point
  w: number;         // Width in world space
}

export interface ITextLineLayout {
  text: string;
  startIndex: number; // Starting index in the original string
  y: number;          // Baseline Y coordinate in unrotated world space
  w: number;          // Total width of the line in world space
  h: number;          // Height of the line in world space
  glyphs: IGlyphPosition[];
}

export interface ITextLayout {
  lines: ITextLineLayout[];
  localBounds: { minX: number; minY: number; maxX: number; maxY: number };
  worldBounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// A global offscreen canvas for measuring text.
let _measureCanvas: HTMLCanvasElement | null = null;
let _measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!_measureCanvas) {
    if (typeof document !== 'undefined') {
      _measureCanvas = document.createElement('canvas');
      _measureCanvas.width = 10;
      _measureCanvas.height = 10;
      _measureCtx = _measureCanvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    }
  }
  return _measureCtx!;
}

export interface ITextLayoutOptions {
  autoWrap?: boolean;
  mtextWidth?: number;
  text: string;
  font: string;
  height: number;
  rotation: number;
  justify: string;       // e.g. 'TL', 'MC', 'BR'
  lineSpacing: number;   // e.g. 1.2
  widthFactor: number;   // DXF group 41
  obliqueAngle: number;  // DXF group 51
  bold: boolean;
  italic: boolean;
  charSpacing: number;
  x: number;
  y: number;
}

export class TextLayoutEngine {
  private static layoutCache = new Map<string, ITextLayout>();

  public static measure(opts: ITextLayoutOptions): ITextLayout {
    const key = JSON.stringify(opts);
    let cached = this.layoutCache.get(key);
    if (cached) return cached;

    // To measure accurately and avoid canvas bugs with tiny fonts, we measure at a large font size
    // and scale down.
    const MEASURE_SIZE = 100;
    const ctx = getMeasureCtx();
    
    // In node/tests, ctx might be null. Return fake layout.
    if (!ctx) {
      return {
        lines: [],
        localBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        worldBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }
      };
    }

    const style = opts.italic ? 'italic ' : '';
    const weight = opts.bold ? 'bold ' : '';
    ctx.font = `${style}${weight}${MEASURE_SIZE}px ${opts.font}`;

    // Compute the world scale factor.
    // The previous draw code used `height * (4/3)` as the pixel size.
    // We maintain that proportion in world space so bounds match visuals exactly.
    const worldHeight = opts.height * (4 / 3);
    const scale = worldHeight / MEASURE_SIZE;
    
    const wf = Math.abs(opts.widthFactor) || 1;
    const finalScaleX = scale * wf;

    const linesRaw = splitTextLines(opts.text || '');
    const lineDy = worldHeight * opts.lineSpacing;
    const horiz = (opts.justify[1] || 'L') as 'L' | 'C' | 'R';
    const vert = (opts.justify[0] || 'T') as 'T' | 'M' | 'B';

    // Build soft-wrapped lines
    interface IRawLine {
      text: string;
      startIndex: number;
      indentOffset: number;
    }
    const wrappedLines: IRawLine[] = [];
    let currentIndex = 0;

    for (let i = 0; i < linesRaw.length; i++) {
      const p = linesRaw[i];
      if (!opts.autoWrap || !(opts.mtextWidth! > 0) || p.length === 0) {
        wrappedLines.push({ text: p, startIndex: currentIndex, indentOffset: 0 });
        currentIndex += p.length + 1; // +1 for the newline char
        continue;
      }

      // Word wrapping logic
      let indentOffset = 0;
      const markerMatch = p.match(/^(\s*)([•\-\*]|\d+\.|[a-z]+\.|[A-Z]+\.)(\s+)/);
      if (markerMatch) {
        indentOffset = ctx.measureText(markerMatch[0]).width * finalScaleX + (markerMatch[0].length * opts.charSpacing);
      }

      let currentLineStartIdx = currentIndex;
      let currentLineText = '';
      let currentLineWidth = 0;
      let isFirstSegment = true;

      const tokens = p.match(/\S+|\s+/g) || [];
      
      for (const token of tokens) {
        const tokenWidth = ctx.measureText(token).width * finalScaleX + (token.length > 0 ? (token.length) * opts.charSpacing : 0);
        
        const maxW = isFirstSegment ? opts.mtextWidth! : opts.mtextWidth! - indentOffset;
        
        if (currentLineText.length > 0 && currentLineWidth + tokenWidth > maxW) {
          if (token.match(/^\s+$/)) {
            currentLineText += token;
            currentLineWidth += tokenWidth;
            continue;
          }
          
          wrappedLines.push({ text: currentLineText, startIndex: currentLineStartIdx, indentOffset: isFirstSegment ? 0 : indentOffset });
          currentLineStartIdx += currentLineText.length;
          currentLineText = token;
          currentLineWidth = tokenWidth;
          isFirstSegment = false;
        } else {
          currentLineText += token;
          currentLineWidth += tokenWidth;
        }
      }

      if (currentLineText.length > 0 || tokens.length === 0) {
        wrappedLines.push({ text: currentLineText, startIndex: currentLineStartIdx, indentOffset: isFirstSegment ? 0 : indentOffset });
      }
      
      currentIndex += p.length + 1;
    }

    const N = Math.max(1, wrappedLines.length);

    let blockY = 0;
    if (vert === 'T') blockY = 0;
    else if (vert === 'M') blockY = -((N - 1) * lineDy) / 2;
    else if (vert === 'B') blockY = -(N - 1) * lineDy;

    const lines: ITextLineLayout[] = [];
    let minLocalX = Infinity;
    let maxLocalX = -Infinity;
    let minLocalY = Infinity;
    let maxLocalY = -Infinity;

    for (let i = 0; i < N; i++) {
      const lineData = wrappedLines[i] || { text: '', startIndex: 0, indentOffset: 0 };
      const text = lineData.text;
      const lineY = blockY + i * lineDy; 
      
      let baselineY = lineY;
      if (vert === 'T') baselineY = lineY + worldHeight * 0.85; 
      else if (vert === 'M') baselineY = lineY + worldHeight * 0.35;
      else if (vert === 'B') baselineY = lineY - worldHeight * 0.15;
      else baselineY = lineY; 

      const glyphs: IGlyphPosition[] = [];
      let currentX = 0;

      let totalW = 0;
      if (text.length > 0) {
        totalW = ctx.measureText(text).width * finalScaleX;
        totalW += Math.max(0, text.length - 1) * opts.charSpacing;
      }

      // The entity's (x, y) is the *attachment point*, wrapped or not: for a
      // centred justify it is the middle of the reference box, for a right
      // justify its right edge. The wrapped case used to treat it as the box's
      // left edge instead, which pushed every centred MTEXT half a box-width to
      // the right — title-block cells overlapping their neighbours, a table
      // caption hanging off the table's right edge.
      let lineStartX = lineData.indentOffset;
      if (horiz === 'C') lineStartX += -totalW / 2 - (opts.autoWrap && opts.mtextWidth! > 0 ? lineData.indentOffset / 2 : 0);
      else if (horiz === 'R') lineStartX += -totalW - (opts.autoWrap && opts.mtextWidth! > 0 ? lineData.indentOffset : 0);

      for (let j = 0; j < text.length; j++) {
        const char = text[j];
        const w = ctx.measureText(char).width * finalScaleX;
        
        glyphs.push({
          char,
          charIndex: lineData.startIndex + j,
          x: lineStartX + currentX,
          w: w
        });
        currentX += w + opts.charSpacing;
      }

      const lineLayout: ITextLineLayout = {
        text,
        startIndex: lineData.startIndex,
        y: baselineY,
        w: totalW,
        h: worldHeight,
        glyphs
      };
      lines.push(lineLayout);

      const top = baselineY - worldHeight * 0.85;
      const bottom = baselineY + worldHeight * 0.15;
      const left = lineStartX;
      const right = lineStartX + totalW;

      if (left < minLocalX) minLocalX = left;
      if (right > maxLocalX) maxLocalX = right;
      if (top < minLocalY) minLocalY = top;
      if (bottom > maxLocalY) maxLocalY = bottom;
    }

    if (minLocalX === Infinity) {
      minLocalX = 0; maxLocalX = worldHeight * 0.1;
      minLocalY = 0; maxLocalY = worldHeight;
      if (horiz === 'C') { minLocalX = -worldHeight * 0.05; maxLocalX = worldHeight * 0.05; }
      else if (horiz === 'R') { minLocalX = -worldHeight * 0.1; maxLocalX = 0; }
      if (vert === 'T') { minLocalY = 0; maxLocalY = worldHeight; }
      else if (vert === 'M') { minLocalY = -worldHeight/2; maxLocalY = worldHeight/2; }
      else if (vert === 'B') { minLocalY = -worldHeight; maxLocalY = 0; }
    }

    if (opts.autoWrap && opts.mtextWidth! > 0) {
      // The reference box sits around the attachment point per the justify.
      const w = opts.mtextWidth!;
      const boxMin = horiz === 'C' ? -w / 2 : horiz === 'R' ? -w : 0;
      minLocalX = Math.min(minLocalX, boxMin);
      maxLocalX = Math.max(maxLocalX, boxMin + w);
    }

    const localBounds = { minX: minLocalX, minY: minLocalY, maxX: maxLocalX, maxY: maxLocalY };

    // Compute rotated world bounds
    const rCos = Math.cos(opts.rotation);
    const rSin = Math.sin(opts.rotation);

    const corners = [
      { x: minLocalX, y: minLocalY },
      { x: maxLocalX, y: minLocalY },
      { x: maxLocalX, y: maxLocalY },
      { x: minLocalX, y: maxLocalY }
    ];

    let wMinX = Infinity, wMaxX = -Infinity;
    let wMinY = Infinity, wMaxY = -Infinity;

    for (const c of corners) {
      // local Y is canvas-space (+Y is down). Convert to world-local (+Y is up) by negating c.y
      const localWorldY = -c.y;
      const wx = c.x * rCos - localWorldY * rSin + opts.x;
      const wy = c.x * rSin + localWorldY * rCos + opts.y;
      if (wx < wMinX) wMinX = wx;
      if (wx > wMaxX) wMaxX = wx;
      if (wy < wMinY) wMinY = wy;
      if (wy > wMaxY) wMaxY = wy;
    }

    const worldBounds = { minX: wMinX, minY: wMinY, maxX: wMaxX, maxY: wMaxY };

    const layout: ITextLayout = {
      lines,
      localBounds,
      worldBounds
    };

    if (this.layoutCache.size > 1000) this.layoutCache.clear();
    this.layoutCache.set(key, layout);

    return layout;
  }

  public static getCaretPosition(layout: ITextLayout, index: number): { x: number, y: number, h: number } {
    if (layout.lines.length === 0) return { x: 0, y: 0, h: 0 };
    
    // Find the line that contains this index
    for (let i = 0; i < layout.lines.length; i++) {
      const line = layout.lines[i];
      const nextLineStart = (i < layout.lines.length - 1) ? layout.lines[i+1].startIndex : Infinity;
      
      if (index >= line.startIndex && index < nextLineStart) {
        // Find exact glyph
        const glyphs = line.glyphs;
        let x = line.w > 0 ? line.glyphs[0]?.x ?? 0 : 0;
        
        // Empty line handling
        if (glyphs.length === 0) {
           return { x: layout.localBounds.minX, y: line.y - line.h * 0.85, h: line.h };
        }

        for (const g of glyphs) {
          if (index === g.charIndex) {
            x = g.x;
            break;
          }
          if (index > g.charIndex) {
            x = g.x + g.w;
          }
        }
        
        return { x, y: line.y - line.h * 0.85, h: line.h };
      }
    }
    
    // If beyond the end, attach to the end of the last line
    const lastLine = layout.lines[layout.lines.length - 1];
    let x = lastLine.glyphs.length > 0 ? lastLine.glyphs[lastLine.glyphs.length - 1].x + lastLine.glyphs[lastLine.glyphs.length - 1].w : 0;
    if (lastLine.w === 0) x = layout.localBounds.minX; // fallback for completely empty strings
    return { x, y: lastLine.y - lastLine.h * 0.85, h: lastLine.h };
  }

  public static getSelectionRects(layout: ITextLayout, startIdx: number, endIdx: number): { x: number, y: number, w: number, h: number }[] {
    if (startIdx === endIdx) return [];
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];

    const rects: { x: number, y: number, w: number, h: number }[] = [];

    for (const line of layout.lines) {
      const lineStartIdx = line.startIndex;
      const lineEndIdx = line.startIndex + line.text.length;

      if (startIdx <= lineEndIdx && endIdx >= lineStartIdx) {
        const sIdx = Math.max(startIdx, lineStartIdx);
        const eIdx = Math.min(endIdx, lineEndIdx);

        let selX = 0;
        let selW = 0;

        if (line.glyphs.length === 0) {
          // Empty line but selected (e.g. newline selected)
          if (endIdx > lineEndIdx) {
            rects.push({
              x: layout.localBounds.minX,
              y: line.y - line.h * 0.85,
              w: line.h * 0.3,
              h: line.h
            });
          }
          continue;
        }

        const startGlyph = line.glyphs.find(g => g.charIndex === sIdx);
        const endGlyph = line.glyphs.find(g => g.charIndex === eIdx);

        if (startGlyph) {
          selX = startGlyph.x;
        } else if (sIdx === lineEndIdx) {
           selX = line.glyphs[line.glyphs.length-1].x + line.glyphs[line.glyphs.length-1].w;
           selW = layout.lines[0].h * 0.3; 
        } else {
           selX = line.glyphs[0].x;
        }

        if (endGlyph) {
          selW = endGlyph.x - selX;
        } else {
          const lastG = line.glyphs[line.glyphs.length-1];
          selW = (lastG.x + lastG.w) - selX;
          if (endIdx > lineEndIdx) {
            selW += layout.lines[0].h * 0.3; // extend past line to indicate newline selection
          }
        }

        rects.push({
          x: selX,
          y: line.y - line.h * 0.85,
          w: selW,
          h: line.h
        });
      }
    }
    return rects;
  }

  public static getIndexFromLocalCoords(layout: ITextLayout, x: number, y: number): number {
    if (layout.lines.length === 0) return 0;

    let closestLine = layout.lines[0];
    let minDy = Infinity;

    for (const line of layout.lines) {
      const lineCenterY = line.y - line.h * 0.35; 
      const dy = Math.abs(y - lineCenterY);
      if (dy < minDy) {
        minDy = dy;
        closestLine = line;
      }
    }

    if (closestLine.glyphs.length === 0) {
      return closestLine.startIndex;
    }

    const firstG = closestLine.glyphs[0];
    const lastG = closestLine.glyphs[closestLine.glyphs.length - 1];

    if (x <= firstG.x + firstG.w / 2) return firstG.charIndex;
    if (x >= lastG.x + lastG.w / 2) return lastG.charIndex + 1;

    for (const g of closestLine.glyphs) {
      const mid = g.x + g.w / 2;
      if (x < mid) {
        return g.charIndex;
      }
    }

    return lastG.charIndex + 1;
  }
}
