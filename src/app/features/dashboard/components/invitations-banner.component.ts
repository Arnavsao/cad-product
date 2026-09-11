import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { OrgInvitationDto } from '../../../core/api/api.models';
import { OrganizationsApiService } from '../../../core/api/organizations-api.service';
import { WorkspaceService } from '../../../core/api/workspace.service';
import { NotificationService } from '../../../core/services/notification.service';
import { UiButtonDirective } from '../../../shared/ui/button.directive';
import { UiIconComponent } from '../../../shared/ui/icon.component';
import { DashboardEventsService } from '../data/dashboard-events.service';

/**
 * "**Priya Haldar** invited you to **Acme Design Studio** as admin · Accept ·
 * Decline", above the dashboard outlet.
 *
 * Design decisions:
 *
 * - **This banner *is* the delivery mechanism.** There is no email sender in
 *   the product, so an invite that is not shown in-app can only be redeemed by
 *   the inviter copying a link out of band. Anyone signed in with the invited
 *   address sees it on their next dashboard visit.
 *
 * - **It fails silently.** An API that cannot answer `GET
 *   /organizations/invitations` (including one that predates the route) must
 *   not put an error banner above every dashboard page; the component simply
 *   renders nothing.
 *
 * - **Accepting adopts the workspace and switches to it.** Someone who just
 *   said yes to an invitation wants to be *in* that organization, and
 *   `WorkspaceService.adopt` is the one call that updates the switcher, the
 *   cached `/me` and the active workspace together.
 */
@Component({
  selector: 'app-invitations-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiButtonDirective, UiIconComponent],
  template: `
    <ng-container *transloco="let t">
    @for (invite of invitations(); track invite.id) {
      <div class="iv" role="status">
        <ui-icon class="iv__icon" name="user-plus" [size]="16" />
        <p class="iv__text">
          {{
            t('dashboard.components.invitations.text', {
              inviter: inviterOf(invite, t),
              org: invite.organizationName,
              role: t('dashboard.components.role.' + invite.role)
            })
          }}
        </p>
        <button
          type="button"
          uiButton
          variant="primary"
          size="sm"
          [disabled]="busy() === invite.id"
          (click)="accept(invite)"
        >
          {{ t('dashboard.components.invitations.accept') }}
        </button>
        <button
          type="button"
          uiButton
          variant="ghost"
          size="sm"
          [disabled]="busy() === invite.id"
          (click)="decline(invite)"
        >
          {{ t('dashboard.components.invitations.decline') }}
        </button>
      </div>
    }
    </ng-container>
  `,
  styles: [
    `
      :host { display: block; }
      .iv {
        display: flex; align-items: center; gap: var(--ui-space-3); flex-wrap: wrap;
        margin-bottom: var(--ui-space-4);
        padding: 10px 14px;
        border: 1px solid var(--ui-accent); border-radius: var(--ui-radius-lg);
        background: var(--ui-accent-tint);
      }
      .iv__icon { color: var(--ui-accent); flex: 0 0 auto; }
      .iv__text { flex: 1; min-width: 200px; margin: 0; font-size: var(--ui-text-md); color: var(--ui-text); }
      .iv__text strong { color: var(--ui-text-strong); font-weight: 600; }
    `,
  ],
})
export class InvitationsBannerComponent {
  private readonly api = inject(OrganizationsApiService);
  private readonly workspace = inject(WorkspaceService);
  private readonly notify = inject(NotificationService);
  private readonly events = inject(DashboardEventsService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly invitations = signal<OrgInvitationDto[]>([]);
  protected readonly busy = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected inviterOf(invite: OrgInvitationDto, t: (key: string) => string): string {
    const by = invite.invitedBy;
    if (!by) return t('dashboard.components.invitations.someone');
    const full = [by.firstName, by.lastName].filter(Boolean).join(' ').trim();
    return full || by.email;
  }

  protected async accept(invite: OrgInvitationDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(invite.id);
    try {
      const org = await this.api.acceptInvitation(invite.id);
      this.drop(invite.id);
      this.workspace.adopt(org);
      this.notify.success(this.transloco.translate('dashboard.components.organization.joined', { name: org.name }));
      await this.router.navigateByUrl('/dashboard/drawings');
      this.events.bump();
    } catch (e) {
      this.notify.error(
        e instanceof Error && e.message
          ? e.message
          : this.transloco.translate('dashboard.components.invitations.acceptFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async decline(invite: OrgInvitationDto): Promise<void> {
    if (this.busy()) return;
    this.busy.set(invite.id);
    try {
      await this.api.declineInvitation(invite.id);
      this.drop(invite.id);
    } catch (e) {
      this.notify.error(
        e instanceof Error && e.message
          ? e.message
          : this.transloco.translate('dashboard.components.invitations.declineFailed'),
      );
    } finally {
      this.busy.set(null);
    }
  }

  private drop(id: string): void {
    this.invitations.update((list) => list.filter((i) => i.id !== id));
  }

  private async load(): Promise<void> {
    try {
      this.invitations.set(await this.api.invitations());
    } catch {
      /* No invitations route, no network, not signed in — render nothing. */
    }
  }
}
