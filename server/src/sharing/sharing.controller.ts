import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Actor } from '../common/access';
import { CurrentActor } from '../common/decorators/current-actor.decorator';
import { ParseCuidPipe } from '../common/pipes/parse-cuid.pipe';
import {
  CreateShareLinkDto,
  EmailShareLinkDto,
  UpsertShareDto,
  type AcceptedShareDto,
  type EmailedShareLinkDto,
  type RemovedShareDto,
  type SharedLinkDto,
  type ShareDto,
  type ShareLinkDto,
  type SharesDto,
} from './dto/share.dto';
import { SharingService } from './sharing.service';

/**
 * Emailing a link is the one route here that causes outbound mail to addresses
 * the caller typed, so it gets a far tighter budget than the default 300/min:
 * ten calls a minute, each naming at most ten addresses.
 */
const EMAIL_LINK_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Sharing routes for drawings, folders and links.
 *
 * Declared with ABSOLUTE paths on a prefix-less controller (as
 * `UploadsController` does) rather than as a second `@Controller('drawings')`:
 * every path here is three or four segments deep, so it can never be confused
 * with `DrawingsController`'s `:id` patterns, and the reader does not have to
 * reason about which controller Nest registered first.
 */
@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  // ── drawings ───────────────────────────────────────────────────────────────

  /** `GET /drawings/:id/shares` → `{ access, shares, links }`; needs `manage`. */
  @Get('drawings/:id/shares')
  listDrawingShares(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<SharesDto> {
    return this.sharing.listDrawingShares(actor, id);
  }

  /** `PUT /drawings/:id/shares` → `ShareDto`; 422 `SHARE_SELF`/`SHARE_SAME_ORG`. */
  @Put('drawings/:id/shares')
  @HttpCode(HttpStatus.OK)
  upsertDrawingShare(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpsertShareDto,
  ): Promise<ShareDto> {
    return this.sharing.upsertDrawingShare(actor, id, dto);
  }

  /** `DELETE /drawings/:id/shares/:shareId` → `{ id }`. */
  @Delete('drawings/:id/shares/:shareId')
  removeDrawingShare(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Param('shareId', ParseCuidPipe) shareId: string,
  ): Promise<RemovedShareDto> {
    return this.sharing.removeDrawingShare(actor, id, shareId);
  }

  /** `POST /drawings/:id/links` → `ShareLinkDto` (201). */
  @Post('drawings/:id/links')
  @HttpCode(HttpStatus.CREATED)
  createLink(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: CreateShareLinkDto,
  ): Promise<ShareLinkDto> {
    return this.sharing.createLink(actor, id, dto);
  }

  /** `DELETE /drawings/:id/links/:linkId` → `{ id }`; sets `revokedAt`. */
  @Delete('drawings/:id/links/:linkId')
  revokeLink(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Param('linkId', ParseCuidPipe) linkId: string,
  ): Promise<RemovedShareDto> {
    return this.sharing.revokeLink(actor, id, linkId);
  }

  /**
   * `POST /drawings/:id/links/:linkId/email` → `{ sent }`; needs `manage`.
   *
   * 404 `LINK_INVALID` when the link is revoked or expired, 400 when the body
   * names more than ten addresses.
   */
  @Throttle(EMAIL_LINK_THROTTLE)
  @Post('drawings/:id/links/:linkId/email')
  @HttpCode(HttpStatus.OK)
  emailLink(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Param('linkId', ParseCuidPipe) linkId: string,
    @Body() dto: EmailShareLinkDto,
  ): Promise<EmailedShareLinkDto> {
    return this.sharing.emailLink(actor, id, linkId, dto);
  }

  // ── folders ────────────────────────────────────────────────────────────────

  /** `GET /folders/:id/shares` → `{ access, shares, links: [] }`. */
  @Get('folders/:id/shares')
  listFolderShares(@CurrentActor() actor: Actor, @Param('id', ParseCuidPipe) id: string): Promise<SharesDto> {
    return this.sharing.listFolderShares(actor, id);
  }

  /** `PUT /folders/:id/shares` → `ShareDto`; covers the whole subtree. */
  @Put('folders/:id/shares')
  @HttpCode(HttpStatus.OK)
  upsertFolderShare(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: UpsertShareDto,
  ): Promise<ShareDto> {
    return this.sharing.upsertFolderShare(actor, id, dto);
  }

  /** `DELETE /folders/:id/shares/:shareId` → `{ id }`. */
  @Delete('folders/:id/shares/:shareId')
  removeFolderShare(
    @CurrentActor() actor: Actor,
    @Param('id', ParseCuidPipe) id: string,
    @Param('shareId', ParseCuidPipe) shareId: string,
  ): Promise<RemovedShareDto> {
    return this.sharing.removeFolderShare(actor, id, shareId);
  }

  // ── links, from the recipient's side ───────────────────────────────────────

  /**
   * `GET /shared/:token` → the drawing behind a link. Authenticated: accepting
   * needs an identity to attach the share to, and the sign-in bounce is the
   * client's job (`returnUrl`), not a reason to leak a drawing name publicly.
   */
  @Get('shared/:token')
  getSharedLink(@CurrentActor() actor: Actor, @Param('token') token: string): Promise<SharedLinkDto> {
    return this.sharing.getSharedLink(actor, token);
  }

  /** `POST /shared/:token/accept` → `{ drawingId, access }`; idempotent. */
  @Post('shared/:token/accept')
  @HttpCode(HttpStatus.OK)
  acceptSharedLink(@CurrentActor() actor: Actor, @Param('token') token: string): Promise<AcceptedShareDto> {
    return this.sharing.acceptSharedLink(actor, token);
  }
}
