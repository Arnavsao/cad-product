import { DraftingLine } from './DraftingLine';
import { GeometryError } from '../../core/errors';
import { Point3D } from '../../types';

describe('DraftingLine', () => {
    const validStart: Point3D = { x: 0, y: 0, z: 0 };
    const validEnd: Point3D = { x: 10, y: 15, z: 0 };
    const layer = 'TEST_LAYER';

    it('should successfully create a valid line and compute the correct O(1) bounding box', () => {
        const line = DraftingLine.create(validStart, validEnd, layer);
        
        expect(line.draftingType).toBe('Line');
        expect(line.start.x).toBe(0);
        expect(line.end.y).toBe(15);
        expect(line.layerRef).toBe(layer);
        
        // Assert bounding box O(1) spatial calculation is correct
        expect(line.boundingBox.minX).toBe(0);
        expect(line.boundingBox.minY).toBe(0);
        expect(line.boundingBox.maxX).toBe(10);
        expect(line.boundingBox.maxY).toBe(15);
    });

    it('should calculate bounding box correctly for inverted/negative coordinate spaces', () => {
        const line = DraftingLine.create({ x: 5, y: -5, z: 0 }, { x: -10, y: 2, z: 0 }, layer);
        
        expect(line.boundingBox.minX).toBe(-10);
        expect(line.boundingBox.maxX).toBe(5);
        expect(line.boundingBox.minY).toBe(-5);
        expect(line.boundingBox.maxY).toBe(2);
    });

    it('should throw a GeometryError if coordinates contain NaN or Infinity', () => {
        expect(() => DraftingLine.create({ x: NaN, y: 0, z: 0 }, validEnd, layer))
            .toThrowError(GeometryError);

        expect(() => DraftingLine.create(validStart, { x: 10, y: Infinity, z: 0 }, layer))
            .toThrowError(GeometryError);
    });

    it('should throw a GeometryError if layer reference is missing or empty space', () => {
        expect(() => DraftingLine.create(validStart, validEnd, ''))
            .toThrowError(GeometryError);

        expect(() => DraftingLine.create(validStart, validEnd, '   '))
            .toThrowError(GeometryError);
    });

    it('should protect against external mutation via defensive cloning and freezing', () => {
        const startMut = { x: 1, y: 1, z: 0 };
        const line = DraftingLine.create(startMut, validEnd, layer);
        
        // Mutate original object
        startMut.x = 999;
        
        // Assert internal state was cloned and protected
        expect(line.start.x).toBe(1);
    });
});
