import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import type { Page } from '../../common/utils/pagination';
import { PlatformRole, type User } from '../../generated/prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../admin.guard';
import { ADMIN_THROTTLE } from '../admin.throttle';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AdminOnly } from '../admin.decorators';
import { AuditContext } from '../audit/audit.context';
import { Audited } from '../audit/audited.decorator';
import {
  DeleteUserDto,
  ListUsersQueryDto,
  NotifyUserDto,
  PlanOverrideDto,
  SetStaffRoleDto,
  SuspendUserDto,
  type AdminUserDetailDto,
  type AdminUserRowDto,
} from '../dto/admin-user.dto';
import { AdminUsersService } from './admin-users.service';

/**
 * `/admin/users` and `/admin/staff`.
 *
 * Reading is SUPPORT; changing an account is ADMIN; changing who *is* staff is
 * OWNER. Each mutation carries `@Audited()`, which is the whole of its
 * bookkeeping — see `AuditInterceptor`.
 */
@Throttle(ADMIN_THROTTLE)
@UseGuards(AdminGuard)
@UseInterceptors(AuditInterceptor)
@AdminOnly()
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  list(@Query() query: ListUsersQueryDto): Promise<Page<AdminUserRowDto>> {
    return this.users.list(query);
  }

  @Get('users/:id')
  get(@Param('id', ParseCuidPipe) id: string): Promise<AdminUserDetailDto> {
    return this.users.get(id);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'user.suspend', targetType: 'user' })
  @Post('users/:id/suspend')
  async suspend(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: SuspendUserDto,
  ): Promise<AdminUserDetailDto> {
    AuditContext.setBefore(req, await this.users.snapshot(id));
    return this.users.suspend(actor, id, dto.reason);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'user.unsuspend', targetType: 'user', reasonField: null })
  @Post('users/:id/unsuspend')
  async unsuspend(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
  ): Promise<AdminUserDetailDto> {
    AuditContext.setBefore(req, await this.users.snapshot(id));
    return this.users.unsuspend(actor, id);
  }

  /**
   * `POST` rather than `DELETE /users/:id` on purpose: it takes a required
   * reason in the body, and a DELETE with a mandatory body is the kind of thing
   * proxies and clients quietly strip.
   */
  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'user.delete', targetType: 'user' })
  @Post('users/:id/delete')
  async remove(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: DeleteUserDto,
  ): Promise<AdminUserDetailDto> {
    AuditContext.setBefore(req, await this.users.snapshot(id));
    return this.users.softDelete(actor, id, dto.reason);
  }

  /**
   * `POST /admin/users/:id/plan-override` — grant a plan without a payment.
   *
   * ADMIN rather than OWNER: handing a beta tester a complimentary Pro is
   * routine support work, and it costs nothing real while billing is off.
   */
  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'user.planOverride', targetType: 'user' })
  @Post('users/:id/plan-override')
  async grantPlan(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
    @Body() dto: PlanOverrideDto,
  ): Promise<AdminUserDetailDto> {
    AuditContext.setBefore(req, await this.users.snapshot(id));
    return this.users.setPlanOverride(actor, id, dto);
  }

  @AdminOnly(PlatformRole.ADMIN)
  @Audited({ action: 'user.planOverrideCleared', targetType: 'user', reasonField: null })
  @Delete('users/:id/plan-override')
  async revokePlan(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('id', ParseCuidPipe) id: string,
  ): Promise<AdminUserDetailDto> {
    AuditContext.setBefore(req, await this.users.snapshot(id));
    return this.users.clearPlanOverride(actor, id);
  }

  @Audited({ action: 'user.notify', targetType: 'user', reasonField: null })
  @Post('users/:id/notify')
  @HttpCode(HttpStatus.NO_CONTENT)
  notify(@Param('id', ParseCuidPipe) id: string, @Body() dto: NotifyUserDto): Promise<void> {
    return this.users.notify(id, dto);
  }

  // --- Staff ---------------------------------------------------------------

  @AdminOnly(PlatformRole.ADMIN)
  @Get('staff')
  listStaff(): Promise<AdminUserRowDto[]> {
    return this.users.listStaff();
  }

  @AdminOnly(PlatformRole.OWNER)
  @Audited({ action: 'staff.setRole', targetType: 'staff', idParam: 'userId', reasonField: null })
  @Post('staff/:userId')
  async setRole(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('userId', ParseCuidPipe) userId: string,
    @Body() dto: SetStaffRoleDto,
  ): Promise<AdminUserRowDto> {
    AuditContext.setBefore(req, await this.users.snapshot(userId));
    return this.users.setStaffRole(actor, userId, dto.role);
  }

  /** Demoting to plain user is the same operation; kept as its own verb for the UI. */
  @AdminOnly(PlatformRole.OWNER)
  @Audited({ action: 'staff.remove', targetType: 'staff', idParam: 'userId', reasonField: null })
  @Delete('staff/:userId')
  async removeStaff(
    @Req() req: Request,
    @CurrentUser() actor: User,
    @Param('userId', ParseCuidPipe) userId: string,
  ): Promise<AdminUserRowDto> {
    AuditContext.setBefore(req, await this.users.snapshot(userId));
    return this.users.setStaffRole(actor, userId, 'user');
  }
}
