import { BaseEntity } from '../../core/BaseEntity';
import { IDraftingEntity } from '../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../types';
import { isValidFloat } from '../../math/tolerance';
import { GeometryError } from '../../core/errors';

/**
 * Immutable concrete implementation of a drafting line segment.
 * Represents a straight linear segment between a start and end point in Paper/Model Space.
 * Extends BaseEntity to automatically participate in Spatial Indexing via its calculated BoundingBox.
 */
export class DraftingLine extends BaseEntity implements IDraftingEntity {
    /** The distinct architectural type string required by flat renderers (e.g. DXF Adapters) */
    public readonly draftingType = 'Line';

    /**
     * Internal constructor. Use DraftingLine.create() for safe instantiation.
     * @param id Unique nominal EntityId.
     * @param start Starting coordinate.
     * @param end Ending coordinate.
     * @param layerRef Layer mapping identifier (e.g., 'Main_Girders').
     * @param sourceEntityId Optional back-reference to the parent Domain logic.
     * @param metadata Optional metadata map for DXF extended data.
     */
    constructor(
        id: EntityId,
        public readonly start: Point3D,
        public readonly end: Point3D,
        public readonly layerRef: string,
        public readonly lineType: string = 'CONTINUOUS',
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        super(id, {
            minX: Math.min(start.x, end.x),
            minY: Math.min(start.y, end.y),
            maxX: Math.max(start.x, end.x),
            maxY: Math.max(start.y, end.y)
        }, sourceEntityId, metadata);

        // Shallow freeze properties to strictly enforce structural immutability downstream
        Object.freeze(this.start);
        Object.freeze(this.end);
    }

    /**
     * Safely constructs a DraftingLine, generating a fresh UUID and calculating the AABB.
     * Enforces strict tolerance and business validation at the boundary.
     * 
     * @throws {GeometryError} if the input points contain NaN/Infinity or the layer is empty.
     */
    public static create(start: Point3D, end: Point3D, layerRef: string, lineType: string = 'CONTINUOUS', sourceId: SourceEntityId = null): DraftingLine {
        if (!isValidFloat(start.x) || !isValidFloat(start.y) || !isValidFloat(end.x) || !isValidFloat(end.y)) {
            throw new GeometryError('Line coordinates must be finite valid numbers.');
        }

        if (!layerRef || layerRef.trim() === '') {
            throw new GeometryError('DraftingLine requires a valid layer reference.');
        }

        // Clone the input points defensively so external mutation of the raw objects won't affect the model
        return new DraftingLine(crypto.randomUUID() as EntityId, { ...start }, { ...end }, layerRef, lineType, sourceId);
    }
}
