import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { InsertEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { ExplodeInsertCmd } from '../../core/models/command.model';
import { getSelectedEntities } from '../select/select-tool';

/**
 * Port of `ExplodeTool` from 23-tools-block-file.js.
 *
 * Explodes every selected INSERT into its constituent entities, with the
 * insert's translate/scale/rotate transform baked in. BYBLOCK children
 * inherit the insert's color (handled inside ExplodeInsertCmd).
 */
export class ExplodeTool implements ITool {
  readonly name = 'explode';

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  activate(): void {
    const sel = getSelectedEntities(this.doc).filter((e: any) => e instanceof InsertEntity) as InsertEntity[];
    if (!sel.length) {
      alert('No block references selected to explode.');
      this.tools.setTool('select');
      return;
    }
    for (const ent of sel) {
      const file = this.doc.getFileOfEntity(ent) ?? this.doc.activeFile;
      this.cmds.push(new ExplodeInsertCmd(ent, file, { markDirty: () => this.vm.markContentDirty(), refreshBlocks: () => this.doc.bump() }));
    }
    this.tools.setTool('select');
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.tools.setTool('select');
  }
}
