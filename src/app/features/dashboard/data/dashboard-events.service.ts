import { Injectable, signal } from '@angular/core';

/**
 * One-line bus between the dashboard shell and whichever page is in the outlet.
 *
 * Design decision: the shell owns three actions that mutate what a page is
 * showing — New drawing, New folder and Upload — but it cannot reach into the
 * routed child's store. Rather than lifting every store into the shell (Recent,
 * Drawings and Trash load completely different things), the shell bumps a
 * revision counter and each page decides for itself whether to refetch. One
 * signal, no subscriptions to clean up, and pages stay independent.
 *
 * Root-provided: the file is only imported by the lazily-loaded dashboard, so
 * it lands in the dashboard chunk regardless.
 */
@Injectable({ providedIn: 'root' })
export class DashboardEventsService {
  /** Incremented whenever drawings or folders may have changed on the server. */
  readonly revision = signal(0);

  /** Ask every mounted dashboard page to reload. */
  bump(): void {
    this.revision.update((n) => n + 1);
  }
}
