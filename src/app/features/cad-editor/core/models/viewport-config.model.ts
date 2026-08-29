/**
 * AutoCAD-style Viewports Configuration Model
 * Supports standard viewport layouts (Single, Two Vertical, Two Horizontal, Three Left, Three Right, Four Equal, etc.)
 */

export type ViewportConfigType =
  | 'Single'
  | 'Two: Vertical'
  | 'Two: Horizontal'
  | 'Three: Right'
  | 'Three: Left'
  | 'Three: Above'
  | 'Three: Below'
  | 'Three: Vertical'
  | 'Three: Horizontal'
  | 'Four: Equal'
  | 'Four: Right'
  | 'Four: Left';

export interface ITileRect {
  x: number; // 0 to 1 ratio relative to canvas width
  y: number; // 0 to 1 ratio relative to canvas height
  w: number; // width ratio
  h: number; // height ratio
  label?: string; // e.g. "Top", "Front", "Right", "Isometric"
}

export interface IModelViewportTile {
  id: string;
  rect: ITileRect;
  scale: number;
  panX: number;
  panY: number;
  viewName: string; // e.g. "Top", "Front", "Right", "2D Wireframe"
  visualStyle: string; // e.g. "2D Wireframe"
  active: boolean;
}

export interface IViewportConfigPreset {
  name: ViewportConfigType;
  tiles: ITileRect[];
}

export const VIEWPORT_CONFIG_PRESETS: IViewportConfigPreset[] = [
  {
    name: 'Single',
    tiles: [{ x: 0, y: 0, w: 1, h: 1, label: 'Top' }]
  },
  {
    name: 'Two: Vertical',
    tiles: [
      { x: 0, y: 0, w: 0.5, h: 1, label: 'Top' },
      { x: 0.5, y: 0, w: 0.5, h: 1, label: 'Front' }
    ]
  },
  {
    name: 'Two: Horizontal',
    tiles: [
      { x: 0, y: 0, w: 1, h: 0.5, label: 'Top' },
      { x: 0, y: 0.5, w: 1, h: 0.5, label: 'Front' }
    ]
  },
  {
    name: 'Three: Right',
    tiles: [
      { x: 0, y: 0, w: 0.5, h: 1, label: 'Top' },
      { x: 0.5, y: 0, w: 0.5, h: 0.5, label: 'Front' },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5, label: 'Right' }
    ]
  },
  {
    name: 'Three: Left',
    tiles: [
      { x: 0, y: 0, w: 0.5, h: 0.5, label: 'Top' },
      { x: 0, y: 0.5, w: 0.5, h: 0.5, label: 'Front' },
      { x: 0.5, y: 0, w: 0.5, h: 1, label: 'Right' }
    ]
  },
  {
    name: 'Three: Above',
    tiles: [
      { x: 0, y: 0, w: 1, h: 0.5, label: 'Top' },
      { x: 0, y: 0.5, w: 0.5, h: 0.5, label: 'Front' },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5, label: 'Right' }
    ]
  },
  {
    name: 'Three: Below',
    tiles: [
      { x: 0, y: 0, w: 0.5, h: 0.5, label: 'Top' },
      { x: 0.5, y: 0, w: 0.5, h: 0.5, label: 'Front' },
      { x: 0, y: 0.5, w: 1, h: 0.5, label: 'Right' }
    ]
  },
  {
    name: 'Three: Vertical',
    tiles: [
      { x: 0, y: 0, w: 0.333, h: 1, label: 'Left' },
      { x: 0.333, y: 0, w: 0.334, h: 1, label: 'Front' },
      { x: 0.667, y: 0, w: 0.333, h: 1, label: 'Right' }
    ]
  },
  {
    name: 'Three: Horizontal',
    tiles: [
      { x: 0, y: 0, w: 1, h: 0.333, label: 'Top' },
      { x: 0, y: 0.333, w: 1, h: 0.334, label: 'Front' },
      { x: 0, y: 0.667, w: 1, h: 0.333, label: 'Bottom' }
    ]
  },
  {
    name: 'Four: Equal',
    tiles: [
      { x: 0, y: 0, w: 0.5, h: 0.5, label: 'Top' },
      { x: 0.5, y: 0, w: 0.5, h: 0.5, label: 'Front' },
      { x: 0, y: 0.5, w: 0.5, h: 0.5, label: 'Left' },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5, label: 'Right' }
    ]
  },
  {
    name: 'Four: Right',
    tiles: [
      { x: 0, y: 0, w: 0.7, h: 1, label: 'Top' },
      { x: 0.7, y: 0, w: 0.3, h: 0.333, label: 'Front' },
      { x: 0.7, y: 0.333, w: 0.3, h: 0.334, label: 'Left' },
      { x: 0.7, y: 0.667, w: 0.3, h: 0.333, label: 'Right' }
    ]
  },
  {
    name: 'Four: Left',
    tiles: [
      { x: 0, y: 0, w: 0.3, h: 0.333, label: 'Top' },
      { x: 0, y: 0.333, w: 0.3, h: 0.334, label: 'Front' },
      { x: 0, y: 0.667, w: 0.3, h: 0.333, label: 'Left' },
      { x: 0.3, y: 0, w: 0.7, h: 1, label: 'Right' }
    ]
  }
];
