import { Injector } from '@angular/core';
import { ITool, IDynamicInputState } from '../../core/models/tool.interface';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { SymbolService } from '../../core/services/symbol.service';
import { DocumentService } from '../../core/services/document.service';
import { InsertBlockTool } from '../block/insert-block-tool';
import { IPoint } from '../../core/models/entity.model';
import { SymbolPickerService } from '../../features/symbol-picker/symbol-picker.service';

/**
 * Engineering-symbol insertion entry point.
 *
 * On activation:
 *   1. Open the visual symbol picker (SVG previews + names + descriptions)
 *      instead of the old `window.prompt` text dialog.
 *   2. If the user picks a symbol, register THAT symbol's block def on the
 *      active file, hand the block name to InsertBlockTool via its static
 *      `requestedBlockName` flag, then switch to that tool so the user places
 *      the block at the cursor.
 *   3. If the user cancels, fall back to the select tool — the drawing is left
 *      exactly as it was, with no block definitions added.
 */
export class SymbolTool implements ITool {
  readonly name = 'symbol';

  constructor(private injector: Injector) {}

  activate(): void {
    const symbolService = this.injector.get(SymbolService) as SymbolService;
    const picker = this.injector.get(SymbolPickerService) as SymbolPickerService;
    const tools = this.injector.get(ToolManagerService) as ToolManagerService;
    const doc = this.injector.get(DocumentService) as DocumentService;

    picker.open().then((choice) => {
      if (choice) {
        // Register AFTER the pick, not before the picker opens: the catalog
        // renders from its own SVG previews, so the drawing only needs the one
        // definition the user is about to place.
        symbolService.ensureStandardBlock(choice);
        doc.bump();
        InsertBlockTool.requestedBlockName = choice;
        tools.setTool('insert_block');
      } else {
        tools.setTool('select');
      }
    });
  }

  getPhase(): string { return 'place'; }

  getAnchor(): IPoint | null { return null; }
  getDynamicInputState(): IDynamicInputState | null { return null; }
  commitDynamicInput(_values: Record<string, string>): boolean { return false; }
}
