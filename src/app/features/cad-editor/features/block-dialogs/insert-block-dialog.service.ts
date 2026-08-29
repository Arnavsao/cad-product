import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface IInsertBlockParams {
  blockName: string;
  scaleX: number;
  scaleY: number;
  rotation: number;
  uniformScale: boolean;
}

@Injectable({ providedIn: 'root' })
export class InsertBlockDialogService {
  readonly isOpen = signal(false);
  readonly blockNames = signal<string[]>([]);
  readonly config = signal<IInsertBlockParams>({
    blockName: '',
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    uniformScale: true,
  });
  private resultSubject: Subject<IInsertBlockParams | null> | null = null;

  open(names: string[], preselected?: string): Promise<IInsertBlockParams | null> {
    this.blockNames.set(names);
    const cfg = this.config();
    this.config.set({
      ...cfg,
      blockName: preselected ?? names[0] ?? '',
    });
    this.isOpen.set(true);
    this.resultSubject = new Subject<IInsertBlockParams | null>();
    return new Promise((resolve) => {
      this.resultSubject?.subscribe((res) => resolve(res));
    });
  }

  commit(result: IInsertBlockParams): void {
    this.config.set({ ...result });
    this.isOpen.set(false);
    this.resultSubject?.next(result);
    this.resultSubject?.complete();
    this.resultSubject = null;
  }

  cancel(): void {
    this.isOpen.set(false);
    this.resultSubject?.next(null);
    this.resultSubject?.complete();
    this.resultSubject = null;
  }
}
