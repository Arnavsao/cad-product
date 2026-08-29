import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

export class CADDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADDimension';

    constructor(
        id: EntityId,
        public readonly start: Point3D,
        public readonly end: Point3D,
        public readonly textLocation: Point3D,
        public readonly text: string,
        public readonly layerRef: string,
        public readonly lineType: string = 'CONTINUOUS',
        public readonly associatedEntityIds: EntityId[] = [],
        public readonly dimStyle: string = 'STANDARD',
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        // Simple AABB bound logic
        super(id, {
            minX: Math.min(start.x, end.x, textLocation.x),
            minY: Math.min(start.y, end.y, textLocation.y),
            maxX: Math.max(start.x, end.x, textLocation.x),
            maxY: Math.max(start.y, end.y, textLocation.y)
        }, sourceEntityId, metadata);
    }

    public static create(
        start: Point3D, 
        end: Point3D, 
        textLocation: Point3D, 
        text: string, 
        layerRef: string, 
        lineType: string = 'CONTINUOUS',
        associatedEntityIds: EntityId[] = [],
        dimStyle: string = 'STANDARD'
    ): CADDimension {
        return new CADDimension(
            crypto.randomUUID() as EntityId, 
            { ...start }, 
            { ...end }, 
            { ...textLocation }, 
            text, 
            layerRef, 
            lineType,
            associatedEntityIds,
            dimStyle
        );
    }
}
