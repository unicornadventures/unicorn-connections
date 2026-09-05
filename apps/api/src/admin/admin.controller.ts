import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AdminGuard } from '../common/guards/admin.guard.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { NumericIdPipe } from '../common/pipes/numeric-id.pipe.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type {
  MoveClassDto,
  RegistrationLinkDto,
  SetClassAdminDto,
  UpdateAdminProfileDto,
} from './dto/admin.dto.js';

/**
 * `/api/admin` — user administration.
 *
 * **The guards vary per route, and that is faithful.** Docs §5.5 and §9.2 said
 * several of these carried no guard at all; that was true of the *Express*
 * router, and the deployed handlers each open with their own `is_admin` check.
 * Since the deployed handlers are the contract (§14), the port is guarded. See
 * docs §18.
 *
 * Three levels are in play:
 *   - `SuperAdminGuard` — `is_admin` only. Most of this controller.
 *   - `AdminGuard` — `is_admin` **or** `is_class_admin`, then a per-user check
 *     inside the handler. Just `DELETE /users/:userId`.
 *   - `JwtAuthGuard` — any valid token, with `canManageUser` doing all the
 *     gating. Just `PUT /users/:userId/profile`, which really is only
 *     token-guarded at the route level.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @UseGuards(SuperAdminGuard)
  listUsers() {
    return this.admin.listUsers();
  }

  @Get('classes/:classId/users')
  @UseGuards(SuperAdminGuard)
  listClassUsers(
    @Param('classId', NumericIdPipe) classId: string,
    @Query() query: Record<string, string>,
  ) {
    return this.admin.listClassUsers(classId, query);
  }

  @Put('users/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  setClassAdmin(
    @Param('userId', NumericIdPipe) userId: string,
    @Body() body: SetClassAdminDto,
  ) {
    return this.admin.setClassAdmin(userId, body?.is_class_admin);
  }

  /**
   * `AdminGuard`, not `SuperAdminGuard`: a class admin may delete users, but
   * only ones sharing a class with them, which `canManageUser` enforces inside.
   */
  @Delete('users/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  deleteUser(
    @Param('userId', NumericIdPipe) userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.deleteUser(userId, user);
  }

  /** Only a token at the route level — see the class comment. */
  @Put('users/:userId/profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  updateUserProfile(
    @Param('userId', NumericIdPipe) userId: string,
    @Body() body: UpdateAdminProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.updateUserProfile(userId, body ?? {}, user);
  }

  @Put('users/:userId/move-class')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  moveUserClass(
    @Param('userId', NumericIdPipe) userId: string,
    @Body() body: MoveClassDto,
  ) {
    return this.admin.moveUserClass(userId, body?.class_id);
  }

  @Post('users/:userId/password-link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  createPasswordLink(@Param('userId', NumericIdPipe) userId: string) {
    return this.admin.createPasswordLink(userId);
  }

  @Post('registration-links')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  createRegistrationLink(@Body() body: RegistrationLinkDto) {
    return this.admin.createRegistrationLink(body?.classId, body?.schoolId);
  }
}
