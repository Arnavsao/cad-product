import { DraftingCanvasContext } from '../adapters/DraftingCanvasContext';

export type BlockGenerator = (ctx: DraftingCanvasContext, params: Record<string, any>) => void;

export class BlockLibrary {
    private static generators: Map<string, BlockGenerator> = new Map();

    public static register(name: string, generator: BlockGenerator) {
        this.generators.set(name, generator);
    }

    public static generate(name: string, ctx: DraftingCanvasContext, params: Record<string, any> = {}) {
        const gen = this.generators.get(name);
        if (!gen) throw new Error(`Block library missing generator for: ${name}`);
        gen(ctx, params);
    }

    public static initializeDefaultLibrary() {
        // 1. North Arrow
        this.register('NORTH_ARROW', (ctx, params) => {
            const size = params['size'] || 50;
            ctx.beginPath();
            ctx.moveTo(0, size);
            ctx.lineTo(size/3, -size);
            ctx.lineTo(0, -size + size/4);
            ctx.lineTo(-size/3, -size);
            ctx.closePath();
            ctx.stroke();
            
            // Add N text
            ctx.fillText('N', 0, size + 10);
        });

        // 2. Scale Bar
        this.register('SCALE_BAR', (ctx, params) => {
            const length = params['length'] || 100;
            const divisions = params['divisions'] || 4;
            const h = params['height'] || 5;
            
            ctx.beginPath();
            ctx.rect(0, 0, length, h);
            for (let i=1; i<divisions; i++) {
                const x = (length/divisions)*i;
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
            }
            ctx.stroke();
        });

        // 3. Section Symbol
        this.register('SECTION_MARKER', (ctx, params) => {
            const r = params['radius'] || 15;
            const label = params['label'] || 'A';
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI*2);
            ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
            ctx.moveTo(0, -r); ctx.lineTo(0, r);
            ctx.stroke();
            ctx.fillText(label, r + 5, -r - 5);
        });

        // 4. Bearing
        this.register('ELASTOMERIC_BEARING', (ctx, params) => {
            const w = params['width'] || 400;
            const h = params['height'] || 50;
            ctx.rect(-w/2, -h/2, w, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-w/2, -h/2);
            ctx.lineTo(w/2, h/2);
            ctx.moveTo(w/2, -h/2);
            ctx.lineTo(-w/2, h/2);
            ctx.stroke();
        });

        // 5. Pier
        this.register('STANDARD_PIER', (ctx, params) => {
            const d = params['diameter'] || 1200;
            const h = params['height'] || 5000;
            ctx.rect(-d/2, 0, d, -h);
            ctx.stroke();
            // Pier Cap
            const cw = params['capWidth'] || 1600;
            const ch = params['capHeight'] || 600;
            ctx.rect(-cw/2, 0, cw, ch);
            ctx.stroke();
        });
        
        // 6. General Notes
        this.register('GENERAL_NOTES', (ctx, params) => {
            const notes = params['notes'] || [
                "1. ALL DIMENSIONS ARE IN MILLIMETERS UNLESS SPECIFIED.",
                "2. CONCRETE GRADE AS PER DRAWING SCHEDULE.",
                "3. REINFORCEMENT BARS TO BE HYSD Fe500D.",
                "4. CLEAR COVER TO BE MAINTAINED AS PER IRC:112."
            ];
            
            ctx.save();
            ctx.font = '10px Arial';
            ctx.fillText("GENERAL NOTES:", 0, 0);
            notes.forEach((line: string, i: number) => {
                ctx.fillText(line, 0, (i + 1) * 15);
            });
            ctx.restore();
        });
    }
}

// Auto-initialize standard library on load
BlockLibrary.initializeDefaultLibrary();
