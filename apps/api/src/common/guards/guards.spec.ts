import { HttpException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { AdminGuard } from './admin.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { SuperAdminGuard } from './super-admin.guard.js';

const SECRET = 'guard-test-secret';
const config = { get: () => SECRET } as unknown as ConfigService;

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/**
 * Guards throw HttpExceptions whose *response body* carries the message —
 * `{ error: '...' }` — while `.message` stays Nest's generic 'Unauthorized
 * Exception'. The body is what AllExceptionsFilter puts on the wire, so that
 * is what these assert on.
 */
function expectRejection(
  fn: () => unknown,
  status: number,
  error: string,
): void {
  try {
    fn();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(HttpException);
    const exception = thrown as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toEqual({ error });
    return;
  }
  throw new Error('expected the guard to reject, but it allowed the request');
}

function bearer(claims: Record<string, unknown>, secret = SECRET) {
  return {
    headers: { authorization: `Bearer ${jwt.sign(claims, secret)}` },
  };
}

const regular = { id: 1, email: 'a@b.com', is_admin: false, is_class_admin: false };
const classAdmin = { ...regular, id: 2, is_class_admin: true };
const superAdmin = { ...regular, id: 3, is_admin: true };

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(config);

  it('accepts a valid bearer token and attaches the claims', () => {
    const request: Record<string, any> = bearer(regular);

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user).toMatchObject(regular);
  });

  it('accepts the token from a cookie as well as the header', () => {
    const request: Record<string, any> = {
      headers: {},
      cookies: { token: jwt.sign(regular, SECRET) },
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user).toMatchObject(regular);
  });

  it('rejects a request with no token', () => {
    expectRejection(
      () => guard.canActivate(contextFor({ headers: {} })),
      401,
      'Authentication required.',
    );
  });

  it('rejects a token signed with a different secret', () => {
    const request = bearer(regular, 'some-other-secret');

    expectRejection(
      () => guard.canActivate(contextFor(request)),
      401,
      'Authentication required.',
    );
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(regular, SECRET, { expiresIn: '-1s' });
    const request = { headers: { authorization: `Bearer ${expired}` } };

    expectRejection(
      () => guard.canActivate(contextFor(request)),
      401,
      'Authentication required.',
    );
  });

  it('ignores an Authorization header that is not a Bearer', () => {
    const request = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };

    expectRejection(
      () => guard.canActivate(contextFor(request)),
      401,
      'Authentication required.',
    );
  });

  it('does not consult the database — claims are taken at face value', () => {
    // Matches the deployed handlers (docs §14): a token claiming is_admin is
    // trusted for the life of the token. Asserted so the behaviour is a
    // decision on record rather than an oversight.
    const request: Record<string, any> = bearer({
      ...regular,
      id: 99999,
      is_admin: true,
    });

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request.user.is_admin).toBe(true);
  });
});

describe('AdminGuard', () => {
  const guard = new AdminGuard(config);

  it('allows a super admin', () => {
    expect(guard.canActivate(contextFor(bearer(superAdmin)))).toBe(true);
  });

  it('allows a class admin', () => {
    expect(guard.canActivate(contextFor(bearer(classAdmin)))).toBe(true);
  });

  it('rejects a regular user with 403', () => {
    expectRejection(
      () => guard.canActivate(contextFor(bearer(regular))),
      403,
      'Admin access required.',
    );
  });

  it('rejects an anonymous request with 401, not 403', () => {
    expectRejection(
      () => guard.canActivate(contextFor({ headers: {} })),
      401,
      'Authentication required.',
    );
  });
});

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard(config);

  it('allows a super admin', () => {
    expect(guard.canActivate(contextFor(bearer(superAdmin)))).toBe(true);
  });

  it('rejects a class admin', () => {
    expectRejection(
      () => guard.canActivate(contextFor(bearer(classAdmin))),
      403,
      'Admin access required.',
    );
  });

  it('uses the same 403 text as AdminGuard', () => {
    // Not a copy-paste slip: the deployed handlers return 'Admin access
    // required.' for super-admin-only endpoints too. The Express middleware's
    // 'Super admin access required.' is not what production says.
    expectRejection(
      () => guard.canActivate(contextFor(bearer(classAdmin))),
      403,
      'Admin access required.',
    );
  });
});
