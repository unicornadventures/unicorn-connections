import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { SuperAdminGuard } from '../common/guards/super-admin.guard.js';
import { NumericIdPipe } from '../common/pipes/numeric-id.pipe.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type { UpdateProfileDto } from './dto/user.dto.js';

/**
 * `/api/users` — the four endpoints API Gateway actually routes.
 *
 * The Express app also mounted `POST /api/users/register` and
 * `POST /api/users/:userId/assign-class` here. Neither is deployed, neither is
 * called by the frontend, and both create or re-scope accounts with no
 * authentication whatsoever — porting them would open a hole that does not
 * exist in production today. They are recorded in docs §9.4 instead.
 *
 * Every route requires a valid token: `lambda/users.ts` opens each handler with
 * `getAuthUser(event)` and answers 401 'Authentication required.' when it comes
 * back null, which is exactly JwtAuthGuard.
 *
 * Route order matters here. Phase 3 mounts a second, comments-owned controller
 * at this same prefix, and Express resolved `GET /api/users/pending` against
 * `GET /:userId` because userRoutes was mounted first (docs §5.3). Keeping
 * UsersModule ahead of CommentsModule in AppModule's imports preserves that.
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Every user in the system, paginated.
   *
   * `SuperAdminGuard` rather than the controller's `JwtAuthGuard`: the deployed
   * handler serves this to **any** authenticated caller, which is §9.2 item 5,
   * approved for fixing in §21. Admin-only is the tightest change that keeps
   * the route — `GET /api/admin/users` is the same listing already behind the
   * same guard, and nothing in the frontend calls this one at all.
   */
  @Get()
  @UseGuards(SuperAdminGuard)
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.users.listUsers(page, pageSize);
  }

  /**
   * `userId` stays a string — see UsersService for why there is no ParseIntPipe
   * on any of these.
   */
  @Get(':userId')
  getProfile(@Param('userId', NumericIdPipe) userId: string) {
    return this.users.getProfile(userId);
  }

  @Get(':userId/class')
  getUserClass(@Param('userId', NumericIdPipe) userId: string) {
    return this.users.getUserClass(userId);
  }

  @Put(':userId/profile')
  updateProfile(
    @Param('userId', NumericIdPipe) userId: string,
    @Body() body: UpdateProfileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.updateProfile(userId, body ?? {}, user);
  }
}
