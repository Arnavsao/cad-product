import { IGeometryEntity, IDraftingEntity } from '../interfaces/entities';
import { ValidationError } from '../core/errors';

export interface GeometryModel {
    readonly primitives: ReadonlyArray<IGeometryEntity>;
}

export interface DraftingModel {
    readonly entities: ReadonlyArray<IDraftingEntity>;
}

export interface LayoutModel {
    readonly sheets: ReadonlyArray<any>; 
}

export interface ValidationResult {
    readonly isValid: boolean;
    readonly errors: ReadonlyArray<ValidationError>;
    readonly warnings: ReadonlyArray<string>;
}
