import { isEqual, isZero, isValidFloat } from '../math/tolerance';

/**
 * Immutable Vector primitive representing magnitude and direction.
 */
export class Vector {
    constructor(
        public readonly dx: number,
        public readonly dy: number,
        public readonly dz: number = 0
    ) {
        if (!isValidFloat(dx) || !isValidFloat(dy) || !isValidFloat(dz)) {
            throw new Error('Vector components must be finite numbers');
        }
    }

    public magnitude(): number {
        return Math.sqrt(this.dx * this.dx + this.dy * this.dy + this.dz * this.dz);
    }

    public normalize(): Vector {
        const mag = this.magnitude();
        if (isZero(mag)) {
            throw new Error('Cannot normalize a zero vector');
        }
        return new Vector(this.dx / mag, this.dy / mag, this.dz / mag);
    }

    public dot(other: Vector): number {
        return this.dx * other.dx + this.dy * other.dy + this.dz * other.dz;
    }

    public cross(other: Vector): Vector {
        return new Vector(
            this.dy * other.dz - this.dz * other.dy,
            this.dz * other.dx - this.dx * other.dz,
            this.dx * other.dy - this.dy * other.dx
        );
    }

    public add(other: Vector): Vector {
        return new Vector(this.dx + other.dx, this.dy + other.dy, this.dz + other.dz);
    }

    public scale(scalar: number): Vector {
        if (!isValidFloat(scalar)) throw new Error('Scalar must be finite');
        return new Vector(this.dx * scalar, this.dy * scalar, this.dz * scalar);
    }

    public equals(other: Vector): boolean {
        return isEqual(this.dx, other.dx) && isEqual(this.dy, other.dy) && isEqual(this.dz, other.dz);
    }
}
