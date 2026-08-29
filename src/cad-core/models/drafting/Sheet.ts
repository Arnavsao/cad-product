import { BaseEntity } from '../../core/BaseEntity';
import { EntityId, SourceEntityId } from '../../types';
import { Viewport } from './Viewport';

export class Sheet extends BaseEntity {
    constructor(
        id: EntityId,
        public readonly width: number,
        public readonly height: number,
        public readonly viewports: ReadonlyArray<Viewport>,
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        // A Sheet's bounding box is simply [0, 0, width, height] in Paper Space coordinates.
        super(id, { minX: 0, minY: 0, maxX: width, maxY: height }, sourceEntityId, metadata);
    }

    public static create(width: number, height: number, viewports: Viewport[]): Sheet {
        return new Sheet(crypto.randomUUID() as EntityId, width, height, [...viewports]);
    }
}
