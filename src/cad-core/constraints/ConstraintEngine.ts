import { IDraftingEntity } from '../interfaces/entities';
import { EntityId } from '../types';
import { ValidationIssue } from '../validation/DrawingValidationEngine';

export type ConstraintType = 'Parallel' | 'Perpendicular' | 'Coincident' | 'Tangent' | 'Concentric' | 'Horizontal' | 'Vertical';

export interface GeometricConstraint {
    id: string;
    type: ConstraintType;
    entityIds: EntityId[]; // The IDs of entities involved
    metadata?: any;
}

export class ConstraintEngine {
    
    public static validate(entities: IDraftingEntity[], constraints: GeometricConstraint[]): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const entityMap = new Map<EntityId, IDraftingEntity>();
        
        for (const e of entities) {
            if (e.id) {
                entityMap.set(e.id, e);
            }
        }

        for (const c of constraints) {
            const ents = c.entityIds.map(id => entityMap.get(id));
            if (ents.some(e => !e)) {
                issues.push({ severity: 'WARNING', message: `Constraint ${c.type} references missing entities.` });
                continue;
            }

            try {
                if (c.type === 'Horizontal') {
                    const line = ents[0] as any;
                    if (line && (line.draftingType === 'Line' || line.draftingType === 'CADLine')) {
                        const p1 = line.start || line.p1;
                        const p2 = line.end || line.p2;
                        if (Math.abs(p1.y - p2.y) > 0.001) {
                            issues.push({ severity: 'CRITICAL', entityId: line.id, message: `Broken Horizontal constraint on entity ${line.id}.` });
                        }
                    }
                } 
                else if (c.type === 'Vertical') {
                    const line = ents[0] as any;
                    if (line && (line.draftingType === 'Line' || line.draftingType === 'CADLine')) {
                        const p1 = line.start || line.p1;
                        const p2 = line.end || line.p2;
                        if (Math.abs(p1.x - p2.x) > 0.001) {
                            issues.push({ severity: 'CRITICAL', entityId: line.id, message: `Broken Vertical constraint on entity ${line.id}.` });
                        }
                    }
                }
                else if (c.type === 'Parallel' && ents.length === 2) {
                    const l1 = ents[0] as any, l2 = ents[1] as any;
                    const p1 = l1.start || l1.p1, p2 = l1.end || l1.p2;
                    const q1 = l2.start || l2.p1, q2 = l2.end || l2.p2;
                    
                    const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
                    const dx2 = q2.x - q1.x, dy2 = q2.y - q1.y;
                    const cross = dx1 * dy2 - dy1 * dx2;
                    
                    if (Math.abs(cross) > 0.001) {
                        issues.push({ severity: 'CRITICAL', entityId: l1.id, message: `Broken Parallel constraint between ${l1.id} and ${l2.id}.` });
                    }
                }
                else if (c.type === 'Perpendicular' && ents.length === 2) {
                    const l1 = ents[0] as any, l2 = ents[1] as any;
                    const p1 = l1.start || l1.p1, p2 = l1.end || l1.p2;
                    const q1 = l2.start || l2.p1, q2 = l2.end || l2.p2;
                    
                    const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
                    const dx2 = q2.x - q1.x, dy2 = q2.y - q1.y;
                    const dot = dx1 * dx2 + dy1 * dy2;
                    
                    if (Math.abs(dot) > 0.001) {
                        issues.push({ severity: 'CRITICAL', entityId: l1.id, message: `Broken Perpendicular constraint between ${l1.id} and ${l2.id}.` });
                    }
                }
                else if (c.type === 'Concentric' && ents.length === 2) {
                    const c1 = ents[0] as any, c2 = ents[1] as any;
                    const center1 = c1.center, center2 = c2.center;
                    if (Math.abs(center1.x - center2.x) > 0.001 || Math.abs(center1.y - center2.y) > 0.001) {
                        issues.push({ severity: 'CRITICAL', entityId: c1.id, message: `Broken Concentric constraint between ${c1.id} and ${c2.id}.` });
                    }
                }
                else if (c.type === 'Coincident' && ents.length === 2) {
                    // Requires metadata to know which points are coincident (e.g. start, end, center)
                    // Stubbed logic for now
                    if (c.metadata && c.metadata.validateCoincidence) {
                        // Check distance
                    }
                }
            } catch (err) {
                issues.push({ severity: 'WARNING', message: `Failed to evaluate constraint ${c.id}: ${err}` });
            }
        }
        
        return issues;
    }
}
