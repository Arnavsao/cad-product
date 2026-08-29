/// <reference lib="webworker" />
import DxfParser from 'dxf-parser';
import { validateAc1032Header } from '../utils/dxf-header-validator';
import { scanRawDxfObjects } from '../utils/dxf-scanner';
import { DxfHatchHandler } from '../services/dxf-hatch-handler';

addEventListener('message', ({ data }) => {
  const { fileText, filename } = data;
  try {
    // ── JSON entity payload from bridge workspace generator ────────────────
    // The bridge exporters produce JSON (an array of IDraftingEntity objects,
    // or an object like { entities: [...] } / { drawingData: [...] }), NOT a
    // DXF file. Detect and forward it so DxfImportService loads it directly.
    const trimmed = fileText.trimStart();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(fileText);
        // Extract the entity array from whichever shape it is
        const entities = Array.isArray(parsed)
          ? parsed
          : (parsed.entities ?? parsed.drawingData ?? parsed.data ?? null);
        if (Array.isArray(entities)) {
          postMessage({ success: true, isJsonEntities: true, entities, filename });
          return;
        }
        // Parsed JSON but no entity array found — fall through to DXF parser
      } catch {
        // Not valid JSON — fall through to the DXF parser below
      }
    }

    const headerValidation = validateAc1032Header(fileText);
    const rawObjects = scanRawDxfObjects(fileText);
    
    const parser = new (DxfParser as any)();
    parser.registerEntityHandler(DxfHatchHandler);
    const dxf = parser.parseSync(fileText);
    
    postMessage({ success: true, dxf, headerValidation, rawObjects, filename });
  } catch (error: any) {
    postMessage({ success: false, error: error.message, filename });
  }
});
