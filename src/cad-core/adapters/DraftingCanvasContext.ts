import { DraftingLine, DraftingArc, DraftingText, DraftingHatch, TextAlignment, TextBaseline } from '../models/drafting';
import { resolveDxfTextHeight, isTitleText, isScaleSubtitle } from '../models/drafting/DxfTextSizeStandards';
import { IDraftingEntity } from '../interfaces/entities';
import { Point3D } from '../types';
import * as ClipperLib from 'clipper-lib';
import { LineTypeRegistry } from '../models/semantics/LineTypeRegistry';
import { CADLinearDimension, CADAngularDimension, CADRadiusDimension, CADDiameterDimension, CADOrdinateDimension, CADCallout, CADSpline, CADLeader, CADMLeader, CADMText } from '../models/semantics/entities/ExtendedEntities';
import { CADEllipse } from '../models/semantics/entities/CADEllipse';
import { CADDimension } from '../models/semantics/entities/CADDimension';
import { AagentoDimension } from '../models/semantics/entities/AagentoDimension';
import { CADInsert } from '../models/semantics/entities/CADInsert';
import { CADBlock } from '../models/semantics/entities/CADBlock';
import { EntityId } from '../types';
import { TopologyEngine } from '../recognition/TopologyEngine';
import { DrawingValidationEngine } from '../validation/DrawingValidationEngine';
import { ConstraintEngine, GeometricConstraint } from '../constraints/ConstraintEngine';
import { BlockLibrary } from '../library/BlockLibrary';
import { SpatialIndex } from '../spatial/SpatialIndex';
import { AutoCADCompatibilityEngine, CompatibilityReport } from '../validation/AutoCADCompatibilityEngine';
import { CADPolyline, CADPolylineVertex } from '../models/semantics/entities/CADPolyline';

/**
 * An adapter that acts exactly like CanvasRenderingContext2D for the legacy monolith, 
 * but instead of drawing pixels or dumping DXF strings, it intercepts the geometry
 * and instantiates immutable Concrete Drafting Models.
 */
export class DraftingCanvasContext {
    // Standard HTML5 Canvas API Properties
    public strokeStyle: string = '#000000';
    public fillStyle: string = '#000000';
    public lineWidth: number = 1;
    public font: string = '10px sans-serif';
    public textAlign: string = 'center';
    public textBaseline: string = 'middle';
    public globalAlpha: number = 1.0;

    // --- Data Storage ---
    private _entities: any[] = [];
    private _constraints: GeometricConstraint[] = [];
    private _spatialIndex = new SpatialIndex({ minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 });
    public get entities() { return this._entities; }
    public get constraints() { return this._constraints; }
    public get spatialIndex() { return this._spatialIndex; }

    // --- Internal State ---
    public viewKey: string = '';
    /** Drawing scale denominator (e.g. 100 for 1:100). Used for arrow sizing etc. */
    public viewScaleFactor: number = 100;

    // Affine Transform Matrix: [a c e]
    //                [b d f]
    //                [0 0 1]
    private matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    private stateStack: any[] = [];
    private blockRegistry: Set<string> = new Set();
    private activeBlock: { name: string, basePoint: { x: number, y: number, z: number }, entities: any[] } | null = null;
    private exclusionPaths: Point3D[][] = [];
    public exclusionBoundaryX?: number;
    public exclusionKeepRight?: boolean;
    public static readonly LAYER_MAP: Record<string, string> = {
        '#000000': '0',
        '#6B7280': 'A-DETL-PATT',
        '#9CA3AF': 'A-DETL-PATT',
        '#EF4444': 'S-REINF',
        '#3B82F6': 'S-DIM-TEXT',
        '#10B981': 'S-HIDDEN',
        '#8B5CF6': 'S-WATER',
        '#F59E0B': 'S-EARTH',
        'rgba(248, 113, 113, 0.4)': 'S-REINF-HATCH',
        'rgba(96, 165, 250, 0.4)': 'S-WATER-HATCH',
        'rgba(52, 211, 153, 0.4)': 'S-EARTH-HATCH',
        '#1F2937': 'S-TEXT',
        '#FFFFFF': '0'
    };

    private highlightBoundary: { x: number, side: 'left' | 'right', dash: number[], color?: string } | null = null;

    setHighlightBoundary(x: number, side: 'left' | 'right', dash: number[], color?: string): void {
        this.highlightBoundary = { x, side, dash, color };
    }

    clearHighlightBoundary(): void {
        this.highlightBoundary = null;
    }

    constructor() {
        this._entities = [];
        this.topologyEngine = new TopologyEngine();
    }

    public addConstraint(constraint: GeometricConstraint) {
        this._constraints.push(constraint);
    }

    getSerializedPayload(): any {
        // Run rigorous Drawing QA Validation
        const drawingIssues = DrawingValidationEngine.validate(this._entities);
        const constraintIssues = ConstraintEngine.validate(this._entities, this._constraints);

        const issues = [...drawingIssues, ...constraintIssues];
        const criticals = issues.filter(i => i.severity === 'CRITICAL');

        if (criticals.length > 0) {
            console.error('DXF EXPORT BLOCKED. Critical Geometry Errors:', criticals);
            throw new Error(`DXF Export blocked due to ${criticals.length} critical drawing errors.`);
        }

        if (issues.length > 0) {
            console.warn(`Drawing Validation Warnings (${issues.length}):`, issues);
        }

        // Run Rigorous AutoCAD Validation
        const acadReports = {
            r2010: AutoCADCompatibilityEngine.validate(this._entities, 'R2010'),
            r2013: AutoCADCompatibilityEngine.validate(this._entities, 'R2013'),
            r2018: AutoCADCompatibilityEngine.validate(this._entities, 'R2018'),
            r2024: AutoCADCompatibilityEngine.validate(this._entities, 'R2024')
        };

        return {
            version: '1.0',
            system: 'DraftingCanvasAdapter',
            entities: this._entities,
            constraints: this._constraints,
            compatibility: acadReports
        };
    }

    public async *getStreamingPayload(chunkSize: number = 5000): AsyncGenerator<any, void, unknown> {
        // V8 Garbage Collection optimization: stream chunks asynchronously to avoid OOM crashes
        let offset = 0;
        while (offset < this._entities.length) {
            const chunk = this._entities.slice(offset, offset + chunkSize);
            yield {
                version: '1.0',
                system: 'DraftingCanvasAdapter_Streaming',
                chunkIndex: offset / chunkSize,
                totalChunks: Math.ceil(this._entities.length / chunkSize),
                entities: chunk
            };
            offset += chunkSize;
            // Free macro-task queue to allow V8 to GC and UI to breathe
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    private pushEntity(entity: any) {
        if (this.viewKey) {
            entity.viewKey = this.viewKey;
        }
        if (this.activeBlock) {
            this.activeBlock.entities.push(entity);
        } else {
            this._entities.push(entity);
            if (entity.boundingBox) {
                this._spatialIndex.insert(entity);
            }
        }
    }
    private topologyEngine: TopologyEngine;
    private clipDepth = 0;
    private currentPath: {
        type: 'moveTo' | 'lineTo' | 'arc' | 'ellipse' | 'quadraticCurveTo' | 'bezierCurveTo',
        x: number, y: number,
        r?: number, rx?: number, ry?: number,
        rotation?: number, sa?: number, ea?: number, ccw?: boolean,
        cpx?: number, cpy?: number,
        cp1x?: number, cp1y?: number, cp2x?: number, cp2y?: number
    }[] = [];

    // --- Mapping Heuristics ---
    private get layerRef(): string {
        // Simple mapping: legacy code uses colors to distinguish layers.
        // We will pass the raw color to the model for now. The downstream 
        // DXF renderer can map #ff0000 back to Red/Layer 1 if needed.
        if (typeof this.strokeStyle === 'string') {
            if (this.strokeStyle === '#000000' && (this as any).drawingColor) return (this as any).drawingColor;
            return this.strokeStyle || 'DEFAULT';
        }
        return 'DEFAULT';
    }

    private get fillLayerRef(): string {
        if (typeof this.fillStyle === 'string') {
            if (this.fillStyle === '#000000' && (this as any).drawingColor) return (this as any).drawingColor;
            return this.fillStyle || 'DEFAULT';
        }
        return 'DEFAULT';
    }

    private getResolvedColor(style: any, sampleX = 0, sampleY = 0): string {
        if (style && typeof style === 'object' && style.__dxfGradient) {
            const dx = style.x1 - style.x0;
            const dy = style.y1 - style.y0;
            const lenSq = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((sampleX - style.x0) * dx + (sampleY - style.y0) * dy) / lenSq));
            const stops = style.stops || [];
            if (!stops.length) return 'DEFAULT';
            let chosen = stops[0].color;
            for (const stop of stops) {
                if (t >= stop.offset) chosen = stop.color;
            }
            return chosen;
        }
        if (typeof style === 'string') {
            if (style === '#000000' && (this as any).drawingColor) return (this as any).drawingColor;
            return style || 'DEFAULT';
        }
        return 'DEFAULT';
    }

