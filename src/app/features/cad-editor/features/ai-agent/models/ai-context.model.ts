import type { IBBox } from '../../../core/models/entity.model';

export interface DrawingSummary {
  entityCount: number;
  byType: Record<string, number>;
  byLayer: Record<string, number>;
  worldExtents: IBBox | null;
}

export interface LayerSummary {
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  frozen: boolean;
  entityCount: number;
}

export interface EntityDigest {
  id: number;
  type: string;
  layer: string;
  color: string;
  bbox: IBBox | null;
}

export interface SelectionContext {
  count: number;
  ids: number[];
  byType: Record<string, number>;
  byLayer: Record<string, number>;
  bbox: IBBox | null;
  entities?: EntityDigest[];
}

export interface LibraryCatalogEntry {
  id: string;
  name: string;
  category: string;
  tags: string[];
}

export interface ViewportContext {
  scale: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** A logical view (plan/elevation/section/detail) detected in model space. */
export interface ViewSummary {
  id: string;
  label: string;
  bbox: IBBox;
  entityCount: number;
}

export interface CadContextSnapshot {
  schemaVersion: 1;
  documentId: string;
  revision: number;
  activeFileId: string | null;
  activeLayer: string;
  summary: DrawingSummary;
  selection: SelectionContext;
  layers: LayerSummary[];
  views: ViewSummary[];
  libraryCatalog: LibraryCatalogEntry[];
  viewport: ViewportContext;
  cursor: { x: number; y: number };
}
