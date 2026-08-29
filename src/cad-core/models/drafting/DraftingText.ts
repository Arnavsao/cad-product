import { BaseEntity } from '../../core/BaseEntity';
import { IDraftingEntity } from '../../interfaces/entities';
import { Point3D, EntityId, SourceEntityId } from '../../types';

export type TextAlignment = 'left' | 'center' | 'right';
export type TextBaseline = 'top' | 'middle' | 'bottom';

export class DraftingText extends BaseEntity implements IDraftingEntity {
    public readonly draftingType = 'Text';

    constructor(
        id: EntityId,
        public readonly text: string,
        public readonly position: Point3D,
        public readonly height: number,
        public readonly alignment: TextAlignment,
        public readonly baseline: TextBaseline,
        public readonly layerRef: string,
        public readonly rotation: number = 0,
        public readonly textStyle: string = 'NOTE_STYLE',
        sourceEntityId: SourceEntityId = null,
        metadata: ReadonlyMap<string, string> = new Map()
    ) {
        const numLines = text.split('\n').length;
        const totalHeight = height + (numLines - 1) * height * 1.33;

        // 1. Calculate local coordinates relative to the insertion point (0, 0)
        let localMinX = 0;
        let localMaxX = 0;
        const textWidth = text.length * height * 0.7; // Width heuristic

        if (alignment === 'left') {
            localMinX = 0;
            localMaxX = textWidth;
        } else if (alignment === 'right') {
            localMinX = -textWidth;
            localMaxX = 0;
        } else {
            // center
            localMinX = -textWidth * 0.5;
            localMaxX = textWidth * 0.5;
        }

        let localMinY = 0;
        let localMaxY = 0;

        if (baseline === 'top') {
            localMinY = -height * 0.2;
            localMaxY = totalHeight + height * 0.2;
        } else if (baseline === 'bottom') {
            localMinY = -totalHeight - height * 0.2;
            localMaxY = height * 0.2;
        } else {
            // middle
            localMinY = -totalHeight * 0.5 - height * 0.2;
            localMaxY = totalHeight * 0.5 + height * 0.2;
        }

        // 2. Rotate the four corners of the local bounding box
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        const corners = [
            { x: localMinX, y: localMinY },
            { x: localMaxX, y: localMinY },
            { x: localMaxX, y: localMaxY },
            { x: localMinX, y: localMaxY }
        ];

        const rotatedX = corners.map(c => c.x * cos - c.y * sin);
        const rotatedY = corners.map(c => c.x * sin + c.y * cos);

        super(id, {
            minX: position.x + Math.min(...rotatedX),
            minY: position.y + Math.min(...rotatedY),
            maxX: position.x + Math.max(...rotatedX),
            maxY: position.y + Math.max(...rotatedY)
        }, sourceEntityId, metadata);
    }

    public static create(text: string, position: Point3D, height: number, align: TextAlignment, baseline: TextBaseline, rotation: number, layerRef: string, textStyle: string = 'NOTE_STYLE', sourceId: SourceEntityId = null): DraftingText {
        return new DraftingText(crypto.randomUUID() as EntityId, text, { ...position }, height, align, baseline, layerRef, rotation, textStyle, sourceId);
    }
}
