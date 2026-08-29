import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

function createBBox(pts: Point3D[]) {
    if (!pts || pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
        minX: Math.min(...pts.map(p => p.x)),
        minY: Math.min(...pts.map(p => p.y)),
        maxX: Math.max(...pts.map(p => p.x)),
        maxY: Math.max(...pts.map(p => p.y))
    };
}

/**
 * AagentoDimension — Fully Associative Native AutoCAD Dimension Entity
 *
 * This entity carries canvas-pixel coordinates (p1, p2, textLoc) alongside the
 * real-world value in millimetres (realValueMm). The backend rescales p1/p2
 * so their DXF distance exactly equals realValueMm, then writes the dimension
 * with text='' so AutoCAD measures the distance itself. This makes the entity
 * fully associative — dragging a grip in AutoCAD will automatically update the
 * displayed text, exactly like a native AutoCAD dimension.
 *
 * Supported dimension types (dimType):
 *   'LINEAR'   — horizontal or vertical (controlled by isVert)
 *   'ALIGNED'  — measured along the angle between p1 and p2
 *
 * Times New Roman is applied via the AAGENTO_DIM_STYLE dimstyle on the backend.
 */
export class AagentoDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'AagentoDimension';

    constructor(
        id: EntityId,
        /** Feature point 1 — one end of the measured distance (canvas pixels) */
        public readonly p1: Point3D,
        /** Feature point 2 — other end of the measured distance (canvas pixels) */
        public readonly p2: Point3D,
        /** Where the dimension line itself is placed (offset from feature line) */
        public readonly textLoc: Point3D,
        /** The real-world value in mm that this dimension represents */
        public readonly realValueMm: number,
        /** CAD layer reference */
        public readonly layerRef: string,
        /** Dimension type: 'LINEAR' (horizontal/vertical) or 'ALIGNED' */
        public readonly dimType: 'LINEAR' | 'ALIGNED' = 'LINEAR',
        /** True for vertical linear dimensions, false for horizontal */
        public readonly isVert: boolean = false,
        /**
         * Drawing scale denominator (e.g. 100 for 1:100, 25 for 1:25).
         * Arrow size = base_arrow × drawingScale (applied via dimscale on backend).
         * Text size is always 200 DXF units regardless of scale.
         */
        public readonly drawingScale: number = 100,
        sourceEntityId: SourceEntityId = null
    ) {
        super(id, createBBox([p1, p2, textLoc]), sourceEntityId);
    }

    public static create(
        p1: Point3D,
        p2: Point3D,
        textLoc: Point3D,
        realValueMm: number,
        layerRef: string,
        dimType: 'LINEAR' | 'ALIGNED' = 'LINEAR',
        isVert: boolean = false,
        drawingScale: number = 100
    ): AagentoDimension {
        return new AagentoDimension(
            crypto.randomUUID() as EntityId,
            { ...p1 },
            { ...p2 },
            { ...textLoc },
            realValueMm,
            layerRef,
            dimType,
            isVert,
            drawingScale
        );
    }
}
