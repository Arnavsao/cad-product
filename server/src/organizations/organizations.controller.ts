import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import type { Actor } from '../common/access';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import {
  CreateInviteDto,
  CreateOrganizationDto,
  JoinOrganizationDto,
  UpdateMemberDto,
  UpdateOrganizationDto,
  type OrgDetailDto,
  type OrgInvitationDto,
  type OrgInviteDto,
  type OrgMemberDto,
  type OrgSummaryDto,
} from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

/**
 * `/api/v1/organizations`.
 *
 * `join` and the `invitations` routes are declared before `:id` routes: Nest
 * matches in declaration order, so a literal path that could also parse as an
 * id parameter has to come first.
 */
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** `GET /organizations` → the caller's organizations. */
  @Get()
  list(@CurrentUser('id') userId: string): Promise<OrgSummaryDto[]> {
    return this.organizations.listForUser(userId);
  }

  /** `POST /organizations` → 201; the caller becomes owner. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateOrganizationDto): Promise<OrgSummaryDto> {
    return this.organizations.create(userId, dto);
  }

  /** `POST /organizations/join` → the org just joined; 404 `INVITE_INVALID`. */
  @Post('join')
  @HttpCode(HttpStatus.OK)
  join(@CurrentUser('id') userId: string, @Body() dto: JoinOrganizationDto): Promise<OrgSummaryDto> {
    return this.organizations.join(userId, dto);
  }

  // ── invitations addressed to the caller ────────────────────────────────────

  /** `GET /organizations/invitations` → pending invitations for the caller. */
  @Get('invitations')
  listInvitations(@CurrentActor() actor: Actor): Promise<OrgInvitationDto[]> {
    return this.organizations.listInvitations(actor);
  }

  /** `POST /organizations/invitations/:id/accept` → the org just joined. */
  @Post('invitations/:id/accept')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
  ): Promise<OrgSummaryDto> {
    return this.organizations.acceptInvitation(actor, id);
  }

  /** `DELETE /organizations/invitations/:id` → decline; addressee only. */
  @Delete('invitations/:id')
  declineInvitation(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
  ): Promise<{ id: string }> {
    return this.organizations.declineInvitation(actor, id);
  }

  /** `GET /organizations/:id`; 404 when the caller is not a member. */
  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<OrgDetailDto> {
    return this.organizations.get(userId, id);
  }

  /** `PATCH /organizations/:id` — admin and up. */
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrgSummaryDto> {
    return this.organizations.update(userId, id, dto);
  }

  /** `DELETE /organizations/:id` — owner only. */
  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<{ id: string }> {
    return this.organizations.remove(userId, id);
  }

  /** `POST /organizations/:id/regenerate-join-code` — admin and up. */
  @Post(':id/regenerate-join-code')
  @HttpCode(HttpStatus.OK)
  regenerateJoinCode(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
  ): Promise<{ joinCode: string }> {
    return this.organizations.regenerateJoinCode(userId, id);
  }

  // ── members ────────────────────────────────────────────────────────────────

  /** `GET /organizations/:id/members` — members only. */
  @Get(':id/members')
  listMembers(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<OrgMemberDto[]> {
    return this.organizations.listMembers(userId, id);
  }

  /** `PATCH /organizations/:id/members/:userId` — owner only. */
  @Patch(':id/members/:userId')
  setMemberRole(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Param('userId', ParseCuidPipe) targetUserId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<OrgMemberDto> {
    return this.organizations.setMemberRole(userId, id, targetUserId, dto);
  }

  /** `DELETE /organizations/:id/members/:userId` — leave (self) or remove (admin). */
  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Param('userId', ParseCuidPipe) targetUserId: string,
  ): Promise<{ userId: string }> {
    return this.organizations.removeMember(userId, id, targetUserId);
  }

  // ── invites ────────────────────────────────────────────────────────────────

  /** `GET /organizations/:id/invites` — admin and up; pending only. */
  @Get(':id/invites')
  listInvites(@CurrentUser('id') userId: string, @Param('id', ParseCuidPipe) id: string): Promise<OrgInviteDto[]> {
    return this.organizations.listInvites(userId, id);
  }

  /** `POST /organizations/:id/invites` → 201; 409 `ALREADY_MEMBER`. */
  @Post(':id/invites')
  @HttpCode(HttpStatus.CREATED)
  invite(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: CreateInviteDto,
  ): Promise<OrgInviteDto> {
    return this.organizations.invite(userId, id, dto);
  }

  /** `DELETE /organizations/:id/invites/:inviteId` — admin and up. */
  @Delete(':id/invites/:inviteId')
  revokeInvite(
    @CurrentUser('id') userId: string,
    @Param('id', ParseCuidPipe) id: string,
    @Param('inviteId', ParseCuidPipe) inviteId: string,
  ): Promise<{ id: string }> {
    return this.organizations.revokeInvite(userId, id, inviteId);
  }
}
