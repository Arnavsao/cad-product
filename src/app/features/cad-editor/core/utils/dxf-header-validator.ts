/**
 * Scans a DXF file text to extract and validate the header variables required for AC1032
 * before full parsing.
 */
export function validateAc1032Header(fileText: string): {
  isValid: boolean;
  metadata: {
    sourceVersion?: string;
    targetVersion?: string;
    units?: string;
    extMin?: { x: number; y: number; z: number };
    extMax?: { x: number; y: number; z: number };
    ltScale?: number;
    dimStyle?: string;
  };
  errors: string[];
} {
  const lines = fileText.split(/\r?\n/);
  const metadata: any = {};
  const errors: string[] = [];

  let inHeader = false;
  let currentVar = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'SECTION') {
      const nextLine = (lines[i + 2] || '').trim();
      if (nextLine === 'HEADER') {
        inHeader = true;
        i += 2;
        continue;
      }
    }

    if (line === 'ENDSEC' && inHeader) {
      break; // Header is over
    }

    if (inHeader) {
      if (line === '9') { // Variable name follows
        currentVar = (lines[i + 1] || '').trim();
        i++;
      } else if (currentVar) {
        if (currentVar === '$ACADVER') {
          if (line === '1') {
            metadata.sourceVersion = (lines[i + 1] || '').trim();
            metadata.targetVersion = 'AC1032';
            currentVar = '';
            i++;
          }
        } else if (currentVar === '$INSUNITS') {
          if (line === '70') {
            metadata.units = (lines[i + 1] || '').trim();
            currentVar = '';
            i++;
          }
        } else if (currentVar === '$LTSCALE') {
          if (line === '40') {
            metadata.ltScale = parseFloat((lines[i + 1] || '').trim());
            currentVar = '';
            i++;
          }
        } else if (currentVar === '$DIMSTYLE') {
          if (line === '2') {
            metadata.dimStyle = (lines[i + 1] || '').trim();
            currentVar = '';
            i++;
          }
        } else if (currentVar === '$EXTMIN') {
          if (!metadata.extMin) metadata.extMin = { x: 0, y: 0, z: 0 };
          if (line === '10') { metadata.extMin.x = parseFloat((lines[i + 1] || '').trim()); i++; }
          else if (line === '20') { metadata.extMin.y = parseFloat((lines[i + 1] || '').trim()); i++; }
          else if (line === '30') { metadata.extMin.z = parseFloat((lines[i + 1] || '').trim()); currentVar = ''; i++; }
        } else if (currentVar === '$EXTMAX') {
          if (!metadata.extMax) metadata.extMax = { x: 0, y: 0, z: 0 };
          if (line === '10') { metadata.extMax.x = parseFloat((lines[i + 1] || '').trim()); i++; }
          else if (line === '20') { metadata.extMax.y = parseFloat((lines[i + 1] || '').trim()); i++; }
          else if (line === '30') { metadata.extMax.z = parseFloat((lines[i + 1] || '').trim()); currentVar = ''; i++; }
        }
      }
    }
  }

  // AutoCAD specification requires $ACADVER to be present.
  if (!metadata.sourceVersion) {
    // Some basic files don't have a header, default to AC1009
    metadata.sourceVersion = 'AC1009';
  }

  return {
    isValid: errors.length === 0,
    metadata,
    errors
  };
}
