import { Point2D as Point, BoundingBox } from '../../types';
import { DimensionStyle } from './DimensionStyle';
import { DimensionTextFormatter } from './DimensionTextFormatter';
import { DimensionTextPlacement } from './DimensionTextPlacement';
import { DimensionArrowPlacement } from './DimensionArrowPlacement';

export interface RenderContext {
    viewportScale: number;
    // Canvas context, WebGL handlers, etc. can be added later
}

export interface DimensionPrimitives {
    lines: { start: Point; end: Point; color?: string; weight?: number; type?: string }[];
    texts: { position: Point; text: string; rotation: number; height: number; color?: string; styleId?: string }[];
    blocks: { position: Point; type: string; rotation: number; scale: number; color?: string }[];
    masks: { points: Point[] }[];
    boundingBox: BoundingBox;
}

/**
 * Builds the geometric primitives for dimension rendering based on the spec pipeline.
 */
export class DimensionGeometryBuilder {
    private primitives: DimensionPrimitives;

    constructor(public readonly style: DimensionStyle, public readonly context: RenderContext) {
        this.primitives = {
            lines: [],
            texts: [],
            blocks: [],
            masks: [],
            boundingBox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        };
    }

    /**
     * Executes the standard dimension rendering pipeline.
     */
    public buildLinearPipeline(
        origin1: Point,
        origin2: Point,
        dimLineLocation: Point,
        textOverride?: string
    ): DimensionPrimitives {

        // 1. Measure (euclidean distance)
        const dx = origin2.x - origin1.x;
        const dy = origin2.y - origin1.y;
        const measuredValue = Math.sqrt(dx * dx + dy * dy);
        const dimAngleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

        // 2. Format Text
        const formattedText = DimensionTextFormatter.format(
            textOverride,
            measuredValue,
            this.style.linearPrecision,
            this.style.prefix,
            this.style.suffix
        );

        // Approximate text width (this should ideally call a font measurement system, but we mock it for now)
        const charWidthRatio = 0.7; // Approx width of average character relative to height
        const textWidth = formattedText.length * (this.style.textHeight * charWidthRatio);

        // 3. Determine Fit
        const fit = DimensionArrowPlacement.calculateFit(
            measuredValue,
            textWidth,
            this.style.arrowSize,
            this.style
        );

        // 4. Generate Extension Lines
        // For a true linear dimension, we project origins perpendicularly to the dimLineLocation.
        // For simplicity in this base builder, we assume aligned. Concrete classes will override exact logic.
        const ext1End = { x: origin1.x - dy * 0.1, y: origin1.y + dx * 0.1 }; // Mocked offset
        const ext2End = { x: origin2.x - dy * 0.1, y: origin2.y + dx * 0.1 }; // Mocked offset

        this.addLine(origin1, ext1End, this.style.extLineColor, this.style.extLineWeight, this.style.extLineType);
        this.addLine(origin2, ext2End, this.style.extLineColor, this.style.extLineWeight, this.style.extLineType);

        // 5. Generate Dimension Line & Arrows
        if (fit.arrowsInside) {
            this.addLine(ext1End, ext2End, this.style.dimLineColor, this.style.dimLineWeight, this.style.dimLineType);
            this.addArrow(ext1End, dimAngleDeg, this.style.arrowType1, this.style.dimLineColor);
            this.addArrow(ext2End, dimAngleDeg + 180, this.style.arrowType2, this.style.dimLineColor);
        } else {
            // Arrows flip outside
            this.addArrow(ext1End, dimAngleDeg + 180, this.style.arrowType1, this.style.dimLineColor);
            this.addArrow(ext2End, dimAngleDeg, this.style.arrowType2, this.style.dimLineColor);
        }

        // 6. Generate Text & Masks
        const textPos = {
            x: (origin1.x + origin2.x) / 2,
            y: (origin1.y + origin2.y) / 2
        }; // Mock centered

        const textRot = DimensionTextPlacement.calculateReadabilityRotation(
            dimAngleDeg,
            !fit.textInside,
            {
                textPlacementVert: this.style.textPlacementVert,
                textInsideAlign: this.style.textInsideAlign,
                textOutsideAlign: this.style.textOutsideAlign,
                textHeight: this.style.textHeight,
                textGap: this.style.textGap
            }
        );

        this.addText(textPos, formattedText, textRot, this.style.textHeight, this.style.textColor, this.style.textStyleId);

        // 7. Generate Bounding Box (mocked via simple inclusion of origins for now)
        this.expandBounds(origin1);
        this.expandBounds(origin2);

        return this.primitives;
    }

    private addLine(start: Point, end: Point, color: string, weight: number, type: string) {
        this.primitives.lines.push({ start, end, color, weight, type });
        this.expandBounds(start);
        this.expandBounds(end);
    }

    private addArrow(position: Point, rotation: number, type: string, color: string) {
        this.primitives.blocks.push({ position, type, rotation, scale: this.style.arrowSize, color });
        this.expandBounds(position);
    }

    private addText(position: Point, text: string, rotation: number, height: number, color: string, styleId: string) {
        this.primitives.texts.push({ position, text, rotation, height, color, styleId });
        this.expandBounds(position);
    }

    private expandBounds(p: Point) {
        const bbox = this.primitives.boundingBox as any; // Cast to circumvent readonly for internal building
        if (p.x < bbox.minX) bbox.minX = p.x;
        if (p.y < bbox.minY) bbox.minY = p.y;
        if (p.x > bbox.maxX) bbox.maxX = p.x;
        if (p.y > bbox.maxY) bbox.maxY = p.y;
    }
}
