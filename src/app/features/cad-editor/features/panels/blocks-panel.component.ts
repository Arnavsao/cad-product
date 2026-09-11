import { Component, computed, inject, signal , ChangeDetectionStrategy
} from '@angular/core';

import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { ToolManagerService } from '../../core/services/tool-manager.service';
import { CommandStackService } from '../../core/services/command-stack.service';
import { BlockEditorService } from '../../core/services/block-editor.service';
import { BlockThumbnailService } from '../../core/services/block-thumbnail.service';
import { InsertBlockTool } from '../../tools/block/insert-block-tool';
import { RenameBlockCmd, DeleteBlockDefCmd, PurgeBlockCmd } from '../../core/models/block-commands.model';
import { TranslocoDirective } from '@jsverse/transloco';
import { injectTranslocoOptional } from '../../../../core/i18n/translate-or';
import { translateOrParams } from '../shared/translate-or-params';

interface BlockRow {
  name: string;
  count: number;
  refCount: number;
  thumb: string;
  description: string;
  section: 'created' | 'standard';
}

interface BlockSection {
  key: BlockRow['section'];
  /** Translation key of the section heading. */
  titleKey: string;
  rows: BlockRow[];
}

const STANDARD_BLOCK_NAMES = new Set(['Centerline', 'Datum', 'NorthArrow', 'SectionMarker']);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-blocks-panel',
  standalone: true,
  imports: [TranslocoDirective],
  template: `
    <div class="blocks-panel" *transloco="let t">
      <div class="header-tools">
        <input class="search-input" type="text" [placeholder]="t('editor.ui.blocks.search')"
          [value]="filter()" (input)="filter.set($any($event.target).value)" />
          <button class="btn" type="button" (click)="createBlock()" [title]="t('editor.ui.blocks.createTooltip')">{{ t('editor.ui.blocks.create') }}</button>
          <button class="btn" type="button" (click)="explodeSelected()" [title]="t('editor.ui.blocks.explodeTooltip')">{{ t('editor.ui.blocks.explode') }}</button>
          <button class="btn" type="button" (click)="purgeUnused()" [title]="t('editor.ui.blocks.purgeTooltip')">{{ t('editor.ui.blocks.purge') }}</button>
        </div>
    
        @if (doc.version() !== null) {
          @for (section of sections(); track trackSection($index, section)) {
            <div class="block-section">
              <div class="section-title">
                <span>{{ t(section.titleKey) }}</span>
                <span>{{ section.rows.length }}</span>
              </div>
              @for (row of section.rows; track trackBlock($index, row)) {
                <div class="block-row"
                  (contextmenu)="onRowContext($event, row)" (dblclick)="editBlock(row.name)">
                  @if (row.thumb) {
                    <div class="block-thumb">
                      <img [src]="row.thumb" alt="" width="36" height="36" />
                    </div>
                  }
                  @if (!row.thumb) {
                    <div class="block-thumb placeholder">?</div>
                  }
                  <div class="block-info">
                    <span class="block-name" [title]="row.name">{{ row.name }}</span>
                    @if (row.description) {
                      <span class="block-description" [title]="row.description">{{ row.description }}</span>
                    }
                    <span class="block-count" [title]="t('editor.ui.blocks.countTooltip', { entities: row.count, references: row.refCount })">
                      {{ t('editor.ui.blocks.countShort', { entities: row.count, references: row.refCount }) }}
                    </span>
                  </div>
                  <div class="row-actions">
                    <button class="btn-sm" type="button" (click)="insert(row.name)" [title]="t('editor.ui.blocks.insert')">{{ t('editor.ui.blocks.insertShort') }}</button>
                    <button class="btn-sm" type="button" (click)="editBlock(row.name)" [title]="t('editor.ui.blocks.edit')">{{ t('editor.ui.blocks.editShort') }}</button>
                    <button class="btn-sm" type="button" (click)="rename(row.name)" [title]="t('editor.ui.blocks.rename')">{{ t('editor.ui.blocks.renameShort') }}</button>
                    <button class="btn-sm" type="button" (click)="selectRefs(row.name)" [title]="t('editor.ui.blocks.selectReferences')">{{ t('editor.ui.blocks.selectShort') }}</button>
                    <button class="btn-sm danger" type="button" (click)="deleteBlock(row.name)" [title]="t('editor.ui.blocks.delete')">{{ t('editor.ui.blocks.deleteShort') }}</button>
                  </div>
                </div>
              }
            </div>
          }
          @if (!filteredRows().length && rows().length) {
            <p class="empty">{{ t('editor.ui.blocks.noMatches', { query: filter() }) }}</p>
          }
          @if (!rows().length) {
            <p class="empty">{{ t('editor.ui.blocks.empty', { button: t('editor.ui.blocks.create') }) }}</p>
          }
        }
      </div>
    `,
  styles: [`
    .blocks-panel { display: flex; flex-direction: column; height: 100%; background: transparent; color: var(--cad-text-primary); font-size: 12px; overflow: auto; }
    .header-tools {
      display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
      padding: 6px 12px; border-bottom: 1px solid var(--cad-border);
      background: var(--cad-bg-hover);
    }
    .search-input {
      flex: 1; min-width: 80px;
      background: var(--cad-bg-surface, #181825); color: var(--cad-text-primary);
      border: 1px solid var(--cad-border); border-radius: 3px;
      padding: 3px 8px; font-size: 11px; outline: none;
      &:focus { border-color: var(--cad-accent); }
    }
    .block-section { display: flex; flex-direction: column; }
    .section-title {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 10px;
      border-bottom: 1px solid var(--cad-border);
      background: var(--cad-bg-panel, #1f2530);
      color: var(--cad-text-dim);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .block-row {
      display: grid; grid-template-columns: 36px 1fr auto;
      align-items: center; gap: 6px;
      padding: 4px 10px;
      border-bottom: 1px solid var(--cad-border);
      cursor: default;
      &:hover { background: var(--cad-bg-hover); }
    }
    .block-thumb {
      width: 36px; height: 36px; border-radius: 3px; overflow: hidden;
      background: var(--cad-bg-surface, #181825); display: flex; align-items: center; justify-content: center;
      &.placeholder { color: var(--cad-text-dim); font-size: 14px; }
      img { display: block; width: 36px; height: 36px; object-fit: contain; }
    }
    .block-info { display: flex; flex-direction: column; overflow: hidden; }
    .block-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .block-description { color: var(--cad-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
    .block-count { color: var(--cad-text-dim); font-variant-numeric: tabular-nums; font-size: 10px; white-space: nowrap; }
    .row-actions { display: flex; gap: 2px; }
    .btn {
      background: transparent; color: var(--cad-text-primary);
      border: 1px solid var(--cad-border); padding: 2px 8px;
      border-radius: 3px; cursor: pointer; font-size: 11px;
      &:hover { background: var(--cad-bg-hover); }
    }
    .btn-sm {
      background: transparent; color: var(--cad-text-dim);
      border: 1px solid transparent; padding: 1px 4px;
      border-radius: 2px; cursor: pointer; font-size: 10px;
      &:hover { background: var(--cad-bg-hover); border-color: var(--cad-border); color: var(--cad-text-primary); }
      &.danger:hover { color: var(--cad-red); border-color: var(--cad-red); }
    }
    .empty { padding: 20px 14px; text-align: center; color: var(--cad-text-dim); line-height: 1.5; }
  `],
})
export class BlocksPanelComponent {
  protected doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private tools = inject(ToolManagerService);
  private cmds = inject(CommandStackService);
  private blockEditor = inject(BlockEditorService);
  private thumbs = inject(BlockThumbnailService);
  private transloco = injectTranslocoOptional();

