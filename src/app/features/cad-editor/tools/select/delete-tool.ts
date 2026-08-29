import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { DeleteMultipleCmd } from '../../core/models/command.model';
import { hitTestAll, getSelectedEntities } from './select-tool';

export class DeleteTool implements ITool {
  readonly name = 'erase';

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  private get hooks() {
    return { markDirty: () => this.vm.markContentDirty(), refreshBlocks: () => this.doc.bump() };
  }

  getPhase(): string { return 'select'; }

  activate(): void {
    const sel = getSelectedEntities(this.doc);
    if (sel.length) {
      this.cmds.push(new DeleteMultipleCmd(sel, (e: any) => this.doc.getFileOfEntity(e), this.hooks));
      this.tools.setTool('select');
    }
  }

  onMouseDown(_wx: number, _wy: number, sx: number, sy: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    const hit = hitTestAll(this.doc, this.vm, sx, sy);
    if (hit) {
      this.cmds.push(new DeleteMultipleCmd([hit.entity], (en) => this.doc.getFileOfEntity(en), this.hooks));
    }
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.tools.setTool('select');
  }
}
