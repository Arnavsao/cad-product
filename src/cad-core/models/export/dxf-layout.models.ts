export type LayoutItemType = 'view' | 'table' | 'text' | 'dimension';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutItem {
  id: string;
  type: LayoutItemType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  selected?: boolean;
  locked?: boolean;
}

export interface LayoutOverride {
  dx: number;
  dy: number;
}

export interface LayoutSheet {
  width: number;
  height: number;
  margin: number;
}

export interface DxfLayoutCapture {
  sheet: LayoutSheet;
  items: LayoutItem[];
}

export interface DxfLayoutRequest {
  overrides?: Record<string, LayoutOverride>;
  capture?: DxfLayoutCapture;
}

export interface LayoutValidation {
  overlaps: Array<[string, string]>;
  outsideBoundary: string[];
}

export type PreviewPrimitive = (
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: 'polyline'; points: LayoutPoint[]; closed: boolean; color: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'arc'; path: string; color: string }
  | { kind: 'text'; x: number; y: number; text: string; height: number; rotation: number; color: string }
) & { viewKey?: string };

export interface DxfPreviewDocument {
  dxf: string;
  sheet: LayoutSheet;
  items: LayoutItem[];
  primitives: PreviewPrimitive[];
  validation: LayoutValidation;
}
