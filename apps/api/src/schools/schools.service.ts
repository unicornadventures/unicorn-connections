import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { rethrowAsInternal } from '../common/http-errors.js';
import { S3Service } from '../photos/s3.service.js';
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

  constructor(
    private readonly repo: SchoolsRepository,
    private readonly s3: S3Service,
  ) {}

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

  // ---- admin ---------------------------------------------------------------

  async createSchool(
    name?: string,
    location?: string,
    timezone?: string,
  ) {
    try {
      if (!name) {
        throw new BadRequestException({ error: 'School name is required.' });
      }

      // The source wraps this insert in BEGIN/COMMIT, which is not a
      // transaction — see AdminService for why — and would buy nothing around a
      // single statement even if it were.
      return {
        school: await this.repo.createSchool(
          name,
          location || null,
          timezone || null,
        ),
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * A full replace, not a patch: omitting `location` or `timezone` nulls them,
   * unlike the COALESCE updates elsewhere in the app. Only `name` is required.
   */
  async updateSchool(
    schoolId: string,
    name?: string,
    location?: string,
    timezone?: string,
  ) {
    try {
      if (!name) {
        throw new BadRequestException({ error: 'School name is required.' });
      }

      const school = await this.repo.updateSchool(
        schoolId,
        name,
        location || null,
        timezone || null,
      );
      if (!school) {
        throw new NotFoundException({ error: 'School not found.' });
      }

      return { school };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Deletes a school, everyone at it, and all their photos.
   *
   * The most destructive endpoint in the app, and the order matters: S3 objects
   * go first in one prefix sweep, because once the rows are gone there is
   * nothing left to say which keys belonged to this school. Users are deleted
   * explicitly rather than by cascade — they hang off `class_user`, not off
   * `schools`, so dropping the school would orphan them instead.
   *
   * Unlike the per-user delete, an S3 failure here is *not* swallowed: it
   * propagates and the request 500s with the database untouched, which is the
   * recoverable ordering.
   */
  async deleteSchool(schoolId: string) {
    try {
      if (!(await this.repo.findSchool(schoolId))) {
        throw new NotFoundException({ error: 'School not found.' });
      }

      await this.s3.deleteFolder(`photos/${schoolId}/`);

      const userIds = await this.repo.findUserIdsAtSchool(schoolId);
      if (userIds.length > 0) {
        await this.repo.deleteUsers(userIds);
      }

      await this.repo.deleteSchool(schoolId);

      return { message: 'School deleted successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
