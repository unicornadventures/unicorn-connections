import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { isValidAvatarColor } from '../common/avatar-colors.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { PhotoUrlService } from '../photos/photo-url.service.js';
import {
  UsersRepository,
  type UserWithProfileRow,
} from './users.repository.js';
import type { UpdateProfileDto, UserProfileResponse } from './dto/user.dto.js';

const DEFAULT_PAGE_SIZE = 20;

/**
 * `/api/users`, ported from `lambda/users.ts`.
 *
 * Path parameters stay **strings** all the way into the SQL, as they do in the
 * source. Coercing them with ParseIntPipe would look tidier and would change
 * behaviour: `GET /api/users/abc` currently reaches Postgres, fails on
 * `invalid input syntax for type integer`, and answers 500. A pipe would answer
 * 400 with Nest's wording instead. The 500 is not good, but it is the contract,
 * and §9 is where changing it gets argued.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repo: UsersRepository,
    private readonly photoUrls: PhotoUrlService,
  ) {}

  /**
   * Builds the `{ user, profile }` body both read and update return, resolving
   * the two photo keys to presigned URLs.
   *
   * `tags` falls back to `[]` because the LEFT JOIN yields null for a user with
   * no profile row at all, and the frontend maps over this field unguarded.
   */
  private async toProfileResponse(
    row: UserWithProfileRow,
  ): Promise<UserProfileResponse> {
    const [thenUrl, nowUrl] = await this.photoUrls.resolveAll([
      row.then_photo_url,
      row.now_photo_url,
    ]);

    return {
      user: {
        user_id: row.id,
        email: row.email,
        is_admin: row.is_admin,
        is_class_admin: row.is_class_admin,
      },
      profile: {
        first_name: row.first_name,
        last_name: row.last_name,
        nickname: row.nickname,
        former_first_name: row.former_first_name,
        former_last_name: row.former_last_name,
        bio: row.bio,
        then_photo_url: thenUrl,
        now_photo_url: nowUrl,
        avatar_color: row.avatar_color,
        tags: row.tags || [],
      },
    };
  }

  /**
   * Any authenticated user can read any other user's profile. That is the
   * deployed behaviour — the Express route had an `?requesterId=` same-class
   * check, but it was opt-in (omitting the parameter skipped it entirely) and
   * has no deployed counterpart, so it protected nothing. Real profile scoping
   * belongs with the §9.2 requesterId work, not smuggled in here.
   */
  async getProfile(userId: string): Promise<UserProfileResponse> {
    try {
      const row = await this.repo.findUserWithProfile(userId);
      if (!row) {
        throw new NotFoundException({ error: 'User not found.' });
      }
      return await this.toProfileResponse(row);
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async getUserClass(userId: string) {
    try {
      const row = await this.repo.findUserClass(userId);
      if (!row) {
        throw new NotFoundException({ error: 'User not in any class.' });
      }
      return { class: row };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Unfiltered, unscoped list of every user in the system, available to any
   * authenticated caller. Flagged rather than fixed: it is deployed as
   * `GET /api/users`, so narrowing it is a §9.2 decision, not a port decision.
   * Nothing in the frontend calls it.
   */
  async listUsers(page?: string, pageSize?: string) {
    try {
      const pageNum = parseInt(page || '1', 10);
      const size = parseInt(pageSize || String(DEFAULT_PAGE_SIZE), 10);
      const offset = (pageNum - 1) * size;

      const [total, users] = await Promise.all([
        this.repo.countUsers(),
        this.repo.listUsers(size, offset),
      ]);

      return { users, total, page: pageNum, pageSize: size };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Checks run in the source's order, which is load-bearing: authorization
   * before validation, so a stranger poking at someone else's profile gets 403
   * rather than a 400 that confirms the field names.
   */
  async updateProfile(
    userId: string,
    body: UpdateProfileDto,
    authUser: AuthUser,
  ): Promise<UserProfileResponse> {
    try {
      if (authUser.id !== parseInt(userId, 10) && !authUser.is_admin) {
        throw new ForbiddenException({
          error: 'You can only edit your own profile.',
        });
      }

      const { avatar_color, email } = body;

      if (
        avatar_color !== undefined &&
        avatar_color !== null &&
        !isValidAvatarColor(avatar_color)
      ) {
        throw new BadRequestException({ error: 'Invalid avatar color.' });
      }

      // Falsy rather than undefined: the source treats an empty-string email as
      // "not provided" and skips the update, so '' cannot blank out an address.
      if (email) {
        const normalized = email.toLowerCase().trim();
        if (await this.repo.isEmailTaken(normalized, userId)) {
          // 400, not the 409 the Express route used. Deployed wins (§14).
          throw new BadRequestException({ error: 'Email already in use.' });
        }
        await this.repo.updateEmail(userId, normalized);
      }

      await this.repo.updateProfile(userId, body);

      if (avatar_color !== undefined) {
        await this.repo.updateAvatarColor(userId, avatar_color);
      }

      // Deliberately re-read rather than using RETURNING: the write is split
      // across up to three statements, and this is the source's own way of
      // guaranteeing the response reflects all of them.
      const row = await this.repo.findUserWithProfile(userId);
      if (!row) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      return await this.toProfileResponse(row);
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
