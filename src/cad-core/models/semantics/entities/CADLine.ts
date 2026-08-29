import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

export class CADLine extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADLine';

    constructor(
        id: EntityId,
        public readonly start: Point3D,
        public readonly end: Point3D,
        public readonly layerRef: string,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        super(id, {
            minX: Math.min(start.x, end.x),
            minY: Math.min(start.y, end.y),
            maxX: Math.max(start.x, end.x),
            maxY: Math.max(start.y, end.y)
        }, sourceEntityId, metadata);
        Object.freeze(this.start);
        Object.freeze(this.end);
    }

    public static create(start: Point3D, end: Point3D, layerRef: string): CADLine {
        return new CADLine(crypto.randomUUID() as EntityId, { ...start }, { ...end }, layerRef);
    }
}
