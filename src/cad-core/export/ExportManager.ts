import { IDraftingEntity } from '../interfaces/entities';
import { TelemetryManager } from '../telemetry/TelemetryManager';

export interface IExporter {
    format: string;
    export(entities: IDraftingEntity[]): string | Blob | Promise<Blob>;
}

export class JSONExporter implements IExporter {
    format = 'JSON';
    
    export(entities: IDraftingEntity[]): string {
        return JSON.stringify({
            metadata: {
                version: '1.0',
                generator: 'CADSemanticEngine',
                timestamp: new Date().toISOString()
            },
            entities: entities
        }, null, 2);
    }
}

export class SVGExporter implements IExporter {
    format = 'SVG';
    
    export(entities: IDraftingEntity[]): string {
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000" style="background-color: white;">\n`;
        svg += `<g transform="translate(2500, 2500)">\n`; // Rough center
        
        for (const e of entities) {
            const anyE = e as any;
            if (e.draftingType === 'CADLine' || e.draftingType === 'Line') {
                const p1 = anyE.start || anyE.p1;
                const p2 = anyE.end || anyE.p2;
                svg += `<line x1="${p1.x}" y1="${-p1.y}" x2="${p2.x}" y2="${-p2.y}" stroke="black" stroke-width="2"/>\n`;
            } else if (e.draftingType === 'CADCircle') {
                svg += `<circle cx="${anyE.center.x}" cy="${-anyE.center.y}" r="${anyE.radius}" stroke="black" fill="none" stroke-width="2"/>\n`;
            } else if (e.draftingType === 'Arc') {
                // Simplified SVG Arc
                svg += `<path d="M ${anyE.center.x} ${-anyE.center.y} A ${anyE.radius} ${anyE.radius} 0 0 1 ${anyE.center.x+anyE.radius} ${-anyE.center.y}" stroke="black" fill="none" stroke-width="2"/>\n`;
            } else if (e.draftingType === 'Text' || e.draftingType === 'CADMText') {
                const pos = anyE.position || anyE.textLocation || {x:0, y:0};
                const txt = anyE.text || '';
                svg += `<text x="${pos.x}" y="${-pos.y}" fill="black" font-family="Arial" font-size="10">${txt}</text>\n`;
            }
        }
        
        svg += `</g>\n</svg>`;
        return svg;
    }
}

export class PDFExporter implements IExporter {
    format = 'PDF';
    
    async export(entities: IDraftingEntity[]): Promise<Blob> {
        // In a real implementation, this would use pdfmake or jspdf using the exact same generic geometry iteration as SVG
        console.warn('PDF export is stubbed. Awaiting pdfmake dependency.');
        return new Blob(['%PDF-1.4\n%Stubbed PDF Document'], { type: 'application/pdf' });
    }
}

export class DXFPythonExporter implements IExporter {
    format = 'DXF';
    
    async export(entities: IDraftingEntity[]): Promise<Blob> {
        const payload = new JSONExporter().export(entities);
        // Delegate complex R2018 DXF rendering to the ezdxf Python backend via Fast API
        const response = await fetch('http://127.0.0.1:8000/api/dxf/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        
        if (!response.ok) {
            throw new Error(`DXF Backend Export Failed: ${response.statusText}`);
        }
        
        return await response.blob();
    }
}

export class ExportManager {
    private exporters: Map<string, IExporter> = new Map();

    constructor() {
        this.register(new JSONExporter());
        this.register(new SVGExporter());
        this.register(new PDFExporter());
        this.register(new DXFPythonExporter());
    }

    public register(exporter: IExporter) {
        this.exporters.set(exporter.format, exporter);
    }

    public async exportFile(format: 'JSON' | 'SVG' | 'PDF' | 'DXF', entities: IDraftingEntity[]): Promise<string | Blob> {
        const exporter = this.exporters.get(format);
        if (!exporter) {
            throw new Error(`Unsupported export format: ${format}`);
        }
        
        // Setup initial Telemetry
        const payloadSize = JSON.stringify(entities).length;
        const tracking = TelemetryManager.startExportTracking(format, entities.length, payloadSize);

        try {
            const output = await exporter.export(entities);
            const outputSize = typeof output === 'string' ? output.length : output.size;
            
            TelemetryManager.finalizeTracking(tracking, outputSize, 'SUCCESS');
            return output;
            
        } catch (err: any) {
            // Error Recovery & Graceful Degradation
            TelemetryManager.finalizeTracking(tracking, 0, 'FAILED', err.message);
            
            console.warn(`[CAD Hardening] Export failed for ${format}. Attempting graceful fallback to generic JSON dump.`);
            if (format !== 'JSON') {
                return await this.exporters.get('JSON')!.export(entities);
            }
            throw err;
        }
    }
}
