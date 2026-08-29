import { IDraftingModel } from './IDraftingModel';

/**
 * Adapter interface for all output renderers (DXF, SVG, PDF).
 * Ensures core logic remains isolated from third-party export libraries.
 */
export interface IRenderer {
    /**
     * Translates an agnostic drafting model into a specific file format byte stream.
     * @param model The fully constructed and validated DraftingModel
     * @returns A promise resolving to the binary stream of the file
     */
    render(model: IDraftingModel): Promise<ArrayBuffer>;
}
