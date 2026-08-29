import { Component, effect , ChangeDetectionStrategy
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { InsertTableDialogService, ITableConfig } from './insert-table-dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-insert-table-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (svc.isOpen()) {
      <div class="dialog-overlay">
        <div class="dialog">
          <div class="dialog-header">
            <span>Insert Table</span>
            <button class="close-btn" (click)="cancel()">✕</button>
          </div>
          <div class="dialog-body">
            <div class="col-left">
              <fieldset>
                <legend>Table Style</legend>
                <div class="form-row">
                  <select disabled><option>Standard</option></select>
                  <button class="btn-icon" disabled>...</button>
                </div>
              </fieldset>

              <fieldset>
                <legend>Column & Row settings</legend>
                <div class="grid-2x2">
                  <div class="form-group">
                    <label>Columns:</label>
                    <input type="number" [(ngModel)]="config.cols" min="1" max="50">
                  </div>
                  <div class="form-group">
                    <label>Column width:</label>
                    <input type="number" [(ngModel)]="config.colWidth" min="1" step="0.5">
                  </div>
                  <div class="form-group">
                    <label>Data rows:</label>
                    <input type="number" [(ngModel)]="config.rows" min="1" max="100">
                  </div>
                  <div class="form-group">
                    <label>Row height:</label>
                    <input type="number" [(ngModel)]="config.rowHeight" min="1" step="0.5">
                  </div>
                </div>
              </fieldset>
              <fieldset>
                <legend>Set cell styles</legend>
                <div class="form-group-row">
                  <label>First row cell style:</label>
                  <select class="cell-style-select" [(ngModel)]="config.firstRowStyle">
                    <option value="Title">Title</option>
                    <option value="Header">Header</option>
                    <option value="Data">Data</option>
                  </select>
                </div>
                <div class="form-group-row">
                  <label>Second row cell style:</label>
                  <select class="cell-style-select" [(ngModel)]="config.secondRowStyle">
                    <option value="Title">Title</option>
                    <option value="Header">Header</option>
                    <option value="Data">Data</option>
                  </select>
                </div>
                <div class="form-group-row">
                  <label>All other row cell styles:</label>
                  <select class="cell-style-select" [(ngModel)]="config.otherRowStyle">
                    <option value="Title">Title</option>
                    <option value="Header">Header</option>
                    <option value="Data">Data</option>
                  </select>
                </div>
              </fieldset>
            </div>
            <div class="col-right">
              <fieldset class="preview-fieldset">
                <legend>Preview</legend>
                <div class="preview-container">
                  <div class="preview-canvas">
                    <div class="preview-table" [style]="getPreviewStyle()">
                    <!-- First Row -->
                    @if (config.firstRowStyle === 'Title') {
                      <div class="preview-cell title" style="grid-column: span 3">Title</div>
                    } @else if (config.firstRowStyle === 'Header') {
                      <div class="preview-cell header">Header</div><div class="preview-cell header">Header</div><div class="preview-cell header">Header</div>
                    } @else {
                      <div class="preview-cell data">Data</div><div class="preview-cell data">Data</div><div class="preview-cell data">Data</div>
                    }
                    
                    <!-- Second Row -->
                    @if (config.secondRowStyle === 'Title') {
                      <div class="preview-cell title" style="grid-column: span 3">Title</div>
                    } @else if (config.secondRowStyle === 'Header') {
                      <div class="preview-cell header">Header</div><div class="preview-cell header">Header</div><div class="preview-cell header">Header</div>
                    } @else {
                      <div class="preview-cell data">Data</div><div class="preview-cell data">Data</div><div class="preview-cell data">Data</div>
                    }

                    <!-- Data Rows (Fixed 4 rows for preview) -->
                    @for (_ of getArray(4); track _) {
                      @if (config.otherRowStyle === 'Title') {
                        <div class="preview-cell title" style="grid-column: span 3">Title</div>
                      } @else if (config.otherRowStyle === 'Header') {
                        <div class="preview-cell header">Header</div><div class="preview-cell header">Header</div><div class="preview-cell header">Header</div>
                      } @else {
                        <div class="preview-cell data">Data</div><div class="preview-cell data">Data</div><div class="preview-cell data">Data</div>
                      }
                    }
                  </div>
                </div>
                </div>
              </fieldset>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn primary-btn" (click)="commit()">OK</button>
            <button class="btn" (click)="cancel()">Cancel</button>
            <button class="btn" disabled>Help</button>
          </div>
        </div>
      </div>
    }
    `,
  styles: [`
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 2000; display: flex; align-items: center; justify-content: center; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #000; }
    .dialog { background: #f0f0f0; border: 1px solid #999; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.2); width: 680px; display: flex; flex-direction: column; overflow: hidden; }
    .dialog-header { background: #ffffff; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
    .close-btn { background: none; border: none; color: #333; cursor: pointer; font-size: 16px; transition: color 0.15s; }
    .close-btn:hover { color: #d32f2f; }
    .dialog-body { display: flex; gap: 20px; padding: 20px; }
    .col-left { flex: 1; display: flex; flex-direction: column; gap: 16px; }
    .col-right { flex: 0 0 260px; display: flex; flex-direction: column; }
    
    fieldset { border: 1px solid #d9d9d9; border-radius: 2px; padding: 12px; margin: 0; }
    legend { font-size: 12px; color: #0056b3; padding: 0 4px; font-weight: 500; margin-left: 8px; }
    
    .form-row { display: flex; gap: 4px; }
    select, input[type=number] { background: #fff; border: 1px solid #a6a6a6; color: #000; padding: 4px 6px; border-radius: 2px; font-family: inherit; font-size: 12px; width: 100%; box-sizing: border-box; }
    input[type=number] { text-align: right; }
    select:disabled, input:disabled { background: #e6e6e6; color: #999; border-color: #ccc; }
    .btn-icon { background: #e1e1e1; border: 1px solid #adadad; color: #333; padding: 0 8px; border-radius: 2px; cursor: pointer; }
    .btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .radio-label { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 6px; cursor: pointer; }
    .radio-label.disabled { color: #999; cursor: not-allowed; }
    
    .grid-2x2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-group label { font-size: 12px; color: #333; }
    
    .form-group-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
    .form-group-row label { font-size: 12px; color: #333; white-space: nowrap; }
    .cell-style-select { background: #fff; border: 1px solid #a6a6a6; padding: 4px 6px; border-radius: 2px; width: 120px; flex: 0 0 120px; font-size: 12px; color: #000; outline: none; }
    .cell-style-select:focus { border-color: #0078d7; }

    .preview-fieldset { flex: 1; display: flex; flex-direction: column; }
    .preview-container { flex: 1; display: flex; align-items: stretch; justify-content: stretch; background: #fff; border: 1px solid #d9d9d9; margin-top: 8px; min-height: 220px; padding: 4px; overflow: hidden; box-shadow: inset 0 0 10px rgba(0,0,0,0.05); }
    .preview-canvas { flex: 1; background: #222831; padding: 12px; display: flex; align-items: flex-start; justify-content: center; }
    .preview-table { display: grid; gap: 1px; background: #fff; border: 1px solid #fff; width: 100%; max-width: 220px; }
    .preview-cell { background: #222831; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #fff; overflow: hidden; white-space: nowrap; font-family: 'Arial', sans-serif; }
    .preview-cell.title { font-size: 13px; font-weight: bold; }
    .preview-cell.header { font-weight: bold; }

    .dialog-footer { padding: 16px 20px; border-top: 1px solid #e5e5e5; display: flex; justify-content: flex-end; gap: 12px; background: #f8f8f8; }
    .btn { background: #e1e1e1; border: 1px solid #adadad; color: #000; padding: 6px 24px; border-radius: 2px; font-size: 12px; cursor: pointer; transition: background 0.15s, border-color 0.15s; min-width: 80px; }
    .btn:hover:not(:disabled) { background: #e5f1fb; border-color: #0078d7; }
    .btn.primary-btn { border-color: #0078d7; outline: 1px solid #0078d7; outline-offset: -2px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `]
})
export class InsertTableDialogComponent {
  config: ITableConfig = { rows: 3, cols: 4, colWidth: 40, rowHeight: 10, firstRowStyle: 'Title', secondRowStyle: 'Header', otherRowStyle: 'Data' };
  
  constructor(public svc: InsertTableDialogService) {
    effect(() => {
      if (this.svc.isOpen()) {
        this.config = { ...this.svc.config() };
      }
    });
  }

  getArray(n: number): any[] {
    return Array(Math.max(1, n)).fill(0);
  }

  getPreviewStyle() {
    let gridRows = '';
    
    // First Row
    if (this.config.firstRowStyle === 'Title') gridRows += '24px ';
    else if (this.config.firstRowStyle === 'Header') gridRows += '20px ';
    else gridRows += '18px ';

    // Second Row
    if (this.config.secondRowStyle === 'Title') gridRows += '24px ';
    else if (this.config.secondRowStyle === 'Header') gridRows += '20px ';
    else gridRows += '18px ';

    // Data Rows (4 fixed)
    let otherH = '18px';
    if (this.config.otherRowStyle === 'Title') otherH = '24px';
    else if (this.config.otherRowStyle === 'Header') otherH = '20px';
    
    gridRows += `repeat(4, ${otherH})`;
    
    return {
      'grid-template-columns': `repeat(3, 1fr)`,
      'grid-template-rows': gridRows
    };
  }

  commit() {
    this.svc.commit({ ...this.config });
  }

  cancel() {
    this.svc.cancel();
  }
}
