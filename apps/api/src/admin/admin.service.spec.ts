import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../common/auth-user.js';
import type { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import type { S3Service } from '../photos/s3.service.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { AdminService } from './admin.service.js';
import type { AdminRepository } from './admin.repository.js';

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 12,
  email: 'admin@example.com',
  is_admin: true,
  is_class_admin: false,
  ...over,
});

const config = {
  get: () => 'http://localhost:5173',
} as unknown as ConfigService;

const scopeAllowing = (allowed: boolean) =>
  ({ canManageUser: async () => allowed }) as unknown as ClassScopeService;

function fakeS3() {
  const deleted: string[] = [];
  const service = {
    deleteObject: async (key: string) => {
      deleted.push(key);
    },
  } as unknown as S3Service;
  return { service, deleted };
}

function serviceWith(
  repo: Partial<AdminRepository>,
  scope: ClassScopeService = scopeAllowing(true),
  s3: S3Service = fakeS3().service,
) {
  return new AdminService(repo as AdminRepository, scope, s3, config);
}

describe('AdminService.deleteUser', () => {
  it('sweeps both profile photos before deleting the row', async () => {
    const s3 = fakeS3();
    const order: string[] = [];
    const service = serviceWith(
      {
        userExists: async () => true,
        findProfilePhotoKeys: async () => ({
          then_photo_url: 'photos/then.jpg',
          now_photo_url: 'photos/now.jpg',
        }),
        deleteUser: async () => {
          order.push('db');
        },
      },
      scopeAllowing(true),
      {
        deleteObject: async (key: string) => {
          order.push(`s3:${key}`);
          s3.deleted.push(key);
        },
      } as unknown as S3Service,
    );

    await service.deleteUser('10', asUser());

    expect(order).toEqual(['s3:photos/then.jpg', 's3:photos/now.jpg', 'db']);
  });

  /**
   * An object that will not delete must not block removing the account —
   * otherwise a stale S3 key makes a user undeletable.
   */
  it('deletes the user even when S3 fails', async () => {
    let deleted = false;
    const service = serviceWith(
      {
        userExists: async () => true,
        findProfilePhotoKeys: async () => ({
          then_photo_url: 'photos/then.jpg',
          now_photo_url: null,
        }),
        deleteUser: async () => {
          deleted = true;
        },
      },
      scopeAllowing(true),
      {
        deleteObject: async () => {
          throw new Error('S3 is down');
        },
      } as unknown as S3Service,
    );

    await expect(service.deleteUser('10', asUser())).resolves.toEqual({
      message: 'User deleted successfully.',
    });
    expect(deleted).toBe(true);
  });

  it('skips S3 entirely when the user has no photos', async () => {
    const s3 = fakeS3();
    const service = serviceWith(
      {
        userExists: async () => true,
        findProfilePhotoKeys: async () => ({
          then_photo_url: null,
          now_photo_url: null,
        }),
        deleteUser: async () => {},
      },
      scopeAllowing(true),
      s3.service,
    );

    await service.deleteUser('10', asUser());

    expect(s3.deleted).toEqual([]);
  });

  it('reports 404 before 403', async () => {
    const service = serviceWith(
      { userExists: async () => false },
      scopeAllowing(false),
    );

    await expectRejection(
      service.deleteUser('9999', asUser({ is_admin: false })),
      404,
      'User not found.',
    );
  });

  it('403s without scope over the user', async () => {
    const service = serviceWith(
      { userExists: async () => true },
      scopeAllowing(false),
    );

    await expectRejection(
      service.deleteUser('10', asUser({ is_admin: false })),
      403,
      'Access denied. You can only manage users in your class.',
    );
  });
});

describe('AdminService.updateUserProfile', () => {
  const validBody = {
    is_deceased: false,
    first_name: 'Ada',
    last_name: 'Lovelace',
  };

  it('requires is_deceased to be a boolean, not merely present', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.updateUserProfile(
        '10',
        { ...validBody, is_deceased: 'yes' },
        asUser(),
      ),
      400,
      'Missing required fields.',
    );
  });

  it('reports the name-specific message when names are missing', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.updateUserProfile('10', { is_deceased: false }, asUser()),
      400,
      'Missing required fields: first_name and last_name.',
    );
  });

  it('checks the boolean before the names', async () => {
    const service = serviceWith({});

    // Both are wrong; the is_deceased message must win.
    await expectRejection(
      service.updateUserProfile('10', {}, asUser()),
      400,
      'Missing required fields.',
    );
  });

  it('coerces empty former names to null', async () => {
    let stored: Record<string, unknown> | null = null;
    const service = serviceWith({
      userExists: async () => true,
      setDeceasedAndNames: async (_id, _dec, names) => {
        stored = names;
        return { id: 10, email: 'a@b.com', is_deceased: false };
      },
    });

    await service.updateUserProfile(
      '10',
      { ...validBody, former_first_name: '' },
      asUser(),
    );

    expect(stored).toMatchObject({
      former_first_name: null,
      former_last_name: null,
    });
  });

  it('echoes the submitted names back rather than re-reading', async () => {
    const service = serviceWith({
      userExists: async () => true,
      setDeceasedAndNames: async () => ({
        id: 10,
        email: 'a@b.com',
        is_deceased: true,
      }),
    });

    const { user } = await service.updateUserProfile(
      '10',
      { is_deceased: true, first_name: 'Augusta', last_name: 'King' },
      asUser(),
    );

    expect(user).toMatchObject({ first_name: 'Augusta', last_name: 'King' });
  });
});

