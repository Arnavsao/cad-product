import { Component, inject, signal, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FileUploadService } from '../../../../core/services/file-upload.service';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { DocumentManagerService } from '../../core/services/document-manager.service';
import { DocumentService } from '../../core/services/document.service';
import { DxfImportService } from '../../core/services/dxf-import.service';
import { ViewModelService } from '../../core/services/view-model.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { LSectionService } from './services/l-section.service';

interface FileUploadState {
  url: string | null;
  uploading: boolean;
  error: string | null;
  fileName: string | null;
}

@Component({
  selector: 'app-l-section-panel',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['./l-section-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="l-section-panel">
      
      <!-- KML File -->
      <div class="upload-group">
        <label class="upload-label">KML File (.kml)</label>
        <div class="input-wrapper">
          <input #kmlInput type="file" class="upload-input" accept=".kml" (change)="onFileChange($event, 'kml')" [disabled]="isGenerating()" />
          @if (fileState().kml.url || fileState().kml.fileName) {
            <button class="clear-btn" (click)="clearFile('kml', kmlInput)" title="Remove file">✕</button>
          }
        </div>
      </div>

      <!-- DTM File -->
      <div class="upload-group">
        <label class="upload-label">DTM File (.tif)</label>
        <div class="input-wrapper">
          <input #dtmInput type="file" class="upload-input" accept=".tif,.tiff" (change)="onFileChange($event, 'dtm')" [disabled]="isGenerating()" />
          @if (fileState().dtm.url || fileState().dtm.fileName) {
            <button class="clear-btn" (click)="clearFile('dtm', dtmInput)" title="Remove file">✕</button>
          }
        </div>
      </div>

      <!-- Survey File -->
      <div class="upload-group">
        <label class="upload-label">Survey File (.xlsx, .xls)</label>
        <div class="input-wrapper">
          <input #surveyInput type="file" class="upload-input" accept=".xlsx,.xls" (change)="onFileChange($event, 'survey')" [disabled]="isGenerating()" />
          @if (fileState().survey.url || fileState().survey.fileName) {
            <button class="clear-btn" (click)="clearFile('survey', surveyInput)" title="Remove file">✕</button>
          }
        </div>
      </div>

      <!-- Bridge File -->
      <div class="upload-group">
        <label class="upload-label">Bridge File (.xlsx, .xls)</label>
        <div class="input-wrapper">
          <input #bridgeInput type="file" class="upload-input" accept=".xlsx,.xls" (change)="onFileChange($event, 'bridge')" [disabled]="isGenerating()" />
          @if (fileState().bridge.url || fileState().bridge.fileName) {
            <button class="clear-btn" (click)="clearFile('bridge', bridgeInput)" title="Remove file">✕</button>
          }
        </div>
      </div>

      <div class="action-row">
        <button class="generate-btn" [disabled]="!canGenerate() || isGenerating()" (click)="generate()">
          {{ isGenerating() ? 'Generating...' : 'Generate DXF' }}
        </button>
      </div>

      @if (statusMessage()) {
        <div class="status-message" [ngClass]="statusType()">
          {{ statusMessage() }}
        </div>
      }

    </div>
  `
})
export class LSectionPanelComponent {
  private route = inject(ActivatedRoute);
  private uploads = inject(FileUploadService);
  private http = inject(HttpClient);
  private docManager = inject(DocumentManagerService);
  private doc = inject(DocumentService);
  private dxfImport = inject(DxfImportService);
  private vm = inject(ViewModelService);
  private notificationService = inject(NotificationService);
  private lSectionService = inject(LSectionService);

  private readonly emptyState: FileUploadState = { url: null, uploading: false, error: null, fileName: null };

  fileState = signal<{ kml: FileUploadState, dtm: FileUploadState, survey: FileUploadState, bridge: FileUploadState }>({
    kml: { ...this.emptyState },
    dtm: { ...this.emptyState },
    survey: { ...this.emptyState },
    bridge: { ...this.emptyState }
  });

  isGenerating = signal(false);

  statusMessage = signal<string | null>(null);
  statusType = signal<'loading' | 'success' | 'error'>('loading');

  async onFileChange(event: Event, type: 'kml' | 'dtm' | 'survey' | 'bridge') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      // Clear file state if user cancels selection
      this.fileState.update(s => ({ ...s, [type]: { ...this.emptyState } }));
      return;
    }

    const file = input.files[0];

    // Set to uploading state
    this.fileState.update(s => ({
      ...s,
      [type]: { url: null, uploading: true, error: null, fileName: file.name }
    }));

    try {
      const projectId = this.route.snapshot.queryParams['projectId'] || 'unknown-project';
      const contentType = file.type || 'application/octet-stream';

      const presignedRes = await lastValueFrom(
        this.uploads.getPresignedUrl(file.name, contentType, projectId)
      );

      if (presignedRes?.uploadUrl) {
        await lastValueFrom(this.uploads.uploadToS3(presignedRes.uploadUrl, file));
        const fileUrl = presignedRes.fileUrl || presignedRes.uploadUrl.split('?')[0];

        // Success
        this.fileState.update(s => ({
          ...s,
          [type]: { url: fileUrl, uploading: false, error: null, fileName: file.name }
        }));
      } else {
        throw new Error(`Failed to get presigned URL`);
      }
    } catch (err: any) {
      console.error(`Failed to upload ${type}:`, err);
      // Error
      this.fileState.update(s => ({
        ...s,
        [type]: { url: null, uploading: false, error: err.message || 'Upload failed', fileName: file.name }
      }));
    }
  }

  clearFile(type: 'kml' | 'dtm' | 'survey' | 'bridge', inputElement: HTMLInputElement) {
    inputElement.value = '';
    this.fileState.update(s => ({ ...s, [type]: { ...this.emptyState } }));
  }

  canGenerate(): boolean {
    const s = this.fileState();
    return !!(s.kml.url && s.dtm.url && s.survey.url && s.bridge.url);
  }

  async generate() {
    if (!this.canGenerate()) return;

    this.isGenerating.set(true);
    this.statusMessage.set('Calling generation API...');
    this.statusType.set('loading');

    try {
      const projectId = this.route.snapshot.queryParams['projectId'] || 'unknown-project';
      const s = this.fileState();

      const s3Paths = {
        kml: s.kml.url!,
        dtm: s.dtm.url!,
        survey: s.survey.url!,
        bridge: s.bridge.url!
      };

      // 3. API Call to Generate DXF
      const payload = {
        projectId,
        files: s3Paths
      };

      const genResponse = await lastValueFrom(
        this.lSectionService.generateDxf(payload)
      );

      if (!genResponse?.dxfUrl) {
        throw new Error('DXF Generation API did not return a valid dxfUrl.');
      }

      this.statusMessage.set('Downloading generated DXF...');

      // 4. Fetch the actual DXF text content from the returned S3 URL
      const dxfText = await lastValueFrom(
        this.http.get(genResponse.dxfUrl, { responseType: 'text' })
      );

      this.statusMessage.set('Loading DXF into Editor...');

      // 5. Load into CAD Editor
      await this.dxfImport.loadDxfDataAsync(dxfText, 'L_Section_Generated.dxf');

      // Zoom to fit
      this.vm.zoomExtentsWhenReady(this.doc);

      this.statusMessage.set('DXF Generated and Loaded Successfully!');
      this.statusType.set('success');
      this.notificationService.success('DXF Generation Complete');

    } catch (err: any) {
      console.error('L-Section Generation Error:', err);
      this.statusMessage.set(err.message || 'An error occurred during generation.');
      this.statusType.set('error');
    } finally {
      this.isGenerating.set(false);
    }
  }
}
