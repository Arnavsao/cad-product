import { isValidFloat } from './tolerance';
import { Vector } from '../primitives/Vector';

/**
 * Immutable 4x4 Affine Transformation Matrix.
 * Stored internally in row-major order.
 */
export class Transform {
    private readonly m: number[];

    constructor(matrix?: number[]) {
        if (matrix) {
            if (matrix.length !== 16) throw new Error('Matrix must have exactly 16 elements');
            if (matrix.some(val => !isValidFloat(val))) throw new Error('Matrix contains invalid floats (NaN or Infinity)');
            this.m = [...matrix];
        } else {
            // Identity matrix
            this.m = [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
            ];
        }
    }

    public get(row: number, col: number): number {
        return this.m[row * 4 + col];
    }

    public multiply(other: Transform): Transform {
        const res = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += this.get(i, k) * other.get(k, j);
                }
                res[i * 4 + j] = sum;
            }
        }
        return new Transform(res);
    }

    public static translation(v: Vector): Transform {
        return new Transform([
            1, 0, 0, v.dx,
            0, 1, 0, v.dy,
            0, 0, 1, v.dz,
            0, 0, 0, 1
        ]);
    }

    public static scale(sx: number, sy: number, sz: number): Transform {
        return new Transform([
            sx, 0, 0, 0,
            0, sy, 0, 0,
            0, 0, sz, 0,
            0, 0, 0, 1
        ]);
    }
}
