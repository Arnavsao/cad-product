import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

export interface CADPolylineVertex {
    point: Point3D;
    bulge: number; // 0 for straight line segments
}

export class CADPolyline extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADPolyline';

    constructor(
        id: EntityId,
        public readonly vertices: ReadonlyArray<CADPolylineVertex>,
        public readonly isClosed: boolean,
        public readonly layerRef: string,
        public readonly lineType: string = 'ByLayer',
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const v of vertices) {
            if (v.point.x < minX) minX = v.point.x;
            if (v.point.y < minY) minY = v.point.y;
            if (v.point.x > maxX) maxX = v.point.x;
            if (v.point.y > maxY) maxY = v.point.y;
        }
        super(id, { minX, minY, maxX, maxY }, sourceEntityId, metadata);
        Object.freeze(this.vertices);
    }

    public static create(vertices: CADPolylineVertex[], isClosed: boolean, layerRef: string, lineType: string = 'ByLayer'): CADPolyline {
        return new CADPolyline(crypto.randomUUID() as EntityId, [...vertices], isClosed, layerRef, lineType);
    }
}
