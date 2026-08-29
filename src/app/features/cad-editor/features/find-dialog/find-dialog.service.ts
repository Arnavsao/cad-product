import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class FindDialogService {
  readonly isOpen = signal(false);

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
