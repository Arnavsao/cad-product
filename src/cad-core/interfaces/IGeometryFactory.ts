import { BaseEntity } from '../core/BaseEntity';

export interface IGeometryPrimitive extends BaseEntity {
    readonly primitiveType: 'Point' | 'Line' | 'Arc' | 'Polygon';
}

/**
 * Pure mathematical geometry factory interface.
 * Operates strictly in the Local Coordinate System (LCS).
 */
export interface IGeometryFactory {
    createPoint(x: number, y: number, z: number): IGeometryPrimitive;
    createLine(start: IGeometryPrimitive, end: IGeometryPrimitive): IGeometryPrimitive;
}
