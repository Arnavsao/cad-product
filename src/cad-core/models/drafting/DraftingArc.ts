import { BaseEntity } from '../../core/BaseEntity';
import { IDraftingEntity } from '../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../types';

export class DraftingArc extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'Arc';

    constructor(
        id: EntityId,
        public readonly center: Point3D,
        public readonly radius: number,
        public readonly startAngle: number,
        public readonly endAngle: number,
        public readonly layerRef: string,
        public readonly lineType: string = 'CONTINUOUS',
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        // Simplified bounding box: square around the entire circle. 
        // A true AABB would calculate exact arc bounds, but this is sufficient for Phase 1.
        super(id, {
            minX: center.x - radius,
            minY: center.y - radius,
            maxX: center.x + radius,
            maxY: center.y + radius
        }, sourceEntityId, metadata);
    }

    public static create(center: Point3D, radius: number, startAngle: number, endAngle: number, layerRef: string, lineType: string = 'CONTINUOUS', sourceId: SourceEntityId = null): DraftingArc {
        return new DraftingArc(crypto.randomUUID() as EntityId, center, radius, startAngle, endAngle, layerRef, lineType, sourceId);
    }
}
