import type { INestApplication } from '@nestjs/common';
import { FIXTURE, authAs, closeFixturePool } from './src/fixtures.js';
import { compare, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 3 parity gate for `/api/feedback`, and the only place the feature flag
 * is exercised — docs §10 makes "feature flag verified in both states" part of
 * this phase's gate.
 *
 * Both implementations read `process.env.FEEDBACK_ENABLED` per request, so a
 * test can flip it between calls without rebooting either side. That is
 * precisely why the port uses a guard rather than conditional module loading
 * (docs §6): a module registered only when the flag is on could not be tested
 * this way, and the flag would stop being observable at runtime.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/feedback.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

/** Restores whatever the harness script set, so order between files cannot matter. */
const originalFlag = process.env.FEEDBACK_ENABLED;
afterEach(() => {
  process.env.FEEDBACK_ENABLED = originalFlag;
});

const asActive = () => authAs(FIXTURE.activeUser);

describe('GET /api/feedback', () => {
  it('matches — the caller’s own feedback only', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listMyFeedbackHandler,
      { method: 'get', path: '/api/feedback', headers: asActive() },
    );

    expect(b).toEqual(a);
    expect((a as any).body.feedback).toHaveLength(1);
    expect((a as any).body.feedback[0].comment).toBe(FIXTURE.feedback.comment);
  });

  it('matches — someone else’s feedback is invisible', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listMyFeedbackHandler,
      {
        method: 'get',
        path: '/api/feedback',
        headers: authAs(FIXTURE.outsiderUser),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { feedback: [] } });
  });

  it('matches with no token', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listMyFeedbackHandler,
      { method: 'get', path: '/api/feedback' },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });
});

describe('POST /api/feedback', () => {
  it('matches on a successful submission', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createFeedbackHandler,
      {
        method: 'post',
        path: '/api/feedback',
        headers: asActive(),
        body: { comment: 'The slideshow is slow on mobile.' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
    expect((a as any).body.feedback.user_id).toBe(FIXTURE.activeUser.id);
  });

  it('trims the comment before storing it', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createFeedbackHandler,
      {
        method: 'post',
        path: '/api/feedback',
        headers: asActive(),
        body: { comment: '   padded   ' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.feedback.comment).toBe('padded');
  });

  it('matches on a missing comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createFeedbackHandler,
      { method: 'post', path: '/api/feedback', headers: asActive(), body: {} },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Comment is required.' },
    });
  });

  it('matches on a whitespace-only comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createFeedbackHandler,
      {
        method: 'post',
        path: '/api/feedback',
        headers: asActive(),
        body: { comment: '   ' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.error).toBe('Comment is required.');
  });
});

describe('the FEEDBACK_ENABLED flag', () => {
  it('404s both endpoints when disabled', async () => {
    process.env.FEEDBACK_ENABLED = 'false';

    const list = await compare(app, legacy.listMyFeedbackHandler, {
      method: 'get',
      path: '/api/feedback',
      headers: asActive(),
    });
    const create = await compare(app, legacy.createFeedbackHandler, {
      method: 'post',
      path: '/api/feedback',
      headers: asActive(),
      body: { comment: 'Should not land.' },
    });

    expect(list.nest).toEqual(list.legacy);
    expect(create.nest).toEqual(create.legacy);
    expect(list.legacy).toEqual({
      status: 404,
      body: { error: 'Feedback is not enabled.' },
    });
    expect(create.legacy).toEqual({
      status: 404,
      body: { error: 'Feedback is not enabled.' },
    });
  });

  /**
   * The flag is checked *before* the token, so a disabled deployment answers
   * 404 to everyone rather than 401 to the signed-out and 404 to the signed-in.
   * In the port that is guard ordering — `@UseGuards(FeedbackEnabledGuard,
   * JwtAuthGuard)` — and this is the test that would catch a reorder.
   */
  it('404s rather than 401s for an unauthenticated caller when disabled', async () => {
    process.env.FEEDBACK_ENABLED = 'false';

    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listMyFeedbackHandler,
      { method: 'get', path: '/api/feedback' },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'Feedback is not enabled.' },
    });
  });

  it('comes back without a restart when re-enabled', async () => {
    process.env.FEEDBACK_ENABLED = 'false';
    const off = await compare(app, legacy.listMyFeedbackHandler, {
      method: 'get',
      path: '/api/feedback',
      headers: asActive(),
    });

    process.env.FEEDBACK_ENABLED = 'true';
    const on = await compare(app, legacy.listMyFeedbackHandler, {
      method: 'get',
      path: '/api/feedback',
      headers: asActive(),
    });

    expect(off.nest).toEqual(off.legacy);
    expect(on.nest).toEqual(on.legacy);
    expect((off.legacy as any).status).toBe(404);
    expect((on.legacy as any).status).toBe(200);
  });

  it('only the literal "false" disables it', async () => {
    process.env.FEEDBACK_ENABLED = 'no';

    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listMyFeedbackHandler,
      { method: 'get', path: '/api/feedback', headers: asActive() },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});
