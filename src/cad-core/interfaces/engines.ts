import { GeometryModel, LayoutModel, DraftingModel, ValidationResult } from '../contracts/models';
import { BoundingBox } from '../types';
import { IGeometryEntity } from './entities';

export interface IGeometryEngine {
    generate(domainModel: any): GeometryModel;
}

export interface ILayoutEngine {
    arrange(geometryModel: GeometryModel): LayoutModel;
}

export interface IAnnotationEngine {
    annotate(layoutModel: LayoutModel): DraftingModel;
}

export interface ISpatialIndex {
    insert(entity: IGeometryEntity): void;
    query(bounds: BoundingBox): ReadonlyArray<IGeometryEntity>;
    remove(entityId: string): void;
}

export interface IValidationEngine {
    validateDomain(domainModel: any): ValidationResult;
    validateGeometry(geometryModel: GeometryModel): ValidationResult;
    validateDrafting(draftingModel: DraftingModel): ValidationResult;
}
