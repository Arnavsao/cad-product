import { Injectable, inject } from '@angular/core';
import { DocumentService } from './document.service';
import { IBlockDef } from '../models/layer.model';
import { LineEntity, CircleEntity } from '../models/entity.model';
import { TextEntity } from '../models/entity-extended.model';

export const ENG_SYMBOLS: Record<string, string[]> = {
  'Engineering': ['°', 'Ø', '±', 'R', '∠', '⌀', 'm²', 'm³'],
  'Arrows': ['→', '←', '↑', '↓'],
};

/** Block names the symbol picker can insert. Shared so the Blocks panel and
 *  InsertBlockTool classify them the same way this service creates them. */
export const STANDARD_SYMBOL_NAMES = ['Centerline', 'Datum', 'NorthArrow', 'SectionMarker'] as const;

export type StandardSymbolName = (typeof STANDARD_SYMBOL_NAMES)[number];

export function isStandardSymbol(name: string): name is StandardSymbolName {
  return (STANDARD_SYMBOL_NAMES as readonly string[]).includes(name);
}

@Injectable({ providedIn: 'root' })
export class SymbolService {
  private doc = inject(DocumentService);

  /**
   * Register the definition for ONE standard symbol, if the drawing lacks it.
   *
   * Deliberately per-symbol: registering the whole set up front (which is what
   * this service used to do when the picker opened) dumped four block
   * definitions into the drawing the moment the user glanced at the symbol
   * list, so the Blocks panel filled with symbols nobody had inserted. A block
   * definition should enter the drawing only when its symbol is actually used.
   */
  ensureStandardBlock(name: string): void {
    const file = this.doc.activeFile;
    if (!file || file.blocks.has(name)) return;
    switch (name) {
      case 'Centerline': file.blocks.set(name, this.createCenterlineBlock()); break;
      case 'Datum': file.blocks.set(name, this.createDatumBlock()); break;
      case 'NorthArrow': file.blocks.set(name, this.createNorthArrowBlock()); break;
      case 'SectionMarker': file.blocks.set(name, this.createSectionMarkerBlock()); break;
    }
  }

  private createCenterlineBlock(): IBlockDef {
    const l1 = new LineEntity(0, 10, 0, -10);
    const l2 = new LineEntity(-10, 0, 10, 0);
    const c = new CircleEntity(0, 0, 5);
    return {
      name: 'Centerline',
      basePoint: { x: 0, y: 0 },
      entities: [l1, l2, c],
      isAnonymous: false,
    };
  }

  private createDatumBlock(): IBlockDef {
    const c1 = new CircleEntity(0, 0, 4);
    const t = new TextEntity(0, 0, 'A', 3, 0);
    t.justify = 'MC';
    return {
      name: 'Datum',
      basePoint: { x: 0, y: -4 },
      entities: [c1, t],
      isAnonymous: false,
    };
  }

  private createNorthArrowBlock(): IBlockDef {
    const l1 = new LineEntity(0, 10, -3, -5);
    const l2 = new LineEntity(-3, -5, 0, -3);
    const l3 = new LineEntity(0, -3, 3, -5);
    const l4 = new LineEntity(3, -5, 0, 10);
    const n = new TextEntity(0, 12, 'N', 3, 0);
    n.justify = 'BC';
    return {
      name: 'NorthArrow',
      basePoint: { x: 0, y: 0 },
      entities: [l1, l2, l3, l4, n],
      isAnonymous: false,
    };
  }

  private createSectionMarkerBlock(): IBlockDef {
    const c = new CircleEntity(0, 0, 5);
    const t1 = new TextEntity(0, 1, 'A', 2.5, 0);
    t1.justify = 'BC';
    const l1 = new LineEntity(-5, 0, 5, 0);
    const t2 = new TextEntity(0, -1, '1', 2.5, 0);
    t2.justify = 'TC';
    return {
      name: 'SectionMarker',
      basePoint: { x: 0, y: 0 },
      entities: [c, t1, l1, t2],
      isAnonymous: false,
    };
  }
}
