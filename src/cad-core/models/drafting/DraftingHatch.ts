import { BaseEntity } from '../../core/BaseEntity';
import { IDraftingEntity } from '../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../types';

export class DraftingHatch extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'Hatch';

    constructor(
        id: EntityId,
        public readonly boundaryPoints: ReadonlyArray<Point3D>,
        public readonly patternName: string,
        public readonly scale: number,
        public readonly angle: number,
        public readonly layerRef: string,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of boundaryPoints) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        super(id, { minX, minY, maxX, maxY }, sourceEntityId, metadata);
    }

    public static create(boundaryPoints: Point3D[], pattern: string, scale: number, layerRef: string, sourceId: SourceEntityId = null): DraftingHatch {
        return new DraftingHatch(crypto.randomUUID() as EntityId, [...boundaryPoints], pattern, scale, 0, layerRef, sourceId);
    }
}
