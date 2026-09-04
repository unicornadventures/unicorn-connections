import type { INestApplication } from '@nestjs/common';
import { FIXTURE, closeFixturePool, resetFixture } from './src/fixtures.js';
import { compare, invokeNest, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 1 parity gate for `/api/auth`.
 *
 * Each case runs the **deployed Lambda handler** and the NestJS endpoint
 * against identically-seeded databases and asserts the status and body match
 * exactly, modulo tokens and timestamps. See docs §14 for why the Lambda
 * handlers are the reference rather than the Express routers.
 *
 * Requires a reachable Postgres. Point DB_* at a scratch database — this
 * TRUNCATEs between every assertion.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  // Imported after env is set so the source's db.ts picks up our scratch DB.
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/auth.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

describe('POST /api/auth/login', () => {
  it('matches on valid credentials', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.loginHandler, {
      method: 'post',
      path: '/api/auth/login',
      body: {
        email: FIXTURE.activeUser.email,
        password: FIXTURE.activeUser.password,
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('matches on a wrong password', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.loginHandler, {
      method: 'post',
      path: '/api/auth/login',
      body: { email: FIXTURE.activeUser.email, password: 'wrong' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(401);
  });

  it('matches on an unknown email', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.loginHandler, {
      method: 'post',
      path: '/api/auth/login',
      body: { email: 'nobody@example.com', password: 'whatever' },
    });

    expect(b).toEqual(a);
  });

  it('matches on missing fields', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.loginHandler, {
      method: 'post',
      path: '/api/auth/login',
      body: {},
    });

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe('Email and password required.');
  });

  it('matches for an unclaimed user with a null password', async () => {
    // The Express route let bcrypt.compare(pw, null) throw and answered 500.
    // The deployed handler checks explicitly and answers 401.
    const { legacy: a, nest: b } = await compare(app, legacy.loginHandler, {
      method: 'post',
      path: '/api/auth/login',
      body: { email: 'ghost@example.com', password: 'anything' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(401);
  });

  it('is case- and whitespace-insensitive on the email, identically', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.loginHandler, {
      method: 'post',
      path: '/api/auth/login',
      body: {
        email: `  ${FIXTURE.activeUser.email.toUpperCase()}  `,
        password: FIXTURE.activeUser.password,
      },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});

describe('POST /api/auth/register', () => {
  it('matches — registration is disabled', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.registerHandler, {
      method: 'post',
      path: '/api/auth/register',
      body: { email: 'new@example.com', password: 'password123' },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Registration is currently disabled.' },
    });
  });
});

describe('GET /api/auth/registration-link/:hash', () => {
  const validHash = Buffer.from(
    JSON.stringify({ s: FIXTURE.school.id, c: FIXTURE.class.id }),
  ).toString('base64url');

  it('matches for a valid hash', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getRegistrationLinkHandler,
      {
        method: 'get',
        path: `/api/auth/registration-link/${validHash}`,
        pathParameters: { hash: validHash },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('matches for an undecodable hash', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getRegistrationLinkHandler,
      {
        method: 'get',
        path: '/api/auth/registration-link/not-base64',
        pathParameters: { hash: 'not-base64' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe('Invalid registration link.');
  });

  it('matches when the school does not exist', async () => {
    const hash = Buffer.from(JSON.stringify({ s: 999, c: 1 })).toString(
      'base64url',
    );
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getRegistrationLinkHandler,
      {
        method: 'get',
        path: `/api/auth/registration-link/${hash}`,
        pathParameters: { hash },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'School not found.' } });
  });

  it('matches when the class is not linked to that school', async () => {
    const hash = Buffer.from(
      JSON.stringify({ s: FIXTURE.school.id, c: 999 }),
    ).toString('base64url');
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getRegistrationLinkHandler,
      {
        method: 'get',
        path: `/api/auth/registration-link/${hash}`,
        pathParameters: { hash },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Class not found.' } });
  });
});

describe('POST /api/auth/reset-password', () => {
  it('matches on a valid token', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.resetPasswordHandler,
      {
        method: 'post',
        path: '/api/auth/reset-password',
        body: {
          token: FIXTURE.resetToken,
          password: 'newpassword',
          confirmPassword: 'newpassword',
        },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'Password reset successful.' },
    });
  });

  it('matches on an unknown token', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.resetPasswordHandler,
      {
        method: 'post',
        path: '/api/auth/reset-password',
        body: {
          token: 'b'.repeat(64),
          password: 'newpassword',
          confirmPassword: 'newpassword',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe('Invalid or expired reset token.');
  });

  it('checks missing fields before mismatch, identically', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.resetPasswordHandler,
      { method: 'post', path: '/api/auth/reset-password', body: {} },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe(
      'Token, password, and password confirmation are required.',
    );
  });

  it('matches on a confirmation mismatch', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.resetPasswordHandler,
      {
        method: 'post',
        path: '/api/auth/reset-password',
        body: {
          token: FIXTURE.resetToken,
          password: 'newpassword',
          confirmPassword: 'different',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe('Passwords do not match.');
  });

  it('matches on a too-short password', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.resetPasswordHandler,
      {
        method: 'post',
        path: '/api/auth/reset-password',
        body: {
          token: FIXTURE.resetToken,
          password: 'short',
          confirmPassword: 'short',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe(
      'Password must be at least 6 characters long.',
    );
  });
});

describe('POST /api/auth/claim-search', () => {
  it('matches when an unclaimed roster entry is found', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimSearchHandler,
      {
        method: 'post',
        path: '/api/auth/claim-search',
        body: {
          first_name: FIXTURE.unclaimedUser.first_name,
          last_name: FIXTURE.unclaimedUser.last_name,
          class_id: FIXTURE.class.id,
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.matches).toHaveLength(1);
  });

  it('matches on the maiden-name branch', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimSearchHandler,
      {
        method: 'post',
        path: '/api/auth/claim-search',
        body: {
          first_name: FIXTURE.unclaimedUser.first_name,
          last_name: FIXTURE.unclaimedUser.former_last_name,
          class_id: FIXTURE.class.id,
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.matches).toHaveLength(1);
  });

  it('matches when nothing is found', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimSearchHandler,
      {
        method: 'post',
        path: '/api/auth/claim-search',
        body: {
          first_name: 'Nobody',
          last_name: 'Here',
          class_id: FIXTURE.class.id,
        },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { matches: [] } });
  });

  it('matches on missing fields', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimSearchHandler,
      { method: 'post', path: '/api/auth/claim-search', body: {} },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe(
      'first_name, last_name, and class_id are required.',
    );
  });
});

describe('POST /api/auth/claim-account', () => {
  it('matches on a successful claim', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimAccountHandler,
      {
        method: 'post',
        path: '/api/auth/claim-account',
        body: {
          user_id: FIXTURE.unclaimedUser.id,
          email: 'grace@example.com',
          password: 'password123',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('matches when the account is already claimed', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimAccountHandler,
      {
        method: 'post',
        path: '/api/auth/claim-account',
        body: {
          user_id: FIXTURE.activeUser.id,
          email: 'grace@example.com',
          password: 'password123',
        },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'Account not found or already registered.' },
    });
  });

  it('matches when the email is taken', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimAccountHandler,
      {
        method: 'post',
        path: '/api/auth/claim-account',
        body: {
          user_id: FIXTURE.unclaimedUser.id,
          email: FIXTURE.activeUser.email,
          password: 'password123',
        },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 409,
      body: { error: 'This email is already registered.' },
    });
  });

  it('matches on a too-short password (note: different wording to reset)', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.claimAccountHandler,
      {
        method: 'post',
        path: '/api/auth/claim-account',
        body: {
          user_id: FIXTURE.unclaimedUser.id,
          email: 'grace@example.com',
          password: 'short',
        },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe(
      'Password must be at least 6 characters.',
    );
  });
});

