import { Injectable, signal } from '@angular/core';

/**
 * One catalog entry per insertable standard symbol. Keep visual + textual
 * metadata next to the engine name so the picker can render previews
 * without re-tessellating the block contents.
 *
 *   - `name`     : the internal block name registered by `SymbolService`.
 *                  This is what gets fed to `InsertBlockTool.requestedBlockName`.
 *   - `label`    : human-facing title shown in the picker.
 *   - `desc`     : one-line subtitle describing where the symbol is used.
 *   - `svg`      : raw SVG markup rendered in the preview tile. Uses
 *                  `currentColor` so it picks up the picker's text color.
 */
export interface ISymbolEntry {
  name: string;
  label: string;
  desc: string;
  svg: string;
}

export const SYMBOL_CATALOG: ISymbolEntry[] = [
  {
    name: 'Centerline',
    label: 'Centerline',
    desc: 'Cross + circle. Marks axes of symmetry.',
    svg: `<svg viewBox="-15 -15 30 30" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <line x1="0" y1="-12" x2="0" y2="12"/>
            <line x1="-12" y1="0" x2="12" y2="0"/>
            <circle cx="0" cy="0" r="5"/>
          </svg>`,
  },
  {
    name: 'Datum',
    label: 'Datum',
    desc: 'Lettered circle for GD&T datum references.',
    svg: `<svg viewBox="-7 -7 14 14" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.4">
            <circle cx="0" cy="0" r="5"/>
            <text x="0" y="1.8" text-anchor="middle" font-size="5.5"
                  font-family="Arial, sans-serif" font-weight="600"
                  stroke="none" fill="currentColor">A</text>
          </svg>`,
  },
  {
    name: 'NorthArrow',
    label: 'North Arrow',
    desc: 'Orientation marker for plans and maps.',
    svg: `<svg viewBox="-7 -16 14 28" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
            <path d="M 0,-12 L -4,8 L 0,5 L 4,8 Z"/>
            <text x="0" y="-13" text-anchor="middle" font-size="4"
                  font-family="Arial, sans-serif" font-weight="700"
                  stroke="none" fill="currentColor">N</text>
          </svg>`,
  },
  {
    name: 'SectionMarker',
    label: 'Section Marker',
    desc: 'Cut-line ID + section number. Used on plans.',
    svg: `<svg viewBox="-7 -7 14 14" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.3">
            <circle cx="0" cy="0" r="5.5"/>
            <line x1="-5.5" y1="0" x2="5.5" y2="0" stroke-width="1"/>
            <text x="0" y="-1.8" text-anchor="middle" font-size="3.5"
                  font-family="Arial, sans-serif" font-weight="700"
                  stroke="none" fill="currentColor">A</text>
            <text x="0" y="4.3" text-anchor="middle" font-size="3.5"
                  font-family="Arial, sans-serif" font-weight="700"
                  stroke="none" fill="currentColor">1</text>
          </svg>`,
  },
];

/**
 * Modal-style picker for the symbol-insert flow. Replaces the previous
 * `window.prompt()` text-only chooser with a visual dropdown of preview
 * tiles. Returns the chosen entry's `name` (the block name) via a Promise
 * so `SymbolTool.activate()` can stay procedural.
 *
 * Cancel (Esc / backdrop click / × button) resolves with `null`.
 */
@Injectable({ providedIn: 'root' })
export class SymbolPickerService {
  readonly isOpen = signal(false);

  /**
   * Read-only catalog accessor. The picker overlay binds to this so adding
   * a new symbol = one entry in SYMBOL_CATALOG; no overlay/template edits.
   */
  readonly catalog = SYMBOL_CATALOG;

  private resolveCallback: ((name: string | null) => void) | null = null;

  /** Open the picker and resolve with the chosen block name (or `null`). */
  open(): Promise<string | null> {
    // If a previous picker is still open, close it cleanly first so we
    // never leak more than one pending resolver.
    this.cancel();
    this.isOpen.set(true);
    return new Promise((resolve) => {
      this.resolveCallback = resolve;
    });
  }

  /** Commit the user's choice. Closes the picker. */
  select(name: string): void {
    const cb = this.resolveCallback;
    this.resolveCallback = null;
    this.isOpen.set(false);
    cb?.(name);
  }

  /** Dismiss without selecting. Resolves the promise with `null`. */
  cancel(): void {
    const cb = this.resolveCallback;
    this.resolveCallback = null;
    this.isOpen.set(false);
    cb?.(null);
  }
}