describe('AdminService.importUsers', () => {
  const okRepo = (): Partial<AdminRepository> => ({
    findUserIdByEmail: async () => undefined,
    createRosterUser: async () => ({ id: 1, email: null, is_deceased: false }),
  });

  it('rejects a non-array', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.importUsers('1', '1', { users: undefined }),
      400,
      'users array is required.',
    );
  });

  it('rejects an empty array', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.importUsers('1', '1', { users: [] }),
      400,
      'users array is required.',
    );
  });

  it('accepts exactly 500 rows', async () => {
    const users = Array.from({ length: 500 }, (_, i) => ({
      first_name: `A${i}`,
      last_name: `B${i}`,
    }));
    const service = serviceWith(okRepo());

    const result = await service.importUsers('1', '1', { users });

    expect(result.created).toBe(500);
  });

  it('rejects 501 rows', async () => {
    const users = Array.from({ length: 501 }, (_, i) => ({
      first_name: `A${i}`,
      last_name: `B${i}`,
    }));
    const service = serviceWith({});

    await expectRejection(
      service.importUsers('1', '1', { users }),
      400,
      'Maximum 500 users per import.',
    );
  });

  it('skips nameless rows by position and keeps going', async () => {
    const service = serviceWith(okRepo());

    const result = await service.importUsers('1', '1', {
      users: [
        { first_name: 'Good', last_name: 'Row' },
        { first_name: '   ', last_name: 'Nameless' },
        { first_name: 'Also', last_name: 'Good' },
      ],
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toEqual([
      { index: 1, name: 'Row 2', reason: 'Missing first or last name' },
    ]);
  });

  it('skips duplicate emails with the row’s name', async () => {
    const service = serviceWith({
      findUserIdByEmail: async (email) => (email === 'dupe@x.com' ? 5 : undefined),
      createRosterUser: async () => ({ id: 1, email: null, is_deceased: false }),
    });

    const result = await service.importUsers('1', '1', {
      users: [
        { first_name: 'Dupe', last_name: 'Email', email: ' DUPE@X.com ' },
        { first_name: 'Fine', last_name: 'Row' },
      ],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([
      { index: 0, name: 'Dupe Email', reason: 'Email already exists' },
    ]);
  });

  /**
   * A row that blows up mid-insert must not take the batch with it — which is
   * exactly why there is no transaction around this loop.
   */
  it('survives a per-row database failure', async () => {
    let calls = 0;
    const service = serviceWith({
      findUserIdByEmail: async () => undefined,
      createRosterUser: async () => {
        calls += 1;
        if (calls === 1) throw new Error('constraint violation');
        return { id: 1, email: null, is_deceased: false };
      },
    });

    const result = await service.importUsers('1', '1', {
      users: [
        { first_name: 'Bad', last_name: 'Row' },
        { first_name: 'Good', last_name: 'Row' },
      ],
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([
      { index: 0, name: 'Bad Row', reason: 'Database error' },
    ]);
  });
});

describe('AdminService.createRosterUser', () => {
  it('hashes a random password when an email is present', async () => {
    let password: string | null = null;
    const service = serviceWith({
      findUserIdByEmail: async () => undefined,
      createRosterUser: async (_entry, hashed) => {
        password = hashed;
        return { id: 1, email: 'a@b.com', is_deceased: false };
      },
    });

    await service.createRosterUser('1', '1', {
      email: 'a@b.com',
      first_name: 'A',
      last_name: 'B',
    });

    expect(password).toMatch(/^\$2[aby]\$/);
  });

  /** No email means an unclaimed entry, waiting for claim-account. */
  it('leaves the password null when there is no email', async () => {
    let password: string | null | undefined;
    const service = serviceWith({
      createRosterUser: async (_entry, hashed) => {
        password = hashed;
        return { id: 1, email: null, is_deceased: false };
      },
    });

    await service.createRosterUser('1', '1', {
      first_name: 'A',
      last_name: 'B',
    });

    expect(password).toBeNull();
  });

  it('lowercases and trims the email before the conflict check', async () => {
    let looked: string | null = null;
    const service = serviceWith({
      findUserIdByEmail: async (email) => {
        looked = email;
        return undefined;
      },
      createRosterUser: async () => ({ id: 1, email: null, is_deceased: false }),
    });

    await service.createRosterUser('1', '1', {
      email: '  MiXeD@Example.COM ',
      first_name: 'A',
      last_name: 'B',
    });

    expect(looked).toBe('mixed@example.com');
  });

  it('409s on a duplicate email', async () => {
    const service = serviceWith({ findUserIdByEmail: async () => 5 });

    await expectRejection(
      service.createRosterUser('1', '1', {
        email: 'taken@x.com',
        first_name: 'A',
        last_name: 'B',
      }),
      409,
      'A user with this email already exists.',
    );
  });
});

describe('AdminService.moveUserClass', () => {
  it('400s when already in the target class', async () => {
    const service = serviceWith({
      userExists: async () => true,
      classExists: async () => true,
      findCurrentClassId: async () => 2,
    });

    await expectRejection(
      service.moveUserClass('10', 2),
      400,
      'User is already in that class.',
    );
  });

  it('accepts a string class_id', async () => {
    let moved: [number, number] | null = null;
    const service = serviceWith({
      userExists: async () => true,
      classExists: async () => true,
      findCurrentClassId: async () => 1,
      moveUserToClass: async (userId, classId) => {
        moved = [userId, classId];
      },
    });

    await service.moveUserClass('10', '2');

    expect(moved).toEqual([10, 2]);
  });

  it('checks the user before the class', async () => {
    const service = serviceWith({
      userExists: async () => false,
      classExists: async () => false,
    });

    await expectRejection(
      service.moveUserClass('9999', 9999),
      404,
      'User not found.',
    );
  });
});

describe('AdminService.createRegistrationLink', () => {
  it('builds a link from the encoded school and class', async () => {
    const service = serviceWith({
      findClassInSchool: async () => ({ id: 1, year: 1994 }),
    });

    const result = await service.createRegistrationLink(1, 1);

    expect(result.registrationUrl).toBe(
      `http://localhost:5173/register/${result.hash}`,
    );
  });

  it('404s when the class is not linked to the school', async () => {
    const service = serviceWith({ findClassInSchool: async () => undefined });

    await expectRejection(
      service.createRegistrationLink(1, 2),
      404,
      'Class not found.',
    );
  });

  it('400s on missing ids', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createRegistrationLink(undefined, 1),
      400,
      'Missing required fields: classId and schoolId.',
    );
  });
});

describe('AdminService.createPasswordLink', () => {
  it('replaces any outstanding token before inserting', async () => {
    const order: string[] = [];
    const service = serviceWith({
      findUserEmail: async () => ({ id: 10, email: 'a@b.com' }),
      deletePasswordResetTokens: async () => {
        order.push('delete');
      },
      insertPasswordResetToken: async () => {
        order.push('insert');
      },
    });

    await service.createPasswordLink('10');

    expect(order).toEqual(['delete', 'insert']);
  });

  it('stores a hash, never the token itself', async () => {
    let storedHash: string | null = null;
    const service = serviceWith({
      findUserEmail: async () => ({ id: 10, email: 'a@b.com' }),
      deletePasswordResetTokens: async () => {},
      insertPasswordResetToken: async (_id, hash) => {
        storedHash = hash;
      },
    });

    const { passwordSetupUrl } = await service.createPasswordLink('10');
    const token = new URL(passwordSetupUrl).searchParams.get('token')!;

    expect(storedHash).toHaveLength(64);
    expect(storedHash).not.toBe(token);
  });

  /** Seven days, not the one hour a self-service reset gets. */
  it('expires in seven days', async () => {
    const service = serviceWith({
      findUserEmail: async () => ({ id: 10, email: 'a@b.com' }),
      deletePasswordResetTokens: async () => {},
      insertPasswordResetToken: async () => {},
    });

    const { expiresAt } = await service.createPasswordLink('10');
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;

    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('400s for a user with no email', async () => {
    const service = serviceWith({
      findUserEmail: async () => ({ id: 11, email: null }),
    });

    await expectRejection(
      service.createPasswordLink('11'),
      400,
      'User has no email on file and cannot log in. Add an email first.',
    );
  });
});
