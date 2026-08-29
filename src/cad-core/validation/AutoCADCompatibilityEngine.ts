import { IDraftingEntity } from '../interfaces/entities';

export type AutoCADVersion = 'R2010' | 'R2013' | 'R2018' | 'R2024';

export interface CompatibilityReport {
    version: AutoCADVersion;
    isFullyCompatible: boolean;
    warnings: string[];
    errors: string[];
    unsupportedEntities: IDraftingEntity[];
}

export class AutoCADCompatibilityEngine {
    
    public static validate(entities: IDraftingEntity[], targetVersion: AutoCADVersion): CompatibilityReport {
        const report: CompatibilityReport = {
            version: targetVersion,
            isFullyCompatible: true,
            warnings: [],
            errors: [],
            unsupportedEntities: []
        };

        for (const e of entities) {
            const dt = e.draftingType;

            // 1. Hatches
            if ((dt as string) === 'CADHatch' || dt === 'Hatch') {
                const hatch = e as any;
                if (targetVersion === 'R2010' && hatch.patternName && hatch.patternName.includes('GRADIENT')) {
                    report.errors.push(`Gradient Hatches are not cleanly supported in R2010 DXF parsers. Fallback to solid or line patterns.`);
                    report.unsupportedEntities.push(e);
                    report.isFullyCompatible = false;
                }
            }

            // 2. MText
            if (dt === 'CADMText') {
                const mtext = e as any;
                if ((targetVersion === 'R2010' || targetVersion === 'R2013') && mtext.text.length > 250) {
                    report.warnings.push(`MText strings over 250 characters can cause text wrapping instability in ${targetVersion}.`);
                }
            }

            // 3. Associative Dimensions
            if (dt && dt.includes('Dimension')) {
                const dim = e as any;
                if (targetVersion === 'R2010' && dim.associatedEntityIds && dim.associatedEntityIds.length > 0) {
                    report.warnings.push(`True parametric dimension associativity may break when importing R2018 objects into R2010.`);
                }
            }

            // 4. Layers
            if (e.layerRef) {
                if (e.layerRef.length > 255) {
                    report.errors.push(`Layer name exceeds AutoCAD standard limits (255 chars).`);
                    report.isFullyCompatible = false;
                }
                if (/[<>/\\":;?*|`]/.test(e.layerRef)) {
                    report.errors.push(`Layer name ${e.layerRef} contains invalid characters for AutoCAD.`);
                    report.isFullyCompatible = false;
                }
            }

            // 5. Blocks
            if (dt === 'CADBlock') {
                const block = e as any;
                if (block.name.length > 255 || /[<>/\\":;?*|`]/.test(block.name)) {
                    report.errors.push(`Block name ${block.name} is invalid for AutoCAD.`);
                    report.unsupportedEntities.push(e);
                    report.isFullyCompatible = false;
                }
            }
        }

        return report;
    }
}
