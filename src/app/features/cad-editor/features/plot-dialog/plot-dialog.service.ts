import { Injectable, signal, computed } from '@angular/core';
import { IPlotOptions, defaultPlotOptions } from '../../core/models/plot-options.model';
import { PageSetup } from '../../core/models/plot-registry.model';

export type PlotDialogTab = 'plotter' | 'area' | 'style' | 'advanced' | 'setups';

/**
 * Owns the open/closed state of the Plot dialog, the in-progress options
 * payload, active tab, and named page setups.
 *
 * Page setups are persisted to localStorage so they survive page refresh.
 */
@Injectable({ providedIn: 'root' })
export class PlotDialogService {
  readonly isOpen   = signal(false);
  readonly options  = signal<IPlotOptions>(defaultPlotOptions());
  readonly activeTab = signal<PlotDialogTab>('plotter');

  /** Named page setups — persisted to localStorage. */
  readonly pageSetups = signal<PageSetup[]>(this._loadSetups());

  /** Derived: display name of selected plotter. */
  readonly plotterLabel = computed(() => {
    const key = this.options().plotterKey;
    try {
      // Avoid import cycle — resolve lazily from window registry if available.
      const reg = (window as any).__plotRegistry as any[] | undefined;
      return reg?.find((p: any) => p.key === key)?.name ?? key;
    } catch { return key; }
  });

  open(initial?: Partial<IPlotOptions>): void {
    this.options.set({ ...defaultPlotOptions(), ...initial });
    this.activeTab.set('plotter');
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  patch(partial: Partial<IPlotOptions>): void {
    this.options.update(o => ({ ...o, ...partial }));
  }

  setTab(tab: PlotDialogTab): void {
    this.activeTab.set(tab);
  }

  // ── Page Setup Management ─────────────────────────────────────────────────

  savePageSetup(name: string): void {
    const o = this.options();
    const setup: PageSetup = {
      name,
      savedAt: new Date().toISOString(),
      snapshot: {
        plotterKey:      o.plotterKey,
        paperKey:        o.paper,
        orientation:     o.orientation,
        scale:           o.scale as number | 'fit',
        margin:          o.margin,
        plotStyleKey:    o.plotStyleKey,
        dpi:             o.dpi,
        background:      o.background,
        centerDrawing:   o.plotOffset?.center ?? o.centerDrawing,
        plotLineweights: o.plotLineweights,
        plotTransparency: o.plotTransparency,
      },
    };
    this.pageSetups.update(list => {
      const idx = list.findIndex(s => s.name === name);
      if (idx >= 0) {
        const next = [...list];
        next[idx] = setup;
        return next;
      }
      return [...list, setup];
    });
    this._persistSetups();
  }

  loadPageSetup(name: string): void {
    const setup = this.pageSetups().find(s => s.name === name);
    if (!setup) return;
    const sn = setup.snapshot;
    this.options.update(o => ({
      ...o,
      plotterKey:      sn.plotterKey,
      paper:           sn.paperKey,
      orientation:     sn.orientation as any,
      scale:           sn.scale,
      margin:          sn.margin,
      plotStyleKey:    sn.plotStyleKey,
      plotStyle:       sn.plotStyleKey.includes('mono') ? 'monochrome'
                       : sn.plotStyleKey.includes('gray') ? 'grayscale' : 'color',
      dpi:             sn.dpi,
      background:      sn.background as any,
      centerDrawing:   sn.centerDrawing,
      plotOffset:      { ...o.plotOffset, center: sn.centerDrawing },
      plotLineweights: sn.plotLineweights,
      plotTransparency: sn.plotTransparency,
    }));
  }

  deletePageSetup(name: string): void {
    this.pageSetups.update(list => list.filter(s => s.name !== name));
    this._persistSetups();
  }

  private _loadSetups(): PageSetup[] {
    try {
      const raw = localStorage.getItem('aagento_plot_setups');
      if (raw) return JSON.parse(raw) as PageSetup[];
    } catch { /* ignore */ }
    return [];
  }

  private _persistSetups(): void {
    try {
      localStorage.setItem('aagento_plot_setups', JSON.stringify(this.pageSetups()));
    } catch { /* ignore quota errors */ }
  }
}
