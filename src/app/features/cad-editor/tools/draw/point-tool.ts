import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import { PointEntity } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';

export class PointTool implements ITool {
  readonly name = 'point';

  getPhase(): string { return 'place'; }

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }

  onMouseDown(wx: number, wy: number): void {
    const p = new PointEntity(wx, wy);
    p.layer = this.doc.activeLayer;
    this.cmds.push(new AddEntityCmd(p, this.doc.activeFile, { markDirty: () => this.vm.markContentDirty() }));
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.tools.setTool('select');
  }
}
