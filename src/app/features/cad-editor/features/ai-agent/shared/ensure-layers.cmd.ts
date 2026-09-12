import type { ICommand } from '../../../core/models/command.model';
import type { DxfFile } from '../../../core/models/layer.model';
import { Layer } from '../../../core/models/layer.model';
import type { Entity } from '../../../core/models/entity.model';
import { defaultLayerColor } from './draw-spec';

/**
 * Undoable "create the layers these entities reference if they do not exist".
 * Colour follows the drafting-convention table so a fresh A-WALL is white and a
 * fresh A-GLAZ cyan without the model having to say so.
 */
export function ensureLayerCmds(entities: Entity[], file: DxfFile): ICommand[] {
  const cmds: ICommand[] = [];
  const names = new Set(entities.map(e => e.layer));
  for (const name of names) {
    if (file.layers.has(name)) continue;
    const layers = file.layers;
    cmds.push({
      execute() { if (!layers.has(name)) layers.set(name, new Layer(name, null, defaultLayerColor(name))); },
      undo() { layers.delete(name); },
    });
  }
  return cmds;
}
