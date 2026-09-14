import type { ConfigService } from '@nestjs/config';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { AuthService } from './auth.service.js';
import type { AuthRepository } from './auth.repository.js';
import type { TokenService } from '../tokens/token.service.js';
import type { PasswordResetDispatcher } from '../email/password-reset-dispatcher.service.js';

/**
 * known-bugs #3.
 *
 * `POST /api/auth/verify-email` existed in the old app's router but had no
 * deployed route, so clicking a verification link reached nothing. This app
 * implements it — and until now nothing in this package tested it at all. The
 * route was covered only by its own existence.
 *
 * These pin the three answers the frontend distinguishes: missing token,
 * unrecognised token, and success. The token is compared by **hash**; a test
 * that let the raw token reach the repository would pass while storing
 * plaintext-comparable secrets, so that is asserted explicitly.
 */
const serviceWith = (repo: Partial<AuthRepository>) =>
  new AuthService(
    repo as AuthRepository,
    { get: () => 'test-secret' } as unknown as ConfigService,
    { hash: (token: string) => `hashed:${token}` } as unknown as TokenService,
    {} as PasswordResetDispatcher,
  );

describe('AuthService.verifyEmail', () => {
  it('rejects a missing token', async () => {
    await expectRejection(
      serviceWith({}).verifyEmail(undefined),
      400,
      'Verification token is required.',
    );
  });

  it('rejects an unrecognised token', async () => {
    const service = serviceWith({
      findUserIdByVerificationTokenHash: async () => undefined,
    });

    await expectRejection(
      service.verifyEmail('nope'),
      400,
      'Invalid or expired verification token.',
    );
  });

  it('marks the email verified and reports success', async () => {
    let verified: number | undefined;
    const service = serviceWith({
      findUserIdByVerificationTokenHash: async () => 10,
      markEmailVerified: async (userId) => {
        verified = userId;
      },
    });

    await expect(service.verifyEmail('good-token')).resolves.toEqual({
      message:
        'Email verified successfully. You can now login to your account.',
    });
    expect(verified).toBe(10);
  });

  /** The raw token must never be what is looked up. */
  it('looks the token up by hash, not by value', async () => {
    let looked: string | undefined;
    const service = serviceWith({
      findUserIdByVerificationTokenHash: async (hash) => {
        looked = hash;
        return 10;
      },
      markEmailVerified: async () => {},
    });

    await service.verifyEmail('good-token');

    expect(looked).toBe('hashed:good-token');
    expect(looked).not.toBe('good-token');
  });
});
