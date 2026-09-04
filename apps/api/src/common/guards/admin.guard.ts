import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extractAuthUser } from '../auth-user.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

/**
 * Either flavour of admin — super admin *or* class admin.
 *
 * Ports the deployed handlers' inline check:
 *   if (!authUser) return errorResponse(401, 'Authentication required.');
 *   if (!authUser.is_admin && !authUser.is_class_admin)
 *     return errorResponse(403, 'Admin access required.');
 *
 * Note this is *not* the Express `requireAdmin` middleware, which re-read the
 * user row and answered 'Missing or invalid authorization token.' / 'User not
 * found.'. See docs §14 for why the deployed version is the reference.
 *
 * Endpoints that additionally scope a class admin to their own class do that
 * check inside the handler, because it depends on arguments the guard has no
 * business parsing.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = extractAuthUser(
      request,
      this.config.get<string>('jwtSecret')!,
    );

    if (!user) {
      throw new UnauthorizedException({ error: 'Authentication required.' });
    }

    if (!user.is_admin && !user.is_class_admin) {
      throw new ForbiddenException({ error: 'Admin access required.' });
    }

    request.user = user;
    return true;
  }
}
