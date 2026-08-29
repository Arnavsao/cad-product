import { Injectable, signal } from '@angular/core';
import type { Entity } from '../../core/models/entity.model';

export interface ISaveToLibraryState {
  open: boolean;
  entities: Entity[];
}

/**
 * Signal-based service to open/close the Save-to-Library modal.
 * The modal component reads `state()` to know what to display.
 * LibraryService handles the actual save; this service is only UI state.
 */
@Injectable({ providedIn: 'root' })
export class SaveToLibraryModalService {
  readonly state = signal<ISaveToLibraryState>({ open: false, entities: [] });

  open(entities: Entity[]): void {
    this.state.set({ open: true, entities });
  }

  close(): void {
    this.state.update(s => ({ ...s, open: false }));
  }
}
