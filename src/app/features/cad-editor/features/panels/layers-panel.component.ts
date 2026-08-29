import { Component, inject , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { Layer, DxfFile } from '../../core/models/layer.model';
import { ColorPickerComponent } from '../shared/color-picker/color-picker.component';
import { CommandStackService } from '../../core/services/command-stack.service';
import { ModifyLayerPropertyCmd, ModifyPropertiesCmd, CompoundCmd } from '../../core/models/command.model';

/**
 * AutoCAD Layer Properties Manager parity.
 *
 * The `Layer` model already carries `frozen`, `lineType` and `lineWeight`, and
 * the renderer already honours all three - `frozen` is checked in
 * DocumentService.drawAll() and in the select/trim/extend/stretch hit tests, and
 * `lineType`/`lineWeight` drive ByLayer resolution in Entity.setupContext().
 * Only the UI was missing, so these columns are pure exposure of existing
 * behaviour rather than new rendering work.
 */
const LAYER_LINETYPES: string[] = [
  'Continuous', 'DASHED', 'HIDDEN', 'CENTER', 'PHANTOM', 'DOT', 'DASHDOT', 'DASHDOTDOT',
];

const LAYER_LINEWEIGHTS: { value: number; label: string }[] = [
  { value: -3, label: 'Default' },
  { value: 0, label: '0.00 mm' },
  { value: 5, label: '0.05 mm' },
  { value: 9, label: '0.09 mm' },
  { value: 13, label: '0.13 mm' },
  { value: 15, label: '0.15 mm' },
  { value: 18, label: '0.18 mm' },
  { value: 20, label: '0.20 mm' },
  { value: 25, label: '0.25 mm' },
  { value: 30, label: '0.30 mm' },
  { value: 35, label: '0.35 mm' },
  { value: 40, label: '0.40 mm' },
  { value: 50, label: '0.50 mm' },
  { value: 53, label: '0.53 mm' },
  { value: 60, label: '0.60 mm' },
  { value: 70, label: '0.70 mm' },
  { value: 80, label: '0.80 mm' },
  { value: 90, label: '0.90 mm' },
  { value: 100, label: '1.00 mm' },
  { value: 106, label: '1.06 mm' },
  { value: 120, label: '1.20 mm' },
  { value: 140, label: '1.40 mm' },
  { value: 158, label: '1.58 mm' },
  { value: 200, label: '2.00 mm' },
  { value: 211, label: '2.11 mm' },
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-layers-panel',
  standalone: true,
  imports: [FormsModule, ColorPickerComponent],
  template: `
    <div class="layers-panel">
      <div class="header-tools">
        <input type="text" class="layer-search" placeholder="Search layers…" [(ngModel)]="layerFilter" (click)="$event.stopPropagation()">
        <button type="button" class="panel-btn" (click)="addLayer()" title="New layer">+ Layer</button>
      </div>
    
      <!-- Subscribe to version signal so list refreshes -->
      @if (doc.version() !== null) {
        @if (doc.activeFile; as file) {
          <div class="layer-list">
            @for (entry of filteredLayerEntries(file); track trackLayer($index, entry)) {
              <div
                class="layer-row"
                [class.active]="entry.name === doc.activeLayerName"
                (click)="setActiveLayer(file, entry.name)">
                <button class="icon-btn" (click)="toggleLayerVisible(entry.lay); $event.stopPropagation()"
                  [class.off]="!entry.lay.visible"
                  [title]="entry.lay.visible ? 'Turn layer off' : 'Turn layer on'">{{ entry.lay.visible ? '◉' : '◌' }}</button>
                <button class="icon-btn" (click)="toggleLayerFrozen(entry.lay); $event.stopPropagation()"
                  [class.off]="entry.lay.frozen"
                  [title]="entry.lay.frozen ? 'Thaw layer' : 'Freeze layer'">{{ entry.lay.frozen ? '❄' : '☀' }}</button>
                <button class="icon-btn" (click)="toggleLayerLock(entry.lay); $event.stopPropagation()"
                  [class.off]="entry.lay.locked"
                  [title]="entry.lay.locked ? 'Unlock layer' : 'Lock layer'">{{ entry.lay.locked ? '🔒' : '🔓' }}</button>
                <button class="icon-btn" (click)="toggleLayerPrint(entry.lay); $event.stopPropagation()"
                  [class.off]="!entry.lay.print"
                  [title]="entry.lay.print ? 'Plot: on' : 'Plot: off (no-plot)'">{{ entry.lay.print ? '⎙' : '⊘' }}</button>
                <span class="layer-color-cell" (click)="$event.stopPropagation()">
                  <app-color-picker
                    [value]="entry.lay.color"
                    [showLabel]="false"
                    (valueChange)="setLayerColor(entry.lay, $event)">
                  </app-color-picker>
                </span>
                @if (editingLayerId !== entry.name) {
                  <span
                    class="layer-name"
                    [title]="entry.name"
                    (dblclick)="startRename(entry.lay); $event.stopPropagation()">
                    {{ entry.name }}
                  </span>
                }
                @if (editingLayerId === entry.name) {
                  <input
                    type="text"
                    class="layer-rename-input"
                    [value]="entry.name"
                    (blur)="commitRename(file, entry.lay, $event)"
                    (keydown.enter)="commitRename(file, entry.lay, $event)"
                    (keydown.escape)="cancelRename()"
                    (click)="$event.stopPropagation()">
                }
                <select class="layer-select lt"
                  [value]="entry.lay.lineType"
                  (click)="$event.stopPropagation()"
                  (change)="setLayerLinetype(entry.lay, $any($event.target).value)"
                  title="Layer linetype">
                  @for (lt of linetypeOptions; track lt) {
                    <option [value]="lt" [selected]="lt.toUpperCase() === entry.lay.lineType.toUpperCase()">{{ lt }}</option>
                  }
                </select>
                <select class="layer-select lw"
                  [value]="entry.lay.lineWeight"
                  (click)="$event.stopPropagation()"
                  (change)="setLayerLineweight(entry.lay, $any($event.target).value)"
                  title="Layer lineweight">
                  @for (o of lineweightOptions; track o.value) {
                    <option [value]="o.value" [selected]="o.value === entry.lay.lineWeight">{{ o.label }}</option>
                  }
                </select>
                @if (!entry.lay.isProtected) {
                  <button class="icon-btn icon-del" (click)="deleteLayer(file, entry.lay); $event.stopPropagation()" title="Delete layer">Ã—</button>
                }
              </div>
            }
          </div>
        }
      }
    </div>
    `,
  styles: [`
    .layers-panel { display: flex; flex-direction: column; height: 100%; background: transparent; color: var(--cad-text-primary); font-size: 12px; overflow: hidden; }
    /* The row carries more columns than the drawer is wide, so the list scrolls
       horizontally instead of clipping the lineweight column off the edge. */
    .layer-list { flex: 1; overflow: auto; }
    .header-tools {
      display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
      padding: 6px 12px; border-bottom: 1px solid var(--cad-border);
      background: var(--cad-bg-hover);
    }
    .layer-search {
      flex: 1; min-width: 80px;
      background: var(--cad-bg-surface, #181825); color: var(--cad-text-primary);
      border: 1px solid var(--cad-border); border-radius: 3px;
      padding: 3px 8px; font-size: 11px; outline: none;
      &:focus { border-color: var(--cad-accent); }
      &::placeholder { color: var(--cad-text-dim); }
    }
    .panel-btn {
      background: transparent; color: var(--cad-text-primary);
      border: 1px solid var(--cad-border); padding: 2px 8px;
      border-radius: 3px; cursor: pointer; font-size: 11px;
      &:hover { background: var(--cad-bg-hover); }
    }
    .layer-row {
      display: flex; align-items: center; gap: 4px;
      min-width: max-content;
      padding: 4px 10px 4px 12px;
      border-bottom: 1px solid var(--cad-border);
      cursor: pointer; color: var(--cad-text-primary);
      &:hover { background: var(--cad-bg-hover); }
      &.active { background: var(--cad-bg-active); }
      .layer-name { flex: 1 1 44px; min-width: 34px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .layer-rename-input {
        flex: 1; min-width: 0;
        background: var(--cad-bg-input); color: var(--cad-text-primary);
        border: 1px solid var(--cad-accent); border-radius: 2px;
        padding: 0 4px; font-size: 11px; outline: none;
      }
    }
    .icon-btn {
      background: transparent; color: var(--cad-text-dim);
      border: 1px solid transparent; padding: 1px 4px;
      border-radius: 2px; cursor: pointer; font-size: 10px;
      flex: 0 0 auto; line-height: 1.4;
      &:hover { background: var(--cad-bg-hover); border-color: var(--cad-border); color: var(--cad-text-primary); }
      &.icon-del:hover { color: var(--cad-red); border-color: var(--cad-red); }
      /* Off / frozen / locked / no-plot states read as dimmed, matching the
         Layer Properties Manager's greyed-out column glyphs. */
      &.off { color: var(--cad-text-dim); opacity: 0.55; }
    }
    .layer-select {
      flex: 0 0 auto;
      max-width: 70px;
      background: var(--cad-bg-input, #181825);
      color: var(--cad-text-primary);
      border: 1px solid var(--cad-border);
      border-radius: 2px;
      padding: 1px 2px;
      font-size: 10px;
      font-family: var(--cad-font-mono, ui-monospace, monospace);
      outline: none;
      cursor: pointer;
      &:hover { border-color: var(--cad-accent); }
      &:focus { border-color: var(--cad-accent); }
      &.lt { width: 62px; }
      &.lw { width: 54px; }
    }
  `],
})
export class LayersPanelComponent {
  protected doc = inject(DocumentService);
  private vm = inject(ViewModelService);
  private cmds = inject(CommandStackService);

