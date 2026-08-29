import { BaseEntity } from '../../../core/BaseEntity';
import { IDraftingEntity } from '../../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../../types';

function createBBox(pts: Point3D[]) {
    if (!pts || pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return {
        minX: Math.min(...pts.map(p => p.x)),
        minY: Math.min(...pts.map(p => p.y)),
        maxX: Math.max(...pts.map(p => p.x)),
        maxY: Math.max(...pts.map(p => p.y))
    };
}

export class CADPoint extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADPoint';
    constructor(id: EntityId, public point: Point3D, public layerRef: string) {
        super(id, createBBox([point]), null);
    }
}

export class CADLWPolyline extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADLWPolyline';
    constructor(id: EntityId, public points: Point3D[], public isClosed: boolean, public layerRef: string) {
        super(id, createBBox(points), null);
    }
}

export class CADPolygon extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADPolygon';
    constructor(id: EntityId, public points: Point3D[], public layerRef: string) {
        super(id, createBBox(points), null);
    }
}

export class CADRectangle extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADRectangle';
    constructor(id: EntityId, public x: number, public y: number, public w: number, public h: number, public layerRef: string) {
        super(id, createBBox([{ x, y, z: 0 }, { x: x + w, y: y + h, z: 0 }]), null);
    }
}

export class CADCircle extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADCircle';
    constructor(id: EntityId, public center: Point3D, public radius: number, public layerRef: string) {
        super(id, createBBox([center]), null); // Simplification
    }
}

export class CADSpline extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADSpline';
    constructor(
        id: EntityId,
        public fitPoints: Point3D[],
        public layerRef: string,
        public controlPoints?: Point3D[],
        public degree?: number
    ) {
        super(id, createBBox(fitPoints.length ? fitPoints : (controlPoints || [])), null);
    }
}

export class CADRegion extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADRegion';
    constructor(id: EntityId, public boundaryPoints: Point3D[], public layerRef: string) {
        super(id, createBBox(boundaryPoints), null);
    }
}

export class CADMText extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADMText';
    constructor(id: EntityId, public position: Point3D, public text: string, public boxWidth: number, public layerRef: string) {
        super(id, createBBox([position]), null);
    }
}

export class CADAttributeDefinition extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADAttributeDefinition';
    constructor(id: EntityId, public position: Point3D, public tag: string, public prompt: string, public layerRef: string) {
        super(id, createBBox([position]), null);
    }
}

export class CADAttribute extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADAttribute';
    constructor(id: EntityId, public position: Point3D, public tag: string, public value: string, public layerRef: string) {
        super(id, createBBox([position]), null);
    }
}

export class CADLeader extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADLeader';
    constructor(id: EntityId, public points: Point3D[], public layerRef: string) {
        super(id, createBBox(points), null);
    }
}

export class CADMLeader extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADMLeader';
    constructor(id: EntityId, public points: Point3D[], public text: string, public layerRef: string, public rotation: number = 0) {
        super(id, createBBox(points), null);
    }
}

export class CADRevisionCloud extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADRevisionCloud';
    constructor(id: EntityId, public points: Point3D[], public layerRef: string) {
        super(id, createBBox(points), null);
    }
}

export class CADCallout extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADCallout';
    constructor(id: EntityId, public points: Point3D[], public text: string, public layerRef: string, public rotation: number = 0) {
        super(id, createBBox(points), null);
    }
}

export class CADLinearDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADLinearDimension';
    constructor(
        id: EntityId,
        public p1: Point3D,
        public p2: Point3D,
        public textLoc: Point3D,
        public text: string,
        public angle: number,
        public layerRef: string,
        public associatedEntityIds: EntityId[] = [],
        public dimStyle: string = 'STANDARD'
    ) {
        super(id, createBBox([p1, p2, textLoc]), null);
    }
}

export class CADAngularDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADAngularDimension';
    constructor(
        id: EntityId,
        public center: Point3D,
        public p1: Point3D,
        public p2: Point3D,
        public textLoc: Point3D,
        public layerRef: string,
        public associatedEntityIds: EntityId[] = [],
        public dimStyle: string = 'STANDARD'
    ) {
        super(id, createBBox([center, p1, p2, textLoc]), null);
    }
}

export class CADRadiusDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADRadiusDimension';
    constructor(
        id: EntityId,
        public center: Point3D,
        public p1: Point3D,
        public textLoc: Point3D,
        public layerRef: string,
        public associatedEntityIds: EntityId[] = [],
        public dimStyle: string = 'STANDARD'
    ) {
        super(id, createBBox([center, p1, textLoc]), null);
    }
}

export class CADDiameterDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADDiameterDimension';
    constructor(
        id: EntityId,
        public center: Point3D,
        public p1: Point3D,
        public textLoc: Point3D,
        public layerRef: string,
        public associatedEntityIds: EntityId[] = [],
        public dimStyle: string = 'STANDARD'
    ) {
        super(id, createBBox([center, p1, textLoc]), null);
    }
}

export class CADOrdinateDimension extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADOrdinateDimension';
    constructor(id: EntityId, public featureLoc: Point3D, public textLoc: Point3D, public isXAxis: boolean, public layerRef: string) {
        super(id, createBBox([featureLoc, textLoc]), null);
    }
}

export class CADTable extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADTable';
    constructor(
        id: EntityId,
        public position: Point3D,
        public rows: number,
        public cols: number,
        public rowHeight: number,
        public colWidth: number,
        public data: string[][],
        public layerRef: string
    ) {
        super(id, createBBox([position, { x: position.x + cols * colWidth, y: position.y + rows * rowHeight, z: 0 }]), null);
    }
}

export class CADXref extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'CADXref';
    constructor(
        id: EntityId,
        public filePath: string,
        public position: Point3D,
        public scale: number,
        public rotation: number,
        public layerRef: string
    ) {
        super(id, createBBox([position]), null);
    }
}
