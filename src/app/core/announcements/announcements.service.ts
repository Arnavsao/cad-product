import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PublicAnnouncementDto } from '../api/admin.models';
import { HttpManagerService } from '../services/http-manager.service';

/** Dismissals live per browser; there is no server-side "seen" to keep. */
const DISMISSED_KEY = 'cad.announcements.dismissed';

/**
 * Product announcements for signed-in users.
 *
 * Loaded once and never polled: a banner that appears mid-session is a
 * distraction, and the next navigation picks up anything new anyway. A failed
 * request is silent — an announcement is the least important thing on the page,
 * and an error toast about one would be worse than not seeing it.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly api = inject(HttpManagerService);
  private readonly all = signal<PublicAnnouncementDto[]>([]);
  private readonly dismissed = signal<string[]>(readDismissed());

  /** Active announcements the reader has not dismissed. */
  readonly visible = signal<PublicAnnouncementDto[]>([]);

  async load(): Promise<void> {
    try {
      const items = await firstValueFrom(this.api.get<PublicAnnouncementDto[]>('announcements/active'));
      this.all.set(items);
      this.recompute();
    } catch {
      /* Silent: see the class note. */
    }
  }

  dismiss(id: string): void {
    const next = [...new Set([...this.dismissed(), id])].slice(-50);
    this.dismissed.set(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      /* Private window or blocked storage: dismissal lasts this session only. */
    }
    this.recompute();
  }

  private recompute(): void {
    const hidden = new Set(this.dismissed());
    this.visible.set(this.all().filter((a) => !hidden.has(a.id)));
  }
}

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
