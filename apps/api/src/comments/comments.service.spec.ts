import type { AuthUser } from '../common/auth-user.js';
import type { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { CommentsService } from './comments.service.js';
import type {
  CommentsRepository,
  CommentWithCommenter,
} from './comments.repository.js';

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  ...over,
});

/** A ClassScopeService that always answers the same way. */
const scopeAlways = (allowed: boolean) =>
  ({ canModerateComments: async () => allowed }) as unknown as ClassScopeService;

function serviceWith(
  repo: Partial<CommentsRepository>,
  scope: ClassScopeService = scopeAlways(false),
) {
  return new CommentsService(repo as CommentsRepository, scope);
}

const comment = (
  over: Partial<CommentWithCommenter> = {},
): CommentWithCommenter =>
  ({
    id: 1,
    target_user_id: 10,
    commenter_id: 13,
    content: 'Hello',
    published: false,
    created_at: new Date(),
    updated_at: new Date(),
    commenter_first_name: 'Bob',
    commenter_last_name: 'Newby',
    ...over,
  }) as CommentWithCommenter;

describe('CommentsService.createComment', () => {
  it('takes the commenter from the token, never the body', async () => {
    let seen: [string, number, string] | null = null;
    const service = serviceWith({
      userExists: async () => true,
      insertComment: async (target, commenter, content) => {
        seen = [target, commenter, content];
        return comment() as never;
      },
    });

    await service.createComment('13', 'Hi', asUser({ id: 10 }));

    expect(seen).toEqual(['13', 10, 'Hi']);
  });

  it('400s on missing content', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createComment('13', undefined, asUser()),
      400,
      'Missing required fields.',
    );
  });

  it('400s on empty content, which is falsy', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createComment('13', '', asUser()),
      400,
      'Missing required fields.',
    );
  });

  it('404s when the target does not exist', async () => {
    const service = serviceWith({
      userExists: async (id) => id !== '9999',
    });

    await expectRejection(
      service.createComment('9999', 'Hi', asUser()),
      404,
      'User not found.',
    );
  });
});

describe('CommentsService.getPendingComments', () => {
  it('keeps only the comments the requester may moderate', async () => {
    const rows = [
      comment({ id: 1, commenter_id: 13 }),
      comment({ id: 2, commenter_id: 99 }),
    ];
    const scope = {
      canModerateComments: async (_r: number, commenterId: number) =>
        commenterId === 13,
    } as unknown as ClassScopeService;

    const service = serviceWith({ listAllFor: async () => rows }, scope);

    const { comments } = await service.getPendingComments('10', asUser());

    expect(comments.map((c) => c.id)).toEqual([1]);
  });

  it('returns an empty list rather than 403 for someone with no standing', async () => {
    const service = serviceWith(
      { listAllFor: async () => [comment()] },
      scopeAlways(false),
    );

    await expect(
      service.getPendingComments('10', asUser({ id: 99 })),
    ).resolves.toEqual({ comments: [] });
  });

  it('asks about each comment individually, not once for the profile', async () => {
    let calls = 0;
    const scope = {
      canModerateComments: async () => {
        calls += 1;
        return true;
      },
    } as unknown as ClassScopeService;

    const service = serviceWith(
      {
        listAllFor: async () => [
          comment({ id: 1 }),
          comment({ id: 2 }),
          comment({ id: 3 }),
        ],
      },
      scope,
    );

    await service.getPendingComments('10', asUser());

    expect(calls).toBe(3);
  });
});

describe('CommentsService.getMyComments', () => {
  it('403s when asking for someone else', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.getMyComments('13', asUser({ id: 10 })),
      403,
      'You can only view your own comments.',
    );
  });

  it('lets an admin read anyone', async () => {
    const service = serviceWith({ listByCommenter: async () => [] });

    await expect(
      service.getMyComments('13', asUser({ id: 12, is_admin: true })),
    ).resolves.toEqual({ comments: [] });
  });
});

