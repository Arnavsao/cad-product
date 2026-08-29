import { Injectable, inject } from '@angular/core';
import type { Entity } from '../models/entity.model';
import type { DxfFile } from '../models/layer.model';
import { CommandStackService } from './command-stack.service';
import { ReorderEntitiesCmd } from '../models/command.model';
import { ViewModelService } from './view-model.service';

@Injectable({ providedIn: 'root' })
export class DrawOrderService {
  private cmdStack = inject(CommandStackService);
  private vm = inject(ViewModelService);

  /**
   * Assigns sequential drawOrders to newly imported/created entities.
   * If a file already has entities, new ones are placed on top.
   */
  assignInitial(entities: Entity[], existingEntities: Entity[] = []): void {
    let maxOrder = 0;
    if (existingEntities.length > 0) {
      maxOrder = Math.max(...existingEntities.map(e => e.drawOrder));
    }
    for (let i = 0; i < entities.length; i++) {
      entities[i].drawOrder = maxOrder + i + 1;
    }
  }

  bringToFront(movers: Entity[], file: DxfFile): void {
    if (!movers.length) return;
    const maxOrder = Math.max(...file.entities.map(e => e.drawOrder));
    this.reorder(movers, movers.map((_, i) => maxOrder + i + 1));
  }

  sendToBack(movers: Entity[], file: DxfFile): void {
    if (!movers.length) return;
    const minOrder = Math.min(...file.entities.map(e => e.drawOrder));
    this.reorder(movers, movers.map((_, i) => minOrder - movers.length + i));
  }

  bringForward(movers: Entity[], file: DxfFile): void {
    if (!movers.length) return;
    // For each mover, find the next highest entity not in the movers set and swap/increment
    const sortedMovers = [...movers].sort((a, b) => b.drawOrder - a.drawOrder); // highest first
    const newOrders = movers.map(e => e.drawOrder);
    
    // Simplest approach: just add a small increment that pushes them past the next entity.
    // To be precise: sort all entities, find the one just above, and swap.
    const allSorted = [...file.entities].sort((a, b) => a.drawOrder - b.drawOrder);
    
    for (const m of sortedMovers) {
      const idx = allSorted.findIndex(e => e.id === m.id);
      if (idx >= 0 && idx < allSorted.length - 1) {
        // Find next entity that is NOT in movers
        let nextIdx = idx + 1;
        while (nextIdx < allSorted.length && movers.includes(allSorted[nextIdx])) {
          nextIdx++;
        }
        if (nextIdx < allSorted.length) {
          const targetOrder = allSorted[nextIdx].drawOrder;
          // Push it just above targetOrder
          const mIdx = movers.findIndex(e => e.id === m.id);
          newOrders[mIdx] = targetOrder + 1;
          // Re-sort allSorted to maintain invariants for next mover
          allSorted[idx].drawOrder = targetOrder + 1;
          allSorted.sort((a, b) => a.drawOrder - b.drawOrder);
        }
      }
    }
    this.reorder(movers, newOrders);
  }

  sendBackward(movers: Entity[], file: DxfFile): void {
    if (!movers.length) return;
    const sortedMovers = [...movers].sort((a, b) => a.drawOrder - b.drawOrder); // lowest first
    const newOrders = movers.map(e => e.drawOrder);
    
    const allSorted = [...file.entities].sort((a, b) => a.drawOrder - b.drawOrder);
    
    for (const m of sortedMovers) {
      const idx = allSorted.findIndex(e => e.id === m.id);
      if (idx > 0) {
        let prevIdx = idx - 1;
        while (prevIdx >= 0 && movers.includes(allSorted[prevIdx])) {
          prevIdx--;
        }
        if (prevIdx >= 0) {
          const targetOrder = allSorted[prevIdx].drawOrder;
          const mIdx = movers.findIndex(e => e.id === m.id);
          newOrders[mIdx] = targetOrder - 1;
          allSorted[idx].drawOrder = targetOrder - 1;
          allSorted.sort((a, b) => a.drawOrder - b.drawOrder);
        }
      }
    }
    this.reorder(movers, newOrders);
  }

  bringAbove(movers: Entity[], reference: Entity, file: DxfFile): void {
    if (!movers.length) return;
    const allSorted = [...file.entities].sort((a, b) => a.drawOrder - b.drawOrder);
    const refIdx = allSorted.findIndex(e => e.id === reference.id);
    if (refIdx === -1) return;
    
    // Find a slot just above reference
    let targetOrder = reference.drawOrder + 1;
    if (refIdx < allSorted.length - 1) {
       targetOrder = (reference.drawOrder + allSorted[refIdx + 1].drawOrder) / 2;
    }
    
    // To preserve relative order of movers, we can space them out
    const newOrders = movers.map((_, i) => targetOrder + i * 0.0001);
    this.reorder(movers, newOrders);
  }

  sendUnder(movers: Entity[], reference: Entity, file: DxfFile): void {
    if (!movers.length) return;
    const allSorted = [...file.entities].sort((a, b) => a.drawOrder - b.drawOrder);
    const refIdx = allSorted.findIndex(e => e.id === reference.id);
    if (refIdx === -1) return;
    
    // Find a slot just under reference
    let targetOrder = reference.drawOrder - 1;
    if (refIdx > 0) {
       targetOrder = (reference.drawOrder + allSorted[refIdx - 1].drawOrder) / 2;
    }
    
    const newOrders = movers.map((_, i) => targetOrder + i * 0.0001);
    this.reorder(movers, newOrders);
  }

  private reorder(entities: Entity[], newOrders: number[]): void {
    const before = entities.map(e => ({ id: e.id, drawOrder: e.drawOrder }));
    const after = entities.map((e, i) => ({ id: e.id, drawOrder: newOrders[i] }));
    
    const cmd = new ReorderEntitiesCmd(entities, before, after, {
      markDirty: () => this.vm.markContentDirty()
    });
    this.cmdStack.push(cmd);
  }
}
