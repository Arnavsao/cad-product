import type { AiTool, AiToolContext, AiToolValidationResult } from '../models/ai-tool.model';
import type { ICommand, IModifyEntitiesCmdHooks } from '../../../core/models/command.model';
import type { Layer, DxfFile } from '../../../core/models/layer.model';

interface RenameLayerParams {
  /** New layer name. */
  to: string;
}

/**
 * Undoable layer rename:
 *   - re-keys the layers Map (old name → new name) keeping the same Layer object
 *   - updates layer.name
 *   - re-points every entity whose `layer` field referenced the old name
 *   - updates the document's active layer name if it pointed at the renamed layer
 */
class RenameLayerCmd implements ICommand {
  private readonly affected: { id: number; }[] = [];

  constructor(
    private readonly file: DxfFile,
    private readonly layer: Layer,
    private readonly oldName: string,
    private readonly newName: string,
    private readonly doc: { activeLayerName: string },
    private readonly hooks: IModifyEntitiesCmdHooks,
  ) {}

  private _rename(from: string, to: string): void {
    const lay = this.file.layers.get(from);
    if (!lay) return;
    this.file.layers.delete(from);
    lay.name = to;
    this.file.layers.set(to, lay);
    for (const e of this.file.entities) {
      if (e.layer === from) e.layer = to;
    }
    if (this.doc.activeLayerName === from) this.doc.activeLayerName = to;
    this.hooks.markDirty();
  }

  execute(): void { this._rename(this.oldName, this.newName); }
  undo(): void { this._rename(this.newName, this.oldName); }
}

export function makeLayerRenameTool(): AiTool<RenameLayerParams> {
  return {
    id: 'layer.rename',
    title: 'Rename Layer',
    description: 'Rename a layer and re-point all its entities. Target the layer with a layer selector; "to" is the new name.',
    category: 'layer',
    permissions: ['mutate:layers'],

    validate(action, ctx): AiToolValidationResult {
      if (action.target.kind !== 'layer') {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'INVALID_TARGET', severity: 'error', message: 'Target must be a layer.' }],
          warnings: [],
        };
      }
      const file = ctx.doc.activeFile;
      const oldName = action.target.layer;
      const layer = file.layers.get(oldName);
      if (!layer) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'LAYER_NOT_FOUND', severity: 'error', message: `Layer "${oldName}" does not exist.` }],
          warnings: [],
        };
      }
      const { to } = action.parameters;
      if (!to || typeof to !== 'string' || !to.trim()) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'MISSING_NAME', severity: 'error', message: 'Provide a new layer name.' }],
          warnings: [],
        };
      }
      if (file.layers.has(to)) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'NAME_TAKEN', severity: 'error', message: `A layer named "${to}" already exists.` }],
          warnings: [],
        };
      }
      if ((layer as { isProtected?: boolean }).isProtected) {
        return {
          ok: false, confidence: 1, affectedIds: [], riskClass: 'review',
          errors: [{ code: 'PROTECTED_LAYER', severity: 'error', message: `Layer "${oldName}" is protected and cannot be renamed.` }],
          warnings: [],
        };
      }
      const affected = file.entities.filter(e => e.layer === oldName).map(e => e.id);
      return { ok: true, confidence: 1, affectedIds: affected, riskClass: 'review', errors: [], warnings: [] };
    },

    compile(action, ctx): ICommand[] {
      if (action.target.kind !== 'layer') return [];
      const file = ctx.doc.activeFile;
      const oldName = action.target.layer;
      const layer = file.layers.get(oldName);
      if (!layer) return [];
      return [new RenameLayerCmd(file, layer, oldName, action.parameters.to.trim(), ctx.doc, ctx.hooks)];
    },

    describe(action, affectedIds): string {
      const from = action.target.kind === 'layer' ? action.target.layer : '?';
      return `Renamed layer "${from}" to "${action.parameters.to}" (${affectedIds.length} entities re-pointed).`;
    },
  };
}
