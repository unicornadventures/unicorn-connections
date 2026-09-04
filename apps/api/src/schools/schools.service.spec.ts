import { expectRejection } from '../../test/support/expect-rejection.js';
import { SchoolsService } from './schools.service.js';
import type { SchoolsRepository, SchoolSummary } from './schools.repository.js';
import type { S3Service } from '../photos/s3.service.js';

const school: SchoolSummary = {
  id: 1,
  name: 'Springfield High',
  location: 'Springfield',
  timezone: 'America/Chicago',
  created_at: new Date('2024-01-01T00:00:00Z'),
};

/** Records prefix sweeps without touching an object store. */
function fakeS3() {
  const sweptPrefixes: string[] = [];
  const service = {
    deleteFolder: async (prefix: string) => {
      sweptPrefixes.push(prefix);
    },
  } as unknown as S3Service;
  return { service, sweptPrefixes };
}

function serviceWith(
  repo: Partial<SchoolsRepository>,
  s3: S3Service = fakeS3().service,
) {
  return new SchoolsService(repo as SchoolsRepository, s3);
}

describe('SchoolsService', () => {
  it('wraps the list in { schools }', async () => {
    const service = serviceWith({ listSchools: async () => [school] });

    await expect(service.listSchools()).resolves.toEqual({ schools: [school] });
  });

  it('wraps a single school in { school }', async () => {
    const service = serviceWith({ findSchool: async () => school });

    await expect(service.getSchool('1')).resolves.toEqual({ school });
  });

  it('404s for an unknown school', async () => {
    const service = serviceWith({ findSchool: async () => undefined });

    await expectRejection(service.getSchool('9999'), 404, 'School not found.');
  });

  it('turns a database failure into the source 500 rather than leaking it', async () => {
    const service = serviceWith({
      listSchools: async () => {
        throw new Error('relation "schools" does not exist');
      },
    });

    await expectRejection(
      service.listSchools(),
      500,
      'Internal server error.',
    );
  });
});

describe('SchoolsService admin writes', () => {
  it('400s creating a school with no name', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createSchool(undefined, 'Somewhere'),
      400,
      'School name is required.',
    );
  });

  it('coerces empty optional fields to null on create', async () => {
    let stored: (string | null)[] = [];
    const service = serviceWith({
      createSchool: async (name, location, timezone) => {
        stored = [name, location, timezone];
        return school;
      },
    });

    await service.createSchool('New School', '', '');

    expect(stored).toEqual(['New School', null, null]);
  });

  /**
   * A full replace, not a patch: omitting a field nulls it. The opposite of the
   * COALESCE updates elsewhere in the app, and the sort of asymmetry a
   * well-meaning refactor would quietly "fix".
   */
  it('nulls omitted fields on update rather than keeping them', async () => {
    let stored: (string | null)[] = [];
    const service = serviceWith({
      updateSchool: async (_id, name, location, timezone) => {
        stored = [name, location, timezone];
        return { ...school, updated_at: new Date() };
      },
    });

    await service.updateSchool('1', 'Renamed');

    expect(stored).toEqual(['Renamed', null, null]);
  });

  it('404s updating an unknown school', async () => {
    const service = serviceWith({ updateSchool: async () => undefined });

    await expectRejection(
      service.updateSchool('9999', 'Ghost'),
      404,
      'School not found.',
    );
  });
});

describe('SchoolsService.deleteSchool', () => {
  /**
   * Order is the whole story: S3 objects go first, while the rows that identify
   * them still exist, then the users, then the school. Users are deleted
   * explicitly because they hang off `class_user`, not off `schools` — a
   * cascade would orphan them instead.
   */
  it('sweeps photos, then users, then the school', async () => {
    const order: string[] = [];
    const s3 = {
      deleteFolder: async (prefix: string) => {
        order.push(`s3:${prefix}`);
      },
    } as unknown as S3Service;

    const service = serviceWith(
      {
        findSchool: async () => school,
        findUserIdsAtSchool: async () => [10, 11],
        deleteUsers: async () => {
          order.push('users');
        },
        deleteSchool: async () => {
          order.push('school');
        },
      },
      s3,
    );

    await service.deleteSchool('1');

    expect(order).toEqual(['s3:photos/1/', 'users', 'school']);
  });

  it('skips the user delete when the school has none', async () => {
    let deleted = false;
    const service = serviceWith({
      findSchool: async () => school,
      findUserIdsAtSchool: async () => [],
      deleteUsers: async () => {
        deleted = true;
      },
      deleteSchool: async () => {},
    });

    await service.deleteSchool('1');

    expect(deleted).toBe(false);
  });

  /**
   * Unlike the per-user delete, an S3 failure here is *not* swallowed — it
   * propagates and the database is left untouched, which is the recoverable
   * ordering.
   */
  it('aborts before touching the database when the sweep fails', async () => {
    let touched = false;
    const s3 = {
      deleteFolder: async () => {
        throw new Error('S3 is down');
      },
    } as unknown as S3Service;

    const service = serviceWith(
      {
        findSchool: async () => school,
        deleteSchool: async () => {
          touched = true;
        },
      },
      s3,
    );

    await expectRejection(
      service.deleteSchool('1'),
      500,
      'Internal server error.',
    );
    expect(touched).toBe(false);
  });

  it('404s for an unknown school', async () => {
    const service = serviceWith({ findSchool: async () => undefined });

    await expectRejection(
      service.deleteSchool('9999'),
      404,
      'School not found.',
    );
  });
});