describe('CommentsService.getAllPendingComments', () => {
  it('gives a super admin the unscoped queue', async () => {
    let used = '';
    const service = serviceWith({
      listAllPending: async () => {
        used = 'all';
        return [];
      },
      listPendingForClassAdmin: async () => {
        used = 'scoped';
        return [];
      },
    });

    await service.getAllPendingComments(asUser({ is_admin: true }));

    expect(used).toBe('all');
  });

  it('gives a class admin the scoped queue', async () => {
    let scopedTo: number | null = null;
    const service = serviceWith({
      listPendingForClassAdmin: async (id) => {
        scopedTo = id;
        return [];
      },
    });

    await service.getAllPendingComments(
      asUser({ id: 14, is_class_admin: true }),
    );

    expect(scopedTo).toBe(14);
  });

  it('403s an ordinary user', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.getAllPendingComments(asUser()),
      403,
      'Not authorized to moderate comments.',
    );
  });

  /** Admin wins when a user somehow carries both claims. */
  it('prefers the unscoped queue when both claims are set', async () => {
    let used = '';
    const service = serviceWith({
      listAllPending: async () => {
        used = 'all';
        return [];
      },
      listPendingForClassAdmin: async () => {
        used = 'scoped';
        return [];
      },
    });

    await service.getAllPendingComments(
      asUser({ is_admin: true, is_class_admin: true }),
    );

    expect(used).toBe('all');
  });
});

describe('CommentsService.updateComment', () => {
  it('400s when neither field is sent', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.updateComment('1', {}, asUser()),
      400,
      'At least one of content or published is required.',
    );
  });

  it('404s for an unknown comment', async () => {
    const service = serviceWith({ findOwnership: async () => undefined });

    await expectRejection(
      service.updateComment('9999', { published: true }, asUser()),
      404,
      'Comment not found.',
    );
  });

  it('403s a publish attempt without moderation standing', async () => {
    const service = serviceWith(
      {
        findOwnership: async () => ({
          id: 1,
          target_user_id: 10,
          commenter_id: 13,
        }),
      },
      scopeAlways(false),
    );

    await expectRejection(
      service.updateComment('1', { published: true }, asUser({ id: 99 })),
      403,
      'Not authorized to moderate this comment.',
    );
  });

  it('403s a content edit by anyone but the author', async () => {
    const service = serviceWith({
      findOwnership: async () => ({
        id: 1,
        target_user_id: 10,
        commenter_id: 13,
      }),
    });

    await expectRejection(
      // The profile owner: may moderate it, may not rewrite it.
      service.updateComment('1', { content: 'Nope' }, asUser({ id: 10 })),
      403,
      'You can only edit your own comments.',
    );
  });

  it('lets the author edit their own comment', async () => {
    const service = serviceWith({
      findOwnership: async () => ({
        id: 1,
        target_user_id: 10,
        commenter_id: 13,
      }),
      updateComment: async () => comment({ content: 'Edited' }),
    });

    const { comment: updated } = await service.updateComment(
      '1',
      { content: 'Edited' },
      asUser({ id: 13 }),
    );

    expect(updated.content).toBe('Edited');
  });

  it('checks moderation before authorship when both fields are sent', async () => {
    const service = serviceWith(
      {
        findOwnership: async () => ({
          id: 1,
          target_user_id: 10,
          commenter_id: 13,
        }),
      },
      scopeAlways(false),
    );

    // The author, but with no moderation standing: the moderation check runs
    // first, so this is the moderation message rather than the authorship one.
    await expectRejection(
      service.updateComment(
        '1',
        { content: 'Edited', published: true },
        asUser({ id: 13 }),
      ),
      403,
      'Not authorized to moderate this comment.',
    );
  });
});

describe('CommentsService.deleteComment', () => {
  it('lets the author delete without consulting moderation rules', async () => {
    let consulted = false;
    const scope = {
      canModerateComments: async () => {
        consulted = true;
        return false;
      },
    } as unknown as ClassScopeService;

    const service = serviceWith(
      {
        findOwnership: async () => ({
          id: 1,
          target_user_id: 10,
          commenter_id: 13,
        }),
        deleteComment: async () => {},
      },
      scope,
    );

    await expect(
      service.deleteComment('1', asUser({ id: 13 })),
    ).resolves.toEqual({ message: 'Comment deleted successfully.' });
    expect(consulted).toBe(false);
  });

  it('falls back to moderation standing for a non-author', async () => {
    const service = serviceWith(
      {
        findOwnership: async () => ({
          id: 1,
          target_user_id: 10,
          commenter_id: 13,
        }),
        deleteComment: async () => {},
      },
      scopeAlways(true),
    );

    await expect(
      service.deleteComment('1', asUser({ id: 10 })),
    ).resolves.toBeDefined();
  });

  it('403s someone with neither', async () => {
    const service = serviceWith(
      {
        findOwnership: async () => ({
          id: 1,
          target_user_id: 10,
          commenter_id: 13,
        }),
      },
      scopeAlways(false),
    );

    await expectRejection(
      service.deleteComment('1', asUser({ id: 99 })),
      403,
      'Not authorized to delete this comment.',
    );
  });
});
