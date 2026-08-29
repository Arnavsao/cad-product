import { DraftingModel } from '../../contracts/models';
import { IDraftingEntity } from '../../interfaces/entities';
import { Sheet } from './Sheet';

export class DraftingModelImpl implements DraftingModel {
    /**
     * Top-level flattened view of all entities (required by DraftingModel contract for flat renderers)
     */
    public readonly entities: ReadonlyArray<IDraftingEntity>;
    
    constructor(
        public readonly sheets: ReadonlyArray<Sheet>
    ) {
        // Flatten all entities from all viewports to satisfy the agnostic DraftingModel contract
        const allEntities: IDraftingEntity[] = [];
        for (const sheet of sheets) {
            for (const viewport of sheet.viewports) {
                allEntities.push(...viewport.entities);
            }
        }
        this.entities = Object.freeze(allEntities);
    }
}
