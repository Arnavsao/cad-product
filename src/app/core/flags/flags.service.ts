import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FlagDto } from '../api/admin.models';
import { HttpManagerService } from '../services/http-manager.service';

/**
 * The server's feature switches, read once per page load.
 *
 * Deliberately fail-open: when the request fails the map stays empty and
 * `enabled()` returns the caller's fallback, which is the shipped behaviour. A
 * flags endpoint that is briefly unreachable must not black out the editor's
 * panels — the switches exist to turn things OFF deliberately, never by
 * accident.
 */
@Injectable({ providedIn: 'root' })
export class FlagsService {
  private readonly api = inject(HttpManagerService);
  private readonly map = signal<Record<string, FlagDto>>({});
  private inflight: Promise<void> | null = null;

  /** True once a response (successful or not) has settled. */
  readonly loaded = signal(false);

  /**
   * Loads the flags once. Safe to call from several places — the second caller
   * awaits the first request rather than issuing another.
   */
  load(): Promise<void> {
    this.inflight ??= this.fetch();
    return this.inflight;
  }

  private async fetch(): Promise<void> {
    try {
      const flags = await firstValueFrom(this.api.get<FlagDto[]>('flags'));
      const next: Record<string, FlagDto> = {};
      for (const flag of flags) next[flag.key] = flag;
      this.map.set(next);
    } catch {
      /* Fail open: callers fall back to the shipped default. */
    } finally {
      this.loaded.set(true);
    }
  }

  /** Whether `key` is on. `fallback` is what the product does with no server answer. */
  enabled(key: string, fallback = true): boolean {
    return this.map()[key]?.enabled ?? fallback;
  }

  /** Structured value of a flag, or null. */
  payload<T = Record<string, unknown>>(key: string): T | null {
    return (this.map()[key]?.payload as T) ?? null;
  }

  /** Re-reads after a staff member changes something in the portal. */
  async refresh(): Promise<void> {
    this.inflight = this.fetch();
    await this.inflight;
  }
}
