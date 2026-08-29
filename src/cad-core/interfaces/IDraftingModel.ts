import { BaseEntity } from '../core/BaseEntity';

/** Base interface for stylized paper-space visual elements */
export interface IDraftingEntity extends BaseEntity {
    readonly layerRef: string;
}

/** Represents a Model Space window mapped to Paper Space */
export interface IViewport extends BaseEntity {
    readonly scale: number;
}

/** Represents a physical drawing medium (e.g., A0) */
export interface ISheet extends BaseEntity {
    readonly viewports: ReadonlyArray<IViewport>;
}

/**
 * The agnostic Paper Space representation that bridges the math engine 
 * to the specific file renderers.
 */
export interface IDraftingModel {
    readonly sheets: ReadonlyArray<ISheet>;
    readonly entities: ReadonlyArray<IDraftingEntity>;
}
