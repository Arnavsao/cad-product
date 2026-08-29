import { Injectable, inject, signal } from '@angular/core';
import { DocumentService } from './document.service';
import { ViewModelService } from './view-model.service';
import { CommandStackService } from './command-stack.service';
import { SaveBlockEditsCmd } from '../models/block-commands.model';
import type { IBlockDef } from '../models/layer.model';
import type { Entity } from '../models/entity.model';

@Injectable({ providedIn: 'root' })
export class BlockEditorService {
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);

  readonly isActive = signal(false);
  readonly editingBlockName = signal<string | null>(null);

  private editingDef: IBlockDef | null = null;
  private savedEntities: Entity[] = [];
  private entitySnapshot: Entity[] = [];
  private stackDepthAtEntry = 0;

  open(blockName: string): void {
    if (this.isActive()) return;
    const file = this.doc.activeFile;
    const def = file.blocks.get(blockName);
    if (!def) return;

    this.editingDef = def;
    this.editingBlockName.set(blockName);
    this.entitySnapshot = def.entities.map(e => e.clone());

    this.savedEntities = file.entities;
    this.doc.beditBackground = this.savedEntities;
    file.entities = def.entities;

    this.stackDepthAtEntry = this.cmds.getDepth();

    this.doc.clearSelection();
    this.isActive.set(true);
    this.vm.zoomExtents(this.doc);
    this.vm.markContentDirty();
  }

  save(): void {
    if (!this.isActive()) return;
    const file = this.doc.activeFile;
    const blockName = this.editingBlockName()!;
    const newEntities = file.entities.map(e => e.clone());

    this.cmds.truncateAbove(this.stackDepthAtEntry);
    file.entities = this.savedEntities;
    this.doc.beditBackground = null;

    this.cmds.push(new SaveBlockEditsCmd(blockName, file, this.entitySnapshot, newEntities, {
      markDirty: () => this.vm.markContentDirty(),
      refreshBlocks: () => this.doc.bump(),
    }));

    this.cleanup();
  }

  discard(): void {
    if (!this.isActive()) return;
    const file = this.doc.activeFile;

    if (this.editingDef) {
      this.editingDef.entities = [...this.entitySnapshot];
    }

    this.cmds.truncateAbove(this.stackDepthAtEntry);
    file.entities = this.savedEntities;
    this.doc.beditBackground = null;

    this.cleanup();
  }

  private cleanup(): void {
    this.editingDef = null;
    this.savedEntities = [];
    this.entitySnapshot = [];
    this.stackDepthAtEntry = 0;
    this.editingBlockName.set(null);
    this.isActive.set(false);
    this.doc.clearSelection();
    this.vm.markContentDirty();
  }
}