  layerFilter = '';

  readonly linetypeOptions = LAYER_LINETYPES;
  readonly lineweightOptions = LAYER_LINEWEIGHTS;

  layerEntries(file: DxfFile): { name: string; lay: Layer }[] {
    return Array.from(file.layers.entries()).map(([name, lay]) => ({ name, lay }));
  }

  filteredLayerEntries(file: DxfFile): { name: string; lay: Layer }[] {
    const q = this.layerFilter.trim().toLowerCase();
    const entries = this.layerEntries(file);
    return q ? entries.filter((e: any) => e.name.toLowerCase().includes(q)) : entries;
  }

  trackLayer = (_i: number, l: { name: string }) => l.name;

  setActiveLayer(file: DxfFile, name: string): void {
    this.doc.activeFileId = file.id;
    this.doc.activeLayerName = name;
    this.doc.bump();
  }

  toggleLayerVisible(lay: Layer): void {
    this.applyLayerChange(lay, { visible: !lay.visible });
  }

  toggleLayerLock(lay: Layer): void {
    this.applyLayerChange(lay, { locked: !lay.locked });
  }

  /**
   * Freeze / thaw. Distinct from visibility: a frozen layer is skipped by the
   * renderer AND excluded from selection, trim, extend and stretch hit tests,
   * whereas an "off" layer is only hidden. Both are already honoured
   * throughout the codebase; this exposes the toggle.
   */
  toggleLayerFrozen(lay: Layer): void {
    this.applyLayerChange(lay, { frozen: !lay.frozen });
  }

