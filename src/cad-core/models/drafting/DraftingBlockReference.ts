import { BaseEntity } from '../../core/BaseEntity';
import { IDraftingEntity } from '../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../types';

export class DraftingBlockReference extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'Block';

    constructor(
        id: EntityId,
        public readonly blockName: string,
        public readonly insertionPoint: Point3D,
        public readonly scaleX: number,
        public readonly scaleY: number,
        public readonly rotation: number,
        public readonly layerRef: string,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        // Block reference bounding box is inherently generic without fetching the block definition.
        // For Phase 1, we use a 1x1 point boundary. The LayoutEngine must expand this if accurate culling is needed.
        super(id, {
            minX: insertionPoint.x - 1,
            minY: insertionPoint.y - 1,
            maxX: insertionPoint.x + 1,
            maxY: insertionPoint.y + 1
        }, sourceEntityId, metadata);
    }

    public static create(blockName: string, point: Point3D, layerRef: string, sourceId: SourceEntityId = null): DraftingBlockReference {
        return new DraftingBlockReference(crypto.randomUUID() as EntityId, blockName, point, 1, 1, 0, layerRef, sourceId);
    }
}
