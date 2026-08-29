import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StartupProfilerService {
  private timings = new Map<string, number>();
  private results = new Map<string, number>();

  markStart(taskName: string): void {
    this.timings.set(taskName, performance.now());
  }

  markEnd(taskName: string): void {
    const start = this.timings.get(taskName);
    if (start !== undefined) {
      const elapsed = performance.now() - start;
      this.results.set(taskName, elapsed);
    }
  }

  printReport(): void {
  }
}
