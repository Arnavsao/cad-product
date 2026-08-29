import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface ITableConfig {
  rows: number;
  cols: number;
  colWidth: number;
  rowHeight: number;
  firstRowStyle: 'Title' | 'Header' | 'Data';
  secondRowStyle: 'Title' | 'Header' | 'Data';
  otherRowStyle: 'Title' | 'Header' | 'Data';
}

@Injectable({ providedIn: 'root' })
export class InsertTableDialogService {
  isOpen = signal<boolean>(false);
  
  private resultSubject: Subject<ITableConfig | null> | null = null;
  
  // Last used settings
  config = signal<ITableConfig>({
    rows: 3,
    cols: 4,
    rowHeight: 10,
    colWidth: 40,
    firstRowStyle: 'Title',
    secondRowStyle: 'Header',
    otherRowStyle: 'Data',
  });

  open(): Promise<ITableConfig | null> {
    this.isOpen.set(true);
    this.resultSubject = new Subject<ITableConfig | null>();
    return new Promise((resolve) => {
      this.resultSubject?.subscribe(res => resolve(res));
    });
  }

  commit(conf: ITableConfig) {
    this.config.set({ ...conf });
    this.isOpen.set(false);
    this.resultSubject?.next(conf);
    this.resultSubject?.complete();
    this.resultSubject = null;
  }

  cancel() {
    this.isOpen.set(false);
    this.resultSubject?.next(null);
    this.resultSubject?.complete();
    this.resultSubject = null;
  }
}
