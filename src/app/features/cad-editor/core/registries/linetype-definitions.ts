export interface LinetypeDefinition {
  name: string;
  pattern: number[];
}

export const LINETYPE_DEFINITIONS: Record<string, LinetypeDefinition> = {
  CONTINUOUS: { name: 'CONTINUOUS', pattern: [] },
  DASHED:     { name: 'DASHED',     pattern: [12, 6] },
  HIDDEN:     { name: 'HIDDEN',     pattern: [6, 3] },
  CENTER:     { name: 'CENTER',     pattern: [30, 6, 6, 6] },
  PHANTOM:    { name: 'PHANTOM',    pattern: [30, 6, 6, 6, 6, 6] },
  DOT:        { name: 'DOT',        pattern: [0.5, 6] },
  DASHDOT:    { name: 'DASHDOT',    pattern: [12, 6, 0.5, 6] },
  DASHDOTDOT: { name: 'DASHDOTDOT', pattern: [12, 6, 0.5, 6, 0.5, 6] },
};
