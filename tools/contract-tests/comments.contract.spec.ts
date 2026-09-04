import type { INestApplication } from '@nestjs/common';
import { FIXTURE, authAs, closeFixturePool } from './src/fixtures.js';
import { compare, expectDivergence, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 3 parity gate for the seven deployed comment endpoints, across both
 * mount points (docs §5.3).
 *
 * Comments are where the port's authorization is most intricate — moderation
 * standing depends on who wrote a comment, whose profile it is on, and which
 * classes the requester shares with the author — so most of these cases are
 * about *who is refused*, not about payload shape.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/comments.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

const asActive = () => authAs(FIXTURE.activeUser);
const asOutsider = () => authAs(FIXTURE.outsiderUser);
const asAdmin = () => authAs({ ...FIXTURE.adminUser, is_admin: true });
const asClassAdmin = () =>
  authAs({ ...FIXTURE.classAdminUser, is_class_admin: true });

describe('GET /api/users/:userId/comments', () => {
  it('matches — published comments only', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getCommentsHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}/comments`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    // The pending one on the same profile must not leak into the public view.
    expect((a as any).body.comments).toHaveLength(1);
    expect((a as any).body.comments[0].content).toBe(
      FIXTURE.publishedComment.content,
    );
  });

  it('includes the commenter name from the joined profile', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getCommentsHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}/comments`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.comments[0].commenter_first_name).toBe(
      FIXTURE.outsiderUser.first_name,
    );
  });

  it('matches with no token', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.getCommentsHandler, {
      method: 'get',
      path: `/api/users/${FIXTURE.activeUser.id}/comments`,
      pathParameters: { userId: String(FIXTURE.activeUser.id) },
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 401,
      body: { error: 'Authentication required.' },
    });
  });
});

describe('GET /api/users/:userId/comments/pending', () => {
  it('shows the profile owner everything on their own profile', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPendingCommentsHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/comments/pending`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    // Unpublished first, then published — ORDER BY published ASC.
    expect((a as any).body.comments.map((c: any) => c.id)).toEqual([
      FIXTURE.pendingComment.id,
      FIXTURE.publishedComment.id,
    ]);
  });

  it('shows a stranger nothing — an empty list, not a 403', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPendingCommentsHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/comments/pending`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asOutsider(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 200, body: { comments: [] } });
  });

  it('shows a class admin the comments written by their classmates', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPendingCommentsHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/comments/pending`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asClassAdmin(),
      },
    );

    expect(b).toEqual(a);
    // Both comments on this profile were written by their classmate.
    expect((a as any).body.comments).toHaveLength(2);
  });

  it('shows a super admin everything', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPendingCommentsHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/comments/pending`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comments).toHaveLength(2);
  });
});

describe('POST /api/users/:userId/comments', () => {
  it('matches on a successful post — unpublished by default', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createCommentHandler,
      {
        method: 'post',
        path: `/api/users/${FIXTURE.outsiderUser.id}/comments`,
        pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
        headers: asActive(),
        body: { content: 'Welcome back.' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(201);
    expect((a as any).body.comment.published).toBe(false);
    expect((a as any).body.comment.commenter_id).toBe(FIXTURE.activeUser.id);
  });

  /**
   * The frontend sends `commenterId` in the body. The deployed handler ignores
   * it and takes the commenter from the token — worth pinning, because
   * honouring it would let anyone post as anyone.
   */
  it('ignores a commenterId in the body', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createCommentHandler,
      {
        method: 'post',
        path: `/api/users/${FIXTURE.outsiderUser.id}/comments`,
        pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
        headers: asActive(),
        body: { content: 'Impersonation attempt.', commenterId: 999 },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comment.commenter_id).toBe(FIXTURE.activeUser.id);
  });

  it('matches on missing content', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createCommentHandler,
      {
        method: 'post',
        path: `/api/users/${FIXTURE.outsiderUser.id}/comments`,
        pathParameters: { userId: String(FIXTURE.outsiderUser.id) },
        headers: asActive(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'Missing required fields.' },
    });
  });

  it('matches when the target user does not exist', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.createCommentHandler,
      {
        method: 'post',
        path: '/api/users/9999/comments',
        pathParameters: { userId: '9999' },
        headers: asActive(),
        body: { content: 'Into the void.' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'User not found.' } });
  });
});

