import jwt from 'jsonwebtoken';
import type { Request } from 'express';

/**
 * The claims the source signs into a login token — `id`, `email`, `is_admin`,
 * `is_class_admin`. Deliberately no more than that: the deployed handlers trust
 * these claims directly rather than re-reading the user row (see docs §14), so
 * widening the payload would widen what authorization trusts.
 */
export interface AuthUser {
  id: number;
  email: string | null;
  is_admin: boolean;
  is_class_admin: boolean;
  [claim: string]: unknown;
}

/**
 * Port of `lambda/authUtils.ts` getAuthUser, with one addition.
 *
 * The deployed handlers read the Authorization header only. The Express-only
 * `/api/auth/me` also accepts the httpOnly cookie its sibling `/login` used to
 * set. Accepting both is a superset of each, and costs nothing: a request
 * carrying neither is rejected identically.
 *
 * Returns null for a missing, malformed, or expired token — never throws.
 */
export function extractAuthUser(
  request: Request,
  secret: string,
): AuthUser | null {
  const header = request.headers.authorization;
  const bearer = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : undefined;
  const token = bearer ?? (request as Request & { cookies?: Record<string, string> }).cookies?.token;

  if (!token) return null;

  try {
    return jwt.verify(token, secret) as AuthUser;
  } catch {
    return null;
  }
}
