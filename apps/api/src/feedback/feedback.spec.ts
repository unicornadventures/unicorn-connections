import { HttpException } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { FeedbackEnabledGuard } from './feedback-enabled.guard.js';
import { FeedbackService } from './feedback.service.js';
import type { FeedbackRepository } from './feedback.repository.js';

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  ...over,
});

function serviceWith(repo: Partial<FeedbackRepository>) {
  return new FeedbackService(repo as FeedbackRepository);
}

describe('FeedbackEnabledGuard', () => {
  const guard = new FeedbackEnabledGuard();
  const original = process.env.FEEDBACK_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.FEEDBACK_ENABLED;
    else process.env.FEEDBACK_ENABLED = original;
  });

  it('allows the request when the flag is unset', () => {
    delete process.env.FEEDBACK_ENABLED;

    expect(guard.canActivate()).toBe(true);
  });

  it('allows the request when the flag is "true"', () => {
    process.env.FEEDBACK_ENABLED = 'true';

    expect(guard.canActivate()).toBe(true);
  });

  it('404s with the source message when the flag is "false"', () => {
    process.env.FEEDBACK_ENABLED = 'false';

    try {
      guard.canActivate();
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(404);
      expect((thrown as HttpException).getResponse()).toEqual({
        error: 'Feedback is not enabled.',
      });
      return;
    }
    throw new Error('expected the guard to reject');
  });

  /** Only the literal string disables it — not 'no', not '0', not 'FALSE'. */
  it.each(['no', '0', 'FALSE', 'False', ''])(
    'treats %o as enabled',
    (value) => {
      process.env.FEEDBACK_ENABLED = value;

      expect(guard.canActivate()).toBe(true);
    },
  );

  /**
   * Reading the environment per call is what lets the flag be flipped without
   * a restart, which the contract suite depends on and which reading config at
   * construction time would break.
   */
  it('re-reads the flag on every call', () => {
    process.env.FEEDBACK_ENABLED = 'false';
    expect(() => guard.canActivate()).toThrow();

    process.env.FEEDBACK_ENABLED = 'true';
    expect(guard.canActivate()).toBe(true);
  });
});

describe('FeedbackService.createFeedback', () => {
  it('trims before storing', async () => {
    let stored: string | null = null;
    const service = serviceWith({
      insert: async (_id, comment) => {
        stored = comment;
        return { id: 1 } as never;
      },
    });

    await service.createFeedback('   padded   ', asUser());

    expect(stored).toBe('padded');
  });

  it('attributes the feedback to the token, not to any body field', async () => {
    let owner: number | null = null;
    const service = serviceWith({
      insert: async (userId) => {
        owner = userId;
        return { id: 1 } as never;
      },
    });

    await service.createFeedback('Hi', asUser({ id: 42 }));

    expect(owner).toBe(42);
  });

  it('400s on a missing comment', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createFeedback(undefined, asUser()),
      400,
      'Comment is required.',
    );
  });

  it('400s on a whitespace-only comment', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createFeedback('   ', asUser()),
      400,
      'Comment is required.',
    );
  });

  /**
   * `String()` coercion rather than a type check, so a number is stored as its
   * text. The source's behaviour; a validation pipe would 400 instead.
   */
  it('coerces a non-string comment rather than rejecting it', async () => {
    let stored: string | null = null;
    const service = serviceWith({
      insert: async (_id, comment) => {
        stored = comment;
        return { id: 1 } as never;
      },
    });

    await service.createFeedback(42, asUser());

    expect(stored).toBe('42');
  });
});

describe('FeedbackService.listMyFeedback', () => {
  it('scopes to the authenticated user', async () => {
    let scopedTo: number | null = null;
    const service = serviceWith({
      listForUser: async (userId) => {
        scopedTo = userId;
        return [];
      },
    });

    await service.listMyFeedback(asUser({ id: 42 }));

    expect(scopedTo).toBe(42);
  });
});
