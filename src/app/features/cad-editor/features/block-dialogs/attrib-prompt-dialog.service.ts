import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { IAttDef, IAttrib } from '../../core/models/block-attribute.model';

export interface AttribPromptResult {
  attribs: IAttrib[];
}

@Injectable({ providedIn: 'root' })
export class AttribPromptDialogService {
  readonly isOpen = signal(false);
  readonly blockName = signal('');
  readonly attDefs = signal<IAttDef[]>([]);

  private resolve$ = new Subject<AttribPromptResult | null>();

  open(blockName: string, defs: IAttDef[], insertX: number, insertY: number): Promise<AttribPromptResult | null> {
    const promptable = defs.filter(d => !d.constant);
    if (!promptable.length) {
      const attribs: IAttrib[] = defs.map(d => ({
        tag: d.tag, value: d.defaultValue,
        x: d.x, y: d.y, height: d.height, rotation: d.rotation,
        invisible: d.invisible,
      }));
      return Promise.resolve({ attribs });
    }
    this.blockName.set(blockName);
    this.attDefs.set(defs);
    this.isOpen.set(true);
    return new Promise<AttribPromptResult | null>(resolve => {
      const sub = this.resolve$.subscribe(r => { sub.unsubscribe(); resolve(r); });
    });
  }

  commit(values: Map<string, string>): void {
    const defs = this.attDefs();
    const attribs: IAttrib[] = defs.map(d => ({
      tag: d.tag,
      value: d.constant ? d.defaultValue : (values.get(d.tag) ?? d.defaultValue),
      x: d.x, y: d.y, height: d.height, rotation: d.rotation,
      invisible: d.invisible,
    }));
    this.isOpen.set(false);
    this.resolve$.next({ attribs });
  }

  cancel(): void {
    this.isOpen.set(false);
    this.resolve$.next(null);
  }
}
