import { DraftingCanvasContext } from './DraftingCanvasContext';
import { IDraftingEntity } from '../interfaces/entities';

export interface DualOutputResult {
    dxfLines: string[];
    draftingEntities: ReadonlyArray<IDraftingEntity>;
}

/**
 * A proxy class that implements the Canvas interface and broadcasts all operations
 * to both the legacy DxfMockContext and the new DraftingCanvasContext simultaneously.
 * This satisfies the Strangler Fig migration pattern by executing both engines in parallel.
 */
export class CanvasMultiplexer {
    constructor(public readonly legacyCtx: any, public readonly draftCtx: DraftingCanvasContext) { }

    // --- Standard Canvas Properties ---
    get strokeStyle(): string { return this.draftCtx.strokeStyle; }
    set strokeStyle(v: string) { this.legacyCtx.strokeStyle = v; this.draftCtx.strokeStyle = v; }

    get fillStyle(): string { return this.draftCtx.fillStyle; }
    set fillStyle(v: string) { this.legacyCtx.fillStyle = v; this.draftCtx.fillStyle = v; }

    get lineWidth(): number { return this.draftCtx.lineWidth; }
    set lineWidth(v: number) { this.legacyCtx.lineWidth = v; this.draftCtx.lineWidth = v; }

    get font(): string { return this.draftCtx.font; }
    set font(v: string) { this.legacyCtx.font = v; this.draftCtx.font = v; }

    get textAlign(): string { return this.draftCtx.textAlign; }
    set textAlign(v: string) { this.legacyCtx.textAlign = v; this.draftCtx.textAlign = v; }

    get textBaseline(): string { return this.draftCtx.textBaseline; }
    set textBaseline(v: string) { this.legacyCtx.textBaseline = v; this.draftCtx.textBaseline = v; }

    get globalAlpha(): number { return this.draftCtx.globalAlpha; }
    set globalAlpha(v: number) { this.legacyCtx.globalAlpha = v; this.draftCtx.globalAlpha = v; }

    // --- Legacy Bespoke Properties (Specific to DxfMockContext) ---
    get isDXF(): boolean { return this.legacyCtx.isDXF; }
    set isDXF(v: boolean) { this.legacyCtx.isDXF = v; }

    get skipHatch(): boolean { return this.legacyCtx.skipHatch; }
    set skipHatch(v: boolean) { this.legacyCtx.skipHatch = v; }

    get skipOverlapCheck(): boolean { return this.legacyCtx.skipOverlapCheck; }
    set skipOverlapCheck(v: boolean) { this.legacyCtx.skipOverlapCheck = v; }

    get viewKey(): string { return this.legacyCtx.viewKey; }
    set viewKey(v: string) {
        this.legacyCtx.viewKey = v;
        if (v !== 'plan' || !this.draftCtx.viewKey) {
            this.draftCtx.viewKey = v;
        }
    }

    get viewScaleFactor(): number { return this.draftCtx.viewScaleFactor; }
    set viewScaleFactor(v: number) { this.draftCtx.viewScaleFactor = v; }

    get draftingContext(): DraftingCanvasContext { return this.draftCtx; }

    get drawingColor(): string { return (this.draftCtx as any).drawingColor; }
    set drawingColor(v: string) {
        (this.legacyCtx as any).drawingColor = v;
        (this.draftCtx as any).drawingColor = v;
    }

    get textScale(): number { return this.legacyCtx.textScale; }
    set textScale(v: number) { this.legacyCtx.textScale = v; }

    get currentLayer(): string { return this.legacyCtx.currentLayer; }
    set currentLayer(v: string) { this.legacyCtx.currentLayer = v; }

    get isCombinedDXF(): boolean { return this.legacyCtx.isCombinedDXF; }
    set isCombinedDXF(v: boolean) { this.legacyCtx.isCombinedDXF = v; }

    get lines(): string[] { return this.legacyCtx.lines; }

    get exclusionBoundaryX(): number | undefined { return this.draftCtx.exclusionBoundaryX; }
    set exclusionBoundaryX(v: number | undefined) {
        if (this.legacyCtx) this.legacyCtx.exclusionBoundaryX = v;
        this.draftCtx.exclusionBoundaryX = v;
    }

    get exclusionKeepRight(): boolean | undefined { return this.draftCtx.exclusionKeepRight; }
    set exclusionKeepRight(v: boolean | undefined) {
        if (this.legacyCtx) this.legacyCtx.exclusionKeepRight = v;
        this.draftCtx.exclusionKeepRight = v;
    }