    private getLayerRefForPoint(sampleX: number, sampleY: number): string {
        return this.getResolvedColor(this.strokeStyle, sampleX, sampleY);
    }

    private getFillLayerRefForPoint(sampleX: number, sampleY: number): string {
        return this.getResolvedColor(this.fillStyle, sampleX, sampleY);
    }

    private getAveragePoint(points: Point3D[]): Point3D {
        if (points.length === 0) return { x: 0, y: 0, z: 0 };
        let sumX = 0, sumY = 0;
        for (const p of points) {
            sumX += p.x;
            sumY += p.y;
        }
        return { x: sumX / points.length, y: sumY / points.length, z: 0 };
    }


    // --- State Management ---
    save(): void {
        this.stateStack.push({
            matrix: { ...this.matrix },
            strokeStyle: this.strokeStyle,
            fillStyle: this.fillStyle,
            lineWidth: this.lineWidth,
            font: this.font,
            textAlign: this.textAlign,
            textBaseline: this.textBaseline,
            globalAlpha: this.globalAlpha,
            lineDash: [...this.currentLineDash],
            clipDepth: this.clipDepth,
            clipEntitySnapshot: this._entities.length,
            clipBoundary: this.currentClipBoundary
        });
    }

    private currentLineDash: number[] = [];
    setLineDash(segments: number[]): void {
        this.currentLineDash = [...segments];
    }

    measureText(text: string): { width: number } {
        // Approximate width for drafting contexts (Canvas fallback)
        return { width: text.length * 6 };
    }

    // --- Hatch Recognition Engine ---
    private isHatching: boolean = false;

    private isExcludingMask: boolean = false;

    beginExclusionMask(): void {
        this.isExcludingMask = true;
    }

    endExclusionMask(): void {
        this.isExcludingMask = false;
    }

    clearExclusionMask(): void {
        this.exclusionPaths = [];
        this.exclusionBoundaryX = undefined;
        this.exclusionKeepRight = undefined;
    }

    addExclusionRect(x: number, y: number, w: number, h: number): void {
        const p1 = this.transformPoint(x, y);
        const p2 = this.transformPoint(x + w, y);
        const p3 = this.transformPoint(x + w, y + h);
        const p4 = this.transformPoint(x, y + h);
        this.exclusionPaths.push([p1, p2, p3, p4, p1]);
    }

