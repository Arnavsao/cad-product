import {
  Component, OnInit, ViewChild, ViewChildren, QueryList, ElementRef, AfterViewInit, inject, ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { DimensionStyleRegistryService } from '../../core/services/dimension-style-registry.service';
import { DimensionStyle } from '../../../../../cad-core/models/dimension/DimensionStyle';
import { DimensionGeometryBuilder } from '../../../../../cad-core/models/dimension/DimensionGeometryBuilder';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { DimStyleDialogService } from './dim-style-dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dim-style-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './dim-style-dialog.component.html',
  styleUrls: ['./dim-style-dialog.component.scss']
})
export class DimStyleDialogComponent implements OnInit, AfterViewInit {
  @ViewChildren('previewCanvas') previewCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  public activeTab: 'Lines' | 'Arrows' | 'Text' | 'Fit' | 'PrimaryUnits' | 'AlternateUnits' | 'Tolerances' = 'Lines';
  public styles: DimensionStyle[] = [];
  public selectedStyleId: string = '';
  public editingStyle!: DimensionStyle;

  public svc = inject(DimStyleDialogService);

  constructor(
    private dimRegistry: DimensionStyleRegistryService,
    private documentService: DocumentService,
    private vm: ViewModelService
  ) { }

  ngOnInit() {
    this.refreshStyles();
    this.selectedStyleId = this.dimRegistry.getCurrentStyle().id;
    this.onStyleSelect(this.selectedStyleId);
  }

  ngAfterViewInit() {
    this.drawPreview();
  }

  public close() {
    this.svc.close();
  }

  public refreshStyles() {
    this.styles = this.dimRegistry.getAllStyles();
  }

  public onStyleSelect(id: string) {
    this.selectedStyleId = id;
    const style = this.dimRegistry.getStyle(id);
    if (style) {
      this.editingStyle = JSON.parse(JSON.stringify(style));
      this.drawPreview();
    }
  }

  public onStyleChange() {
    this.drawPreview();
  }

  public saveAndClose() {
    if (this.editingStyle) {
      this.dimRegistry.addStyle(this.editingStyle);

      // Push the update to the current document
      if (this.documentService.activeFile && this.documentService.activeFile.dimStyles instanceof Map) {
        const styleToSave: any = JSON.parse(JSON.stringify(this.editingStyle));

        // Map the dialog's cad-core properties to the rendering engine's properties
        if (styleToSave.extendBeyondDim !== undefined) styleToSave.extensionPast = styleToSave.extendBeyondDim;
        if (styleToSave.offsetFromOrigin !== undefined) styleToSave.extensionGap = styleToSave.offsetFromOrigin;
        if (styleToSave.textGap !== undefined) styleToSave.textOffset = styleToSave.textGap;

        if (styleToSave.linearFormat !== undefined) styleToSave.unitFormat = styleToSave.linearFormat.toLowerCase();
        if (styleToSave.linearPrecision !== undefined) styleToSave.unitPrecision = styleToSave.linearPrecision;
        if (styleToSave.prefix !== undefined) styleToSave.unitPrefix = styleToSave.prefix;
        if (styleToSave.suffix !== undefined) styleToSave.unitSuffix = styleToSave.suffix;

        if (styleToSave.textPlacementVert !== undefined) {
          let p = styleToSave.textPlacementVert.toLowerCase();
          if (p === 'centered') p = 'auto';
          styleToSave.textPlacement = p;
        }

        if (styleToSave.arrowType1 !== undefined) {
          let t = styleToSave.arrowType1.toLowerCase();
          if (t === 'closedfilled') t = 'closed';
          else if (t === 'closedblank') t = 'open';
          else if (t === 'architecturaltick') t = 'tick';
          styleToSave.arrowType = t;
        }

        if (styleToSave.zeroSuppression !== undefined) {
          styleToSave.suppressTrailingZeros = (styleToSave.zeroSuppression === 'Trailing' || styleToSave.zeroSuppression === 'Both');
        }

        // The CAD rendering engine expects the key to be the style's .name, not .id
        const key = this.editingStyle.name || this.editingStyle.id;
        this.documentService.activeFile.dimStyles.set(key, styleToSave);
      }

      // Force all dimensions and mleaders to refresh geometry with the new style
      this.documentService.activeFile?.entities.forEach((ent: any) => {
        if (ent.type === 'DIMENSION' || ent.type === 'MLEADER' || ent.type === 'LEADER') {
          if (typeof ent.refreshCaches === 'function') {
            ent.refreshCaches(this.documentService);
          }
        }
      });

      // Trigger redraw of main canvas
      this.vm.markContentDirty();
    }
    this.close();
  }

  public setTab(tab: typeof this.activeTab) {
    this.activeTab = tab;
    setTimeout(() => this.drawPreview(), 0);
  }

  private drawPreview() {
    if (!this.previewCanvases || this.previewCanvases.length === 0 || !this.editingStyle) return;

    const canvas = this.previewCanvases.first.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw mock geometry (a simple bracket)
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 80);
    ctx.lineTo(50, 40);
    ctx.lineTo(250, 40);
    ctx.lineTo(250, 80);
    ctx.stroke();

    // Use the GeometryBuilder to calculate dimension primitives
    const builder = new DimensionGeometryBuilder(this.editingStyle, { viewportScale: 1 });
    const origin1 = { x: 50, y: 40 };
    const origin2 = { x: 250, y: 40 };
    const dimLineLocation = { x: 150, y: 20 };

    const primitives = builder.buildLinearPipeline(origin1, origin2, dimLineLocation);

    // Translate our builder primitives to 2D Canvas calls for the preview
    // Lines
    primitives.lines.forEach((l: any) => {
      ctx.strokeStyle = l.color === 'ByBlock' ? '#fff' : (l.color || '#fff');
      ctx.lineWidth = l.weight > 0 ? l.weight : 1;
      ctx.beginPath();
      ctx.moveTo(l.start.x, l.start.y);
      ctx.lineTo(l.end.x, l.end.y);
      ctx.stroke();
    });

    // Texts
    primitives.texts.forEach((t: any) => {
      ctx.fillStyle = t.color === 'ByBlock' ? '#fff' : (t.color || '#fff');
      ctx.font = `${t.height * 5}px sans-serif`; // Scale text for preview visibility
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.save();
      ctx.translate(t.position.x, t.position.y);
      ctx.rotate(-t.rotation * Math.PI / 180);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    });

    // Arrows (Mocking drawing an arrow as a circle/block for preview)
    primitives.blocks.forEach((b: any) => {
      ctx.fillStyle = b.color === 'ByBlock' ? '#fff' : (b.color || '#fff');
      ctx.beginPath();
      ctx.arc(b.position.x, b.position.y, b.scale, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
