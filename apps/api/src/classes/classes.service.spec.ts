import type { AuthUser } from '../common/auth-user.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { S3Service } from '../photos/s3.service.js';
import { ClassesService } from './classes.service.js';
import type { ClassesRepository } from './classes.repository.js';

const photoUrls = {
  resolve: async (key: string | null | undefined) =>
    key ? `signed:${key}` : null,
  resolveAll: async (keys: (string | null | undefined)[]) =>
    keys.map((key) => (key ? `signed:${key}` : null)),
} as unknown as S3Service;

function serviceWith(
  repo: Partial<ClassesRepository>,
  s3: S3Service = photoUrls,
) {
  return new ClassesService(repo as ClassesRepository, s3);
}

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  ...over,
});

describe('ClassesService.listSchoolClasses', () => {
  const currentYear = new Date().getFullYear();

  it('links the current year when the school has classes but not this one', async () => {
    let linked: [number, string] | null = null;
    const service = serviceWith({
      isYearLinkedToSchool: async () => false,
      hasAnyLinkedClass: async () => true,
      findClassIdByYear: async () => 3,
      linkClassToSchool: async (classId, schoolId) => {
        linked = [classId, schoolId];
      },
      listSchoolClasses: async () => [],
    });

    await service.listSchoolClasses('1');

    expect(linked).toEqual([3, '1']);
  });

  it('does not link anything for a school with no classes configured', async () => {
    let touched = false;
    const service = serviceWith({
      isYearLinkedToSchool: async () => false,
      hasAnyLinkedClass: async () => false,
      linkClassToSchool: async () => {
        touched = true;
      },
      listSchoolClasses: async () => [],
    });

    await service.listSchoolClasses('2');

    expect(touched).toBe(false);
  });

  it('does nothing when the current year is already linked', async () => {
    let touched = false;
    const service = serviceWith({
      isYearLinkedToSchool: async (_school, year) => year === currentYear,
      hasAnyLinkedClass: async () => {
        touched = true;
        return true;
      },
      listSchoolClasses: async () => [],
    });

    await service.listSchoolClasses('1');

    expect(touched).toBe(false);
  });

  it('skips the link when no class row exists for the current year', async () => {
    let touched = false;
    const service = serviceWith({
      isYearLinkedToSchool: async () => false,
      hasAnyLinkedClass: async () => true,
      findClassIdByYear: async () => undefined,
      linkClassToSchool: async () => {
        touched = true;
      },
      listSchoolClasses: async () => [],
    });

    await service.listSchoolClasses('1');

    expect(touched).toBe(false);
  });

  it('answers with an empty list rather than 404 for an unknown school', async () => {
    const service = serviceWith({
      isYearLinkedToSchool: async () => false,
      hasAnyLinkedClass: async () => false,
      listSchoolClasses: async () => [],
    });

    await expect(service.listSchoolClasses('9999')).resolves.toEqual({
      classes: [],
    });
  });
});

describe('ClassesService class-scoped access', () => {
  it('lets a member read the directory', async () => {
    const service = serviceWith({
      isClassMember: async () => true,
      listDirectory: async () => [],
    });

    await expect(service.getDirectory('1', asUser())).resolves.toEqual({
      users: [],
    });
  });

  it('refuses a non-member', async () => {
    const service = serviceWith({
      isClassMember: async () => false,
      listDirectory: async () => {
        throw new Error('must not be reached');
      },
    });

    await expectRejection(
      service.getDirectory('1', asUser({ id: 13 })),
      403,
      'Access denied. You are not in this class.',
    );
  });

  it('lets an admin through without a membership lookup', async () => {
    let checked = false;
    const service = serviceWith({
      isClassMember: async () => {
        checked = true;
        return false;
      },
      listDirectory: async () => [],
    });

    await service.getDirectory('1', asUser({ id: 12, is_admin: true }));

    expect(checked).toBe(false);
  });

  it('derives identity from the token, so a member id in the payload is irrelevant', async () => {
    let askedAbout: number | null = null;
    const service = serviceWith({
      isClassMember: async (userId) => {
        askedAbout = userId;
        return false;
      },
    });

    await expectRejection(
      service.getDirectory('1', asUser({ id: 13 })),
      403,
      'Access denied. You are not in this class.',
    );
    expect(askedAbout).toBe(13);
  });
});

