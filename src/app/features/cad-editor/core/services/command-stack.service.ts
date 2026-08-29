import { Injectable, inject, Injector } from '@angular/core';
import { ICommand, CompoundCmd } from '../models/command.model';
import { ViewModelService } from './view-model.service';
import { DocumentManagerService } from './document-manager.service';

@Injectable({ providedIn: 'root' })
export class CommandStackService {
  private vm = inject(ViewModelService);
  private injector = inject(Injector);

  private get docManager(): DocumentManagerService {
    return this.injector.get(DocumentManagerService) as DocumentManagerService;
  }

  private get stack(): ICommand[] {
    return this.docManager.activeDocument?.cmdState.stack ?? [];
  }
  
  private set stack(v: ICommand[]) {
    if (this.docManager.activeDocument) {
      this.docManager.activeDocument.cmdState.stack = v;
    }
  }

  private get redoStack(): ICommand[] {
    return this.docManager.activeDocument?.cmdState.redoStack ?? [];
  }
  
  private set redoStack(v: ICommand[]) {
    if (this.docManager.activeDocument) {
      this.docManager.activeDocument.cmdState.redoStack = v;
    }
  }

  onAfterUndoRedo?: () => void;

  push(cmd: ICommand): void {
    cmd.execute();
    this.stack.push(cmd);
    this.redoStack = [];
    this.docManager.markActiveDirty();
  }

  record(cmd: ICommand): void {
    this.stack.push(cmd);
    this.redoStack = [];
    this.docManager.markActiveDirty();
  }

  appendToTop(cmd: ICommand): void {
    const s = this.stack;
    if (s.length === 0) {
      s.push(cmd);
      return;
    }
    const top = s[s.length - 1];
    s[s.length - 1] = new CompoundCmd([top, cmd]);
    this.docManager.markActiveDirty();
  }

  undo(): void {
    const s = this.stack;
    if (!s.length) return;
    const c = s.pop()!;
    c.undo();
    this.redoStack.push(c);
    this.docManager.markActiveDirty();
    this.vm.markContentDirty();
    this.onAfterUndoRedo?.();
  }

  redo(): void {
    const rs = this.redoStack;
    if (!rs.length) return;
    const c = rs.pop()!;
    c.execute();
    this.stack.push(c);
    this.docManager.markActiveDirty();
    this.vm.markContentDirty();
    this.onAfterUndoRedo?.();
  }

  canUndo(): boolean { return this.stack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  getDepth(): number { return this.stack.length; }

  truncateAbove(depth: number): void {
    this.stack.splice(depth);
    this.redoStack = [];
  }

  clear(): void {
    this.stack = [];
    this.redoStack = [];
  }
}
