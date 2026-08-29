import { DraftingLine, DraftingArc, DraftingText, DraftingHatch } from '../../models/drafting';
import { IDraftingEntity } from '../../interfaces/entities';

export class TranslationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TranslationError';
    }
}

/**
 * $O(1)$ Entity Translator that converts mathematically pristine Drafting Models
 * into raw AutoLISP DXF array chunks. Enforces floating-point bounds and AutoCAD quirks.
 */
export class EntityTranslator {
    
    public static translate(entity: IDraftingEntity): string[] {
        switch (entity.draftingType) {
            case 'Line': return this.translateLine(entity as DraftingLine);
            case 'Arc': return this.translateArc(entity as DraftingArc);
            case 'Text': return this.translateText(entity as DraftingText);
            case 'Hatch': return this.translateHatch(entity as DraftingHatch);
            default:
                throw new TranslationError(`Unsupported drafting entity type: ${entity.draftingType}`);
        }
    }

    private static getLayerAndColor(layerRef: string): string[] {
        // Simple heuristic: if layerRef is a color code from the Multiplexer, map it to a layer name and color integer
        // Default to ANNOTATIONS/RED for simplicity, but can be expanded
        let layerName = 'ELEVATION';
        let colorInt = '1'; // Red
        
        if (layerRef === '#0000ff' || layerRef === 'blue') {
            layerName = 'DIMENSIONS';
            colorInt = '5'; // Blue
        } else if (layerRef === '#ff0000' || layerRef === 'red') {
            layerName = 'ELEVATION';
            colorInt = '1';
        } else if (!layerRef.startsWith('#')) {
            layerName = layerRef;
            colorInt = '7'; // White/Black
        }

        return ['8', layerName, '62', colorInt];
    }

    private static translateLine(line: DraftingLine): string[] {
        this.ensureFinite(line.start.x, line.start.y, line.end.x, line.end.y);
        
        const dx = line.end.x - line.start.x;
        const dy = line.end.y - line.start.y;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
            throw new TranslationError('Zero length line');
        }

        return [
            '0', 'LINE',
            ...this.getLayerAndColor(line.layerRef),
            '10', line.start.x.toFixed(4),
            '20', line.start.y.toFixed(4),
            '30', '0.0',
            '11', line.end.x.toFixed(4),
            '21', line.end.y.toFixed(4),
            '31', '0.0'
        ];
    }

    private static translateArc(arc: DraftingArc): string[] {
        this.ensureFinite(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle);
        if (arc.radius <= 0) throw new TranslationError('Invalid arc radius');

        let saDeg = (arc.startAngle * (180 / Math.PI)) % 360;
        let eaDeg = (arc.endAngle * (180 / Math.PI)) % 360;

        if (saDeg < 0) saDeg += 360;
        if (eaDeg < 0) eaDeg += 360;

        const sweepAngle = Math.abs((arc.endAngle - arc.startAngle) * (180 / Math.PI));
        if (Math.abs(sweepAngle - 360) < 0.01 || sweepAngle === 0 || Math.abs(saDeg - eaDeg) < 0.001) {
            return [
                '0', 'CIRCLE',
                ...this.getLayerAndColor(arc.layerRef),
                '10', arc.center.x.toFixed(4),
                '20', arc.center.y.toFixed(4),
                '30', '0.0',
                '40', arc.radius.toFixed(4)
            ];
        }

        return [
            '0', 'ARC',
            ...this.getLayerAndColor(arc.layerRef),
            '10', arc.center.x.toFixed(4),
            '20', arc.center.y.toFixed(4),
            '30', '0.0',
            '40', arc.radius.toFixed(4),
            '50', saDeg.toFixed(4),
            '51', eaDeg.toFixed(4)
        ];
    }

    private static translateText(text: DraftingText): string[] {
        this.ensureFinite(text.position.x, text.position.y, text.height, text.rotation);
        if (!text.text || text.text.trim().length === 0) throw new TranslationError('Empty text string');

        let halign = 1; // Center
        if (text.alignment === 'left') halign = 0;
        else if (text.alignment === 'right') halign = 2;

        let valign = 2; // Middle
        if (text.baseline === 'bottom') valign = 1;
        else if (text.baseline === 'top') valign = 3;

        const rotDeg = text.rotation * (180 / Math.PI);

        return [
            '0', 'TEXT',
            ...this.getLayerAndColor(text.layerRef),
            '10', text.position.x.toFixed(4),
            '20', text.position.y.toFixed(4),
            '30', '0.0',
            '11', text.position.x.toFixed(4),
            '21', text.position.y.toFixed(4),
            '31', '0.0',
            '40', text.height.toFixed(4),
            '50', rotDeg.toFixed(4),
            '72', halign.toString(),
            '73', valign.toString(),
            '1', text.text
        ];
    }

    private static translateHatch(hatch: DraftingHatch): string[] {
        const b = hatch.boundaryPoints;
        if (b.length < 3) throw new TranslationError('Hatch boundary must have at least 3 vertices');
        b.forEach(p => this.ensureFinite(p.x, p.y));

        if (hatch.patternName === 'SOLID' && (b.length === 3 || b.length === 4)) {
            // AutoCAD SOLID vertex order requires specific swapping: 1, 2, 4, 3
            // Which maps to groups 10, 11, 13, 12
            const p1 = b[0], p2 = b[1];
            const p3 = b.length === 4 ? b[2] : b[2];
            const p4 = b.length === 4 ? b[3] : b[2];

            return [
                '0', 'SOLID',
                ...this.getLayerAndColor(hatch.layerRef),
                '10', p1.x.toFixed(4),
                '20', p1.y.toFixed(4),
                '30', '0.0',
                '11', p2.x.toFixed(4),
                '21', p2.y.toFixed(4),
                '31', '0.0',
                '13', p3.x.toFixed(4), // Notice group 13 gets the 3rd vertex
                '23', p3.y.toFixed(4),
                '33', '0.0',
                '12', p4.x.toFixed(4), // Notice group 12 gets the 4th vertex
                '22', p4.y.toFixed(4),
                '32', '0.0'
            ];
        }

        throw new TranslationError('Complex HATCH boundaries > 4 points not implemented in V2 SOLID fallback');
    }

    private static ensureFinite(...values: number[]) {
        for (const v of values) {
            if (!Number.isFinite(v)) {
                throw new TranslationError(`Invalid NaN or Infinity coordinate detected: ${v}`);
            }
        }
    }
}
