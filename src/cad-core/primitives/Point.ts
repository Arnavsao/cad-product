import { EntityId, SourceEntityId, BoundingBox } from '../types';
import { Transform } from '../math/Transform';
import { Vector } from './Vector';
import { isEqual, isValidFloat } from '../math/tolerance';
import { IGeometryEntity } from '../interfaces/entities';

/**
 * Immutable Point primitive operating in the Local Coordinate System.
 * Fully implements the BaseEntity trait for spatial tracking.
 */
export class Point implements IGeometryEntity {
    public readonly primitiveType = 'Point';
    public readonly id: EntityId;
    public readonly boundingBox: BoundingBox;

    constructor(
        public readonly x: number,
        public readonly y: number,
        public readonly z: number = 0,
        public readonly sourceEntityId: SourceEntityId = null,
        public readonly metadata: ReadonlyMap<string, string> = new Map()
    ) {
        if (!isValidFloat(x) || !isValidFloat(y) || !isValidFloat(z)) {
            throw new Error('Point coordinates must be finite numbers');
        }
        this.id = crypto.randomUUID() as EntityId;
        this.boundingBox = { minX: x, minY: y, maxX: x, maxY: y }; // O(1) bounding box
    }

    public translate(v: Vector): Point {
        // Enforce strict immutability by returning a new instance
        return new Point(this.x + v.dx, this.y + v.dy, this.z + v.dz, this.sourceEntityId, this.metadata);
    }

    public transform(t: Transform): Point {
        const nx = t.get(0, 0) * this.x + t.get(0, 1) * this.y + t.get(0, 2) * this.z + t.get(0, 3);
        const ny = t.get(1, 0) * this.x + t.get(1, 1) * this.y + t.get(1, 2) * this.z + t.get(1, 3);
        const nz = t.get(2, 0) * this.x + t.get(2, 1) * this.y + t.get(2, 2) * this.z + t.get(2, 3);
        return new Point(nx, ny, nz, this.sourceEntityId, this.metadata);
    }

    public distanceTo(other: Point): number {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public equals(other: Point): boolean {
        return isEqual(this.x, other.x) && isEqual(this.y, other.y) && isEqual(this.z, other.z);
    }
}
