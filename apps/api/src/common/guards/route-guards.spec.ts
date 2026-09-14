import 'reflect-metadata';
import { AuthController } from '../../auth/auth.controller.js';
import { UsersController } from '../../users/users.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { SuperAdminGuard } from './super-admin.guard.js';

/**
 * Which guard is on which route.
 *
 * `guards.spec.ts` covers what each guard *decides*. Nothing covered whether a
 * guard is actually attached to the route that needs it — `SuperAdminGuard`
 * could be deleted from `UsersController.list` and every test in this package
 * would still pass. The only thing that caught it was the contract suite, which
 * needs a checkout of an application that no longer exists.
 *
 * So these read the metadata Nest itself reads. They are deliberately about
 * wiring, not behaviour: a route losing its guard is a silent privilege
 * escalation, and it should fail here rather than in a security review.
 */
const guardsOn = (target: object, method: string): unknown[] =>
  Reflect.getMetadata('__guards__', (target as never)[method]) ?? [];

describe('route guard wiring', () => {
  /**
   * known-bugs #6. The deployed handler served an unfiltered list of every user
   * to any authenticated caller. Admin-only was the tightest fix that kept the
   * route.
   */
  it('GET /api/users is behind SuperAdminGuard', () => {
    expect(guardsOn(UsersController.prototype, 'list')).toContain(
      SuperAdminGuard,
    );
  });

  /** A weaker guard here would be the bug back, not a different fix. */
  it('GET /api/users is not merely authenticated', () => {
    expect(guardsOn(UsersController.prototype, 'list')).not.toContain(
      JwtAuthGuard,
    );
  });

  /**
   * Reading one user is a different question from listing all of them, and the
   * fix for #6 was meant to be the narrowest one that kept the route working.
   * If this ever matches `list`, the guard was raised on the whole controller
   * rather than on the listing.
   */
  it('GET /api/users/:userId is not swept up by the same guard', () => {
    expect(guardsOn(UsersController.prototype, 'getProfile')).not.toContain(
      SuperAdminGuard,
    );
  });

  /** `/api/auth/me` echoes token claims, so it needs a token and nothing more. */
  it('GET /api/auth/me is behind JwtAuthGuard', () => {
    expect(guardsOn(AuthController.prototype, 'me')).toContain(JwtAuthGuard);
  });
});
