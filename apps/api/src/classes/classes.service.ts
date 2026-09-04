import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { S3Service } from '../photos/s3.service.js';
import { ClassesRepository } from './classes.repository.js';

/** Class years are seeded from this year forward; nothing older can be linked. */
const EARLIEST_CLASS_YEAR = 1950;

/**
 * `/api/classes` plus `GET /api/schools/:schoolId/classes`, ported from
 * `lambda/classes.ts`.
 *
 * The admin half of that file — linking, bulk-linking and unlinking class years
 * — is deployed under `/api/admin/schools/…` and belongs to phase 5.
 */
@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);

  constructor(
    private readonly repo: ClassesRepository,
    private readonly s3: S3Service,
  ) {}

  /**
   * Membership check for the two class-scoped reads.
   *
   * Identity comes from the token, never from a query parameter. The Express
   * routes took `?userId=` and checked *that* id against the class, so anyone
   * could read any directory by passing a member's id; the deployed handlers
   * use `authUser.id`, which is why they are the reference (docs §14). The
   * frontend still sends `?userId=`, harmlessly — it is ignored here.
   *
   * Admins bypass the check entirely, as they do in the source.
   */
  private async assertClassAccess(
    authUser: AuthUser,
    classId: string,
  ): Promise<void> {
    if (authUser.is_admin) return;

    if (!(await this.repo.isClassMember(authUser.id, classId))) {
      throw new ForbiddenException({
        error: 'Access denied. You are not in this class.',
      });
    }
  }

  async listAllClasses() {
    try {
      return { classes: await this.repo.listAllClasses() };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async getClass(classId: string) {
    try {
      const found = await this.repo.findClass(classId);
      if (!found) {
        throw new NotFoundException({ error: 'Class not found.' });
      }
      return { class: found };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Lists a school's class years, and links the current year on the way past.
   *
   * That write-on-read is odd but deliberate in the source: class years are
   * seeded 1950→current at schema time, so without it every school silently
   * stops offering the new year each January until someone links it by hand.
   * Two conditions keep it from creating rows for schools nobody has set up —
   * it only fires when the school already has at least one linked year, and the
   * insert is ON CONFLICT DO NOTHING so concurrent requests cannot duplicate.
   *
   * Note there is no "school exists" check: an unknown schoolId returns an
   * empty list, not a 404. The Express route did check; the deployed one does
   * not, and deployed wins.
   */
  async listSchoolClasses(schoolId: string) {
    try {
      const currentYear = new Date().getFullYear();

      if (!(await this.repo.isYearLinkedToSchool(schoolId, currentYear))) {
        if (await this.repo.hasAnyLinkedClass(schoolId)) {
          const classId = await this.repo.findClassIdByYear(currentYear);
          if (classId !== undefined) {
            await this.repo.linkClassToSchool(classId, schoolId);
          }
        }
      }

      return { classes: await this.repo.listSchoolClasses(schoolId) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Any authenticated user can list any class's members. Unlike the directory
   * below there is no membership check — the deployed handler has none. The
   * payload is limited to names and emails, which is presumably why, though
   * "presumably" is doing work there; it is flagged in docs §9.2 rather than
   * tightened here.
   */
  async getMembers(classId: string) {
    try {
      return { members: await this.repo.listMembers(classId) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async getDirectory(classId: string, authUser: AuthUser) {
    try {
      await this.assertClassAccess(authUser, classId);

      const rows = await this.repo.listDirectory(classId);

      const users = await Promise.all(
        rows.map(async (row) => {
          const [nowUrl, thenUrl] = await this.s3.resolveAll([
            row.now_photo_url,
            row.then_photo_url,
          ]);
          return { ...row, now_photo_url: nowUrl, then_photo_url: thenUrl };
        }),
      );

      return { users };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Every photo belonging to the class, flattened for the slideshow: each
   * member's then and now shots followed by their gallery uploads.
   *
   * Keys that fail to resolve are dropped rather than returned as nulls, so the
   * slideshow never has to render a hole.
   */
  async getPhotos(classId: string, authUser: AuthUser) {
    try {
      await this.assertClassAccess(authUser, classId);

      const [profiles, gallery] = await Promise.all([
        this.repo.listMemberProfilePhotoKeys(classId),
        this.repo.listMemberGalleryKeys(classId),
      ]);

      const keys: { key: string; userId: number }[] = [];
      for (const row of profiles) {
        if (row.then_photo_url) {
          keys.push({ key: row.then_photo_url, userId: row.user_id });
        }
        if (row.now_photo_url) {
          keys.push({ key: row.now_photo_url, userId: row.user_id });
        }
      }
      for (const row of gallery) {
        keys.push({ key: row.s3_key, userId: row.user_id });
      }

      const photos = (
        await Promise.all(
          keys.map(async (entry) => ({
            url: await this.s3.resolve(entry.key),
            userId: entry.userId,
          })),
        )
      ).filter((photo) => !!photo.url);

      return { photos };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  // ---- admin ---------------------------------------------------------------

  /**
   * Links one existing class year to a school.
   *
   * Classes are global — `schema.ts` seeds one row per year from 1950 to the
   * current year — so this creates a `class_school` row rather than a class.
   * The body carries a `year`, not a class id, and the year must already exist.
   */
  async linkClassToSchool(schoolId: string, year?: number) {
    try {
      if (!schoolId || !year) {
        throw new BadRequestException({
          error: 'School ID and year are required.',
        });
      }

      if (!(await this.repo.schoolExists(schoolId))) {
        throw new NotFoundException({ error: 'School not found.' });
      }

      const klass = await this.repo.findClassByYear(year);
      if (!klass) {
        throw new NotFoundException({ error: `Class year ${year} not found.` });
      }

      if (await this.repo.isLinked(String(klass.id), schoolId)) {
        throw new ConflictException({
          error: `Class year ${year} is already linked to this school.`,
        });
      }

      await this.repo.linkClass(klass.id, schoolId);

      return { class: klass };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Links every year from `startYear` to the current one — how a new school is
   * set up in a single call rather than seventy.
   *
   * Idempotent: each insert is ON CONFLICT DO NOTHING, so re-running it after
   * adding a year links only the gap. Returns the school's full class list
   * afterwards, not just the newly linked ones.
   */
  async bulkLinkClasses(schoolId: string, startYear?: number) {
    try {
      const currentYear = new Date().getFullYear();

      if (!schoolId) {
        throw new BadRequestException({ error: 'School ID required.' });
      }
      if (!startYear || startYear < EARLIEST_CLASS_YEAR || startYear > currentYear) {
        throw new BadRequestException({
          error: `startYear must be between ${EARLIEST_CLASS_YEAR} and ${currentYear}.`,
        });
      }

      if (!(await this.repo.schoolExists(schoolId))) {
        throw new NotFoundException({ error: 'School not found.' });
      }

      const classes = await this.repo.findClassesInYearRange(
        startYear,
        currentYear,
      );

      // Sequential rather than Promise.all: the source does it in a loop, and a
      // burst of seventy inserts would contend for pool connections with every
      // other request in flight.
      for (const klass of classes) {
        await this.repo.linkClassToSchool(klass.id, schoolId);
      }

      return { classes: await this.repo.listSchoolClasses(schoolId) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Unlinks a class year from a school, optionally deleting its members.
   *
   * `?cascadeUsers=true` deletes every user in that class at that school along
   * with their photos; without it the users survive and only their memberships
   * go. The flag is a query parameter on a DELETE, which is easy to omit by
   * accident — but omitting it is the *safe* direction, so the default is
   * benign.
   *
   * The class row itself is never deleted, only the link: other schools may
   * share the year.
   */
  async unlinkClassFromSchool(
    schoolId: string,
    classId: string,
    cascadeUsers: boolean,
  ) {
    try {
      if (!(await this.repo.isLinked(classId, schoolId))) {
        throw new NotFoundException({
          error: 'Class is not linked to this school.',
        });
      }

      if (cascadeUsers) {
        // Photos first, while the rows that identify them still exist.
        await this.s3.deleteFolder(`photos/${schoolId}/${classId}/`);

        const userIds = await this.repo.findUserIdsInClassAtSchool(
          classId,
          schoolId,
        );
        if (userIds.length > 0) {
          await this.repo.deleteUsers(userIds);
        }
      } else {
        await this.repo.deleteClassMemberships(classId, schoolId);
      }

      await this.repo.unlinkClass(classId, schoolId);

      return { message: 'Class unlinked from school successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
