import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { rethrowAsInternal } from '../common/http-errors.js';
import { S3Service } from './s3.service.js';
import {
  PhotosRepository,
  type PhotoType,
  type UserPlacement,
} from './photos.repository.js';

/** A user may keep at most this many gallery photos. */
const GALLERY_LIMIT = 9;

/** Captions are stored in a VARCHAR(255). */
const CAPTION_MAX_LENGTH = 255;

const PHOTO_TYPES: PhotoType[] = ['then', 'now'];

/**
 * `/api/users/:userId/photo/*`, `/api/users/:userId/gallery/*` and
 * `GET /api/photos/presigned`, ported from `lambda/photos.ts`.
 *
 * **No file bytes pass through here.** Every upload is a presigned PUT that the
 * browser performs directly against S3; this service mints the URL and records
 * the key, and that is the whole of its involvement. The Express router had a
 * multer/multipart variant of the same path, but it was never deployed and the
 * frontend never called it — see docs §17.
 *
 * The consequence worth knowing: the database row is written when the URL is
 * *minted*, not when the upload succeeds. A client that asks for a URL and then
 * abandons the upload leaves a key pointing at no object, which is why every
 * read path tolerates a missing object rather than treating it as an error.
 */
@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly repo: PhotosRepository,
    private readonly s3: S3Service,
    private readonly scope: ClassScopeService,
  ) {}

  /**
   * Rejects anything that is not `then` or `now` before the value is used to
   * build a column name. The message is the deployed one — the Express router
   * said 'photoType must be "then" or "now".', which docs §5.4 recorded, but
   * that route is not the one in production (§14).
   */
  private assertPhotoType(
    userId: string,
    photoType: string,
  ): asserts photoType is PhotoType {
    if (!userId || !photoType || !PHOTO_TYPES.includes(photoType as PhotoType)) {
      throw new BadRequestException({
        error: 'Valid userId and photoType (then/now) required.',
      });
    }
  }

  /**
   * `photos/{school}/{class}/{user}-{kind}-{suffix}.jpg`, falling back to an
   * `other/` prefix for a user in no class.
   *
   * The suffix is a base-36 millisecond timestamp, which makes every mint a
   * fresh key: uploading a new "now" photo never overwrites the old object, it
   * just stops being referenced. That orphans the previous object in S3 —
   * nothing sweeps it — which is worth knowing before anyone reasons about
   * storage growth. Faithful to the source.
   */
  private buildKey(
    placement: UserPlacement,
    userId: string,
    kind: string,
  ): string {
    const suffix = Date.now().toString(36);
    return placement.school_id && placement.class_id
      ? `photos/${placement.school_id}/${placement.class_id}/${userId}-${kind}-${suffix}.jpg`
      : `photos/other/${userId}-${kind}-${suffix}.jpg`;
  }

  /** Trimmed, capped, and empty-to-null. */
  private normalizeCaption(caption: unknown): string | null {
    if (typeof caption !== 'string') return null;
    const trimmed = caption.trim();
    return trimmed ? trimmed.slice(0, CAPTION_MAX_LENGTH) : null;
  }

  /** Gallery writes are self-or-admin only — classmates cannot contribute. */
  private assertOwnGallery(
    authUser: AuthUser,
    userId: string,
    message: string,
  ): void {
    if (authUser.id !== parseInt(userId, 10) && !authUser.is_admin) {
      throw new ForbiddenException({ error: message });
    }
  }

  // ---- then/now profile photos -------------------------------------------

  async createPhotoUploadUrl(
    userId: string,
    photoType: string,
    authUser: AuthUser,
  ) {
    try {
      this.assertPhotoType(userId, photoType);

      if (!(await this.scope.canManagePhotos(authUser, parseInt(userId, 10)))) {
        throw new ForbiddenException({
          error: 'You do not have permission to manage this photo.',
        });
      }

      const placement = await this.repo.findPlacement(userId);
      if (!placement) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      const key = this.buildKey(placement, userId, photoType);
      const presignedUrl = await this.s3.presignUpload(key);

      // Recorded now, before the browser has uploaded anything. See the class
      // comment for what that implies.
      await this.repo.setPhotoKey(userId, photoType, key);

      return { presignedUrl, key };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async deletePhoto(userId: string, photoType: string, authUser: AuthUser) {
    try {
      this.assertPhotoType(userId, photoType);

      if (!(await this.scope.canManagePhotos(authUser, parseInt(userId, 10)))) {
        throw new ForbiddenException({
          error: 'You do not have permission to manage this photo.',
        });
      }

      const existing = await this.repo.findPhotoKey(userId, photoType);
      if (!existing) {
        throw new NotFoundException({ error: 'User profile not found.' });
      }

      // A profile with no photo set still answers 200 — clearing nothing is a
      // success, not a 404.
      if (existing.key) {
        await this.s3.deleteObject(existing.key);
      }

      await this.repo.setPhotoKey(userId, photoType, null);

      return { message: 'Photo deleted successfully.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /**
   * Mints a viewing URL for a key the caller names.
   *
   * The deployed handler presigns **anything** — any authenticated user could
   * mint a URL for any object in the bucket if they could name it. That is
   * §9.2 item 6, approved for fixing in §21: the key's owner is now resolved
   * from the database and `canViewPhotos` applied, which is the same rule the
   * gallery listing uses.
   *
   * A key that belongs to nobody and a key the caller may not see both answer
   * 403 with the same message. Distinguishing them would turn this endpoint
   * into an oracle for which keys exist, which is most of what the ownership
   * check is here to prevent.
   */
  async createViewUrl(key: string | undefined, authUser: AuthUser) {
    try {
      if (!key) {
        throw new BadRequestException({ error: 'Photo key required.' });
      }

      const ownerId = await this.repo.findKeyOwner(key);
      const allowed =
        ownerId !== undefined &&
        (await this.scope.canViewPhotos(authUser, ownerId));

      if (!allowed) {
        throw new ForbiddenException({
          error: 'You do not have permission to view this photo.',
        });
      }

      return { presignedUrl: await this.s3.resolve(key) };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  // ---- gallery ------------------------------------------------------------

  async createGalleryUploadUrl(
    userId: string,
    caption: unknown,
    authUser: AuthUser,
  ) {
    try {
      this.assertOwnGallery(
        authUser,
        userId,
        'You can only upload to your own gallery.',
      );

      // Checked before the user is known to exist, so an over-quota id that
      // does not exist reports the limit rather than a 404. Source ordering.
      if ((await this.repo.countGalleryPhotos(userId)) >= GALLERY_LIMIT) {
        throw new BadRequestException({
          error: `Gallery limit of ${GALLERY_LIMIT} photos reached.`,
        });
      }

      const placement = await this.repo.findPlacement(userId);
      if (!placement) {
        throw new NotFoundException({ error: 'User not found.' });
      }

      const key = this.buildKey(placement, userId, 'gallery');
      const presignedUrl = await this.s3.presignUpload(key);

      const id = await this.repo.insertGalleryPhoto(
        userId,
        key,
        this.normalizeCaption(caption),
      );

      return { presignedUrl, key, id };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  /** Viewing is broader than managing: any classmate may look. */
  async listGallery(userId: string, authUser: AuthUser) {
    try {
      if (!(await this.scope.canViewPhotos(authUser, parseInt(userId, 10)))) {
        throw new ForbiddenException({
          error: 'You do not have permission to view this gallery.',
        });
      }

      const rows = await this.repo.listGalleryPhotos(userId);

      const photos = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          url: await this.s3.resolve(row.s3_key),
          caption: row.caption,
          created_at: row.created_at,
        })),
      );

      return { photos };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async updateCaption(
    userId: string,
    photoId: string,
    caption: unknown,
    authUser: AuthUser,
  ) {
    try {
      this.assertOwnGallery(
        authUser,
        userId,
        'You can only edit captions on your own gallery photos.',
      );

      const row = await this.repo.updateGalleryCaption(
        photoId,
        userId,
        this.normalizeCaption(caption),
      );
      if (!row) {
        throw new NotFoundException({ error: 'Photo not found.' });
      }

      return {
        photo: {
          id: row.id,
          url: await this.s3.resolve(row.s3_key),
          caption: row.caption,
          created_at: row.created_at,
        },
      };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }

  async deleteGalleryPhoto(
    userId: string,
    photoId: string,
    authUser: AuthUser,
  ) {
    try {
      this.assertOwnGallery(
        authUser,
        userId,
        'You can only delete your own gallery photos.',
      );

      const row = await this.repo.findGalleryPhoto(photoId, userId);
      if (!row) {
        throw new NotFoundException({ error: 'Photo not found.' });
      }

      // S3 first, then the row. If the delete throws, the row survives and the
      // photo is still listed — better than a row-less object nobody can find.
      await this.s3.deleteObject(row.s3_key);
      await this.repo.deleteGalleryPhoto(photoId);

      return { message: 'Gallery photo deleted.' };
    } catch (error) {
      rethrowAsInternal(error, 'Internal server error.', this.logger);
    }
  }
}
