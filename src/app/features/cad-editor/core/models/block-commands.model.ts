import type { ICommand } from './command.model';
import type { DxfFile } from './layer.model';
import type { Entity } from './entity.model';

interface IBlockCmdHooks {
  markDirty(): void;
  refreshBlocks?(): void;
}

export class RenameBlockCmd implements ICommand {
  constructor(
    private readonly oldName: string,
    private readonly newName: string,
    private readonly file: DxfFile,
    private readonly hooks: IBlockCmdHooks,
  ) {}

  execute(): void {
    const def = this.file.blocks.get(this.oldName);
    if (!def) return;
    def.name = this.newName;
    this.file.blocks.delete(this.oldName);
    this.file.blocks.set(this.newName, def);
    for (const e of this.file.entities) {
      if ((e as any).type === 'INSERT' && (e as any).blockName === this.oldName) {
        (e as any).blockName = this.newName;
      }
    }
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    const def = this.file.blocks.get(this.newName);
    if (!def) return;
    def.name = this.oldName;
    this.file.blocks.delete(this.newName);
    this.file.blocks.set(this.oldName, def);
    for (const e of this.file.entities) {
      if ((e as any).type === 'INSERT' && (e as any).blockName === this.newName) {
        (e as any).blockName = this.oldName;
      }
    }
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }
}

export class PurgeBlockCmd implements ICommand {
  private purgedDefs: Map<string, any> = new Map();

  constructor(
    private readonly file: DxfFile,
    private readonly hooks: IBlockCmdHooks,
  ) {}

  execute(): void {
    this.purgedDefs.clear();
    const referenced = new Set<string>();
    for (const e of this.file.entities) {
      if ((e as any).type === 'INSERT') referenced.add((e as any).blockName);
    }
    // Also check nested references inside block definitions
    for (const [, def] of this.file.blocks) {
      for (const e of def.entities) {
        if ((e as any).type === 'INSERT') referenced.add((e as any).blockName);
      }
    }
    for (const [name, def] of this.file.blocks) {
      if (name.startsWith('*')) continue;
      if (!referenced.has(name)) {
        this.purgedDefs.set(name, def);
        this.file.blocks.delete(name);
      }
    }
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    for (const [name, def] of this.purgedDefs) {
      this.file.blocks.set(name, def);
    }
    this.purgedDefs.clear();
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }
}

export class SaveBlockEditsCmd implements ICommand {
  constructor(
    private readonly blockName: string,
    private readonly file: DxfFile,
    private readonly oldEntities: Entity[],
    private readonly newEntities: Entity[],
    private readonly hooks: IBlockCmdHooks,
  ) {}

  execute(): void {
    const def = this.file.blocks.get(this.blockName);
    if (!def) return;
    def.entities = this.newEntities.map(e => e.clone());
    this.refreshInserts(def);
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    const def = this.file.blocks.get(this.blockName);
    if (!def) return;
    def.entities = this.oldEntities.map(e => e.clone());
    this.refreshInserts(def);
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  private refreshInserts(def: any): void {
    for (const e of this.file.entities) {
      if ((e as any).type === 'INSERT' && (e as any).blockName === this.blockName) {
        (e as any)._blockDef = def;
      }
    }
  }
}

export class DeleteBlockDefCmd implements ICommand {
  private removedDef: any = null;
  private removedInserts: { entity: Entity; index: number }[] = [];

  constructor(
    private readonly blockName: string,
    private readonly file: DxfFile,
    private readonly hooks: IBlockCmdHooks,
  ) {}

  execute(): void {
    this.removedDef = this.file.blocks.get(this.blockName) ?? null;
    this.file.blocks.delete(this.blockName);
    this.removedInserts = [];
    for (let i = this.file.entities.length - 1; i >= 0; i--) {
      const e = this.file.entities[i];
      if ((e as any).type === 'INSERT' && (e as any).blockName === this.blockName) {
        this.removedInserts.push({ entity: e, index: i });
        this.file.entities.splice(i, 1);
      }
    }
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }

  undo(): void {
    if (this.removedDef) this.file.blocks.set(this.blockName, this.removedDef);
    for (const { entity, index } of this.removedInserts.reverse()) {
      this.file.entities.splice(index, 0, entity);
    }
    this.removedInserts = [];
    this.hooks.markDirty();
    this.hooks.refreshBlocks?.();
  }
}
