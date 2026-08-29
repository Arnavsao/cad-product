import { Injector } from '@angular/core';
import { ITool } from '../../core/models/tool.interface';
import type { IPoint } from '../../core/models/entity.model';
import { InsertEntity } from '../../core/models/entity-extended.model';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { AddEntityCmd } from '../../core/models/command.model';
import { InsertBlockDialogService } from '../../features/block-dialogs/insert-block-dialog.service';
import { AttribPromptDialogService } from '../../features/block-dialogs/attrib-prompt-dialog.service';

/**
 * INSERT tool. Pick a block from the dialog (or via requestedBlockName from
 * the Blocks panel), then click to drop INSERT references. Esc to finish.
 */
export class InsertBlockTool implements ITool {
  readonly name = 'insert_block';
  static requestedBlockName: string | null = null;

  private blockName: string | null = null;
  private scaleX = 1;
  private scaleY = 1;
  private rotation = 0; // degrees
  private cur: IPoint = { x: 0, y: 0 };
  private hasCursor = false;

  constructor(private injector: Injector) {}

  private get doc() { return this.injector.get(DocumentService) as DocumentService; }
  private get vm() { return this.injector.get(ViewModelService) as ViewModelService; }
  private get cmds() { return this.injector.get(CommandStackService) as CommandStackService; }
  private get tools() { return this.injector.get(ToolManagerService) as ToolManagerService; }
  private get dialog() { return this.injector.get(InsertBlockDialogService) as InsertBlockDialogService; }
  private get attribDialog() { return this.injector.get(AttribPromptDialogService) as AttribPromptDialogService; }

  activate(): void {
    const file = this.doc.activeFile;

    // Pre-requested from panel â€” skip dialog
    if (InsertBlockTool.requestedBlockName) {
      this.blockName = InsertBlockTool.requestedBlockName;
      InsertBlockTool.requestedBlockName = null;
      this.applyAutoScale(file);
      return;
    }

    const names = Array.from(file.blocks.keys()).filter((n) => !n.startsWith('*'));
    if (!names.length) {
      alert('No blocks defined in this drawing. Create a block first.');
      this.tools.setTool('select');
      return;
    }

    this.dialog.open(names).then((result) => {
      if (!result) { this.tools.setTool('select'); return; }
      this.blockName = result.blockName;
      this.scaleX = result.scaleX;
      this.scaleY = result.uniformScale ? result.scaleX : result.scaleY;
      this.rotation = result.rotation;
      this.applyAutoScale(file);
    });
  }

  private applyAutoScale(file: any): void {
    if (!this.blockName) return;
    const def = file.blocks.get(this.blockName);
    if (!def) {
      this.tools.setTool('select');
      return;
    }
    if (['Centerline', 'Datum', 'NorthArrow', 'SectionMarker'].includes(this.blockName)) {
      let minX = Infinity, maxX = -Infinity;
      for (const e of def.entities) {
        const b = e.bbox?.();
        if (b) { minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.w); }
      }
      const w = maxX - minX;
      if (w > 0 && w !== Infinity && this.vm.canvasWidth > 0) {
        const targetWorldWidth = (this.vm.canvasWidth / this.vm.scale) * 0.03;
        this.scaleX = targetWorldWidth / w;
        this.scaleY = this.scaleX;
      }
    }
  }

  onMouseDown(wx: number, wy: number): void {
    if (!this.blockName) return;
    const file = this.doc.activeFile;
    const def = file.blocks.get(this.blockName);
    const ent = new InsertEntity(this.blockName, wx, wy, this.scaleX, this.scaleY, this.rotation);
    ent.layer = this.doc.activeLayer;
    ent._blockDef = def ?? null;

    if (def?.attDefs?.length) {
      this.attribDialog.open(this.blockName, def.attDefs, wx, wy).then(result => {
        if (result) {
          ent.attribs = result.attribs;
        }
        this.cmds.push(new AddEntityCmd(ent, file, { markDirty: () => this.vm.markContentDirty(), refreshBlocks: () => this.doc.bump() }));
      });
    } else {
      this.cmds.push(new AddEntityCmd(ent, file, { markDirty: () => this.vm.markContentDirty(), refreshBlocks: () => this.doc.bump() }));
    }
  }

  onMouseMove(wx: number, wy: number): void {
    this.cur = { x: wx, y: wy };
    this.hasCursor = true;
    if (this.blockName) this.vm.markDirty();
  }

  getPhase(): string { return 'place'; }

  drawPreview(ctx: CanvasRenderingContext2D): void {
    if (!this.blockName || !this.hasCursor) return;
    const file = this.doc.activeFile;
    const blockDef = file.blocks.get(this.blockName);
    if (!blockDef?.entities) return;

    ctx.save();
    ctx.globalAlpha = 0.5;
    const preview = new InsertEntity(this.blockName, this.cur.x, this.cur.y, this.scaleX, this.scaleY, this.rotation);
    preview.draw(ctx, this.vm as any, file);
    ctx.restore();

    const s = this.vm.w2s(this.cur.x, this.cur.y);
    ctx.save();
    ctx.strokeStyle = '#63b3ed';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y); ctx.lineTo(s.x + 8, s.y);
    ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x, s.y + 8);
    ctx.stroke();
    ctx.restore();
  }

  getAnchor(): IPoint | null { return this.hasCursor ? this.cur : null; }

  onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      this.blockName = null;
      this.hasCursor = false;
      this.vm.markDirty();
      this.tools.setTool('select');
    }
  }

  deactivate(): void {
    this.blockName = null;
    this.hasCursor = false;
  }
}
