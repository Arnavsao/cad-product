import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminFlagDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { FlagsService } from '../../../core/flags/flags.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiBadgeComponent, UiButtonDirective, UiSkeletonComponent } from '../../../shared/ui';

/**
 * The switches, grouped the way the registry groups them.
 *
 * Each row says what the flag does in plain words, because the person flipping
 * it at 2am should not have to read the source to find out. A flag that has
 * been overridden is marked, so "why is this off" has an answer that does not
 * involve a deploy log.
 */
@Component({
  selector: 'app-admin-flags',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButtonDirective, UiBadgeComponent, UiSkeletonComponent],
  template: `
    <div class="flags">
      <p class="flags__lede">
        Changes take effect across the site within a minute. Nothing here needs a deploy.
      </p>

      @if (loading()) {
        <ui-skeleton height="52px" [lines]="6" />
      } @else {
        @for (group of groups(); track group.name) {
          <section class="flags__group">
            <h2 class="flags__heading">{{ group.name }}</h2>
            @for (flag of group.flags; track flag.key) {
              <div class="flags__row">
                <div class="flags__meta">
                  <span class="flags__key">
                    {{ flag.key }}
                    @if (flag.overridden) {
                      <ui-badge tone="info">overridden</ui-badge>
                    }
                  </span>
                  <span class="flags__desc">{{ flag.description }}</span>
                  @if (flag.updatedByEmail) {
                    <span class="flags__by">Last changed by {{ flag.updatedByEmail }}</span>
                  }
                </div>
                <div class="flags__controls">
                  <ui-badge [tone]="flag.enabled ? 'success' : 'neutral'">{{ flag.enabled ? 'on' : 'off' }}</ui-badge>
                  @if (canWrite()) {
                    <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="toggle(flag)">
                      Turn {{ flag.enabled ? 'off' : 'on' }}
                    </button>
                    @if (flag.overridden) {
                      <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="reset(flag)">Reset</button>
                    }
                  }
                </div>
              </div>
            }
          </section>
        }
        @if (!canWrite()) {
          <p class="flags__lede">Changing a flag needs the admin tier.</p>
        }
      }
    </div>
  `,
  styles: [
    `
      .flags {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-5);
        max-width: 900px;
      }
      .flags__lede {
        margin: 0;
        color: var(--ui-text-dim);
        font-size: var(--ui-text-sm);
      }
      .flags__group {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        overflow: hidden;
        background: var(--ui-surface);
      }
      .flags__heading {
        margin: 0;
        padding: 8px var(--ui-space-4);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
        background: var(--ui-surface-2);
        border-bottom: 1px solid var(--ui-border);
      }
      .flags__row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--ui-space-3);
        padding: var(--ui-space-3) var(--ui-space-4);
        border-bottom: 1px solid var(--ui-border);
      }
      .flags__row:last-child {
        border-bottom: 0;
      }
      .flags__meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 240px;
        flex: 1 1 320px;
      }
      .flags__key {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        font-family: var(--ui-font-mono, ui-monospace, monospace);
        font-size: var(--ui-text-sm);
        font-weight: 600;
      }
      .flags__desc {
        font-size: var(--ui-text-sm);
        color: var(--ui-text-dim);
      }
      .flags__by {
        font-size: 11px;
        color: var(--ui-text-dim);
      }
      .flags__controls {
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
      }
    `,
  ],
})
export class AdminFlagsPage {
  private readonly api = inject(AdminApiService);
  private readonly notify = inject(NotificationService);
  private readonly flagsService = inject(FlagsService);
  private readonly me = inject(MeService);

  protected readonly flags = signal<AdminFlagDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);

  /** Writing needs ADMIN; SUPPORT sees the state but no buttons. */
  protected readonly canWrite = computed(() => {
    const role = this.me.me()?.user.platformRole;
    return role === 'admin' || role === 'owner';
  });

  protected readonly groups = computed(() => {
    const byGroup = new Map<string, AdminFlagDto[]>();
    for (const flag of this.flags()) {
      const list = byGroup.get(flag.group) ?? [];
      list.push(flag);
      byGroup.set(flag.group, list);
    }
    return [...byGroup.entries()].map(([name, flags]) => ({ name, flags }));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.flags.set(await this.api.listFlags());
    } catch (error) {
      this.notify.error((error as { message?: string })?.message ?? 'Could not load the flags.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async toggle(flag: AdminFlagDto): Promise<void> {
    await this.write(() => this.api.setFlag(flag.key, !flag.enabled), `${flag.key} is now ${flag.enabled ? 'off' : 'on'}`);
  }

  protected async reset(flag: AdminFlagDto): Promise<void> {
    await this.write(() => this.api.resetFlag(flag.key), `${flag.key} is back to its default`);
  }

  private async write(action: () => Promise<AdminFlagDto>, success: string): Promise<void> {
    this.busy.set(true);
    try {
      const updated = await action();
      this.flags.update((list) => list.map((f) => (f.key === updated.key ? updated : f)));
      // The portal itself reads flags, so refresh the app-wide copy too rather
      // than waiting out the client cache.
      await this.flagsService.refresh();
      this.notify.success(success);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      this.notify.error(code === 'FORBIDDEN' ? 'Your staff tier cannot change flags.' : 'Could not change that flag.');
    } finally {
      this.busy.set(false);
    }
  }
}
