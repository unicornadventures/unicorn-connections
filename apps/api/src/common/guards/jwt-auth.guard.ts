import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { extractAuthUser, type AuthUser } from '../auth-user.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Requires a valid token and attaches the decoded claims to `request.user`.
 *
 * Verification only — no database read, matching the deployed handlers
 * (docs §14). A user deleted or demoted mid-token keeps their claims until it
 * expires; tokens are 24h. That is the source's behaviour and changing it would
 * add a database round-trip to every authenticated request.
 *
 * 401 message matches `lambda/*`'s 'Authentication required.'
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
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

    request.user = user;
    return true;
  }
}
