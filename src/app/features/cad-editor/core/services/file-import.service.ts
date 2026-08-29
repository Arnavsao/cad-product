import { Injectable, inject } from '@angular/core';
import { DocumentService } from './document.service';
import { DocumentManagerService } from './document-manager.service';
import { ViewModelService } from './view-model.service';
import { DxfImportService } from './dxf-import.service';
import { ToolManagerService } from './tool-manager.service';
import { ImageTool } from '../../tools/draw/image-tool';

@Injectable({ providedIn: 'root' })
export class FileImportService {
  private doc = inject(DocumentService);
  private docManager = inject(DocumentManagerService);
  private vm = inject(ViewModelService);
  private dxfImport = inject(DxfImportService);
  private toolMgr = inject(ToolManagerService);

  private imageQueue: File[] = [];
  private isProcessingImages = false;

  handleFiles(files: File[]): void {
    if (!files.length) return;

    // Separate by type: DXF, JSON (entity payload), and images.
    const dxfs  = files.filter(f => f.name.toLowerCase().endsWith('.dxf'));
    const jsons = files.filter(f => f.name.toLowerCase().endsWith('.json'));
    const images = files.filter(f =>
      f.type.startsWith('image/') ||
      /\.(png|jpe?g|svg|webp|gif)$/i.test(f.name)
    );
    const unsupported = files.filter(f =>
      !dxfs.includes(f) && !jsons.includes(f) && !images.includes(f)
    );

    if (unsupported.length > 0) {
      console.warn(`Ignored unsupported files: ${unsupported.map(f => f.name).join(', ')}`);
    }

    // JSON and DXF both go through loadDxfDataAsync — the worker auto-detects
    // JSON vs DXF from the content. Give priority to whichever was dropped.
    const toImport = [...dxfs, ...jsons];
    if (toImport.length > 0) {
      this._importDxf(toImport[0]);
    }

    if (images.length > 0) {
      this.imageQueue.push(...images);
      if (!this.isProcessingImages) {
        this._processNextImage();
      }
    }
  }

  private _importDxf(file: File): void {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      if (text) {
        try {
          await this.dxfImport.loadDxfDataAsync(text, file.name);
          this.vm.zoomExtentsWhenReady(this.doc);

          // Drop the untouched `Drawing1` scaffolding tab the editor boots with.
          this.docManager.closeBlankDocuments(this.doc.activeFileId);
        } catch (err) {
          console.error(`Error processing DXF data for ${file.name}:`, err);
        }
      }
    };
    reader.onerror = () => {
      console.error(`Failed to read DXF file: ${file.name}`);
    };
    reader.readAsText(file);
  }

  private async _processNextImage(): Promise<void> {
    if (this.imageQueue.length === 0) {
      this.isProcessingImages = false;
      this.toolMgr.setTool('select');
      return;
    }

    this.isProcessingImages = true;
    const nextFile = this.imageQueue.shift()!;
    
    // Set static flag FIRST so activate() will not open a second file picker dialog
    ImageTool.isProgrammaticQueue = true;

    const tool = await this.toolMgr.setTool('image');
    const imageTool = tool as ImageTool;
    
    if (imageTool && typeof imageTool.loadFromFile === 'function') {
      imageTool.loadFromFile(nextFile, () => {
        // Called when placed or cancelled
        this._processNextImage();
      });
    } else {
      console.error('Image tool does not support programmatic loading.');
      ImageTool.isProgrammaticQueue = false;
      this.isProcessingImages = false;
    }
  }
}
