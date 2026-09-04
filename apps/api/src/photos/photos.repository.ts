import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** Where a user sits, which is what their S3 key path is built from. */
export interface UserPlacement {
  id: number;
  school_id: number | null;
  class_id: number | null;
}

export interface GalleryPhotoRow {
  id: number;
  s3_key: string;
  caption: string | null;
  created_at: Date;
}

/** `'then' | 'now'` — validated in the service before it ever reaches here. */
export type PhotoType = 'then' | 'now';

@Injectable()
export class PhotosRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * `LIMIT 1` over a LEFT JOIN that can match several memberships: a user in
   * two classes gets whichever the planner returns, and their photo lands under
   * that class's prefix. The source's behaviour, and harmless — the key is
   * stored, never recomputed, so a photo stays findable wherever it was put.
   */
  async findPlacement(userId: string): Promise<UserPlacement | undefined> {
    const result = await this.db.query<UserPlacement>(
      `SELECT u.id, cu.school_id, cu.class_id
       FROM users u
       LEFT JOIN class_user cu ON u.id = cu.user_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );
    return result.rows[0];
  }

  /**
   * The `photoType` interpolation is why `PhotoType` is a union rather than a
   * string: it names a column, so it cannot be parameterised. The service
   * rejects anything outside `then`/`now` before this is reached, which is what
   * keeps the interpolation safe.
   */
  async findPhotoKey(
    userId: string,
    photoType: PhotoType,
  ): Promise<{ key: string | null } | undefined> {
    const column = `${photoType}_photo_url`;
    const result = await this.db.query<Record<string, string | null>>(
      `SELECT ${column} FROM profiles WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? { key: row[column] } : undefined;
  }

  async setPhotoKey(
    userId: string,
    photoType: PhotoType,
    key: string | null,
  ): Promise<void> {
    const column = `${photoType}_photo_url`;
    await this.db.query(
      `UPDATE profiles SET ${column} = $1 WHERE user_id = $2`,
      [key, userId],
    );
  }

  /**
   * Which user does this S3 key belong to?
   *
   * Resolved from the database rather than by parsing the key. Keys *look*
   * parseable (`photos/{school}/{class}/{user}-{kind}-{suffix}.jpg`, with an
   * `other/` fallback), but a caller supplies this string, so trusting its
   * shape would mean trusting the caller to name their own owner. Three places
   * can hold a key; a key in none of them has no owner and must be refused.
   */
  async findKeyOwner(key: string): Promise<number | undefined> {
    const result = await this.db.query<{ user_id: number }>(
      `SELECT user_id FROM profiles WHERE then_photo_url = $1 OR now_photo_url = $1
       UNION
       SELECT user_id FROM gallery_photos WHERE s3_key = $1
       LIMIT 1`,
      [key],
    );
    return result.rows[0]?.user_id;
  }

  async countGalleryPhotos(userId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      'SELECT COUNT(*) FROM gallery_photos WHERE user_id = $1',
      [userId],
    );
    return parseInt(result.rows[0].count, 10);
  }

  async insertGalleryPhoto(
    userId: string,
    key: string,
    caption: string | null,
  ): Promise<number> {
    const result = await this.db.query<{ id: number }>(
      'INSERT INTO gallery_photos (user_id, s3_key, caption) VALUES ($1, $2, $3) RETURNING id',
      [userId, key, caption],
    );
    return result.rows[0].id;
  }

  /** Oldest first — a gallery reads as a timeline. */
  async listGalleryPhotos(userId: string): Promise<GalleryPhotoRow[]> {
    const result = await this.db.query<GalleryPhotoRow>(
      'SELECT id, s3_key, caption, created_at FROM gallery_photos WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    );
    return result.rows;
  }

  /** Scoped by `user_id` as well as `id`, so one user cannot edit another's row. */
  async updateGalleryCaption(
    photoId: string,
    userId: string,
    caption: string | null,
  ): Promise<GalleryPhotoRow | undefined> {
    const result = await this.db.query<GalleryPhotoRow>(
      'UPDATE gallery_photos SET caption = $1 WHERE id = $2 AND user_id = $3 RETURNING id, s3_key, caption, created_at',
      [caption, photoId, userId],
    );
    return result.rows[0];
  }

  async findGalleryPhoto(
    photoId: string,
    userId: string,
  ): Promise<{ id: number; s3_key: string } | undefined> {
    const result = await this.db.query<{ id: number; s3_key: string }>(
      'SELECT id, s3_key FROM gallery_photos WHERE id = $1 AND user_id = $2',
      [photoId, userId],
    );
    return result.rows[0];
  }

  async deleteGalleryPhoto(photoId: string): Promise<void> {
    await this.db.query('DELETE FROM gallery_photos WHERE id = $1', [photoId]);
  }
}
