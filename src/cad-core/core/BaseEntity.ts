import { EntityId, SourceEntityId, BoundingBox } from '../types';

export interface IBaseEntity {
    readonly id: EntityId;
    readonly sourceEntityId: SourceEntityId;
    readonly boundingBox: BoundingBox;
    readonly metadata: ReadonlyMap<string, string>;
}

export abstract class BaseEntity implements IBaseEntity {
    constructor(
        public readonly id: EntityId,
        public readonly boundingBox: BoundingBox,
        public readonly sourceEntityId: SourceEntityId = null,
        public readonly metadata: ReadonlyMap<string, string> = new Map()
    ) {}
}
