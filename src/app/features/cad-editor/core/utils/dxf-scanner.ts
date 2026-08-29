import { DxfTag, RawDxfObject } from '../models/entity.model';

/**
 * A lightweight lexical scanner that parses a DXF file into raw tag blocks.
 * Used to preserve unsupported entities and metadata (XDATA/Dictionaries) that
 * the primary dxf-parser drops.
 */
export function scanRawDxfObjects(fileText: string): RawDxfObject[] {
  const lines = fileText.split(/\r?\n/);
  const objects: RawDxfObject[] = [];
  
  let inEntitiesSection = false;
  let inBlocksSection = false;
  let currentObj: RawDxfObject | null = null;
  
  for (let i = 0; i < lines.length; i += 2) {
    if (i + 1 >= lines.length) break;
    
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();

    if (code === 0 && value === 'SECTION') {
      const sectionName = (lines[i + 3] || '').trim();
      if (sectionName === 'ENTITIES') inEntitiesSection = true;
      if (sectionName === 'BLOCKS') inBlocksSection = true;
      i += 2; // skip the section name lines
      continue;
    }

    if (code === 0 && value === 'ENDSEC') {
      inEntitiesSection = false;
      inBlocksSection = false;
      if (currentObj) {
        objects.push(currentObj);
        currentObj = null;
      }
      continue;
    }

    // We only capture objects in ENTITIES or BLOCKS section
    if (inEntitiesSection || inBlocksSection) {
      if (code === 0) {
        // Start of a new object
        if (currentObj) {
          objects.push(currentObj);
        }
        currentObj = {
          handle: '',
          ownerHandle: '',
          entityType: value,
          originalTags: []
        };
      }
      
      if (currentObj) {
        currentObj.originalTags.push({ code, value });
        if (code === 5) currentObj.handle = value;
        if (code === 330) currentObj.ownerHandle = value;
      }
    }
  }

  if (currentObj) {
    objects.push(currentObj);
  }

  return objects;
}

/**
 * Parses the DIMSTYLE table from a DXF file to extract dimension styles.
 * dxf-parser currently ignores this table entirely.
 */
export function scanDimStyles(fileText: string): Map<string, any> {
  const lines = fileText.split(/\r?\n/);
  const styles = new Map<string, any>();
  
  let inTablesSection = false;
  let inDimStyleTable = false;
  let currentStyle: any = null;
  
  for (let i = 0; i < lines.length; i += 2) {
    if (i + 1 >= lines.length) break;
    
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1].trim();

    if (code === 0 && value === 'SECTION') {
      const sectionName = (lines[i + 3] || '').trim();
      inTablesSection = (sectionName === 'TABLES');
      i += 2;
      continue;
    }

    if (code === 0 && value === 'ENDSEC') {
      if (inTablesSection) break; // We only care about TABLES
      continue;
    }

    if (inTablesSection) {
      if (code === 0 && value === 'TABLE') {
        const tableName = (lines[i + 3] || '').trim();
        inDimStyleTable = (tableName === 'DIMSTYLE');
        i += 2;
        continue;
      }
      if (code === 0 && value === 'ENDTAB') {
        inDimStyleTable = false;
        if (currentStyle && currentStyle.name) {
          styles.set(currentStyle.name, currentStyle);
          currentStyle = null;
        }
        continue;
      }

      if (inDimStyleTable) {
        if (code === 0 && value === 'DIMSTYLE') {
          if (currentStyle && currentStyle.name) {
            styles.set(currentStyle.name, currentStyle);
          }
          currentStyle = { arrowAspect: 2 };
        } else if (currentStyle) {
          if (code === 2) currentStyle.name = value;
          else if (code === 41) currentStyle.arrowSize = Number(value); // DIMASZ
          else if (code === 42) currentStyle.extensionGap = Number(value); // DIMEXO
          else if (code === 44) currentStyle.extensionPast = Number(value); // DIMEXE
          else if (code === 140) currentStyle.textHeight = Number(value); // DIMTXT
          else if (code === 147) currentStyle.textOffset = Number(value); // DIMGAP
        }
      }
    }
  }
  
  if (currentStyle && currentStyle.name) {
    styles.set(currentStyle.name, currentStyle);
  }
  
  return styles;
}
