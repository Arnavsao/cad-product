import { Component, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { FindDialogService } from './find-dialog.service';
import { FindReplaceService, FindResult } from '../../core/services/find-replace.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { DocumentService } from '../../core/services/document.service';
import { ViewModelService } from '../../core/services/view-model.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-find-dialog',
  standalone: true,
  imports: [FormsModule, DragDropModule],
  templateUrl: './find-dialog.component.html',
  styleUrls: ['./find-dialog.component.scss']
})
export class FindDialogComponent {
  public svc = inject(FindDialogService);
  private findReplaceSvc = inject(FindReplaceService);
  private notify = inject(NotificationService);
  private doc = inject(DocumentService);
  private vm = inject(ViewModelService);

  public findWhat = signal('');
  public replaceWith = signal('');
  public findWhere = signal<'entire_drawing' | 'current_layout' | 'selected'>('entire_drawing');
  
  public matchCase = signal(false);
  public wholeWords = signal(false);
  public listResults = signal(false);
  
  public advancedExpanded = signal(false);

  public results = signal<FindResult[]>([]);
  public activeResultIndex = signal(0);
  
  private lastSearchKey = '';

  public close(): void {
    this.svc.close();
  }

  public find(silent: boolean = false): void {
    const res = this.findReplaceSvc.findMatches(this.findWhat(), {
      matchCase: this.matchCase(),
      wholeWords: this.wholeWords(),
      scope: this.findWhere()
    });

    const currentSearchKey = `${this.findWhat()}|${this.matchCase()}|${this.wholeWords()}|${this.findWhere()}`;
    const isNewSearch = currentSearchKey !== this.lastSearchKey;
    this.lastSearchKey = currentSearchKey;

    let newIndex = 0;
    if (!isNewSearch && res.length > 0) {
      newIndex = (this.activeResultIndex() + 1) % res.length;
    }
    
    this.results.set(res);
    this.activeResultIndex.set(newIndex);
    
    if (res.length === 0) {
      if (!silent) {
        this.notify.info('No matches found.');
      }
    } else {
      if (isNewSearch && !silent) {
        this.notify.success(`Found ${res.length} match(es).`);
      } else if (!isNewSearch && newIndex === 0 && !silent) {
        this.notify.info('Finished searching the drawing.');
      }
      this.focusMatch(res[newIndex]);
    }
  }

  private focusMatch(match: FindResult): void {
    this.doc.clearSelection();
    this.doc.setEntitySelected(match.entity, true);
    
    // Attempt to pan to the entity center
    const box = match.entity.bbox();
    if (box) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      
      // Auto-zoom if the text is too small (takes up less than 15% of screen width)
      const screenW = box.w * this.vm.scale;
      const targetScreenW = (this.vm.canvasWidth || 800) * 0.15;
      if (screenW > 0 && screenW < targetScreenW) {
        this.vm.scale = Math.min(targetScreenW / box.w, 100);
      }
      
      this.vm.panX = -cx * this.vm.scale;
      this.vm.panY = cy * this.vm.scale;
      this.vm.markViewDirty();
    }
    
    this.vm.markContentDirty();
  }

  public replace(): void {
    const res = this.results();
    if (res.length > 0 && this.activeResultIndex() < res.length) {
      this.findReplaceSvc.replace(res[this.activeResultIndex()], this.findWhat(), this.replaceWith(), {
        matchCase: this.matchCase(),
        wholeWords: this.wholeWords(),
        scope: this.findWhere()
      });
      this.find(true);
      const newRes = this.results();
      if (newRes.length === 0) {
        this.close();
      }
    } else {
      this.find(true);
      const newRes = this.results();
      if (newRes.length > 0) {
        this.replace();
      } else {
        this.notify.info('No matches found.');
      }
    }
  }

  public replaceAll(): void {
    const count = this.findReplaceSvc.replaceAll(this.findWhat(), this.replaceWith(), {
      matchCase: this.matchCase(),
      wholeWords: this.wholeWords(),
      scope: this.findWhere()
    });
    this.notify.success(`Replaced ${count} occurrences.`);
    this.results.set([]);
    if (count > 0) {
      this.close();
    }
  }
}
