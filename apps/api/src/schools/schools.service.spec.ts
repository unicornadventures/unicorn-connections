import { expectRejection } from '../../test/support/expect-rejection.js';
import { SchoolsService } from './schools.service.js';
import type { SchoolsRepository, SchoolSummary } from './schools.repository.js';

const school: SchoolSummary = {
  id: 1,
  name: 'Springfield High',
  location: 'Springfield',
  timezone: 'America/Chicago',
  created_at: new Date('2024-01-01T00:00:00Z'),
};

function serviceWith(repo: Partial<SchoolsRepository>) {
  return new SchoolsService(repo as SchoolsRepository);
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
