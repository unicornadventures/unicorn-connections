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
 * Super admin only (`is_admin`).
 *
 * The 403 string is 'Admin access required.' — the same text AdminGuard uses.
 * That looks like a copy-paste slip but it is what the deployed handlers
 * return for super-admin-only endpoints, and the Express middleware's more
 * precise 'Super admin access required.' is not what users see in production.
 * Kept for parity; see docs §14.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
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

    if (!user.is_admin) {
      throw new ForbiddenException({ error: 'Admin access required.' });
    }

    request.user = user;
    return true;
  }
}
