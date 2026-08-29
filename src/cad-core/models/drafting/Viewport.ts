import { BaseEntity } from '../../core/BaseEntity';
import { EntityId, SourceEntityId, BoundingBox } from '../../types';
import { IDraftingEntity } from '../../interfaces/entities';

export class Viewport extends BaseEntity {
    constructor(
        id: EntityId,
        public readonly scale: number,
        public readonly paperSpaceBounds: BoundingBox,
        public readonly entities: ReadonlyArray<IDraftingEntity>,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        // A Viewport's spatial index bounding box IS its Paper Space bounds.
        super(id, paperSpaceBounds, sourceEntityId, metadata);
    }

    public static create(scale: number, bounds: BoundingBox, entities: IDraftingEntity[], sourceId: SourceEntityId = null): Viewport {
        return new Viewport(crypto.randomUUID() as EntityId, scale, bounds, [...entities], sourceId);
    }
}