describe('GET /api/comments/my-comments/:commenterId', () => {
  it('matches for your own comments, with the target names joined', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getMyCommentsHandler,
      {
        method: 'get',
        path: `/api/comments/my-comments/${FIXTURE.outsiderUser.id}`,
        pathParameters: { commenterId: String(FIXTURE.outsiderUser.id) },
        headers: asOutsider(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comments.map((c: any) => c.id)).toEqual([
      FIXTURE.pendingComment.id,
      FIXTURE.publishedComment.id,
    ]);
    expect((a as any).body.comments[0].target_first_name).toBe(
      FIXTURE.activeUser.first_name,
    );
  });

  it('matches when asking for someone else', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getMyCommentsHandler,
      {
        method: 'get',
        path: `/api/comments/my-comments/${FIXTURE.outsiderUser.id}`,
        pathParameters: { commenterId: String(FIXTURE.outsiderUser.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You can only view your own comments.' },
    });
  });

  it('lets an admin read anyone else, identically', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getMyCommentsHandler,
      {
        method: 'get',
        path: `/api/comments/my-comments/${FIXTURE.outsiderUser.id}`,
        pathParameters: { commenterId: String(FIXTURE.outsiderUser.id) },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});

describe('GET /api/comments/pending', () => {
  it('gives a super admin every unpublished comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAllPendingCommentsHandler,
      { method: 'get', path: '/api/comments/pending', headers: asAdmin() },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comments.map((c: any) => c.id)).toEqual([
      FIXTURE.pendingComment.id,
      FIXTURE.crossClassComment.id,
      FIXTURE.selfModeratedComment.id,
    ]);
  });

  /**
   * The scope that makes class admins interesting: they see comments *written
   * by* their classmates, not comments *on* their classmates' profiles. The
   * cross-class comment is excluded even though it is unpublished.
   */
  it('scopes a class admin to comments written by their classmates', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAllPendingCommentsHandler,
      { method: 'get', path: '/api/comments/pending', headers: asClassAdmin() },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comments.map((c: any) => c.id)).toEqual([
      FIXTURE.pendingComment.id,
    ]);
  });

  it('refuses an ordinary user', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAllPendingCommentsHandler,
      { method: 'get', path: '/api/comments/pending', headers: asActive() },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Not authorized to moderate comments.' },
    });
  });

  it('ignores a spoofed ?requesterId=', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getAllPendingCommentsHandler,
      {
        method: 'get',
        path: '/api/comments/pending',
        query: { requesterId: String(FIXTURE.adminUser.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});

describe('PUT /api/comments/:commentId', () => {
  it('lets the profile owner publish a comment on their profile', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: `/api/comments/${FIXTURE.pendingComment.id}`,
        pathParameters: { commentId: String(FIXTURE.pendingComment.id) },
        headers: asActive(),
        body: { published: true },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comment.published).toBe(true);
  });

  it('lets a class admin publish a classmate’s comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: `/api/comments/${FIXTURE.pendingComment.id}`,
        pathParameters: { commentId: String(FIXTURE.pendingComment.id) },
        headers: asClassAdmin(),
        body: { published: true },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('refuses a class admin on a comment from outside their class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: `/api/comments/${FIXTURE.crossClassComment.id}`,
        pathParameters: { commentId: String(FIXTURE.crossClassComment.id) },
        headers: asClassAdmin(),
        body: { published: true },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Not authorized to moderate this comment.' },
    });
  });

  it('lets the author edit their own content, which unpublishes it', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: `/api/comments/${FIXTURE.publishedComment.id}`,
        pathParameters: { commentId: String(FIXTURE.publishedComment.id) },
        headers: asOutsider(),
        body: { content: 'Rewritten.' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.comment.content).toBe('Rewritten.');
    // An edit sends it back to moderation.
    expect((a as any).body.comment.published).toBe(false);
  });

  it('refuses a content edit by anyone but the author', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: `/api/comments/${FIXTURE.publishedComment.id}`,
        pathParameters: { commentId: String(FIXTURE.publishedComment.id) },
        // The profile owner — may moderate it, may not rewrite it.
        headers: asActive(),
        body: { content: 'Putting words in your mouth.' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You can only edit your own comments.' },
    });
  });

  /**
   * **Deliberate divergence** (§9.2 item 4, approved in §21). The source emits
   * `published` twice when both fields are sent and Postgres rejects the
   * duplicate assignment, so it 500s. The port assigns it once, and the content
   * side effect wins — an edit always returns the comment to moderation, so an
   * author cannot rewrite an approved comment and re-approve it in one request.
   */
  it('diverges: content + published now succeeds, unpublished', async () => {
    const observed = await compare(app, legacy.updateCommentHandler, {
      method: 'put',
      path: `/api/comments/${FIXTURE.selfModeratedComment.id}`,
      pathParameters: { commentId: String(FIXTURE.selfModeratedComment.id) },
      headers: asAdmin(),
      body: { content: 'Both at once.', published: true },
    });

    expect((observed.legacy as any).status).toBe(500);
    expectDivergence(
      observed,
      {
        status: 200,
        body: {
          comment: {
            id: FIXTURE.selfModeratedComment.id,
            target_user_id: FIXTURE.selfModeratedComment.target,
            commenter_id: FIXTURE.selfModeratedComment.commenter,
            content: 'Both at once.',
            // published: true was sent and is deliberately ignored.
            published: false,
            // normalize() masks these; they are listed so the shape is exact.
            created_at: '<created_at>',
            updated_at: '<updated_at>',
          },
        },
      },
      '§9.2 item 4 — duplicate assignment to published',
    );
  });

  it('matches on an empty body', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: `/api/comments/${FIXTURE.publishedComment.id}`,
        pathParameters: { commentId: String(FIXTURE.publishedComment.id) },
        headers: asActive(),
        body: {},
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      body: { error: 'At least one of content or published is required.' },
    });
  });

  it('matches for an unknown comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateCommentHandler,
      {
        method: 'put',
        path: '/api/comments/9999',
        pathParameters: { commentId: '9999' },
        headers: asActive(),
        body: { published: true },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Comment not found.' } });
  });
});

describe('DELETE /api/comments/:commentId', () => {
  it('lets the author delete their own comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteCommentHandler,
      {
        method: 'delete',
        path: `/api/comments/${FIXTURE.pendingComment.id}`,
        pathParameters: { commentId: String(FIXTURE.pendingComment.id) },
        headers: asOutsider(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'Comment deleted successfully.' },
    });
  });

  it('lets the profile owner delete a comment on their profile', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteCommentHandler,
      {
        method: 'delete',
        path: `/api/comments/${FIXTURE.pendingComment.id}`,
        pathParameters: { commentId: String(FIXTURE.pendingComment.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('refuses someone with no standing over the comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteCommentHandler,
      {
        method: 'delete',
        path: `/api/comments/${FIXTURE.crossClassComment.id}`,
        pathParameters: { commentId: String(FIXTURE.crossClassComment.id) },
        headers: asClassAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'Not authorized to delete this comment.' },
    });
  });

  it('matches for an unknown comment', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteCommentHandler,
      {
        method: 'delete',
        path: '/api/comments/9999',
        pathParameters: { commentId: '9999' },
        headers: asAdmin(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Comment not found.' } });
  });
});
