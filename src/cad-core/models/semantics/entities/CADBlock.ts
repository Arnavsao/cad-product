import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

export class CADBlock extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADBlock';

    constructor(
        id: EntityId,
        public readonly name: string,
        public readonly basePoint: Point3D,
        public readonly entities: ReadonlyArray<IDraftingEntity>,
        public readonly layerRef: string,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        super(id, { minX: basePoint.x, minY: basePoint.y, maxX: basePoint.x, maxY: basePoint.y }, sourceEntityId, metadata);
        Object.freeze(this.entities);
    }

    public static create(name: string, basePoint: Point3D, entities: IDraftingEntity[]): CADBlock {
        return new CADBlock(crypto.randomUUID() as EntityId, name, { ...basePoint }, [...entities], '0');
    }
}
