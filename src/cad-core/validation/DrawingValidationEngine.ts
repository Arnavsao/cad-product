import { IDraftingEntity } from '../interfaces/entities';

export interface ValidationIssue {
    severity: 'WARNING' | 'CRITICAL';
    entityId?: string;
    draftingType?: string;
    message: string;
    suggestedFix?: string;
}

export class DrawingValidationEngine {
    
    public static validate(entities: IDraftingEntity[]): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        const seenSignatures = new Set<string>();
        const definedBlocks = new Set<string>();
        
        // Allowed ISO Standards Layers
        const allowedLayers = new Set(['01_ELEVATION', '02_DIMENSIONS', '03_HATCH', '04_HIDDEN', '05_ANNOTATIONS', '00_DEFAULT', 'DEFAULT', '0']);

        // First pass: Index block definitions
        for (const e of entities) {
            if (e.draftingType === 'CADBlock') {
                definedBlocks.add((e as any).name);
            }
        }

        for (const e of entities) {
            // 0. Layer Violations
            if (e.layerRef && !allowedLayers.has(e.layerRef)) {
                issues.push({ 
                    severity: 'WARNING', 
                    entityId: e.id, 
                    draftingType: e.draftingType, 
                    message: `Entity is on an invalid layer: ${e.layerRef}`,
                    suggestedFix: `Move the entity to an approved standard layer like '01_ELEVATION' or '05_ANNOTATIONS'.`
                });
            }

            // 1. Zero-Length Lines
            if (e.draftingType === 'CADLine' || e.draftingType === 'Line') {
                const line = e as any;
                const p1 = line.start || line.p1;
                const p2 = line.end || line.p2;
                if (p1 && p2) {
                    const length = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
                    if (length < 0.0001) {
                        issues.push({ 
                            severity: 'CRITICAL', 
                            entityId: e.id, 
                            draftingType: e.draftingType, 
                            message: `Zero-length line detected.`,
                            suggestedFix: `Delete this line or correct the start/end coordinate math.`
                        });
                    }
                    
                    // 2. Duplicate Lines Detection
                    const sig1 = `${p1.x.toFixed(3)},${p1.y.toFixed(3)}-${p2.x.toFixed(3)},${p2.y.toFixed(3)}`;
                    const sig2 = `${p2.x.toFixed(3)},${p2.y.toFixed(3)}-${p1.x.toFixed(3)},${p1.y.toFixed(3)}`;
                    if (seenSignatures.has(sig1) || seenSignatures.has(sig2)) {
                        issues.push({ 
                            severity: 'WARNING', 
                            entityId: e.id, 
                            draftingType: e.draftingType, 
                            message: `Duplicate collinear line detected.`,
                            suggestedFix: `Remove overlapping geometry to prevent plotting artifacts.`
                        });
                    }
                    seenSignatures.add(sig1);
                }
            }

            // 3. Open Polylines & Invalid Hatches
            if ((e.draftingType as string) === 'CADHatch' || e.draftingType === 'Hatch') {
                const hatch = e as any;
                const pts = hatch.boundaryPoints;
                if (!pts || pts.length < 3) {
                    issues.push({ 
                        severity: 'CRITICAL', 
                        entityId: e.id, 
                        draftingType: e.draftingType, 
                        message: `Hatch boundary has fewer than 3 points.`,
                        suggestedFix: `Ensure the hatch generation loops emit at least 3 distinct vertices.`
                    });
                } else {
                    const first = pts[0];
                    const last = pts[pts.length - 1];
                    const isClosed = Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001;
                    if (!isClosed) {
                        issues.push({ 
                            severity: 'WARNING', 
                            entityId: e.id, 
                            draftingType: e.draftingType, 
                            message: `Hatch boundary is not perfectly closed.`,
                            suggestedFix: `Force the final boundary point to mathematically equal the first point.`
                        });
                    }
                }
            }

            // 4. Invalid Arcs
            if (e.draftingType === 'Arc') {
                const arc = e as any;
                if (arc.radius <= 0) {
                    issues.push({ 
                        severity: 'CRITICAL', 
                        entityId: e.id, 
                        draftingType: e.draftingType, 
                        message: `Arc has zero or negative radius.`,
                        suggestedFix: `Verify radius math for haunches and fillets.`
                    });
                }
                if (Math.abs(arc.startAngle - arc.endAngle) < 0.001) {
                    issues.push({ 
                        severity: 'WARNING', 
                        entityId: e.id, 
                        draftingType: e.draftingType, 
                        message: `Arc sweep angle is near zero.`,
                        suggestedFix: `Ensure the arc sweeps an angle greater than 0.001 radians.`
                    });
                }
            }

            // 5. Invalid Dimensions
            if (e.draftingType && e.draftingType.includes('Dimension')) {
                const dim = e as any;
                if (!dim.text && e.draftingType !== 'CADRadiusDimension' && e.draftingType !== 'CADDiameterDimension') {
                    issues.push({ 
                        severity: 'WARNING', 
                        entityId: e.id, 
                        draftingType: e.draftingType, 
                        message: `Dimension text is empty.`,
                        suggestedFix: `Inject a valid string value for the dimension text, or rely on native AutoCAD measurement generation.`
                    });
                }
            }

            // 6. Missing Blocks
            if (e.draftingType === 'CADInsert') {
                const insert = e as any;
                if (!definedBlocks.has(insert.blockName)) {
                    issues.push({ 
                        severity: 'CRITICAL', 
                        entityId: e.id, 
                        draftingType: e.draftingType, 
                        message: `CADInsert references undefined block name: ${insert.blockName}.`,
                        suggestedFix: `Ensure BlockLibrary generates the block definition BEFORE emitting the insert pointer.`
                    });
                }
            }
        }

        return issues;
    }
}
