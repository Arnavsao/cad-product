import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { Entity, IPoint } from '../../core/models/entity.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { CreateBlockCmd } from '../../core/models/command.model';
import { getSelectedEntities, hitTestAll } from '../select/select-tool';
import { CreateBlockDialogService, ICreateBlockResult } from '../../features/block-dialogs/create-block-dialog.service';

import { CommandPromptService } from '../../core/services/command-prompt.service';

export class CreateBlockTool implements ITool {
  readonly name = 'create_block';
  private blockName: string | null = null;
  private blockDescription = '';
  private selected: Entity[] = [];
  private basePointMode: 'pick' | 'origin' = 'pick';
  private isSelecting = false;
  private dialogOpen = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dialog() { return this.injector.get(CreateBlockDialogService) as CreateBlockDialogService; }
  private get prompt() { return this.injector.get(CommandPromptService) as CommandPromptService; }

  activate(): void {
    this.selected = getSelectedEntities(this.doc);
    if (this.selected.length === 0) {
      this.isSelecting = true;
      return;
    }
    this.openDialog();
  }

  private openDialog(): void {
    const file = this.doc.activeFile;
    const suggested = 'Block' + (file.blocks.size + 1);
    const existing = Array.from(file.blocks.keys()).filter((n) => !n.startsWith('*'));

    this.dialogOpen = true;
    this.dialog.open(suggested, existing).then((result) => {
      this.dialogOpen = false;
      if (!result) { this.tools.setTool('select'); return; }
      this.blockName = result.name;
      this.blockDescription = result.description;
      this.basePointMode = result.basePointMode;
      if (result.basePointMode === 'origin') {
        this.executeCreateBlock(0, 0);
      }
    });
  }

  getPhase(): string | null {
    if (this.isSelecting) return 'select';
    if (this.blockName && this.basePointMode === 'pick') return 'origin';
    return null;
  }

  private executeCreateBlock(wx: number, wy: number): void {
    if (!this.blockName) return;
    const file = this.doc.activeFile;
    this.cmds.push(new CreateBlockCmd(
      this.blockName,
      { x: wx, y: wy },
      this.selected,
      file,
      this.doc.activeLayer,
      {
        markDirty: () => this.vm.markContentDirty(),
        refreshBlocks: () => this.doc.bump(),
      },
      this.blockDescription,
    ));
    for (const e of file.entities) e.selected = false;
    this.blockName = null;
    this.blockDescription = '';
    this.selected = [];
    this.tools.setTool('select');
  }

  onMouseDown(wx: number, wy: number, sx: number, sy: number): void {
    if (this.dialogOpen) return;

    if (this.isSelecting) {
      const hit = hitTestAll(this.doc, this.vm, sx, sy);
      if (hit) {
        hit.entity.selected = true;
        this.vm.markContentDirty();
        this.selected = getSelectedEntities(this.doc);
      }
      return;
    }

    if (!this.blockName || this.basePointMode !== 'pick') return;
    this.executeCreateBlock(wx, wy);
  }

  onKeyDown(e: KeyboardEvent): void {
    if (this.dialogOpen) return;

    if (this.isSelecting && (e.key === 'Enter' || e.key === ' ')) {
      if (this.selected.length > 0) {
        this.isSelecting = false;
        this.openDialog();
      } else {
        this.tools.setTool('select');
      }
      return;
    }

    if (e.key === 'Escape') {
      this.blockName = null;
      this.blockDescription = '';
      this.selected = [];
      this.tools.setTool('select');
    }
  }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.blockName || this.basePointMode !== 'pick' || this.dialogOpen) return;
    void ctx;
  }

  getAnchor(): IPoint | null { return null; }
}