describe('ClassesService.getPhotos', () => {
  it('flattens then, now and gallery keys into resolved URLs', async () => {
    const service = serviceWith({
      isClassMember: async () => true,
      listMemberProfilePhotoKeys: async () => [
        { user_id: 10, then_photo_url: 'then.jpg', now_photo_url: 'now.jpg' },
        { user_id: 11, then_photo_url: null, now_photo_url: null },
      ],
      listMemberGalleryKeys: async () => [{ user_id: 10, s3_key: 'g1.jpg' }],
    });

    const { photos } = await service.getPhotos('1', asUser());

    expect(photos).toEqual([
      { url: 'signed:then.jpg', userId: 10 },
      { url: 'signed:now.jpg', userId: 10 },
      { url: 'signed:g1.jpg', userId: 10 },
    ]);
  });

  it('drops keys that fail to resolve rather than returning null entries', async () => {
    const dropping = {
      resolve: async (key: string) => (key === 'bad.jpg' ? null : `signed:${key}`),
      resolveAll: async (keys: string[]) => keys.map((k) => `signed:${k}`),
    } as unknown as S3Service;

    const service = new ClassesService(
      {
        isClassMember: async () => true,
        listMemberProfilePhotoKeys: async () => [
          { user_id: 10, then_photo_url: 'bad.jpg', now_photo_url: 'ok.jpg' },
        ],
        listMemberGalleryKeys: async () => [],
      } as unknown as ClassesRepository,
      dropping,
    );

    const { photos } = await service.getPhotos('1', asUser());

    expect(photos).toEqual([{ url: 'signed:ok.jpg', userId: 10 }]);
  });
});

describe('ClassesService.getClass', () => {
  it('404s for an unknown class', async () => {
    const service = serviceWith({ findClass: async () => undefined });

    await expectRejection(service.getClass('9999'), 404, 'Class not found.');
  });
});

describe('ClassesService admin link management', () => {
  it('409s when the year is already linked', async () => {
    const service = serviceWith({
      schoolExists: async () => true,
      findClassByYear: async () => ({ id: 1, year: 1994 }),
      isLinked: async () => true,
    });

    await expectRejection(
      service.linkClassToSchool('1', 1994),
      409,
      'Class year 1994 is already linked to this school.',
    );
  });

  it('404s for a year with no class row', async () => {
    const service = serviceWith({
      schoolExists: async () => true,
      findClassByYear: async () => undefined,
    });

    await expectRejection(
      service.linkClassToSchool('1', 1066),
      404,
      'Class year 1066 not found.',
    );
  });

  it('checks the school before the year', async () => {
    const service = serviceWith({
      schoolExists: async () => false,
      findClassByYear: async () => undefined,
    });

    await expectRejection(
      service.linkClassToSchool('9999', 1066),
      404,
      'School not found.',
    );
  });

  it.each([1949, new Date().getFullYear() + 1])(
    'rejects a startYear of %i',
    async (startYear) => {
      const service = serviceWith({});

      await expectRejection(
        service.bulkLinkClasses('1', startYear),
        400,
        `startYear must be between 1950 and ${new Date().getFullYear()}.`,
      );
    },
  );

  it('links every year in range, oldest last', async () => {
    const linked: number[] = [];
    const service = serviceWith({
      schoolExists: async () => true,
      findClassesInYearRange: async () => [
        { id: 3, year: 2026 },
        { id: 2, year: 1995 },
        { id: 1, year: 1994 },
      ],
      linkClassToSchool: async (classId) => {
        linked.push(classId);
      },
      listSchoolClasses: async () => [],
    });

    await service.bulkLinkClasses('1', 1994);

    expect(linked).toEqual([3, 2, 1]);
  });
});

describe('ClassesService.unlinkClassFromSchool', () => {
  it('removes memberships but keeps the users by default', async () => {
    const order: string[] = [];
    const service = serviceWith(
      {
        isLinked: async () => true,
        deleteClassMemberships: async () => {
          order.push('memberships');
        },
        deleteUsers: async () => {
          order.push('users');
        },
        unlinkClass: async () => {
          order.push('unlink');
        },
      },
      photoUrls,
    );

    await service.unlinkClassFromSchool('1', '1', false);

    expect(order).toEqual(['memberships', 'unlink']);
  });

  /** Photos first, while the rows that identify them still exist. */
  it('sweeps photos and deletes users when cascading', async () => {
    const order: string[] = [];
    const s3 = {
      deleteFolder: async (prefix: string) => {
        order.push(`s3:${prefix}`);
      },
    } as unknown as S3Service;

    const service = new ClassesService(
      {
        isLinked: async () => true,
        findUserIdsInClassAtSchool: async () => [10],
        deleteUsers: async () => {
          order.push('users');
        },
        unlinkClass: async () => {
          order.push('unlink');
        },
      } as unknown as ClassesRepository,
      s3,
    );

    await service.unlinkClassFromSchool('1', '2', true);

    expect(order).toEqual(['s3:photos/1/2/', 'users', 'unlink']);
  });

  it('404s when the class is not linked to that school', async () => {
    const service = serviceWith({ isLinked: async () => false });

    await expectRejection(
      service.unlinkClassFromSchool('2', '1', false),
      404,
      'Class is not linked to this school.',
    );
  });
});

describe('ClassesService.getMembers', () => {
  it('has no membership check — any authenticated caller sees the list', async () => {
    let checked = false;
    const service = serviceWith({
      isClassMember: async () => {
        checked = true;
        return false;
      },
      listMembers: async () => [
        { id: 10, email: 'ada@example.com', first_name: 'Ada', last_name: 'L' },
      ],
    });

    const { members } = await service.getMembers('1');

    expect(members).toHaveLength(1);
    expect(checked).toBe(false);
  });
});
