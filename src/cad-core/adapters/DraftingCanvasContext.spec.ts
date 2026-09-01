import { DraftingCanvasContext } from './DraftingCanvasContext';
import { DraftingLine, DraftingText } from '../models/drafting';

describe('DraftingCanvasContext', () => {
    let ctx: DraftingCanvasContext;

    beforeEach(() => {
        ctx = new DraftingCanvasContext();
    });

    it('should correctly intercept stroke() and generate transformed DraftingLines', () => {
        ctx.strokeStyle = '#ff0000';
        ctx.translate(10, 10);
        ctx.scale(2, 2);
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(5, 5);
        ctx.stroke();

        expect(ctx.entities.length).toBe(1);
        const line = ctx.entities[0] as DraftingLine;
        expect(line.draftingType).toBe('Line');
        expect(line.start.x).toBe(10); // (0*2) + 10
        expect(line.start.y).toBe(10);
        expect(line.end.x).toBe(20);   // (5*2) + 10
        expect(line.end.y).toBe(20);
        expect(line.layerRef).toBe('#ff0000');
    });

    it('should discard zero-length lines to prevent index bloat', () => {
        ctx.beginPath();
        ctx.moveTo(10, 10);
        ctx.lineTo(10, 10);
        ctx.stroke();

        expect(ctx.entities.length).toBe(0);
    });

    it('should never emit a DraftingHatch from fillRect() (structural GAD exports must not turn component fills into SOLID hatches)', () => {
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 0, 10, 10);

        expect(ctx.entities.length).toBe(0);
    });

    it('should ignore fills when the color is pure white (legacy text masking heuristic)', () => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'; // Specific legacy mask color
        ctx.fillRect(0, 0, 10, 10);
        
        ctx.fillStyle = 'white';
        ctx.fill();

        expect(ctx.entities.length).toBe(0);
    });

    it('should map fillText() properties to DraftingText accurately', () => {
        ctx.font = 'bold 14px "Times New Roman"';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.scale(3, 3);

        ctx.fillText('Bridge GAD', 10, 20);

        expect(ctx.entities.length).toBe(1);
        const textEntity = ctx.entities[0] as DraftingText;
        expect(textEntity.draftingType).toBe('Text');
        expect(textEntity.text).toBe('Bridge GAD');
        // Height follows the fixed DXF_TEXT_STANDARDS table (default view, non-title
        // dimension text = 200 units / 2.5 scale factor), not naive canvas-font * transform-scale.
        expect(textEntity.height).toBe(80);
        expect(textEntity.position.x).toBe(30);
        expect(textEntity.position.y).toBe(60);
        expect(textEntity.alignment).toBe('right');
        expect(textEntity.baseline).toBe('top');
    });

    it('should accurately handle save() and restore() state stacks', () => {
        ctx.translate(100, 100);
        ctx.save();
        
        ctx.translate(50, 50); // Now at 150, 150
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(1, 1);
        ctx.stroke();
        
        ctx.restore(); // Back to 100, 100
        
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(1, 1);
        ctx.stroke();

        expect(ctx.entities.length).toBe(2);
        expect((ctx.entities[0] as DraftingLine).start.x).toBe(150);
        expect((ctx.entities[1] as DraftingLine).start.x).toBe(100);
    });
});
