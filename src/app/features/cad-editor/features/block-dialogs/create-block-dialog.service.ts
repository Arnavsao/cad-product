import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export interface ICreateBlockResult {
  name: string;
  basePointMode: 'pick' | 'origin';
  description: string;
}

@Injectable({ providedIn: 'root' })
export class CreateBlockDialogService {
  readonly isOpen = signal(false);
  readonly suggestedName = signal('');
  readonly existingNames = signal<string[]>([]);
  private resultSubject: Subject<ICreateBlockResult | null> | null = null;

  open(suggested: string, existing: string[]): Promise<ICreateBlockResult | null> {
    this.suggestedName.set(suggested);
    this.existingNames.set(existing);
    this.isOpen.set(true);
    this.resultSubject = new Subject<ICreateBlockResult | null>();
    return new Promise((resolve) => {
      this.resultSubject?.subscribe((res) => resolve(res));
    });
  }

  commit(result: ICreateBlockResult): void {
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
