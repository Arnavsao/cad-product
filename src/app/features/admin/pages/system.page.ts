import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { SystemInfoDto } from '../../../core/api/admin.models';
import { FileSizePipe, UiBadgeComponent, UiSkeletonComponent } from '../../../shared/ui';

/**
 * What this deployment is actually configured to do.
 *
 * The first questions in any incident are whether mail is really sending,
 * whether billing is in test mode, and which build is running — answers that
 * otherwise live in three dashboards and an env file. Modes and reachability
 * only: the server never returns a key, and this page never asks for one.
 */
@Component({
  selector: 'app-admin-system',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadgeComponent, UiSkeletonComponent, FileSizePipe],
  template: `
    <div class="sys">
      @if (loading()) {
        <ui-skeleton height="60px" [lines]="5" />
      } @else if (info(); as s) {
        <section class="sys__card">
          <h2 class="sys__heading">Build</h2>
          <dl class="sys__facts">
            <div><dt>Version</dt><dd>{{ s.version }}</dd></div>
            <div><dt>Environment</dt><dd>{{ s.environment }}</dd></div>
            <div><dt>Node</dt><dd>{{ s.nodeVersion }}</dd></div>
            <div><dt>Uptime</dt><dd>{{ uptime(s.uptimeSeconds) }}</dd></div>
          </dl>
        </section>

        <section class="sys__card">
          <h2 class="sys__heading">Services</h2>
          <dl class="sys__facts">
            <div>
              <dt>Database</dt>
              <dd>
                <ui-badge [tone]="s.database.reachable ? 'success' : 'danger'">
                  {{ s.database.reachable ? 'reachable' : 'unreachable' }}
                </ui-badge>
                {{ s.database.latencyMs }} ms
              </dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>
                <ui-badge [tone]="s.storage.reachable ? 'success' : 'danger'">
                  {{ s.storage.reachable ? 'reachable' : 'unreachable' }}
                </ui-badge>
                {{ s.storage.bucket }}
              </dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd>
                <ui-badge [tone]="s.auth.configured ? 'success' : 'warning'">{{ s.auth.mode }}</ui-badge>
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                <ui-badge [tone]="s.mail.transport === 'resend' ? 'success' : 'warning'">
                  {{ s.mail.transport === 'resend' ? 'sending' : 'logging only' }}
                </ui-badge>
                {{ s.mail.from ?? 'no from address' }}
              </dd>
            </div>
            <div>
              <dt>Billing</dt>
              <dd>
                <ui-badge [tone]="billingTone(s)">{{ s.billing.mode }}</ui-badge>
                @if (s.billing.configured && !s.billing.webhookConfigured) {
                  <span class="sys__warn">webhook key missing — customers can pay without getting their plan</span>
                }
              </dd>
            </div>
          </dl>
        </section>

        <section class="sys__card">
          <h2 class="sys__heading">Limits</h2>
          <dl class="sys__facts">
            <div><dt>Rate limit</dt><dd>{{ s.limits.rateLimit }} / min</dd></div>
            <div><dt>Admin rate limit</dt><dd>{{ s.limits.adminRateLimit }} / min</dd></div>
            <div><dt>Max upload</dt><dd>{{ s.limits.maxUploadBytes | fileSize }}</dd></div>
            <div><dt>Max inline save</dt><dd>{{ s.limits.maxInlineContentBytes | fileSize }}</dd></div>
            <div><dt>Versions kept</dt><dd>{{ s.limits.maxVersionsPerDrawing }}</dd></div>
          </dl>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .sys {
        display: flex;
        flex-direction: column;
        gap: var(--ui-space-4);
        max-width: 900px;
      }
      .sys__card {
        border: 1px solid var(--ui-border);
        border-radius: var(--ui-radius-md);
        background: var(--ui-surface);
        overflow: hidden;
      }
      .sys__heading {
        margin: 0;
        padding: 8px var(--ui-space-4);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
        background: var(--ui-surface-2);
        border-bottom: 1px solid var(--ui-border);
      }
      .sys__facts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--ui-space-3);
        margin: 0;
        padding: var(--ui-space-4);
      }
      .sys__facts dt {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--ui-text-dim);
      }
      .sys__facts dd {
        margin: 4px 0 0;
        font-size: var(--ui-text-sm);
        display: flex;
        align-items: center;
        gap: var(--ui-space-2);
        flex-wrap: wrap;
      }
      .sys__warn {
        color: var(--ui-warning, #d29922);
        font-size: 12px;
      }
    `,
  ],
})
export class AdminSystemPage {
  private readonly api = inject(AdminApiService);

  protected readonly info = signal<SystemInfoDto | null>(null);
  protected readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.info.set(await this.api.system());
    } catch {
      /* The shell shows the 403; nothing useful to add here. */
    } finally {
      this.loading.set(false);
    }
  }

  protected uptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  }

  protected billingTone(s: SystemInfoDto): 'success' | 'warning' | 'neutral' {
    if (!s.billing.configured) return 'neutral';
    return s.billing.webhookConfigured ? 'success' : 'warning';
  }
}
