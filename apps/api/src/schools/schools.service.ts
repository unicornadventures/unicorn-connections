import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { rethrowAsInternal } from '../common/http-errors.js';
import { SchoolsRepository } from './schools.repository.js';

/**
 * `/api/schools` reads, ported from `lambda/schools.ts`.
 *
 * The write half of that file — create, update, delete — is deployed under
 * `/api/admin/schools` behind an admin check and lands in phase 5 with the rest
 * of AdminModule. Splitting them that way follows the deployed route surface
 * rather than the source's file layout.
 */
@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(private readonly repo: SchoolsRepository) {}

  async listSchools() {
    try {
      return { schools: await this.repo.listSchools() };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async getSchool(schoolId: string) {
    try {
      const school = await this.repo.findSchool(schoolId);
      if (!school) {
        throw new NotFoundException({ error: 'School not found.' });
      }
      return { school };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
