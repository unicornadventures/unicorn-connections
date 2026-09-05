import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { AuthUser } from '../common/auth-user.js';
import { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { encodeRegistrationHash } from '../common/registration-link.js';
import { S3Service } from '../photos/s3.service.js';
import { AdminRepository } from './admin.repository.js';
import type {
  ImportUsersDto,
  RosterEntryDto,
  SkippedRow,
  UpdateAdminProfileDto,
} from './dto/admin.dto.js';

const BCRYPT_ROUNDS = 10;

/** One CSV upload may not exceed this many rows. */
const MAX_IMPORT_ROWS = 500;

/** Admin-minted set-password links last a week, not the usual hour. */
const PASSWORD_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_ROSTER_PAGE_SIZE = 10;

/**
 * `/api/admin`, ported from `lambda/admin.ts`.
 *
 * **On transactions.** Two of these handlers wrap their writes in
 * `BEGIN`/`COMMIT` in the source, and those are not transactions: `db.ts`'s
 * `query()` calls `pool.query()`, which checks out an arbitrary idle client per
 * statement, so the `BEGIN` and the `UPDATE` can land on different connections.
 * They are genuinely atomic here, via `DatabaseService.withTransaction` (§21).
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly repo: AdminRepository,
    private readonly scope: ClassScopeService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
  ) {}

  private frontendUrl(): string {
    return this.config.get<string>('frontendUrl')!;
  }

  private async assertCanManage(
    authUser: AuthUser,
    targetUserId: number,
  ): Promise<void> {
    if (!(await this.scope.canManageUser(authUser, targetUserId))) {
      throw new ForbiddenException({
        error: 'Access denied. You can only manage users in your class.',
      });
    }
  }

  async listUsers() {
    try {
      return { users: await this.repo.listAllUsers() };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * The class roster, paginated and optionally filtered by last-name prefix.
   * Page size defaults to 10 here, not the 20 that `GET /api/users` uses —
   * different endpoint, different default, both deployed.
   */
  async listClassUsers(classId: string, query: Record<string, string> = {}) {
    try {
      const page = parseInt(query.page || '1', 10);
      const pageSize = parseInt(
        query.pageSize || String(DEFAULT_ROSTER_PAGE_SIZE),
        10,
      );
      const lastName = (query.lastName || '').trim();
      const offset = (page - 1) * pageSize;

      const [total, users] = await Promise.all([
        this.repo.countClassUsers(classId, lastName),
        this.repo.listClassUsers(classId, lastName, pageSize, offset),
      ]);

      return { users, total, page, pageSize };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async setClassAdmin(userId: string, isClassAdmin: unknown) {
    try {
      if (!userId || isClassAdmin === undefined) {
        throw new BadRequestException({ error: 'Missing required fields.' });
      }

      const userIdNum = parseInt(userId);

      if (!(await this.repo.userExists(userIdNum))) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      return {
        user: await this.repo.setClassAdmin(
          userIdNum,
          isClassAdmin as boolean,
        ),
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Deletes a user and their profile photos.
   *
   * S3 failures are logged and swallowed — an object that will not delete must
   * not block removing the account. The database delete cascades to the
   * profile, comments, memberships and tokens.
   *
   * Sweeps the gallery as well as the two profile photos (known-bugs #11). The
   * source swept only the profile photos, so a deleted user's gallery uploads
   * stayed in the bucket forever with no row left to identify them.
   */
  async deleteUser(userId: string, authUser: AuthUser) {
    try {
      const userIdNum = parseInt(userId);

      // Existence before authorization, so a missing user reports 404 whoever
      // is asking.
      if (!(await this.repo.userExists(userIdNum))) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      await this.assertCanManage(authUser, userIdNum);

      for (const key of await this.repo.findAllPhotoKeys(userIdNum)) {
        try {
          await this.s3.deleteObject(key);
        } catch (error) {
          // Still swallowed: an object that will not delete must not make an
          // account undeletable.
          this.logger.error(`Failed to delete S3 object ${key}`, error as Error);
        }
      }

      await this.repo.deleteUser(userIdNum);

      return { message: 'User deleted successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Name fields and the deceased flag.
   *
   * Note there is no up-front admin check: the route is behind nothing stronger
   * than a valid token, and `canManageUser` is what actually gates it. An
   * ordinary user reaches the 403 rather than being turned away earlier, so the
   * validation errors below are visible to any authenticated caller.
   */
  async updateUserProfile(
    userId: string,
    body: UpdateAdminProfileDto,
    authUser: AuthUser,
  ) {
    try {
      const { is_deceased, first_name, last_name } = body;

      if (!userId || typeof is_deceased !== 'boolean') {
        throw new BadRequestException({ error: 'Missing required fields.' });
      }
      if (!first_name || !last_name) {
        throw new BadRequestException({
          error: 'Missing required fields: first_name and last_name.',
        });
      }

      const userIdNum = parseInt(userId);

      if (!(await this.repo.userExists(userIdNum))) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      await this.assertCanManage(authUser, userIdNum);

      const former_first_name = body.former_first_name || null;
      const former_last_name = body.former_last_name || null;

      const user = await this.repo.setDeceasedAndNames(userIdNum, is_deceased, {
        first_name,
        last_name,
        former_first_name,
        former_last_name,
      });

      // Echoes back what was sent rather than re-reading, which is the
      // source's shape.
      return {
        user: {
          ...user,
          first_name,
          last_name,
          former_first_name,
          former_last_name,
        },
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Hashes a random password for a roster entry that has an email.
   *
   * An entry with no email gets a null password and stays unclaimed until
   * `POST /api/auth/claim-account` fills both in. One with an email gets a
   * password nobody knows — deliberately: the admin then mints a set-password
   * link, and a hash of random bytes is safer than a placeholder somebody might
   * guess.
   */
  private async passwordFor(email: string | null): Promise<string | null> {
    if (!email) return null;
    return bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  }

  async createRosterUser(
    schoolId: string,
    classId: string,
    body: RosterEntryDto,
  ) {
    try {
      if (!schoolId || !classId) {
        throw new BadRequestException({
          error: 'schoolId and classId required.',
        });
      }
      if (!body?.first_name?.trim() || !body?.last_name?.trim()) {
        throw new BadRequestException({
          error: 'first_name and last_name are required.',
        });
      }

      const email = body.email?.trim().toLowerCase() || null;

      if (email && (await this.repo.findUserIdByEmail(email))) {
        throw new ConflictException({
          error: 'A user with this email already exists.',
        });
      }

      const user = await this.repo.createRosterUser(
        { ...body, email },
        await this.passwordFor(email),
        classId,
        schoolId,
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          first_name: body.first_name,
          last_name: body.last_name,
          is_deceased: user.is_deceased,
        },
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Bulk roster import — the CSV path, though the parsing happens client-side
   * and this receives a JSON array.
   *
   * Rows are processed **one at a time and independently**: a bad row is
   * skipped with a reason and the rest still land. That is why there is no
   * transaction around the loop, and why each row's failure is caught
   * individually. The response is `{ created: <count>, skipped: [...] }`, so
   * the client can show which rows did not make it and why.
   */
  async importUsers(
    schoolId: string,
    classId: string,
    body: ImportUsersDto,
  ) {
    try {
      if (!schoolId || !classId) {
        throw new BadRequestException({
          error: 'schoolId and classId required.',
        });
      }

      const users = body?.users;
      if (!Array.isArray(users) || users.length === 0) {
        throw new BadRequestException({ error: 'users array is required.' });
      }
      if (users.length > MAX_IMPORT_ROWS) {
        throw new BadRequestException({
          error: `Maximum ${MAX_IMPORT_ROWS} users per import.`,
        });
      }

      const created: { first_name: string; last_name: string }[] = [];
      const skipped: SkippedRow[] = [];

      for (const [index, entry] of users.entries()) {
        const { first_name, last_name } = entry;

        if (!first_name?.trim() || !last_name?.trim()) {
          // No name to identify the row by, so it is reported by position.
          skipped.push({
            index,
            name: `Row ${index + 1}`,
            reason: 'Missing first or last name',
          });
          continue;
        }

        const email = entry.email?.trim().toLowerCase() || null;

        try {
          if (email && (await this.repo.findUserIdByEmail(email))) {
            skipped.push({
              index,
              name: `${first_name} ${last_name}`,
              reason: 'Email already exists',
            });
            continue;
          }

          await this.repo.createRosterUser(
            { ...entry, email },
            await this.passwordFor(email),
            classId,
            schoolId,
          );

          created.push({
            first_name: first_name.trim(),
            last_name: last_name.trim(),
          });
        } catch {
          // Deliberately opaque: the source reports 'Database error' for any
          // per-row failure rather than leaking a constraint name to the client.
          skipped.push({
            index,
            name: `${first_name} ${last_name}`,
            reason: 'Database error',
          });
        }
      }

      return { created: created.length, skipped };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * A shareable registration URL for one class at one school.
   *
   * The hash is an *encoding*, not a signature — see `registration-link.ts`.
   * The class-in-school check here is what stops a link naming a pair that was
   * never linked; the endpoint that consumes the hash re-checks it too.
   */
  async createRegistrationLink(classId?: number, schoolId?: number) {
    try {
      if (!classId || !schoolId) {
        throw new BadRequestException({
          error: 'Missing required fields: classId and schoolId.',
        });
      }

      const klass = await this.repo.findClassInSchool(
        String(classId),
        String(schoolId),
      );
      if (!klass) {
        throw new NotFoundException({ error: 'Class not found.' });
      }

      const hash = encodeRegistrationHash(schoolId, classId);

      return {
        hash,
        registrationUrl: `${this.frontendUrl()}/register/${hash}`,
        class: klass,
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * A set-password link an admin can hand to a user who has never logged in.
   *
   * Reuses the password-reset token table and the reset-password page, but with
   * a seven-day expiry rather than an hour — it is an invitation, not a
   * response to a forgotten password. Any outstanding token for the user is
   * replaced, so minting a second link invalidates the first.
   */
  async createPasswordLink(userId: string) {
    try {
      const user = await this.repo.findUserEmail(userId);
      if (!user) {
        throw new NotFoundException({ error: 'User not found.' });
      }
      if (!user.email) {
        throw new BadRequestException({
          error:
            'User has no email on file and cannot log in. Add an email first.',
        });
      }

      await this.repo.deletePasswordResetTokens(userId);

      const token = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + PASSWORD_LINK_TTL_MS);

      await this.repo.insertPasswordResetToken(userId, hash, expiresAt);

      return {
        passwordSetupUrl: `${this.frontendUrl()}/reset-password?token=${token}`,
        expiresAt,
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async moveUserClass(userId: string, classId: unknown) {
    try {
      if (!classId) {
        throw new BadRequestException({ error: 'class_id is required.' });
      }

      const userIdNum = parseInt(userId);
      const classIdNum = parseInt(String(classId));

      if (!(await this.repo.userExists(userIdNum))) {
        throw new NotFoundException({ error: 'User not found.' });
      }
      if (!(await this.repo.classExists(classIdNum))) {
        throw new NotFoundException({ error: 'Class not found.' });
      }

      if ((await this.repo.findCurrentClassId(userIdNum)) === classIdNum) {
        throw new BadRequestException({
          error: 'User is already in that class.',
        });
      }

      await this.repo.moveUserToClass(userIdNum, classIdNum);

      return { message: 'User moved to new class successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
