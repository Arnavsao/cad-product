import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { AdminFlagDto } from '../../../core/api/admin.models';
import { MeService } from '../../../core/api/me.service';
import { FlagsService } from '../../../core/flags/flags.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RelativeTimePipe, UiBadgeComponent, UiButtonDirective, UiSkeletonComponent } from '../../../shared/ui';

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
  imports: [UiButtonDirective, UiBadgeComponent, UiSkeletonComponent, RelativeTimePipe],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">Feature flags</h1>
        <p class="adm-lede">Switches that take effect across the site within a minute. Nothing here needs a deploy.</p>
      </div>
      @if (!canWrite()) {
        <span class="adm-muted">Changing a flag needs the admin tier.</span>
      }
    </div>

    @if (loading()) {
      <ui-skeleton height="52px" [lines]="6" />
    } @else {
      @for (group of groups(); track group.name) {
        <section class="adm-table adm-card--flush">
          <div class="adm-card__bar"><p class="adm-kicker">{{ group.name }}</p></div>
          @for (flag of group.flags; track flag.key) {
            <div class="adm-list__row fl__row">
              <div class="fl__meta">
                <span class="adm-row">
                  <span class="adm-mono adm-cell--strong">{{ flag.key }}</span>
                  @if (flag.overridden) { <ui-badge tone="info">overridden</ui-badge> }
                </span>
                <span class="adm-muted">{{ flag.description }}</span>
                @if (flag.updatedByEmail) {
                  <span class="fl__by">Last changed by {{ flag.updatedByEmail }} · {{ flag.updatedAt | relativeTime }}</span>
                }
              </div>
              <div class="adm-actions">
                <ui-badge [tone]="flag.enabled ? 'success' : 'neutral'">{{ flag.enabled ? 'on' : 'off' }}</ui-badge>
                @if (canWrite()) {
                  <button uiButton variant="secondary" size="sm" [disabled]="busy()" (click)="toggle(flag)">Turn {{ flag.enabled ? 'off' : 'on' }}</button>
                  @if (flag.overridden) {
                    <button uiButton variant="ghost" size="sm" [disabled]="busy()" (click)="reset(flag)">Reset</button>
                  }
                }
              </div>
            </div>
          }
        </section>
      }
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .fl__row { justify-content: space-between; align-items: center; }
      .fl__meta { display: grid; gap: 2px; flex: 1 1 320px; min-width: 240px; }
      .fl__by { font-size: var(--ui-text-xs); color: var(--ui-text-dim); }
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