    private addCurrentPathAsExclusion(): void {
        const pts = this.currentPath.filter(p => p.type === 'moveTo' || p.type === 'lineTo');
        if (pts.length >= 3) {
            const transformed = pts.map(p => this.transformPoint(p.x, p.y));
            // Ensure closed loop for containment checks
            const first = transformed[0];
            const last = transformed[transformed.length - 1];
            if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001) {
                transformed.push({ ...first });
            }
            this.exclusionPaths.push(transformed);
        }
    }

    private addCurrentPathAsStrokeExclusion(): void {
        let cp: Point3D | null = null;
        const halfWidth = Math.max(0.001, this.lineWidth / 2);
        for (const seg of this.currentPath) {
            if (seg.type === 'moveTo') {
                cp = this.transformPoint(seg.x, seg.y);
            } else if (seg.type === 'lineTo' && cp) {
                const p = this.transformPoint(seg.x, seg.y);
                this.addStrokeSegmentExclusion(cp, p, halfWidth);
                cp = p;
            }
        }
    }

    private addStrokeSegmentExclusion(p1: Point3D, p2: Point3D, halfWidth: number): void {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.000001) return;
        const nx = -dy / len * halfWidth;
        const ny = dx / len * halfWidth;
        this.exclusionPaths.push([
            { x: p1.x + nx, y: p1.y + ny, z: 0 },
            { x: p2.x + nx, y: p2.y + ny, z: 0 },
            { x: p2.x - nx, y: p2.y - ny, z: 0 },
            { x: p1.x - nx, y: p1.y - ny, z: 0 },
            { x: p1.x + nx, y: p1.y + ny, z: 0 }
        ]);
    }

    private getLineSegmentsOutsideExclusionPaths(p1: Point3D, p2: Point3D): { p1: Point3D, p2: Point3D }[] {
        if (this.exclusionPaths.length === 0) return [{ p1, p2 }];

        const ts: number[] = [0, 1];
        const x1 = p1.x, y1 = p1.y;
        const x2 = p2.x, y2 = p2.y;

        for (const path of this.exclusionPaths) {
            if (path.length < 3) continue;
            for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
                const p3_x = path[j].x, p3_y = path[j].y;
                const p4_x = path[i].x, p4_y = path[i].y;
                const den = (x1 - x2) * (p3_y - p4_y) - (y1 - y2) * (p3_x - p4_x);
                if (Math.abs(den) < 1e-9) continue;
                const t = ((x1 - p3_x) * (p3_y - p4_y) - (y1 - p3_y) * (p3_x - p4_x)) / den;
                const u = -((x1 - x2) * (y1 - p3_y) - (y1 - y2) * (x1 - p3_x)) / den;
                if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
            }
        }

        ts.sort((a, b) => a - b);
        const uniqueTs = ts.filter((val, index, arr) => index === 0 || val > arr[index - 1] + 0.000001);
        const validSegments: { p1: Point3D, p2: Point3D }[] = [];

        for (let k = 0; k < uniqueTs.length - 1; k++) {
            const tA = uniqueTs[k];
            const tB = uniqueTs[k + 1];
            const ptA_x = x1 + tA * (x2 - x1), ptA_y = y1 + tA * (y2 - y1);
            const ptB_x = x1 + tB * (x2 - x1), ptB_y = y1 + tB * (y2 - y1);
            const midX = (ptA_x + ptB_x) / 2;
            const midY = (ptA_y + ptB_y) / 2;
            if (!this.isPointInExclusionPath(midX, midY)) {
                validSegments.push({
                    p1: { x: ptA_x, y: ptA_y, z: 0 },
                    p2: { x: ptB_x, y: ptB_y, z: 0 }
                });
            }
        }

        return validSegments;
    }

    private isPointInExclusionPath(x: number, y: number): boolean {
        if (this.exclusionPaths.length === 0) return false;
        for (const path of this.exclusionPaths) {
            if (path.length < 3) continue;
            let inside = false;
            for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
                const xi = path[i].x, yi = path[i].y;
                const xj = path[j].x, yj = path[j].y;
                const intersects = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersects) inside = !inside;
            }
            if (inside) return true;
        }
        return false;
    }

    private clipPolygonAgainstExclusionPaths(points: Point3D[]): Point3D[][] {
        if (this.exclusionPaths.length === 0) return [points];

        const SCALE = 1000000;
        const scaleUp = (pts: { x: number, y: number }[]) =>
            pts.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
        const scaleDown = (path: any[]) =>
            path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE, z: 0 }));

        try {
            const subjPath = scaleUp(points);
            const clipper = new ClipperLib.Clipper();
            clipper.AddPath(subjPath, ClipperLib.PolyType.ptSubject, true);

            for (const path of this.exclusionPaths) {
                if (path.length >= 3) {
                    const clipPath = scaleUp(path);
                    clipper.AddPath(clipPath, ClipperLib.PolyType.ptClip, true);
                }
            }

            const solutionPaths: ClipperLib.Paths = [];
            const success = clipper.Execute(
                ClipperLib.ClipType.ctDifference,
                solutionPaths,
                ClipperLib.PolyFillType.pftNonZero,
                ClipperLib.PolyFillType.pftNonZero
            );

            if (success && solutionPaths.length > 0) {
                const result: Point3D[][] = [];
                for (let i = 0; i < solutionPaths.length; i++) {
                    const path = solutionPaths[i];
                    if (path.length >= 3) {
                        result.push(scaleDown(path));
                    }
                }
                return result;
            }
        } catch (e) {
            console.error('Clipper error in DraftingCanvasContext:', e);
        }

        return [points];
    }

    private clipPolygonAtVerticalLine(points: Point3D[], boundaryX: number, keepRight: boolean): Point3D[] {
        const clipped: Point3D[] = [];
        if (points.length < 3) return points;

        const isInside = (pt: Point3D) => {
            return keepRight ? (pt.x >= boundaryX) : (pt.x <= boundaryX);
        };

        const getIntersection = (p1: Point3D, p2: Point3D): Point3D => {
            const t = (boundaryX - p1.x) / (p2.x - p1.x);
            return {
                x: boundaryX,
                y: p1.y + t * (p2.y - p1.y),
                z: 0
            };
        };

        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];

            const p1In = isInside(p1);
            const p2In = isInside(p2);

            if (p1In && p2In) {
                clipped.push({ ...p2 });
            } else if (p1In && !p2In) {
                clipped.push(getIntersection(p1, p2));
            } else if (!p1In && p2In) {
                clipped.push(getIntersection(p1, p2));
                clipped.push({ ...p2 });
            }
        }
        return clipped;
    }

    private get isSuppressingPrimitives(): boolean {
        return this.isHatching || this.isDimensioning || this.isExcludingMask || this.isLeadering;
    }

    private activeHatchPattern: string = 'SOLID';
    private activeHatchScale: number = 1.0;

    beginSemanticHatch(patternName: string, scale: number = 1.0): void {
        this.isHatching = true;
        // Extract the hatch boundary from the current path!
        const pts: { x: number, y: number }[] = [];
        let cp = { x: 0, y: 0 };
        for (const p of this.currentPath) {
            if (p.type === 'moveTo' || p.type === 'lineTo') {
                pts.push(p);
                cp = p;
            } else if (p.type === 'ellipse' || p.type === 'arc') {
                const rx = p.type === 'ellipse' ? Math.abs(p.rx!) : p.r!;
                const ry = p.type === 'ellipse' ? Math.abs(p.ry!) : p.r!;
                const cx = p.x;
                const cy = p.y;
                const sa = p.sa!;
                const ea = p.ea!;
                const ccw = p.ccw!;
                const rotation = p.rotation || 0;
                const steps = 32;
                let start = sa;
                let end = ea;
                if (ccw) {
                    while (end > start) end -= Math.PI * 2;
                } else {
                    while (end < start) end += Math.PI * 2;
                }
                for (let i = 0; i <= steps; i++) {
                    const a = start + (end - start) * (i / steps);
                    const ex = cx + rx * Math.cos(a) * Math.cos(rotation) - ry * Math.sin(a) * Math.sin(rotation);
                    const ey = cy + rx * Math.cos(a) * Math.sin(rotation) + ry * Math.sin(a) * Math.cos(rotation);
                    pts.push({ x: ex, y: ey });
                    cp = { x: ex, y: ey };
                }
            }
        }

        if (pts.length >= 3) {
            const transformed = pts.map(p => this.transformPoint(p.x, p.y));
            try {
                const avg = this.getAveragePoint(transformed);
                const layer = this.getLayerRefForPoint(avg.x, avg.y);
                this.pushEntity(DraftingHatch.create(transformed, patternName, scale * this.GLOBAL_DXF_SCALE, layer));
            } catch (e) { }
        }
    }

    endSemanticHatch(): void {
        this.isHatching = false;
    }

    // --- Block Recognition Engine ---
    private isBlocking: boolean = false;

    private pendingFirstInsert: { name: string, insertPoint: Point3D, scale: number, rotation: number } | null = null;

    beginBlock(name: string, baseX: number, baseY: number, scale: number = 1.0, rotation: number = 0): void {
        const bp = this.transformPoint(baseX, baseY);
        if (this.blockRegistry.has(name)) {
            // Block already captured! Suppress raw primitives and just emit the Insert pointer
            this.isBlocking = true;
            const layer = this.getLayerRefForPoint(bp.x, bp.y);
            this.pushEntity(CADInsert.create(name, bp, scale, scale, rotation, layer));
        } else {
            // First time seeing this block! Start capturing geometry
            this.isBlocking = true;
            this.activeBlock = { name, basePoint: { x: baseX, y: baseY, z: 0 }, entities: [] };
            // Defer the first insert until the block definition is finalized in endBlock
            const transformedBase = this.transformPoint(baseX, baseY);
            this.pendingFirstInsert = { name, insertPoint: transformedBase, scale, rotation };
        }
    }

    endBlock(): void {
        this.isBlocking = false;
        if (this.activeBlock) {
            // Commit the captured block FIRST
            const transformedBase = this.transformPoint(this.activeBlock.basePoint.x, this.activeBlock.basePoint.y);
            this.pushEntity(CADBlock.create(this.activeBlock.name, transformedBase, this.activeBlock.entities));
            this.blockRegistry.add(this.activeBlock.name);
            this.activeBlock = null;

            // Now push the deferred CADInsert so that the DXF parser finds the block definition first
            if (this.pendingFirstInsert) {
                const layer = this.getLayerRefForPoint(this.pendingFirstInsert.insertPoint.x, this.pendingFirstInsert.insertPoint.y);
                this.pushEntity(CADInsert.create(
                    this.pendingFirstInsert.name,
                    this.pendingFirstInsert.insertPoint,
                    this.pendingFirstInsert.scale,
                    this.pendingFirstInsert.scale,
                    this.pendingFirstInsert.rotation,
                    layer
                ));
                this.pendingFirstInsert = null;
            }
        }
    }

    // --- Dimension Recognition Engine ---
    private isDimensioning: boolean = false;

    beginSemanticDimension(x1: number, y1: number, x2: number, y2: number, textX: number, textY: number, text: string, type: string = 'ALIGNED', isVert: boolean = false): void {
        this.isDimensioning = true;
        const p1 = this.transformPoint(x1, y1);
        const p2 = this.transformPoint(x2, y2);
        const tp = this.transformPoint(textX, textY);
        // Assuming CADLinearDimension maps these appropriately
        const avg = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: 0 };
        const layer = this.getLayerRefForPoint(avg.x, avg.y);
        this.pushEntity(new CADLinearDimension(crypto.randomUUID() as EntityId, p1, p2, tp, text, isVert ? 90 : 0, layer));
    }

    endSemanticDimension(): void {
        this.isDimensioning = false;
    }

    private isLeadering: boolean = false;

    beginSemanticLeader(points: { x: number, y: number }[], text: string): void {
        this.isLeadering = true;
        const pts = points.map(p => this.transformPoint(p.x, p.y));
        if (pts.length > 0) {
            const layer = this.getLayerRefForPoint(pts[0].x, pts[0].y);
            // Arrow size rule: 3 × drawing scale (e.g. 1:100 → 300 DXF units)
            const arrowSize = 3.0 * this.viewScaleFactor;
            let entity: any;
            if (text && text.trim() !== '') {
                entity = new CADCallout(crypto.randomUUID() as EntityId, pts, text, layer, 0);
            } else {
                entity = new CADLeader(crypto.randomUUID() as EntityId, pts, layer);
            }
            entity.arrowSize = arrowSize;
            this.pushEntity(entity);
        }
    }

    endSemanticLeader(): void {
        this.isLeadering = false;
    }

    restore(): void {
        if (this.stateStack.length > 0) {
            const s = this.stateStack.pop();
            this.matrix = s.matrix;
            this.strokeStyle = s.strokeStyle;
            this.fillStyle = s.fillStyle;
            this.lineWidth = s.lineWidth;
            this.font = s.font;
            this.textAlign = s.textAlign;
            this.textBaseline = s.textBaseline;
            this.globalAlpha = s.globalAlpha;
            this.currentLineDash = s.lineDash || [];

            while (this.clipDepth > s.clipDepth) {
                this.topologyEngine.popClip();
                this.clipDepth--;
            }

            // Removed Automatic Hatch Recognition Heuristic

            this.currentClipBoundary = s.clipBoundary;
        }
    }

    // --- Transformations ---
    translate(tx: number, ty: number): void {
        this.matrix.e += tx * this.matrix.a + ty * this.matrix.c;
        this.matrix.f += tx * this.matrix.b + ty * this.matrix.d;
    }

    rotate(angle: number): void {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const a = this.matrix.a, b = this.matrix.b, c = this.matrix.c, d = this.matrix.d;
        this.matrix.a = a * cos + c * sin;
        this.matrix.b = b * cos + d * sin;
        this.matrix.c = c * cos - a * sin;
        this.matrix.d = d * cos - b * sin;
    }

    scale(sx: number, sy: number): void {
        this.matrix.a *= sx;
        this.matrix.b *= sx;
        this.matrix.c *= sy;
        this.matrix.d *= sy;
    }

    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
        this.matrix = { a, b, c, d, e, f };
    }

    resetTransform(): void {
        this.matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    public readonly GLOBAL_DXF_SCALE = 1.0; // Schematic drawing, do not physically scale.

    private transformPoint(x: number, y: number): Point3D {
        return {
            x: (x * this.matrix.a + y * this.matrix.c + this.matrix.e) * this.GLOBAL_DXF_SCALE,
            y: (x * this.matrix.b + y * this.matrix.d + this.matrix.f) * this.GLOBAL_DXF_SCALE,
            z: 0
        };
    }

    // --- Paths ---
    beginPath(): void {
        this.currentPath = [];
    }

    moveTo(x: number, y: number): void {
        this.currentPath.push({ type: 'moveTo', x, y });
    }

    lineTo(x: number, y: number): void {
        this.currentPath.push({ type: 'lineTo', x, y });
    }

    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
        this.currentPath.push({ type: 'lineTo', x: x1, y: y1 });
    }

    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
        const cp = this.currentPath.length > 0 ? this.currentPath[this.currentPath.length - 1] : { x: 0, y: 0 };
        const p0x = cp.x || 0;
        const p0y = cp.y || 0;
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const px = mt * mt * p0x + 2 * mt * t * cpx + t * t * x;
            const py = mt * mt * p0y + 2 * mt * t * cpy + t * t * y;
            this.lineTo(px, py);
        }
    }

    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        const cp = this.currentPath.length > 0 ? this.currentPath[this.currentPath.length - 1] : { x: 0, y: 0 };
        const p0x = cp.x || 0;
        const p0y = cp.y || 0;
        const steps = 15;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            const px = mt * mt * mt * p0x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x;
            const py = mt * mt * mt * p0y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y;
            this.lineTo(px, py);
        }
    }

    arc(x: number, y: number, r: number, sa: number, ea: number, ccw: boolean = false): void {
        this.currentPath.push({ type: 'arc', x, y, r, sa, ea, ccw });
    }

    ellipse(x: number, y: number, rx: number, ry: number, rotation: number, sa: number, ea: number, ccw: boolean = false): void {
        this.currentPath.push({ type: 'ellipse', x, y, rx: Math.abs(rx), ry: Math.abs(ry), rotation, sa, ea, ccw });
    }

    dimension(x1: number, y1: number, x2: number, y2: number, textX: number, textY: number, text: string): void {
        const p1 = this.transformPoint(x1, y1);
        const p2 = this.transformPoint(x2, y2);
        const textLoc = this.transformPoint(textX, textY);
        try {
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(new CADDimension(('dim_' + Date.now()) as unknown as EntityId, p1, p2, textLoc, text, layer));
        } catch (e) { }
    }

    linearDimension(x1: number, y1: number, x2: number, y2: number, textX: number, textY: number, text: string, angle: number): void {
        const p1 = this.transformPoint(x1, y1);
        const p2 = this.transformPoint(x2, y2);
        const textLoc = this.transformPoint(textX, textY);
        // Correct dimension orientation by adding matrix rotation
        const matrixRot = Math.atan2(this.matrix.b, this.matrix.a);
        try {
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(new CADLinearDimension(('dim_' + Date.now()) as unknown as EntityId, p1, p2, textLoc, text, angle + matrixRot, layer, [], 'AAGENTO_DIM'));
        } catch (e) { }
    }

    /**
     * aagentoDimension — create a fully associative native AutoCAD dimension entity.
     *
     * @param x1, y1       Feature point 1 (canvas pixels — one end of the measured segment)
     * @param x2, y2       Feature point 2 (canvas pixels — other end of the measured segment)
     * @param textX, textY Where the dimension line is placed (offset from the feature line)
     * @param realValueMm  The actual mm value shown in the UI (e.g. 500 for a 500mm wall)
     * @param dimType      'LINEAR' (horizontal/vertical) | 'ALIGNED' (along angle)
     * @param isVert       true = vertical linear dim, false = horizontal linear dim
     * @param drawingScale Drawing scale denominator (e.g. 100 for 1:100). Arrow size scales with this.
     *                     Text is always 200 DXF units. Defaults to 100 if not supplied.
     */
    aagentoDimension(
        x1: number, y1: number,
        x2: number, y2: number,
        textX: number, textY: number,
        realValueMm: number,
        dimType: 'LINEAR' | 'ALIGNED' = 'LINEAR',
        isVert: boolean = false,
        drawingScale?: number
    ): void {
        const p1 = this.transformPoint(x1, y1);
        const p2 = this.transformPoint(x2, y2);
        const textLoc = this.transformPoint(textX, textY);
        const effectiveScale = drawingScale ?? (this as any).DXF_TEXT_SCALE_FACTOR ?? 100;
        try {
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(AagentoDimension.create(p1, p2, textLoc, realValueMm, layer, dimType, isVert, effectiveScale));
        } catch (e) { }
    }

    angularDimension(cx: number, cy: number, p1x: number, p1y: number, p2x: number, p2y: number, textX: number, textY: number): void {
        try {
            const textLoc = this.transformPoint(textX, textY);
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(new CADAngularDimension(('dim_' + Date.now()) as unknown as EntityId,
                this.transformPoint(cx, cy), this.transformPoint(p1x, p1y), this.transformPoint(p2x, p2y), textLoc,
                layer, [], 'AAGENTO_DIM'));
        } catch (e) { }
    }

    radiusDimension(cx: number, cy: number, px: number, py: number, textX: number, textY: number): void {
        try {
            const textLoc = this.transformPoint(textX, textY);
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(new CADRadiusDimension(('dim_' + Date.now()) as unknown as EntityId,
                this.transformPoint(cx, cy), this.transformPoint(px, py), textLoc,
                layer, [], 'AAGENTO_DIM'));
        } catch (e) { }
    }

    diameterDimension(cx: number, cy: number, px: number, py: number, textX: number, textY: number): void {
        try {
            const textLoc = this.transformPoint(textX, textY);
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(new CADDiameterDimension(('dim_' + Date.now()) as unknown as EntityId,
                this.transformPoint(cx, cy), this.transformPoint(px, py), textLoc,
                layer, [], 'AAGENTO_DIM'));
        } catch (e) { }
    }

    ordinateDimension(fx: number, fy: number, tx: number, ty: number, isX: boolean): void {
        try {
            const textLoc = this.transformPoint(tx, ty);
            const layer = this.getLayerRefForPoint(textLoc.x, textLoc.y);
            this.pushEntity(new CADOrdinateDimension(('dim_' + Date.now()) as unknown as EntityId,
                this.transformPoint(fx, fy), textLoc, isX, layer));
        } catch (e) { }
    }


    insertLibraryBlock(name: string, x: number, y: number, scale: number = 1.0, rotation: number = 0, params: Record<string, any> = {}): void {
        // Automatically manages definition creation & duplicate insertion
        this.beginBlock(name, x, y, scale, rotation);

        if (!this.isSuppressingPrimitives) {
            // First instance! Generate the geometry physically using the generator
            this.save();
            this.translate(x, y);
            this.rotate(rotation);
            this.scale(scale, scale);

            BlockLibrary.generate(name, this, params);

            this.restore();
        }

        this.endBlock();
    }

    rect(x: number, y: number, w: number, h: number): void {
        this.moveTo(x, y);
        this.lineTo(x + w, y);
        this.lineTo(x + w, y + h);
        this.lineTo(x, y + h);
        this.lineTo(x, y);
    }

    roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
        let rTopLeft = 0, rTopRight = 0, rBottomRight = 0, rBottomLeft = 0;
        if (typeof radii === 'number') {
            rTopLeft = rTopRight = rBottomRight = rBottomLeft = radii;
        } else if (Array.isArray(radii)) {
            if (radii.length === 1) {
                rTopLeft = rTopRight = rBottomRight = rBottomLeft = radii[0];
            } else if (radii.length === 2) {
                rTopLeft = rBottomRight = radii[0];
                rTopRight = rBottomLeft = radii[1];
            } else if (radii.length === 3) {
                rTopLeft = radii[0];
                rTopRight = rBottomLeft = radii[1];
                rBottomRight = radii[2];
            } else if (radii.length >= 4) {
                rTopLeft = radii[0];
                rTopRight = radii[1];
                rBottomRight = radii[2];
                rBottomLeft = radii[3];
            }
        }

        const minSide = Math.min(w, h);
        rTopLeft = Math.min(rTopLeft, minSide / 2);
        rTopRight = Math.min(rTopRight, minSide / 2);
        rBottomRight = Math.min(rBottomRight, minSide / 2);
        rBottomLeft = Math.min(rBottomLeft, minSide / 2);

        this.moveTo(x + rTopLeft, y);
        this.lineTo(x + w - rTopRight, y);
        if (rTopRight > 0) {
            this.arc(x + w - rTopRight, y + rTopRight, rTopRight, -Math.PI / 2, 0, false);
        }
        this.lineTo(x + w, y + h - rBottomRight);
        if (rBottomRight > 0) {
            this.arc(x + w - rBottomRight, y + h - rBottomRight, rBottomRight, 0, Math.PI / 2, false);
        }
        this.lineTo(x + rBottomLeft, y + h);
        if (rBottomLeft > 0) {
            this.arc(x + rBottomLeft, y + h - rBottomLeft, rBottomLeft, Math.PI / 2, Math.PI, false);
        }
        this.lineTo(x, y + rTopLeft);
        if (rTopLeft > 0) {
            this.arc(x + rTopLeft, y + rTopLeft, rTopLeft, Math.PI, -Math.PI / 2, false);
        }
        this.closePath();
    }

    closePath(): void {
        // Connect to the most recent moveTo segment
        let lastMove = null;
        for (let i = this.currentPath.length - 1; i >= 0; i--) {
            if (this.currentPath[i].type === 'moveTo') {
                lastMove = this.currentPath[i];
                break;
            }
        }
        if (lastMove) {
            this.lineTo(lastMove.x, lastMove.y);
        }
    }

    // --- Drawing Execution ---
    stroke(): void {
        if (this.isExcludingMask) {
            this.addCurrentPathAsStrokeExclusion();
            return;
        }
        if (this.isSuppressingPrimitives) return; // SUPPRESS RAW LINES INSIDE HATCHES!

        let cp: { x: number, y: number } | null = null;

        const style = this.strokeStyle;

        let currentPolylinePts: Point3D[] = [];
        const flushPolyline = () => {
            if (currentPolylinePts.length === 2) {
                let lineType = LineTypeRegistry.resolveFromDashArray(this.currentLineDash);
                const avg = { x: (currentPolylinePts[0].x + currentPolylinePts[1].x) / 2, y: (currentPolylinePts[0].y + currentPolylinePts[1].y) / 2, z: 0 };

                if (this.highlightBoundary) {
                    const isTargetSide = this.highlightBoundary.side === 'right' ? avg.x > this.highlightBoundary.x : avg.x < this.highlightBoundary.x;
                    if (isTargetSide) {
                        lineType = LineTypeRegistry.resolveFromDashArray(this.highlightBoundary.dash);
                    }
                }

                let layer = this.getLayerRefForPoint(avg.x, avg.y);
                if (this.highlightBoundary && this.highlightBoundary.color) {
                    const isTargetSide = this.highlightBoundary.side === 'right' ? avg.x > this.highlightBoundary.x : avg.x < this.highlightBoundary.x;
                    if (isTargetSide) {
                        layer = this.highlightBoundary.color;
                    }
                }
                this.pushEntity(DraftingLine.create(currentPolylinePts[0], currentPolylinePts[1], layer, lineType));
            } else if (currentPolylinePts.length > 2) {
                const first = currentPolylinePts[0];
                const last = currentPolylinePts[currentPolylinePts.length - 1];
                const isClosed = Math.abs(first.x - last.x) < 0.1 && Math.abs(first.y - last.y) < 0.1;

                const vertices: CADPolylineVertex[] = currentPolylinePts.map(p => ({ point: p, bulge: 0 }));
                if (isClosed) {
                    vertices.pop(); // Remove duplicate last point for closed polylines
                }
                const avg = this.getAveragePoint(currentPolylinePts);
                let lineType = LineTypeRegistry.resolveFromDashArray(this.currentLineDash);

                if (this.highlightBoundary) {
                    const isTargetSide = this.highlightBoundary.side === 'right' ? avg.x > this.highlightBoundary.x : avg.x < this.highlightBoundary.x;
                    if (isTargetSide) {
                        lineType = LineTypeRegistry.resolveFromDashArray(this.highlightBoundary.dash);
                    }
                }

                let layer = this.getLayerRefForPoint(avg.x, avg.y);
                if (this.highlightBoundary && this.highlightBoundary.color) {
                    const isTargetSide = this.highlightBoundary.side === 'right' ? avg.x > this.highlightBoundary.x : avg.x < this.highlightBoundary.x;
                    if (isTargetSide) {
                        layer = this.highlightBoundary.color;
                    }
                }
                this.pushEntity(CADPolyline.create(vertices, isClosed, layer, lineType));
            }
            currentPolylinePts = [];
        };

        for (const seg of this.currentPath) {
            if (seg.type === 'moveTo') {
                flushPolyline();
                cp = { x: seg.x, y: seg.y };
            } else if (seg.type === 'lineTo') {
                if (cp) {
                    const p1 = this.transformPoint(cp.x, cp.y);
                    const p2 = this.transformPoint(seg.x, seg.y);

                    if (Math.abs(p1.x - p2.x) > 0.0001 || Math.abs(p1.y - p2.y) > 0.0001) {
                        const clipped = this.topologyEngine.clipLine(p1, p2);
                        if (clipped) {
                            const segments = this.getLineSegmentsOutsideExclusionPaths(clipped[0], clipped[1]);
                            for (const s of segments) {
                                let pieces = [s];
                                if (this.highlightBoundary) {
                                    const hbx = this.highlightBoundary.x;
                                    const minX = Math.min(s.p1.x, s.p2.x);
                                    const maxX = Math.max(s.p1.x, s.p2.x);
                                    if (minX < hbx - 0.001 && maxX > hbx + 0.001) {
                                        const t = (hbx - s.p1.x) / (s.p2.x - s.p1.x);
                                        const intersectPt = {
                                            x: hbx,
                                            y: s.p1.y + t * (s.p2.y - s.p1.y),
                                            z: 0
                                        };
                                        pieces = [
                                            { p1: s.p1, p2: intersectPt },
                                            { p1: intersectPt, p2: s.p2 }
                                        ];
                                    }
                                }

                                for (const piece of pieces) {
                                    if (currentPolylinePts.length === 0) {
                                        currentPolylinePts.push(piece.p1);
                                    } else {
                                        const lastPt = currentPolylinePts[currentPolylinePts.length - 1];
                                        if (Math.abs(lastPt.x - piece.p1.x) > 0.1 || Math.abs(lastPt.y - piece.p1.y) > 0.1) {
                                            flushPolyline();
                                            currentPolylinePts.push(piece.p1);
                                        }
                                    }
                                    currentPolylinePts.push(piece.p2);

                                    if (pieces.length === 2 && piece === pieces[0]) {
                                        flushPolyline();
                                    }
                                }
                            }
                        }
                    }
                }
                cp = { x: seg.x, y: seg.y };
            } else if (seg.type === 'arc') {
                const center = this.transformPoint(seg.x, seg.y);
                if (this.isPointInExclusionPath(center.x, center.y)) {
                    cp = { x: seg.x + seg.r! * Math.cos(seg.ea!), y: seg.y + seg.r! * Math.sin(seg.ea!) };
                    continue;
                }
                // Extract uniform scale from matrix for radius calculation
                const scale = Math.sqrt(this.matrix.a * this.matrix.a + this.matrix.b * this.matrix.b);
                const r = seg.r! * scale;
                // Correctly rotate the start and end angles using the matrix's affine rotation component!
                const matrixRotation = Math.atan2(this.matrix.b, this.matrix.a);

                let startAngle = seg.sa! + matrixRotation;
                let endAngle = seg.ea! + matrixRotation;

                // If Canvas drew counter-clockwise, swap the angles so the DXF backend's fixed CCW mapping correctly interprets the sweep!
                if (seg.ccw) {
                    const temp = startAngle;
                    startAngle = endAngle;
                    endAngle = temp;
                }

                try {
                    let lineType = LineTypeRegistry.resolveFromDashArray(this.currentLineDash);
                    let layer = this.getLayerRefForPoint(center.x, center.y);
                    if (this.highlightBoundary) {
                        const midAngle = (startAngle + endAngle) / 2;
                        const curveMidX = center.x + r * Math.cos(midAngle);
                        const isTargetSide = this.highlightBoundary.side === 'right' ? curveMidX > this.highlightBoundary.x : curveMidX < this.highlightBoundary.x;
                        if (isTargetSide) {
                            lineType = LineTypeRegistry.resolveFromDashArray(this.highlightBoundary.dash);
                            if (this.highlightBoundary.color) layer = this.highlightBoundary.color;
                        }
                    }
                    this.pushEntity(DraftingArc.create(center, r, startAngle, endAngle, layer, lineType));
                } catch (e) { }
                // Move virtual pen to end of arc
                cp = { x: seg.x + seg.r! * Math.cos(seg.ea!), y: seg.y + seg.r! * Math.sin(seg.ea!) };
            } else if (seg.type === 'ellipse') {
                const center = this.transformPoint(seg.x, seg.y);
                if (this.isPointInExclusionPath(center.x, center.y)) {
                    cp = { x: seg.x, y: seg.y };
                    continue;
                }
                const scaleX = Math.sqrt(this.matrix.a * this.matrix.a + this.matrix.c * this.matrix.c);
                const scaleY = Math.sqrt(this.matrix.b * this.matrix.b + this.matrix.d * this.matrix.d);
                const matrixRotation = Math.atan2(this.matrix.b, this.matrix.a);

                let startAngle = seg.sa! + matrixRotation;
                let endAngle = seg.ea! + matrixRotation;

                // Sweep inversion for counter-clockwise ellipses
                if (seg.ccw) {
                    const temp = startAngle;
                    startAngle = endAngle;
                    endAngle = temp;
                }

                try {
                    let lineType = LineTypeRegistry.resolveFromDashArray(this.currentLineDash);
                    let layer = this.getLayerRefForPoint(center.x, center.y);
                    if (this.highlightBoundary) {
                        const midAngle = (startAngle + endAngle) / 2;
                        const curveMidX = center.x + (seg.rx! * scaleX) * Math.cos(midAngle) * Math.cos(seg.rotation! + matrixRotation) - (seg.ry! * scaleY) * Math.sin(midAngle) * Math.sin(seg.rotation! + matrixRotation);
                        const isTargetSide = this.highlightBoundary.side === 'right' ? curveMidX > this.highlightBoundary.x : curveMidX < this.highlightBoundary.x;
                        if (isTargetSide) {
                            lineType = LineTypeRegistry.resolveFromDashArray(this.highlightBoundary.dash);
                            if (this.highlightBoundary.color) layer = this.highlightBoundary.color;
                        }
                    }
                    this.pushEntity(CADEllipse.create(
                        center,
                        seg.rx! * scaleX,
                        seg.ry! * scaleY,
                        seg.rotation! + matrixRotation,
                        startAngle,
                        endAngle,
                        layer,
                        lineType
                    ));
                } catch (e) { }
                cp = { x: seg.x, y: seg.y }; // Approximation for pen position
            } else if (seg.type === 'quadraticCurveTo') {
                if (cp) {
                    const steps = 8;
                    for (let step = 1; step <= steps; step++) {
                        const t = step / steps;
                        const invT = 1 - t;
                        const qx = invT * invT * cp.x + 2 * invT * t * seg.cpx! + t * t * seg.x;
                        const qy = invT * invT * cp.y + 2 * invT * t * seg.cpy! + t * t * seg.y;
                        currentPolylinePts.push(this.transformPoint(qx, qy));
                    }
                }
                cp = { x: seg.x, y: seg.y };
            } else if (seg.type === 'bezierCurveTo') {
                if (cp) {
                    const steps = 8;
                    for (let step = 1; step <= steps; step++) {
                        const t = step / steps;
                        const invT = 1 - t;
                        const bx = invT * invT * invT * cp.x + 3 * invT * invT * t * seg.cp1x! + 3 * invT * t * t * seg.cp2x! + t * t * t * seg.x;
                        const by = invT * invT * invT * cp.y + 3 * invT * invT * t * seg.cp1y! + 3 * invT * t * t * seg.cp2y! + t * t * t * seg.y;
                        currentPolylinePts.push(this.transformPoint(bx, by));
                    }
                }
                cp = { x: seg.x, y: seg.y };
            }
        }
        flushPolyline();

        // Canvas API does NOT empty path on stroke() unless beginPath() is called,
        // but for safety in this proxy, we assume subsequent strokes without beginPath are rare.
    }

    fill(): void {
        if (this.isExcludingMask) {
            this.addCurrentPathAsExclusion();
            return;
        }
        if (this.isSuppressingPrimitives) return; // SUPPRESS DOTS INSIDE HATCHES!

        // Edge Case: Check for legacy white-box text masking heuristics
        let colorString = '';
        if (typeof this.fillStyle === 'string') {
            colorString = this.fillStyle.toLowerCase().trim().replace(/\s/g, '');
        }
        // Plain white and rgba(255,255,255,*) are clearly text backgrounds
        const isPlainWhite = colorString === '#ffffff' || colorString === 'white' || colorString === '#fff';
        // Any semi-transparent rgba fill is a text background mask (cream, white, etc.)
        const isSemiTransparentRgba = (() => {
            const m = colorString.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
            return m ? parseFloat(m[4]) < 1.0 : false;
        })();
        const isTextBg = isPlainWhite || isSemiTransparentRgba;
        // Skip text background clear masks
        if (isTextBg) return;

        // Only convert 3-point dimension arrowheads into SOLID DXF entities.
        // Structural component shape fills (gusset plates, top chord plates, dirt walls, abutment bodies, footings)
        // must NOT create opaque SOLID hatches in AutoCAD GAD drawings.
        const pts = this.currentPath.filter(p => p.type === 'moveTo' || p.type === 'lineTo');
        const isArrowhead = pts.length === 3;

        if (isArrowhead) {
            let transformed = pts.map(p => this.transformPoint(p.x, p.y));

            if (transformed.length === 3) {
                let clippedPolys: Point3D[][] = [];
                if (this.exclusionPaths.length > 0) {
                    clippedPolys = this.clipPolygonAgainstExclusionPaths(transformed);
                } else if (this.exclusionBoundaryX !== undefined && this.exclusionKeepRight !== undefined) {
                    clippedPolys = [this.clipPolygonAtVerticalLine(transformed, this.exclusionBoundaryX, this.exclusionKeepRight)];
                } else {
                    clippedPolys = [transformed];
                }

                for (const poly of clippedPolys) {
                    if (poly.length === 3) {
                        try {
                            const polyAvg = this.getAveragePoint(poly);
                            const fillLayer = this.getFillLayerRefForPoint(polyAvg.x, polyAvg.y);
                            this.pushEntity(DraftingHatch.create(poly, 'SOLID', 1.0, fillLayer));
                        } catch (e) { }
                    }
                }
            }
        }
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        // Skip converting fillRect into DXF SOLID hatches for background clears or component fills
        if (Math.abs(w) <= 2.0 && Math.abs(h) <= 2.0) {
            return;
        }

        if (typeof this.fillStyle === 'string') {
            const fs = this.fillStyle.toLowerCase().replace(/\s/g, '');
            const rgbaMatch = fs.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
            if (rgbaMatch) {
                const alpha = parseFloat(rgbaMatch[4]);
                if (alpha < 1.0) return;
            }
            if (fs === '#ffffff' || fs === 'white' || fs === '#fff') return;
        }

        // Component rect fills on canvas should not emit SOLID CAD hatches in DXF
        return;
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
        this.beginPath();
        this.rect(x, y, w, h);
        this.stroke();
    }

    // --- Native DXF Hatch Injection ---
    addHatch(points: { x: number, y: number }[], pattern: string, scale: number, angle: number = 0): void {
        let transformed = points.map(p => this.transformPoint(p.x, p.y));
        if (transformed.length >= 3) {
            let clippedPolys: Point3D[][] = [];
            if (this.exclusionPaths.length > 0) {
                clippedPolys = this.clipPolygonAgainstExclusionPaths(transformed);
            } else if (this.exclusionBoundaryX !== undefined && this.exclusionKeepRight !== undefined) {
                clippedPolys = [this.clipPolygonAtVerticalLine(transformed, this.exclusionBoundaryX, this.exclusionKeepRight)];
            } else {
                clippedPolys = [transformed];
            }

            const style = pattern === 'SOLID' ? this.fillStyle : this.strokeStyle;
            if (style && typeof style === 'object' && (style as any).__dxfGradient) {
                const grad = (style as any).__dxfGradient;
                if (Math.abs(grad.x0 - grad.x1) < 1.0) {
                    const boundaryX = (grad.x0 + grad.x1) / 2;
                    let finalPolys: Point3D[][] = [];
                    for (const poly of clippedPolys) {
                        const leftPoly = this.clipPolygonAtVerticalLine(poly, boundaryX, false);
                        const rightPoly = this.clipPolygonAtVerticalLine(poly, boundaryX, true);
                        if (leftPoly.length >= 3) finalPolys.push(leftPoly);
                        if (rightPoly.length >= 3) finalPolys.push(rightPoly);
                    }
                    clippedPolys = finalPolys;
                }
            }

            for (const poly of clippedPolys) {
                if (poly.length >= 3) {
                    try {
                        const polyAvg = this.getAveragePoint(poly);
                        let layer = pattern === 'SOLID' ? this.getFillLayerRefForPoint(polyAvg.x, polyAvg.y) : this.getLayerRefForPoint(polyAvg.x, polyAvg.y);
                        if (this.highlightBoundary && this.highlightBoundary.color) {
                            const isTargetSide = this.highlightBoundary.side === 'right' ? polyAvg.x > this.highlightBoundary.x : polyAvg.x < this.highlightBoundary.x;
                            if (isTargetSide) layer = this.highlightBoundary.color;
                        }
                        this.pushEntity(DraftingHatch.create(poly, pattern, scale, layer));
                    } catch (e) { }
                }
            }
        }
    }

    // --- Text Execution ---

    fillText(text: string, x: number, y: number): void {
        if (this.isSuppressingPrimitives) return;

        // 1. Extract canvas font size (e.g., '12px Arial' -> 12)
        let canvasFontSize = 10;
        const match = this.font.match(/(\d+)px/);
        if (match) canvasFontSize = parseInt(match[1], 10);

        // Unscale font size if manually scaled by st.scale in the drawing function (like ROB level table)
        const scaleFactor = (this as any)._stScale ? (this as any)._stScale / 16.0 : 25.0; // Fallback to 400/16 = 25
        if (canvasFontSize > 30) {
            canvasFontSize = canvasFontSize / scaleFactor;
        }

        // 2. Transform coordinate and height
        const scale = Math.sqrt(this.matrix.a * this.matrix.a + this.matrix.b * this.matrix.b);

        // --- NEW TEXT SCALING LOGIC ---
        // Final height based on strictly defined standard DXF heights per view and text type (dimension vs title)
        const finalHeight = resolveDxfTextHeight(this.viewKey, text, canvasFontSize);
        let pos = this.transformPoint(x, y);

        // Clip text if its insertion point is inside the exclusion path
        if (this.isPointInExclusionPath(pos.x, pos.y)) return;

        // 3. Map Enums safely
        let align: TextAlignment = 'center';
        if (this.textAlign === 'left' || this.textAlign === 'right') align = this.textAlign as TextAlignment;

        let base: TextBaseline = 'middle';
        if (this.textBaseline === 'top' || this.textBaseline === 'bottom') base = this.textBaseline as TextBaseline;

        // 4. Extract rotation
        const rot = Math.atan2(this.matrix.b, this.matrix.a);

        const isTitle = isTitleText(text, canvasFontSize);
        const isScale = isScaleSubtitle(text);

        if (isTitle) {
            let maxTitleY = -Infinity;
            let maxGeomY = -Infinity;
            let minGeomX = Infinity;
            let maxGeomX = -Infinity;

            for (const ent of this._entities) {
                if (ent.viewKey === this.viewKey && ent.boundingBox) {
                    if ((ent as any).isViewTitle) {
                        if (ent.boundingBox.maxY > maxTitleY) {
                            maxTitleY = ent.boundingBox.maxY;
                        }
                    } else {
                        if (ent.boundingBox.maxY > maxGeomY) {
                            maxGeomY = ent.boundingBox.maxY;
                        }
                        if (ent.boundingBox.minX < minGeomX) minGeomX = ent.boundingBox.minX;
                        if (ent.boundingBox.maxX > maxGeomX) maxGeomX = ent.boundingBox.maxX;
                    }
                }
            }

            let targetY = pos.y;
            if (maxTitleY !== -Infinity) {
                targetY = maxTitleY + finalHeight * 1.5;
            } else if (maxGeomY !== -Infinity) {
                const transformedGap = pos.y - maxGeomY;
                const unscaledGap = transformedGap * (this.viewScaleFactor / 100);
                targetY = maxGeomY + unscaledGap;
            }
            const centerX = (minGeomX !== Infinity) ? (minGeomX + maxGeomX) / 2 : 0;
            pos = { ...pos, x: centerX, y: targetY };

            base = 'top';
        }

        try {
            const fillLayer = this.getFillLayerRefForPoint(pos.x, pos.y);

            let textStyle = 'NOTE_STYLE';
            if (this.font && this.font.includes('Times New Roman')) {
                textStyle = 'TIMES_STYLE';
            }

            const textEnt = DraftingText.create(text, pos, finalHeight, align, base, rot, fillLayer, textStyle);
            if (isTitle) {
                (textEnt as any).isViewTitle = true;
            }
            this.pushEntity(textEnt);
        } catch (e) { }
    }

    strokeText(text: string, x: number, y: number): void {
        // In CAD semantics, text outlines are generally not parsed independently from filled text.
        // We alias strokeText to fillText to preserve the entity geometry.
        this.fillText(text, x, y);
    }

    fillTextMultiline(text: string, x: number, y: number, lineHeight: number): void {
        if (this.isSuppressingPrimitives) return;

        let canvasFontSize = 10;
        const match = this.font.match(/(\d+)px/);
        if (match) canvasFontSize = parseInt(match[1], 10);

        // Unscale font size if manually scaled by st.scale in the drawing function (like ROB level table)
        const scaleFactor = (this as any)._stScale ? (this as any)._stScale / 16.0 : 25.0; // Fallback to 400/16 = 25
        if (canvasFontSize > 30) {
            canvasFontSize = canvasFontSize / scaleFactor;
        }

        // Use exactly the same height rules as standard text
        const finalHeight = resolveDxfTextHeight(this.viewKey, text, canvasFontSize);
        let pos = this.transformPoint(x, y);

        if (this.isPointInExclusionPath(pos.x, pos.y)) return;

        const isTitle = isTitleText(text, canvasFontSize);
        if (isTitle) {
            let maxTitleY = -Infinity;
            let maxGeomY = -Infinity;
            let minGeomX = Infinity;
            let maxGeomX = -Infinity;

            for (const ent of this._entities) {
                if (ent.viewKey === this.viewKey && ent.boundingBox) {
                    if ((ent as any).isViewTitle) {
                        if (ent.boundingBox.maxY > maxTitleY) {
                            maxTitleY = ent.boundingBox.maxY;
                        }
                    } else {
                        if (ent.boundingBox.maxY > maxGeomY) {
                            maxGeomY = ent.boundingBox.maxY;
                        }
                        if (ent.boundingBox.minX < minGeomX) minGeomX = ent.boundingBox.minX;
                        if (ent.boundingBox.maxX > maxGeomX) maxGeomX = ent.boundingBox.maxX;
                    }
                }
            }
            let targetY = pos.y;
            if (maxTitleY !== -Infinity) {
                targetY = maxTitleY + finalHeight * 1.5;
            } else if (maxGeomY !== -Infinity) {
                const transformedGap = pos.y - maxGeomY;
                const unscaledGap = transformedGap * (this.viewScaleFactor / 100);
                targetY = maxGeomY + unscaledGap;
            }
            const centerX = (minGeomX !== Infinity) ? (minGeomX + maxGeomX) / 2 : 0;
            pos = { ...pos, x: centerX, y: targetY };
        }

        try {
            const fillLayer = this.getFillLayerRefForPoint(pos.x, pos.y);

            // The Python DXF backend defaults MTEXT attachment to Top-Left (1).
            // If the canvas requested a 'bottom' baseline, pos.y is the bottom of the text block.
            // We must explicitly shift pos.y UPWARDS in DXF space to represent the Top-Left corner!
            const numLines = text.split('\n').length;
            // MTEXT typically has 1.0 spacing, but true bounding box height involves line spacing.
            // A single line needs ~1.2x height to clear the descenders.
            // Each additional line adds ~1.7x height in AutoCAD due to line spacing.
            const totalHeight = finalHeight * 1.2 + (numLines - 1) * finalHeight * 1.7;

            if (this.textBaseline === 'bottom' || this.textBaseline === 'alphabetic') {
                pos = { ...pos, y: pos.y - totalHeight }; // Subtracting height moves the Top-Left point higher (since Y increases downwards here)
            } else if (this.textBaseline === 'middle') {
                pos = { ...pos, y: pos.y - totalHeight / 2 };
            }

            // We use MTEXT for multiline strings
            // MText in DXF handles formatting like \P internally if passed properly by backend, 
            // but we'll send it with \n directly and let the python schema catch it.
            // Replace \n with \P if the backend strictly requires AutoCAD newline strings.
            const textContent = text.replace(/\n/g, '\\P');
            const mTextEnt = new CADMText(('mtext_' + Date.now()) as unknown as EntityId, pos, textContent, 0, fillLayer);

            // Attach these optional formatting fields in case the exporter uses them
            (mTextEnt as any).height = finalHeight;
            (mTextEnt as any).rotation = Math.atan2(this.matrix.b, this.matrix.a);

            // Map text baseline and alignment to AutoCAD attachment_point
            let attachment_point = 1; // Default: Top Left
            if (this.textBaseline === 'top') {
                if (this.textAlign === 'left') attachment_point = 1;
                else if (this.textAlign === 'center') attachment_point = 2;
                else if (this.textAlign === 'right') attachment_point = 3;
            } else if (this.textBaseline === 'middle') {
                if (this.textAlign === 'left') attachment_point = 4;
                else if (this.textAlign === 'center') attachment_point = 5;
                else if (this.textAlign === 'right') attachment_point = 6;
            } else if (this.textBaseline === 'bottom' || this.textBaseline === 'alphabetic') {
                if (this.textAlign === 'left') attachment_point = 7;
                else if (this.textAlign === 'center') attachment_point = 8;
                else if (this.textAlign === 'right') attachment_point = 9;
            }
            (mTextEnt as any).attachment_point = attachment_point;
            if (isTitle) {
                (mTextEnt as any).isViewTitle = true;
            }

            this.pushEntity(mTextEnt);
        } catch (e) { }
    }

    // --- Legacy Monolith Dummies ---
    private currentClipBoundary: Point3D[] | null = null;

    clip(): void {
        const pts = this.currentPath.filter(p => p.type === 'moveTo' || p.type === 'lineTo');
        if (pts.length >= 3) {
            const transformed = pts.map(p => this.transformPoint(p.x, p.y));
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of transformed) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            }
            this.topologyEngine.pushClip({ minX, minY, maxX, maxY });
            this.clipDepth++;
            this.currentClipBoundary = transformed;
        }
    }
}
