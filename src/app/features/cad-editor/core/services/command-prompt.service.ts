import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { translateOr } from '../../../../core/i18n/translate-or';
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
  // Optional for the same reason as in ToolCatalogService: embedded hosts and
  // specs may have no Transloco provider, and English is the right fallback.
  private transloco = inject(TranslocoService, { optional: true });

  readonly state = signal<ICommandPromptState | null>(null);
  readonly activeOptions = computed(() => this.state()?.options ?? []);

  /** Cache the last resolved key so we only update the signal when something changes. */
  private lastSyncKey = '';

  /** The (commandId, phaseId) last synced, so a language change can re-resolve it. */
  private lastSynced: { commandId: string; phaseId: string | null } | null = null;

  constructor() {
    // `sync()` is called every frame but returns early unless the
    // (command, phase) pair changed — which means a language switch mid-command
    // would leave the old language's prompt on screen until the user advanced a
    // phase. Drop the cache and re-resolve the current phase instead.
    effect(() => {
      this.transloco?.getActiveLang();
      const last = this.lastSynced;
      if (!last) return;
      this.lastSyncKey = '';
      this.sync(last.commandId, last.phaseId);
    });
  }

  /**
   * Called each frame by the canvas render loop.
   * Resolves commandId + phaseId → prompt state and updates the signal only
   * when the key actually changes, keeping Angular change-detection pressure minimal.
   */
  sync(commandId: string, phaseId: string | null): void {
    const key = `${commandId}:${phaseId ?? ''}`;
    if (key === this.lastSyncKey) return;
    this.lastSyncKey = key;
    this.lastSynced = { commandId, phaseId };

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

    // `def.command` is NOT translated: it is the command name the user types
    // (LINE, FILLET) and is echoed back in the command line, so it has to match
    // what the parser accepts. Option `key` letters are left alone for the same
    // reason — only `label` and `hint` are prose. See docs/TRANSLATING.md.
    const base = phase ? `editor.cmd.${commandId}.${phase.id}` : '';
    this.state.set({
      command: def.command,
      message: phase ? translateOr(this.transloco, `${base}.message`, phase.message) : '',
      options: (phase?.options ?? []).map((opt) => ({
        ...opt,
        label: translateOr(this.transloco, `${base}.opt.${opt.key}.label`, opt.label),
        hint: opt.hint ? translateOr(this.transloco, `${base}.opt.${opt.key}.hint`, opt.hint) : opt.hint,
      })),
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
   * The labels matched here come from `activeOptions()`, which now holds
   * TRANSLATED text — so a French user can type "Rayon". The single-letter
   * `key` is untranslated and always works, which is the path muscle memory
   * and AutoCAD tutorials both rely on.
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
