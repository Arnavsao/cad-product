import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

export class CADInsert extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADInsert';

    constructor(
        id: EntityId,
        public readonly blockName: string,
        public readonly insertPoint: Point3D,
        public readonly scaleX: number,
        public readonly scaleY: number,
        public readonly rotation: number,
        public readonly layerRef: string,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        // Approximate BoundingBox (to be rigorously calculated by the Spatial Index later)
        super(id, { minX: insertPoint.x, minY: insertPoint.y, maxX: insertPoint.x, maxY: insertPoint.y }, sourceEntityId, metadata);
    }

    public static create(blockName: string, insertPoint: Point3D, scaleX: number, scaleY: number, rotation: number, layerRef: string): CADInsert {
        return new CADInsert(crypto.randomUUID() as EntityId, blockName, { ...insertPoint }, scaleX, scaleY, rotation, layerRef);
    }
}
