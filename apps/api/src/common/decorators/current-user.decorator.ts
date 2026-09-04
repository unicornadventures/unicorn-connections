import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../auth-user.js';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard.js';

/**
 * The claims a guard attached to the request. Only meaningful on routes behind
 * JwtAuthGuard/AdminGuard/SuperAdminGuard — elsewhere it is undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
