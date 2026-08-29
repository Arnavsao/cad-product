import { IDraftingEntity } from '../interfaces/entities';

export interface DiffReport {
    summary: {
        baselineCount: number;
        currentCount: number;
        unchanged: number;
        added: number;
        removed: number;
        modified: number;
    };
    added: IDraftingEntity[];
    removed: IDraftingEntity[];
    modified: { baseline: IDraftingEntity, current: IDraftingEntity, changes: string[] }[];
}

export class DrawingDiffEngine {

    public static compare(baseline: IDraftingEntity[], current: IDraftingEntity[]): DiffReport {
        const added: IDraftingEntity[] = [];
        const removed: IDraftingEntity[] = [];
        const modified: { baseline: IDraftingEntity, current: IDraftingEntity, changes: string[] }[] = [];

        // 1. Map by Hash Signatures for exact matches
        const baselineMap = new Map<string, IDraftingEntity>();
        const currentMap = new Map<string, IDraftingEntity>();

        baseline.forEach(e => baselineMap.set(this.generateHash(e), e));
        current.forEach(e => currentMap.set(this.generateHash(e), e));

        const unchanged = new Set<string>();

        // Find Unchanged and Removed
        for (const [hash, baseEntity] of baselineMap.entries()) {
            if (currentMap.has(hash)) {
                unchanged.add(hash);
            } else {
                removed.push(baseEntity);
            }
        }

        // Find Added
        for (const [hash, currEntity] of currentMap.entries()) {
            if (!baselineMap.has(hash)) {
                added.push(currEntity);
            }
        }

        // 2. Attempt to detect Modifications from the Added/Removed pools
        // If an entity was "removed" and another was "added" of the same type and near identical bounding box center, 
        // it was likely modified (e.g. layer change, dimension text change).
        const finalAdded: IDraftingEntity[] = [];
        const finalRemoved = [...removed];

        for (const addEnt of added) {
            let foundModification = false;
            
            for (let i = 0; i < finalRemoved.length; i++) {
                const remEnt = finalRemoved[i];
                if (remEnt.draftingType === addEnt.draftingType) {
                    const centerBase = this.getCenter(remEnt);
                    const centerCurr = this.getCenter(addEnt);
                    
                    const dist = Math.sqrt((centerBase.x - centerCurr.x)**2 + (centerBase.y - centerCurr.y)**2);
                    if (dist < 1.0) { // Tolerance for "same location"
                        const changes = this.detectPropertyChanges(remEnt, addEnt);
                        if (changes.length > 0) {
                            modified.push({ baseline: remEnt, current: addEnt, changes });
                            finalRemoved.splice(i, 1);
                            foundModification = true;
                            break;
                        }
                    }
                }
            }

            if (!foundModification) {
                finalAdded.push(addEnt);
            }
        }

        return {
            summary: {
                baselineCount: baseline.length,
                currentCount: current.length,
                unchanged: unchanged.size,
                added: finalAdded.length,
                removed: finalRemoved.length,
                modified: modified.length
            },
            added: finalAdded,
            removed: finalRemoved,
            modified
        };
    }

    private static getCenter(e: IDraftingEntity): {x: number, y: number} {
        const bbox = e.boundingBox;
        if (!bbox) return { x: 0, y: 0 };
        return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
    }

    private static detectPropertyChanges(base: any, curr: any): string[] {
        const changes: string[] = [];
        if (base.layerRef !== curr.layerRef) changes.push(`Layer changed from ${base.layerRef} to ${curr.layerRef}`);
        if (base.text !== curr.text && curr.text !== undefined) changes.push(`Text changed from "${base.text}" to "${curr.text}"`);
        if (base.lineType !== curr.lineType) changes.push(`Linetype changed from ${base.lineType} to ${curr.lineType}`);
        if (base.radius && curr.radius && Math.abs(base.radius - curr.radius) > 0.001) changes.push(`Radius changed from ${base.radius} to ${curr.radius}`);
        return changes;
    }

    private static generateHash(e: any): string {
        let geomPart = '';
        const dt = e.draftingType;
        
        if (dt === 'CADLine' || dt === 'Line') {
            const p1 = e.start || e.p1;
            const p2 = e.end || e.p2;
            geomPart = `${p1.x.toFixed(2)},${p1.y.toFixed(2)}-${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
        } else if (dt === 'Arc' || dt === 'CADArc' || dt === 'CADCircle') {
            geomPart = `${e.center.x.toFixed(2)},${e.center.y.toFixed(2)}-R${e.radius.toFixed(2)}`;
        } else if (dt === 'CADBlock' || dt === 'CADInsert') {
            const p = e.basePoint || e.insertPoint || {x:0,y:0};
            geomPart = `${e.name || e.blockName}-${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        } else if (dt.includes('Dimension') || dt === 'Text' || dt === 'CADMText') {
            const p = e.textLoc || e.textLocation || e.position || {x:0,y:0};
            geomPart = `${p.x.toFixed(2)},${p.y.toFixed(2)}-${e.text}`;
        } else if (e.points || e.boundaryPoints) {
            const pts = e.points || e.boundaryPoints;
            geomPart = pts.map((p:any) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('|');
        } else {
            geomPart = `${e.boundingBox?.minX.toFixed(2)},${e.boundingBox?.minY.toFixed(2)}`;
        }

        // Include layers and styles in hash so modification detection catches them
        return `${dt}::${geomPart}::L:${e.layerRef}::LT:${e.lineType}`;
    }
}
