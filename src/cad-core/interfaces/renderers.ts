import { DraftingModel } from '../contracts/models';

export interface IRenderer {
    render(model: DraftingModel): Promise<ArrayBuffer>;
}

export interface IDxfRenderer extends IRenderer {
    readonly supportedVersions: ReadonlyArray<string>;
}

export interface ISvgRenderer extends IRenderer {
    readonly useInlineStyles: boolean;
}
