import { Injectable, computed, inject, signal } from '@angular/core';
import type { ICommandPromptState } from '../models/command-prompt.model';
import { COMMAND_PROMPTS } from './command-prompts.registry';
import { ToolCatalogService } from './tool-catalog.service';
import { ToolManagerService } from './tool-manager.service';

/**
 * Owns the live command-prompt state shown in the Command Bar.
 *
 * The canvas render loop calls sync() each frame with the active tool name and
 * phase ID; this service resolves the correct message + options from the central
 * registry and pushes them to the `state` signal.  The Command Bar component
 * reads `state` reactively and renders the prompt + clickable option chips.
 *
 * Tools report only a lightweight phase ID via getPhase() — no message text
 * lives inside individual tool classes.
 */
@Injectable({ providedIn: 'root' })
export class CommandPromptService {
  private catalog = inject(ToolCatalogService);
  private toolMgr = inject(ToolManagerService);

  readonly state = signal<ICommandPromptState | null>(null);
  readonly activeOptions = computed(() => this.state()?.options ?? []);

  /** Cache the last resolved key so we only update the signal when something changes. */
  private lastSyncKey = '';

  /**
   * Called each frame by the canvas render loop.
   * Resolves commandId + phaseId → prompt state and updates the signal only
   * when the key actually changes, keeping Angular change-detection pressure minimal.
   */
  sync(commandId: string, phaseId: string | null): void {
    const key = `${commandId}:${phaseId ?? ''}`;
    if (key === this.lastSyncKey) return;
    this.lastSyncKey = key;

    // Idle — select / pan tool active.
    if (!commandId || commandId === 'select' || commandId === 'pan') {
      this.state.set(null);
      return;
    }

    const def = COMMAND_PROMPTS[commandId];
    if (!def) {
      // Unknown command: fall back to catalog title for the name.
      const meta = this.catalog.getById(commandId);
      const name = meta
        ? meta.title.replace(/\s*\([^)]*\)$/, '').toUpperCase()
        : commandId.toUpperCase();
      this.state.set({ command: name, message: '', options: [] });
      return;
    }

    // When tool is active but hasn't entered a phase yet, show the first phase.
    const phase = phaseId
      ? (def.phases.find((p: any) => p.id === phaseId) ?? def.phases[0])
      : def.phases[0];

    this.state.set({
      command: def.command,
      message: phase?.message ?? '',
      options: phase?.options ?? [],
    });
  }

  /**
   * Route an option input to the active tool's invokeOption handler.
   *
   * Accepts both the single-key shortcut ('D', '3') AND full label text
   * ('Diameter', '3P', 'ttr') so the user can type the full word in the
   * command bar and press Enter to invoke the option.
   *
   * Match priority: exact key > exact label > label prefix.
   *
   * Returns true when an option matched AND the tool consumed it.
   * Caller should preventDefault + stopImmediatePropagation on true.
   */
  invokeOptionByKey(input: string): boolean {
    const upper = input.trim().toUpperCase();
    if (!upper) return false;
    const option = this.activeOptions().find(o => {
      const k = o.key.toUpperCase();
      const l = o.label.toUpperCase().replace(/\s+/g, '');
      return k === upper || l === upper || l.startsWith(upper);
    });
    if (!option) return false;
    return this.toolMgr.activeTool?.invokeOption?.(option.key.toUpperCase()) ?? false;
  }

  /**
   * Force-reset the sync cache so the next sync() call always re-evaluates.
   * Call when the active tool is deactivated to ensure the idle state is set
   * immediately without waiting for a new (commandId, phaseId) pair.
   */
  reset(): void {
    this.lastSyncKey = '';
    this.state.set(null);
  }
}
