import { IBaseEntity } from '../core/BaseEntity';

export interface IDomainEntity extends IBaseEntity {
    readonly domainType: string;
}

export interface IGeometryEntity extends IBaseEntity {
    readonly primitiveType: 'Point' | 'Line' | 'Arc' | 'Circle' | 'Polyline' | 'Polygon';
}

export interface IDraftingEntity extends IBaseEntity {
    readonly layerRef: string;
    readonly lineType?: string;
    readonly draftingType: 'Text' | 'Dimension' | 'Hatch' | 'Block' | 'Line' | 'Arc' | 'CADLine' | 'CADPolyline' | 'CADBlock' | 'CADInsert' | 'CADEllipse' | 'CADDimension' | 'CADPoint' | 'CADLWPolyline' | 'CADPolygon' | 'CADRectangle' | 'CADCircle' | 'CADSpline' | 'CADRegion' | 'CADMText' | 'CADAttributeDefinition' | 'CADAttribute' | 'CADLeader' | 'CADMLeader' | 'CADRevisionCloud' | 'CADCallout' | 'CADLinearDimension' | 'CADAngularDimension' | 'CADRadiusDimension' | 'CADDiameterDimension' | 'CADOrdinateDimension' | 'CADTable' | 'CADXref' | 'AagentoDimension';
}