    // --- State Management ---
    save() { this.legacyCtx.save(); this.draftCtx.save(); }
    restore() { this.legacyCtx.restore(); this.draftCtx.restore(); }
    translate(x: number, y: number) { this.legacyCtx.translate(x, y); this.draftCtx.translate(x, y); }
    rotate(a: number) { this.legacyCtx.rotate(a); this.draftCtx.rotate(a); }
    scale(x: number, y: number) { this.legacyCtx.scale(x, y); this.draftCtx.scale(x, y); }
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        this.legacyCtx.setTransform(a, b, c, d, e, f);
        this.draftCtx.setTransform(a, b, c, d, e, f);
    }
    resetTransform() {
        if (typeof this.legacyCtx.resetTransform === 'function') this.legacyCtx.resetTransform();
        if (typeof this.draftCtx.resetTransform === 'function') this.draftCtx.resetTransform();
    }
    setLineDash(segments: number[]) {
        if (typeof this.legacyCtx.setLineDash === 'function') this.legacyCtx.setLineDash(segments);
        if (typeof this.draftCtx.setLineDash === 'function') this.draftCtx.setLineDash(segments);
    }

    // --- Paths ---
    beginPath() { this.legacyCtx.beginPath(); this.draftCtx.beginPath(); }
    moveTo(x: number, y: number) { this.legacyCtx.moveTo(x, y); this.draftCtx.moveTo(x, y); }
    lineTo(x: number, y: number) { this.legacyCtx.lineTo(x, y); this.draftCtx.lineTo(x, y); }
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
        if (typeof this.legacyCtx.arcTo === 'function') this.legacyCtx.arcTo(x1, y1, x2, y2, radius);
        if (typeof (this.draftCtx as any).arcTo === 'function') (this.draftCtx as any).arcTo(x1, y1, x2, y2, radius);
    }
    arc(x: number, y: number, r: number, sa: number, ea: number, ccw: boolean = false) {
        this.legacyCtx.arc(x, y, r, sa, ea, ccw);
        this.draftCtx.arc(x, y, r, sa, ea, ccw);
    }
    ellipse(x: number, y: number, rx: number, ry: number, rotation: number, sa: number, ea: number, ccw: boolean = false) {
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        if (typeof this.legacyCtx.ellipse === 'function') {
            this.legacyCtx.ellipse(x, y, rx, ry, rotation, sa, ea, ccw);
        }
        if (typeof (this.draftCtx as any).ellipse === 'function') {
            (this.draftCtx as any).ellipse(x, y, rx, ry, rotation, sa, ea, ccw);
        }
    }
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
        if (typeof this.legacyCtx.quadraticCurveTo === 'function') {
            this.legacyCtx.quadraticCurveTo(cpx, cpy, x, y);
        }
        if (typeof (this.draftCtx as any).quadraticCurveTo === 'function') {
            (this.draftCtx as any).quadraticCurveTo(cpx, cpy, x, y);
        }
    }
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        if (typeof this.legacyCtx.bezierCurveTo === 'function') {
            this.legacyCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        }
        if (typeof (this.draftCtx as any).bezierCurveTo === 'function') {
            (this.draftCtx as any).bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        }
    }

    get lineDashOffset() { return this.legacyCtx.lineDashOffset; }
    set lineDashOffset(value) {
        this.legacyCtx.lineDashOffset = value;
        if (typeof (this.draftCtx as any).lineDashOffset !== 'undefined') {
            (this.draftCtx as any).lineDashOffset = value;
        }
    }

    setHighlightBoundary(x: number, side: 'left' | 'right', dash: number[], color?: string) {
        if (typeof (this.legacyCtx as any).setHighlightBoundary === 'function') (this.legacyCtx as any).setHighlightBoundary(x, side, dash, color);
        if (typeof (this.draftCtx as any).setHighlightBoundary === 'function') (this.draftCtx as any).setHighlightBoundary(x, side, dash, color);
    }

    clearHighlightBoundary() {
        if (typeof (this.legacyCtx as any).clearHighlightBoundary === 'function') (this.legacyCtx as any).clearHighlightBoundary();
        if (typeof (this.draftCtx as any).clearHighlightBoundary === 'function') (this.draftCtx as any).clearHighlightBoundary();
    }

    rect(x: number, y: number, w: number, h: number) { this.legacyCtx.rect(x, y, w, h); this.draftCtx.rect(x, y, w, h); }
    roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0) {
        this.legacyCtx.roundRect(x, y, w, h, radii);
        this.draftCtx.roundRect(x, y, w, h, radii);
    }
    closePath() { this.legacyCtx.closePath(); this.draftCtx.closePath(); }
    clip() { this.legacyCtx.clip(); this.draftCtx.clip(); }

    // --- Execution ---
    stroke() { this.legacyCtx.stroke(); this.draftCtx.stroke(); }
    fill() { this.legacyCtx.fill(); this.draftCtx.fill(); }
    fillRect(x: number, y: number, w: number, h: number) { this.legacyCtx.fillRect(x, y, w, h); this.draftCtx.fillRect(x, y, w, h); }
    strokeRect(x: number, y: number, w: number, h: number) { this.legacyCtx.strokeRect(x, y, w, h); this.draftCtx.strokeRect(x, y, w, h); }
    fillText(t: string, x: number, y: number) { this.legacyCtx.fillText(t, x, y); this.draftCtx.fillText(t, x, y); }
    fillTextMultiline(t: string, x: number, y: number, lineHeight: number) {
        // Draw to legacy Canvas line by line so it looks correct in the UI
        const lines = t.split('\n');

        let startY = 0;
        const base = this.legacyCtx.textBaseline;
        if (base === 'top') {
            startY = 0; // First line is at y
        } else if (base === 'bottom') {
            startY = (lines.length - 1) * lineHeight; // First line is drawn ABOVE y
        } else {
            startY = (lines.length - 1) * lineHeight / 2; // Middle
        }

        // To draw the next line BELOW the first line, we must subtract lineHeight!
        lines.forEach((line, i) => {
            this.legacyCtx.fillText(line, x, y + startY - i * lineHeight);
        });

        if (typeof (this.draftCtx as any).fillTextMultiline === 'function') {
            (this.draftCtx as any).fillTextMultiline(t, x, y, lineHeight);
        } else {
            // Pass the raw string with \n to drafting context, which backend converts to single MTEXT
            this.draftCtx.fillText(t, x, y);
        }
    }
    measureText(t: string): any {
        if (typeof this.legacyCtx.measureText === 'function') return this.legacyCtx.measureText(t);
        if (typeof this.draftCtx.measureText === 'function') return this.draftCtx.measureText(t);
        return { width: t.length * 6 }; // fallback
    }

    // --- Legacy Monolith Dummies ---
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
        let grad: any = null;
        if (typeof this.legacyCtx.createLinearGradient === 'function') {
            grad = this.legacyCtx.createLinearGradient(x0, y0, x1, y1);
        } else {
            grad = { addColorStop: function () { } };
        }

        if (grad && !grad.__dxfGradient) {
            grad.__dxfGradient = { x0, y0, x1, y1, stops: [] };

            const originalAddColorStop = grad.addColorStop.bind(grad);
            grad.addColorStop = (offset: number, color: string) => {
                grad.__dxfGradient.stops.push({ offset, color });
                grad.__dxfGradient.stops.sort((a: any, b: any) => a.offset - b.offset);
                if (typeof this.legacyCtx.createLinearGradient === 'function') {
                    originalAddColorStop(offset, color);
                }
            };
        }
        return grad;
    }

    beginExclusionMask() {
        if (typeof this.legacyCtx.beginExclusionMask === 'function') this.legacyCtx.beginExclusionMask();
        if (typeof (this.draftCtx as any).beginExclusionMask === 'function') (this.draftCtx as any).beginExclusionMask();
    }
    endExclusionMask() {
        if (typeof this.legacyCtx.endExclusionMask === 'function') this.legacyCtx.endExclusionMask();
        if (typeof (this.draftCtx as any).endExclusionMask === 'function') (this.draftCtx as any).endExclusionMask();
    }
    clearExclusionMask() {
        if (typeof this.legacyCtx.clearExclusionMask === 'function') this.legacyCtx.clearExclusionMask();
        if (typeof (this.draftCtx as any).clearExclusionMask === 'function') (this.draftCtx as any).clearExclusionMask();
    }
    addExclusionRect(x: number, y: number, w: number, h: number) {
        if (typeof this.legacyCtx.addExclusionRect === 'function') this.legacyCtx.addExclusionRect(x, y, w, h);
        if (typeof (this.draftCtx as any).addExclusionRect === 'function') (this.draftCtx as any).addExclusionRect(x, y, w, h);
    }

    // --- Hatch Semantic Engine ---
    beginSemanticHatch(patternName: string, scale?: number) {
        if (typeof (this.draftCtx as any).beginSemanticHatch === 'function') {
            (this.draftCtx as any).beginSemanticHatch(patternName, scale);
        }
        if (typeof (this.legacyCtx as any).beginSemanticHatch === 'function') {
            (this.legacyCtx as any).beginSemanticHatch(patternName, scale);
        }
    }
    endSemanticHatch() {
        if (typeof (this.draftCtx as any).endSemanticHatch === 'function') {
            (this.draftCtx as any).endSemanticHatch();
        }
        if (typeof (this.legacyCtx as any).endSemanticHatch === 'function') {
            (this.legacyCtx as any).endSemanticHatch();
        }
    }

    // --- Output Extraction ---
    getDxfLines(): string[] { return this.legacyCtx.lines || []; }
    getDraftingEntities(): ReadonlyArray<IDraftingEntity> { return this.draftCtx.entities; }

    // --- Semantic Extensibility ---
    addHatch(points: { x: number, y: number }[], patternName: string, scale?: number, angle?: number) {
        if (typeof this.legacyCtx.addHatch === 'function') {
            this.legacyCtx.addHatch(points, patternName, scale, angle);
        }
        if (typeof (this.draftCtx as any).addHatch === 'function') {
            (this.draftCtx as any).addHatch(points, patternName, scale, angle);
        }
    }
    addLeader(points: { x: number, y: number }[], color: any, hasArrow: boolean = true, text: string = '', arrowSize: number = 1.0) {
        if (typeof this.legacyCtx.addLeader === 'function') {
            this.legacyCtx.addLeader(points, color, hasArrow, text, arrowSize);
        }
        if (typeof (this.draftCtx as any).beginSemanticLeader === 'function') {
            (this.draftCtx as any).beginSemanticLeader(points, text);
            (this.draftCtx as any).endSemanticLeader();
        }
    }
    dimension(x1: number, y1: number, x2: number, y2: number, textX: number, textY: number, text: string): void {
        if (typeof (this.draftCtx as any).dimension === 'function') {
            (this.draftCtx as any).dimension(x1, y1, x2, y2, textX, textY, text);
        }
    }

    addMTextDirect(text: string, x: number, y: number, fontSize: number): void {
        if (typeof (this.legacyCtx as any).addMTextDirect === 'function') {
            (this.legacyCtx as any).addMTextDirect(text, x, y, fontSize);
        }
        if (typeof (this.draftCtx as any).addMTextDirect === 'function') {
            (this.draftCtx as any).addMTextDirect(text, x, y, fontSize);
        }
    }

    /**
     * aagentoDimension — fully associative native AutoCAD dimension.
     * text='' is passed to AutoCAD so it measures the geometry itself.
     * realValueMm is used by the backend to rescale the geometry so the
     * measured distance matches the displayed UI value.
     *
     * drawingScale is read automatically from DXF_TEXT_SCALE_FACTOR (set per-view
     * from st.scaleText). Arrow size = 2.5 × drawingScale. Text = 200 DXF units.
     * No per-view wiring needed — all views get correct sizes automatically.
     */
    aagentoDimension(
        x1: number, y1: number,
        x2: number, y2: number,
        textX: number, textY: number,
        realValueMm: number,
        dimType: 'LINEAR' | 'ALIGNED' = 'LINEAR',
        isVert: boolean = false
    ): void {
        if (typeof (this.draftCtx as any).aagentoDimension === 'function') {
            // Read the drawing scale set by the view (e.g. 100 for 1:100, 25 for 1:25)
            const drawingScale: number = (this.legacyCtx as any).DXF_TEXT_SCALE_FACTOR ?? 100;
            (this.draftCtx as any).aagentoDimension(x1, y1, x2, y2, textX, textY, realValueMm, dimType, isVert, drawingScale);
        }
    }

    beginSemanticDimension(x1: number, y1: number, x2: number, y2: number, textX: number, textY: number, text: string, type: string = 'ALIGNED', isVert: boolean = false): void {
        if (typeof (this.draftCtx as any).beginSemanticDimension === 'function') {
            (this.draftCtx as any).beginSemanticDimension(x1, y1, x2, y2, textX, textY, text, type, isVert);
        }
    }

    endSemanticDimension(): void {
        if (typeof (this.draftCtx as any).endSemanticDimension === 'function') {
            (this.draftCtx as any).endSemanticDimension();
        }
    }

    beginSemanticLeader(points: { x: number, y: number }[], text: string): void {
        if (typeof (this.draftCtx as any).beginSemanticLeader === 'function') {
            (this.draftCtx as any).beginSemanticLeader(points, text);
        }
    }

    endSemanticLeader(): void {
        if (typeof (this.draftCtx as any).endSemanticLeader === 'function') {
            (this.draftCtx as any).endSemanticLeader();
        }
    }

    beginBlock(name: string, baseX: number, baseY: number, scale: number = 1.0, rotation: number = 0): void {
        if (typeof (this.draftCtx as any).beginBlock === 'function') {
            (this.draftCtx as any).beginBlock(name, baseX, baseY, scale, rotation);
        }
    }

    endBlock(): void {
        if (typeof (this.draftCtx as any).endBlock === 'function') {
            (this.draftCtx as any).endBlock();
        }
    }
}