  setLayerLinetype(lay: Layer, value: string): void {
    if (!value || value === lay.lineType) return;
    this.applyLayerChange(lay, { lineType: value });
  }

  setLayerLineweight(lay: Layer, value: string | number): void {
    const lw = typeof value === 'number' ? value : parseInt(value, 10);
    if (!isFinite(lw) || lw === lay.lineWeight) return;
    // `lineWidth` is the legacy display field read by some older render paths;
    // keep the two in step so a lineweight change is visible immediately.
    this.applyLayerChange(lay, { lineWeight: lw, lineWidth: lw > 0 ? lw / 100 : 0 });
  }

  /**
   * Route every layer-property edit through the command stack so Ctrl+Z
   * restores it, and bump the document so panels bound to `doc.version()`
   * re-read the mutated Layer instance (signals cannot see in-place field
   * writes on a plain class).
   */
  private applyLayerChange(lay: Layer, after: Record<string, unknown>): void {
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(after)) before[k] = (lay as unknown as Record<string, unknown>)[k];

    this.cmds.push(
      new ModifyLayerPropertyCmd(
        lay as unknown as { [k: string]: unknown },
        before,
        after,
        {
          markDirty: () => {
            this.vm.markContentDirty();
            this.doc.bump();
          },
        },
      ),
    );
  }

  toggleLayerPrint(lay: Layer): void {
    if (lay.isDefpoints) return;
    this.applyLayerChange(lay, { print: !lay.print });
  }

  /**
   * Apply a new layer color through the command stack so Ctrl+Z restores
   * the prior color. Picker emits the canonical `#rrggbb` hex on commit.
   *
   * Layer color is the source of truth — any entity on this layer that has
   * an explicit color override (direct hex, or ACI != 256) is also reset to
   * BYLAYER so the new layer color paints through visibly (rule 3:
   * "Connected — any property change must propagate to Canvas..."). All
   * three mutations land in a single CompoundCmd so undo restores both the
   * old layer color and each entity's prior override in one step.
   */
  setLayerColor(lay: Layer, hex: string): void {
    if (!hex || lay.color === hex) return;

    // Locate the file that owns this Layer instance — layers are file-scoped,
    // and the panel can edit layers from any open file.
    let ownerFile: DxfFile | null = null;
    let layerName: string | null = null;
    outer: for (const f of this.doc.files) {
      for (const [name, l] of f.layers) {
        if (l === lay) { ownerFile = f; layerName = name; break outer; }
      }
    }

    const hooks = { markDirty: () => this.vm.markContentDirty() };
    const layerCmd = new ModifyLayerPropertyCmd(
      lay as unknown as { [k: string]: unknown },
      { color: lay.color },
      { color: hex },
      hooks,
    );

    const overridden = ownerFile && layerName
      ? ownerFile.entities.filter(
          (e: any) =>
            e.layer === layerName &&
            (e.color != null ||
              (e.colorNumber !== 256 && e.colorNumber >= 0 && e.colorNumber < 256)),
        )
      : [];

    if (overridden.length === 0) {
      this.cmds.push(layerCmd);
      return;
    }

    const oldColors = overridden.map((e: any) => ({ id: e.id, value: e.color }));
    const oldColorNumbers = overridden.map((e: any) => ({ id: e.id, value: e.colorNumber }));

    this.cmds.push(
      new CompoundCmd([
        layerCmd,
        new ModifyPropertiesCmd(overridden, 'color', null, oldColors, hooks),
        new ModifyPropertiesCmd(overridden, 'colorNumber', 256, oldColorNumbers, hooks),
      ]),
    );
  }

  addLayer(): void {
    const file = this.doc.activeFile;
    // Suggest a unique default
    let idx = file.layers.size;
    let suggested = `Layer ${idx}`;
    while (file.layers.has(suggested)) {
      idx++;
      suggested = `Layer ${idx}`;
    }
    const colors = ['#e8eaf0', '#ff6b6b', '#51cf66', '#ffd43b', '#74c0fc', '#cc5de8', '#ff922b', '#22b8cf'];
    const lay = new Layer(suggested, colors[file.layers.size % colors.length], file.layers.size + 7);
    file.layers.set(suggested, lay);
    this.doc.activeLayerName = suggested;
    this.doc.bump();
    this.vm.markContentDirty();
    this.startRename(lay);
  }

  editingLayerId: string | null = null;

  startRename(lay: Layer): void {
    if (lay.isProtected) return;
    this.editingLayerId = lay.name;
    setTimeout(() => {
      const el = document.querySelector('.layer-rename-input') as HTMLInputElement;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
  }

  cancelRename(): void {
    this.editingLayerId = null;
  }

  commitRename(file: DxfFile, lay: Layer, event: Event): void {
    if (!this.editingLayerId) return; // already committed or cancelled
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim();
    this.editingLayerId = null;

    if (!newName || newName === lay.name) return;
    if (file.layers.has(newName)) {
      alert(`Layer "${newName}" already exists.`);
      return;
    }

    const oldName = lay.name;

    // Rename in map
    file.layers.delete(oldName);
    lay.name = newName;

    // Convert entries back to an array to maintain insertion order if necessary,
    // though Map preserves insertion order. To insert at the same place, we'd need to rebuild.
    // For simplicity, just set it at the end (standard Map behavior).
    file.layers.set(newName, lay);

    if (this.doc.activeLayerName === oldName) {
      this.doc.activeLayerName = newName;
    }

    for (const ent of file.entities) {
      if (ent.layer === oldName) {
        ent.layer = newName;
      }
    }

    this.doc.bump();
    this.vm.markContentDirty();
  }

  deleteLayer(file: DxfFile, lay: Layer): void {
    if (lay.isProtected) return;
    file.layers.delete(lay.name);
    if (this.doc.activeLayerName === lay.name) {
      this.doc.activeLayerName = file.layers.keys().next().value ?? 'Layer 0';
    }
    // Reassign entities from deleted layer back to Layer 0
    for (const ent of file.entities) {
      if (ent.layer === lay.name) ent.layer = 'Layer 0';
    }
    this.doc.bump();
    this.vm.markContentDirty();
  }
}
