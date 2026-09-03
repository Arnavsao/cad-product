import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpManagerService } from '../services/http-manager.service';
import {
  AssignableOrgRole,
  OrgDetailDto,
  OrgInvitationDto,
  OrgInviteDto,
  OrgMemberDto,
  OrgRole,
  OrgSummaryDto,
} from './api.models';

const enc = encodeURIComponent;

/**
 * Promise-returning client for `/organizations`.
 *
 * Error codes worth branching on: 404 `ORG_NOT_FOUND` (also what a non-member
 * gets, so existence never leaks), 403 `ORG_FORBIDDEN` (role too junior),
 * 409 `ALREADY_MEMBER`, 409 `LAST_OWNER` (an org must keep one owner) and
 * 404 `INVITE_INVALID` (expired, spent, or addressed to someone else).
 */
@Injectable({ providedIn: 'root' })
export class OrganizationsApiService {
  private readonly api = inject(HttpManagerService);

  /** `GET /organizations` — the caller's workspaces. */
  list(): Promise<OrgSummaryDto[]> {
    return firstValueFrom(this.api.get<OrgSummaryDto[]>('organizations'));
  }

  /** `GET /organizations/:id` — includes `joinCode` for admins and owners. */
  get(id: string): Promise<OrgDetailDto> {
    return firstValueFrom(this.api.get<OrgDetailDto>(`organizations/${enc(id)}`));
  }

  /** `POST /organizations` — the caller becomes owner. */
  create(name: string): Promise<OrgSummaryDto> {
    return firstValueFrom(this.api.post<OrgSummaryDto>('organizations', { name }));
  }

  /** `PATCH /organizations/:id` — admin and up. */
  update(id: string, patch: { name?: string; imageUrl?: string | null }): Promise<OrgSummaryDto> {
    return firstValueFrom(this.api.patch<OrgSummaryDto>(`organizations/${enc(id)}`, patch));
  }

  /** `DELETE /organizations/:id` — owner only; cascades its drawings and folders. */
  remove(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`organizations/${enc(id)}`));
  }

  /** `POST /organizations/join` — by typed code or emailed invite token. */
  join(input: { code?: string; token?: string }): Promise<OrgSummaryDto> {
    return firstValueFrom(this.api.post<OrgSummaryDto>('organizations/join', input));
  }

  /** `POST /organizations/:id/regenerate-join-code` — invalidates the old code. */
  regenerateJoinCode(id: string): Promise<{ joinCode: string }> {
    return firstValueFrom(this.api.post<{ joinCode: string }>(`organizations/${enc(id)}/regenerate-join-code`, {}));
  }

  // ── members ───────────────────────────────────────────────────────────────

  /** `GET /organizations/:id/members` — owners first. */
  members(id: string): Promise<OrgMemberDto[]> {
    return firstValueFrom(this.api.get<OrgMemberDto[]>(`organizations/${enc(id)}/members`));
  }

  /**
   * `PATCH /organizations/:id/members/:userId` — owner only.
   *
   * `owner` is an ownership *addition*, not a swap: the caller stays an owner,
   * so an organization can never end up with none (409 `LAST_OWNER` guards the
   * other direction).
   */
  setMemberRole(id: string, userId: string, role: OrgRole): Promise<OrgMemberDto> {
    return firstValueFrom(
      this.api.patch<OrgMemberDto>(`organizations/${enc(id)}/members/${enc(userId)}`, { role }),
    );
  }

  /** `DELETE /organizations/:id/members/:userId` — leave (self) or remove (admin). */
  removeMember(id: string, userId: string): Promise<{ userId: string }> {
    return firstValueFrom(this.api.delete<{ userId: string }>(`organizations/${enc(id)}/members/${enc(userId)}`));
  }

  // ── invites ───────────────────────────────────────────────────────────────

  /** `GET /organizations/:id/invites` — pending only; admin and up. */
  invites(id: string): Promise<OrgInviteDto[]> {
    return firstValueFrom(this.api.get<OrgInviteDto[]>(`organizations/${enc(id)}/invites`));
  }

  /** `POST /organizations/:id/invites` — re-inviting refreshes the pending row. */
  invite(id: string, email: string, role: AssignableOrgRole = 'member'): Promise<OrgInviteDto> {
    return firstValueFrom(this.api.post<OrgInviteDto>(`organizations/${enc(id)}/invites`, { email, role }));
  }

  /** `DELETE /organizations/:id/invites/:inviteId`. */
  revokeInvite(id: string, inviteId: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`organizations/${enc(id)}/invites/${enc(inviteId)}`));
  }

  // ── invitations addressed to me ───────────────────────────────────────────
  //
  // There is no email delivery, so this listing *is* how an invitee finds out.
  // The dashboard shell polls it once on arrival and shows a banner.

  /** `GET /organizations/invitations` — pending, unexpired, addressed to the caller. */
  invitations(): Promise<OrgInvitationDto[]> {
    return firstValueFrom(this.api.get<OrgInvitationDto[]>('organizations/invitations'));
  }

  /** `POST /organizations/invitations/:id/accept` — equivalent to joining with its token. */
  acceptInvitation(inviteId: string): Promise<OrgSummaryDto> {
    return firstValueFrom(this.api.post<OrgSummaryDto>(`organizations/invitations/${enc(inviteId)}/accept`, {}));
  }

  /** `DELETE /organizations/invitations/:id` — decline; only the addressee may. */
  declineInvitation(inviteId: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`organizations/invitations/${enc(inviteId)}`));
  }
}
