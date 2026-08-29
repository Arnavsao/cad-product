export type EntityId = string & { readonly __brand: unique symbol };
export type SourceEntityId = EntityId | null;

export interface Point2D {
    readonly x: number;
    readonly y: number;
}

export interface Point3D extends Point2D {
    readonly z: number;
}

export interface Vector2D {
    readonly dx: number;
    readonly dy: number;
}

export interface Vector3D extends Vector2D {
    readonly dz: number;
}

export type TransformMatrix = readonly [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
];

export interface BoundingBox {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}
