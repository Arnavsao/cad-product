import { Injectable, signal } from '@angular/core';
import type { LayoutReport } from '../tools/views-intelligent-layout.tools';

/**
 * Holds the most-recent `layout.validate` report as a reactive signal.
 * The validate tool writes here during execute(); the orchestrator reads it
 * and emits a `report` event so the panel can render a structured card.
 */
@Injectable({ providedIn: 'root' })
export class AiLayoutReportService {
  readonly current = signal<LayoutReport | null>(null);

  set(report: LayoutReport): void {
    this.current.set(report);
  }

  clear(): void {
    this.current.set(null);
  }
}
