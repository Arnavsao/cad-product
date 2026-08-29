import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CommandRegistryService {
  private actions = new Map<string, () => void>();

  /**
   * Register a system action.
   * @param id The command id, matching the id in ToolCatalogService.
   * @param action The callback to execute.
   */
  registerAction(id: string, action: () => void): void {
    this.actions.set(id, action);
  }

  /**
   * Execute an action by id.
   * @returns true if the action was executed, false if not found.
   */
  execute(id: string): boolean {
    const action = this.actions.get(id);
    if (action) {
      action();
      return true;
    }
    return false;
  }
}
