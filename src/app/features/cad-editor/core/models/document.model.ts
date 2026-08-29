import { DxfFile } from './layer.model';
import { ICommand } from './command.model';
import { IBBox, Entity, IPoint } from './entity.model';

export class DrawingDocument {
  file: DxfFile;
  isDirty = false;
  tabId: string;
  order = 0;
  pinned = false;

  // DocumentService State
  activeLayerName = 'Layer 0';
  activeHatchPattern = 'ANSI31';
  isPrintMode = false;
  ltScale = 1.0;
  beditBackground: Entity[] | null = null;
  activeSpace: 'model' | 'paper' = 'model';
  
  // ViewModelService State
  vmState = {
    scale: 1,
    panX: 0,
    panY: 0,
    lastCursorWorld: { x: 0, y: 0 } as IPoint,
    previewHiddenIds: null as Set<number> | null
  };

  // CommandStackService State
  cmdState = {
    stack: [] as ICommand[],
    redoStack: [] as ICommand[]
  };

  // SpatialIndexService State
  spatialState = {
    cache: new Map<number, { bbox: IBBox; revision: number }>(),
    buckets: new Map<number, number[]>(),
    cellSize: 0,
    bucketTouches: 0,
    syncedFileId: null as string | null,
    syncedVersion: -1
  };

  // Object ID Generator
  entityIdCounter = 1;

  constructor(file: DxfFile) {
    this.file = file;
    this.tabId = file.id;
  }
}
