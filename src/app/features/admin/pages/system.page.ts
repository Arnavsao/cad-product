import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../../../core/api/admin-api.service';
import { SystemInfoDto } from '../../../core/api/admin.models';
import { FileSizePipe, UiBadgeComponent, UiButtonDirective, UiIconComponent, UiSkeletonComponent } from '../../../shared/ui';

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
  imports: [RouterLink, UiBadgeComponent, UiButtonDirective, UiIconComponent, UiSkeletonComponent, FileSizePipe],
  template: `
    <div class="adm-head">
      <div>
        <h1 class="adm-title">System</h1>
        <p class="adm-lede">What this deployment is actually configured to do. Modes and reachability only — never a secret.</p>
      </div>
      <div class="adm-actions">
        <a uiButton variant="secondary" size="sm" routerLink="/admin/jobs"><ui-icon name="clock" [size]="16" /> Scheduled jobs</a>
      </div>
    </div>

    @if (loading()) {
      <div class="adm-grid-halves">
        @for (i of [1, 2, 3]; track i) { <ui-skeleton height="160px" radius="var(--ui-radius-lg)" /> }
      </div>
    } @else if (info(); as s) {
      <div class="adm-grid-halves">
        <section class="adm-card">
          <p class="adm-kicker">Build</p>
          <dl class="adm-facts">
            <div><dt>Version</dt><dd class="adm-mono">{{ s.version }}</dd></div>
            <div><dt>Environment</dt><dd>{{ s.environment }}</dd></div>
            <div><dt>Node</dt><dd class="adm-mono">{{ s.nodeVersion }}</dd></div>
            <div><dt>Uptime</dt><dd>{{ uptime(s.uptimeSeconds) }}</dd></div>
          </dl>
        </section>

        <section class="adm-card">
          <p class="adm-kicker">Services</p>
          <dl class="adm-facts">
            <div>
              <dt>Database</dt>
              <dd>
                <ui-badge [tone]="s.database.reachable ? 'success' : 'danger'">{{ s.database.reachable ? 'reachable' : 'unreachable' }}</ui-badge>
                <span class="adm-muted">{{ s.database.latencyMs }} ms · keepalive {{ s.database.keepaliveSeconds }}s</span>
              </dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>
                <ui-badge [tone]="s.storage.reachable ? 'success' : 'danger'">{{ s.storage.reachable ? 'reachable' : 'unreachable' }}</ui-badge>
                <span class="adm-muted adm-mono">{{ s.storage.bucket }}</span>
              </dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd><ui-badge [tone]="s.auth.configured ? 'success' : 'warning'">{{ s.auth.mode }}</ui-badge></dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                <ui-badge [tone]="s.mail.transport === 'resend' ? 'success' : 'warning'">{{ s.mail.transport === 'resend' ? 'sending' : 'logging only' }}</ui-badge>
                <span class="adm-muted">{{ s.mail.from ?? 'no from address' }}</span>
              </dd>
            </div>
            <div>
              <dt>Billing</dt>
              <dd>
                <ui-badge [tone]="billingTone(s)">{{ s.billing.mode }}</ui-badge>
                @if (s.billing.configured && !s.billing.webhookConfigured) {
                  <span class="adm-warn-text adm-muted">webhook key missing</span>
                }
              </dd>
            </div>
          </dl>
        </section>

        <section class="adm-card">
          <p class="adm-kicker">Limits</p>
          <dl class="adm-facts">
            <div><dt>Rate limit</dt><dd>{{ s.limits.rateLimit }} / min</dd></div>
            <div><dt>Admin rate limit</dt><dd>{{ s.limits.adminRateLimit }} / min</dd></div>
            <div><dt>Max upload</dt><dd>{{ s.limits.maxUploadBytes | fileSize }}</dd></div>
            <div><dt>Max inline save</dt><dd>{{ s.limits.maxInlineContentBytes | fileSize }}</dd></div>
            <div><dt>Versions kept</dt><dd>{{ s.limits.maxVersionsPerDrawing }}</dd></div>
          </dl>
        </section>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
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
