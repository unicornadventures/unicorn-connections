import type { AuthUser } from '../common/auth-user.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { PhotoUrlService } from '../photos/photo-url.service.js';
import { UsersService } from './users.service.js';
import type {
  UsersRepository,
  UserWithProfileRow,
} from './users.repository.js';

/**
 * Logic-level tests with the repository mocked. They exist to pin the parts the
 * contract suite cannot reach cheaply — argument handling, check ordering, and
 * which repository calls a given request should and should not make — while the
 * contract suite covers the wire format against the deployed handlers.
 */

const row = (over: Partial<UserWithProfileRow> = {}): UserWithProfileRow => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  first_name: 'Ada',
  last_name: 'Lovelace',
  nickname: null,
  former_first_name: null,
  former_last_name: null,
  bio: null,
  then_photo_url: 'photos/then.jpg',
  now_photo_url: null,
  avatar_color: null,
  tags: ['looms'],
  ...over,
});

/** Stands in for S3: echoes the key back so assertions can see it flow through. */
const photoUrls = {
  resolve: async (key: string | null | undefined) =>
    key ? `signed:${key}` : null,
  resolveAll: async (keys: (string | null | undefined)[]) =>
    keys.map((key) => (key ? `signed:${key}` : null)),
} as unknown as PhotoUrlService;

function serviceWith(repo: Partial<UsersRepository>) {
  return new UsersService(repo as UsersRepository, photoUrls);
}

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  ...over,
});

describe('UsersService.getProfile', () => {
  it('resolves photo keys into URLs and splits the row into user + profile', async () => {
    const service = serviceWith({ findUserWithProfile: async () => row() });

    const result = await service.getProfile('10');

    expect(result.user).toEqual({
      user_id: 10,
      email: 'ada@example.com',
      is_admin: false,
      is_class_admin: false,
    });
    expect(result.profile.then_photo_url).toBe('signed:photos/then.jpg');
    expect(result.profile.now_photo_url).toBeNull();
  });

  it('defaults tags to an array when the profile row is missing', async () => {
    const service = serviceWith({
      findUserWithProfile: async () => row({ tags: null }),
    });

    expect((await service.getProfile('10')).profile.tags).toEqual([]);
  });

  it('404s for an unknown user', async () => {
    const service = serviceWith({ findUserWithProfile: async () => undefined });

    await expectRejection(service.getProfile('9999'), 404, 'User not found.');
  });

  it('turns an unexpected repository failure into the source 500', async () => {
    const service = serviceWith({
      findUserWithProfile: async () => {
        throw new Error('connection terminated');
      },
    });

    await expectRejection(
      service.getProfile('10'),
      500,
      'Internal server error.',
    );
  });
});

describe('UsersService.listUsers', () => {
  it('applies the default page and size', async () => {
    let seen: [number, number] | null = null;
    const service = serviceWith({
      countUsers: async () => 4,
      listUsers: async (limit, offset) => {
        seen = [limit, offset];
        return [];
      },
    });

    const result = await service.listUsers();

    expect(seen).toEqual([20, 0]);
    expect(result).toMatchObject({ total: 4, page: 1, pageSize: 20 });
  });

  it('computes the offset from page and pageSize', async () => {
    let seen: [number, number] | null = null;
    const service = serviceWith({
      countUsers: async () => 4,
      listUsers: async (limit, offset) => {
        seen = [limit, offset];
        return [];
      },
    });

    await service.listUsers('3', '5');

    expect(seen).toEqual([5, 10]);
  });
});

describe('UsersService.updateProfile', () => {
  it('lets a user edit their own profile', async () => {
    const service = serviceWith({
      updateProfile: async () => {},
      findUserWithProfile: async () => row({ bio: 'new' }),
    });

    const result = await service.updateProfile('10', { bio: 'new' }, asUser());

    expect(result.profile.bio).toBe('new');
  });

  it('lets an admin edit someone else', async () => {
    const service = serviceWith({
      updateProfile: async () => {},
      findUserWithProfile: async () => row(),
    });

    await expect(
      service.updateProfile('10', { bio: 'x' }, asUser({ id: 99, is_admin: true })),
    ).resolves.toBeDefined();
  });

  it('403s when a stranger edits someone else', async () => {
    const service = serviceWith({
      updateProfile: async () => {
        throw new Error('must not be reached');
      },
    });

    await expectRejection(
      service.updateProfile('10', { bio: 'x' }, asUser({ id: 99 })),
      403,
      'You can only edit your own profile.',
    );
  });

  it('checks authorization before validating the payload', async () => {
    const service = serviceWith({});

    // An invalid colour *and* the wrong user: the 403 must win, so a stranger
    // learns nothing about which fields would have been accepted.
    await expectRejection(
      service.updateProfile(
        '10',
        { avatar_color: '#nonsense' },
        asUser({ id: 99 }),
      ),
      403,
      'You can only edit your own profile.',
    );
  });

  it('400s on a colour outside the palette', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.updateProfile('10', { avatar_color: '#123456' }, asUser()),
      400,
      'Invalid avatar color.',
    );
  });

  it('accepts an explicit null colour and writes it through', async () => {
    let cleared = false;
    const service = serviceWith({
      updateProfile: async () => {},
      updateAvatarColor: async (_id, color) => {
        cleared = color === null;
      },
      findUserWithProfile: async () => row(),
    });

    await service.updateProfile('10', { avatar_color: null }, asUser());

    expect(cleared).toBe(true);
  });

  it('leaves avatar_color alone when the field is absent', async () => {
    let touched = false;
    const service = serviceWith({
      updateProfile: async () => {},
      updateAvatarColor: async () => {
        touched = true;
      },
      findUserWithProfile: async () => row(),
    });

    await service.updateProfile('10', { bio: 'x' }, asUser());

    expect(touched).toBe(false);
  });

  it('lowercases and trims a new email', async () => {
    let stored: string | null = null;
    const service = serviceWith({
      isEmailTaken: async () => false,
      updateEmail: async (_id, email) => {
        stored = email;
      },
      updateProfile: async () => {},
      findUserWithProfile: async () => row(),
    });

    await service.updateProfile('10', { email: '  ADA@X.COM ' }, asUser());

    expect(stored).toBe('ada@x.com');
  });

  it('400s rather than 409s on a duplicate email', async () => {
    const service = serviceWith({ isEmailTaken: async () => true });

    await expectRejection(
      service.updateProfile('10', { email: 'taken@x.com' }, asUser()),
      400,
      'Email already in use.',
    );
  });

  it('treats an empty-string email as "not provided"', async () => {
    let touched = false;
    const service = serviceWith({
      isEmailTaken: async () => {
        touched = true;
        return false;
      },
      updateProfile: async () => {},
      findUserWithProfile: async () => row(),
    });

    await service.updateProfile('10', { email: '' }, asUser());

    expect(touched).toBe(false);
  });

  it('404s when the re-read finds nothing', async () => {
    const service = serviceWith({
      updateProfile: async () => {},
      findUserWithProfile: async () => undefined,
    });

    await expectRejection(
      service.updateProfile('10', { bio: 'x' }, asUser()),
      404,
      'User not found.',
    );
  });
});

describe('UsersService.getUserClass', () => {
  it('404s for a user in no class', async () => {
    const service = serviceWith({ findUserClass: async () => undefined });

    await expectRejection(
      service.getUserClass('12'),
      404,
      'User not in any class.',
    );
  });
});