  filter = signal('');

  rows = computed<BlockRow[]>(() => {
    const docVer = this.doc.version();
    const file = this.doc.activeFile;
    const out: BlockRow[] = [];
    const refCounts = new Map<string, number>();
    for (const e of file.entities) {
      if ((e as any).type === 'INSERT') {
        const bn = (e as any).blockName;
        refCounts.set(bn, (refCounts.get(bn) ?? 0) + 1);
      }
    }
    for (const [name, def] of file.blocks) {
      if (name.startsWith('*')) continue;
      out.push({
        name,
        count: def.entities.length,
        refCount: refCounts.get(name) ?? 0,
        thumb: this.thumbs.getThumbnail(def, docVer),
        description: def.description ?? '',
        section: STANDARD_BLOCK_NAMES.has(name) ? 'standard' : 'created',
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  filteredRows = computed(() => {
    const q = this.filter().toLowerCase().trim();
    if (!q) return this.rows();
    return this.rows().filter(r =>
      r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
    );
  });

  sections = computed<BlockSection[]>(() => {
    const rows = this.filteredRows();
    const created = rows.filter((row) => row.section === 'created');
    const standard = rows.filter((row) => row.section === 'standard');
    const sections: BlockSection[] = [];
    if (created.length) sections.push({ key: 'created', titleKey: 'editor.ui.blocks.sectionCreated', rows: created });
    if (standard.length) sections.push({ key: 'standard', titleKey: 'editor.ui.blocks.sectionStandard', rows: standard });
    return sections;
  });

  trackSection = (_i: number, section: BlockSection) => section.key;
  trackBlock = (_i: number, e: BlockRow) => e.name;

  insert(name: string): void {
    InsertBlockTool.requestedBlockName = name;
    this.tools.setTool('insert_block');
  }

  editBlock(name: string): void {
    this.blockEditor.open(name);
  }

  createBlock(): void {
    this.tools.setTool('create_block');
  }

  explodeSelected(): void {
    this.tools.setTool('explode');
  }

  rename(name: string): void {
    const newName = window.prompt(translateOrParams(this.transloco, 'editor.ui.blocks.renamePrompt', 'Rename block "{{name}}" to:', { name }), name);
    if (!newName?.trim() || newName.trim() === name) return;
    const trimmed = newName.trim();
    const file = this.doc.activeFile;
    if (file.blocks.has(trimmed)) {
      alert(translateOrParams(this.transloco, 'editor.ui.blocks.alreadyExists', 'Block "{{name}}" already exists.', { name: trimmed }));
      return;
    }
    this.cmds.push(new RenameBlockCmd(name, trimmed, file, {
      markDirty: () => this.vm.markContentDirty(),
      refreshBlocks: () => this.doc.bump(),
    }));
  }

  deleteBlock(name: string): void {
    const file = this.doc.activeFile;
    const refCount = file.entities.filter((e: any) => e.type === 'INSERT' && e.blockName === name).length;
    const msg = refCount > 0
      ? translateOrParams(this.transloco, 'editor.ui.blocks.confirmDeleteReferenced', 'Delete block "{{name}}"? This will also remove {{count}} reference(s) from the drawing.', { name, count: refCount })
      : translateOrParams(this.transloco, 'editor.ui.blocks.confirmDeleteUnused', 'Delete unused block "{{name}}"?', { name });
    if (!confirm(msg)) return;
    this.cmds.push(new DeleteBlockDefCmd(name, file, {
      markDirty: () => this.vm.markContentDirty(),
      refreshBlocks: () => this.doc.bump(),
    }));
  }

  selectRefs(name: string): void {
    const file = this.doc.activeFile;
    for (const e of file.entities) {
      e.selected = (e as any).type === 'INSERT' && (e as any).blockName === name;
    }
    this.vm.markContentDirty();
  }

  purgeUnused(): void {
    const file = this.doc.activeFile;
    this.cmds.push(new PurgeBlockCmd(file, {
      markDirty: () => this.vm.markContentDirty(),
      refreshBlocks: () => this.doc.bump(),
    }));
  }

  onRowContext(e: MouseEvent, row: BlockRow): void {
    e.preventDefault();
  }
}