/**
 * No deployed counterpart to diff against, so these assert the documented
 * contract directly. forgot-password's source handler talks to the RDS Data API
 * and SQS, neither of which exists locally, so it cannot be executed here —
 * its wire contract is asserted instead.
 */
describe('endpoints with no deployed counterpart', () => {
  beforeEach(async () => {
    await resetFixture();
  });

  it('POST /forgot-password answers opaquely for a known address', async () => {
    const res = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/forgot-password',
      body: { email: FIXTURE.activeUser.email },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        message: 'If the email exists, a password reset link has been sent.',
      },
    });
  });

  it('POST /forgot-password answers identically for an unknown address', async () => {
    const res = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/forgot-password',
      body: { email: 'nobody@example.com' },
    });

    expect(res).toEqual({
      status: 200,
      body: {
        message: 'If the email exists, a password reset link has been sent.',
      },
    });
  });

  it('POST /forgot-password requires an email', async () => {
    const res = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/forgot-password',
      body: {},
    });

    expect(res).toEqual({ status: 400, body: { error: 'Email is required.' } });
  });

  it('GET /me returns the token claims', async () => {
    const login = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/login',
      body: {
        email: FIXTURE.activeUser.email,
        password: FIXTURE.activeUser.password,
      },
    });

    const res = await invokeNest(app, {
      method: 'get',
      path: '/api/auth/me',
      headers: { Authorization: `Bearer ${login.body.token}` },
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: FIXTURE.activeUser.id,
      email: FIXTURE.activeUser.email,
      is_admin: false,
      is_class_admin: false,
    });
  });

  it('GET /me rejects a missing token', async () => {
    const res = await invokeNest(app, { method: 'get', path: '/api/auth/me' });

    expect(res).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });

  it('GET /me rejects a garbage token', async () => {
    const res = await invokeNest(app, {
      method: 'get',
      path: '/api/auth/me',
      headers: { Authorization: 'Bearer not-a-jwt' },
    });

    expect(res.status).toBe(401);
  });

  it('POST /logout succeeds', async () => {
    const res = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/logout',
    });

    expect(res).toEqual({
      status: 200,
      body: { message: 'Logged out successfully' },
    });
  });

  it('POST /verify-email requires a token', async () => {
    const res = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/verify-email',
      body: {},
    });

    expect(res).toEqual({
      status: 400,
      body: { error: 'Verification token is required.' },
    });
  });

  it('POST /verify-email rejects an unknown token', async () => {
    const res = await invokeNest(app, {
      method: 'post',
      path: '/api/auth/verify-email',
      body: { token: 'c'.repeat(64) },
    });

    expect(res).toEqual({
      status: 400,
      body: { error: 'Invalid or expired verification token.' },
    });
  });
});
