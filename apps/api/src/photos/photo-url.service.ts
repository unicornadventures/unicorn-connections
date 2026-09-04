import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '../config/configuration.js';

/** Matches `lambda/photos.ts` — one hour, long enough for a slideshow to run. */
const URL_TTL_SECONDS = 3600;

/**
 * Turns the S3 keys stored in `profiles.then_photo_url` / `now_photo_url` and
 * `gallery_photos.s3_key` into short-lived presigned GET URLs.
 *
 * This is the whole of `lambda/photos.ts`'s `resolvePhotoUrl`, extracted early
 * because phase 2's read endpoints depend on it: the profile, directory, and
 * slideshow responses all carry resolved URLs rather than raw keys, and
 * returning keys instead would be a silent contract break the frontend renders
 * as broken images. Phase 4 grows this file into the full PhotosModule
 * (uploads, deletes, gallery CRUD, `deleteS3Folder`); the client and bucket
 * configuration here is the part that module will build on.
 *
 * The column names lie: they hold keys, not URLs. Renaming them is a schema
 * change, so the names stay and this comment carries the correction.
 */
@Injectable()
export class PhotoUrlService {
  private readonly storage: StorageConfig;
  private client: S3Client | null = null;

  constructor(config: ConfigService) {
    this.storage = config.get<StorageConfig>('storage')!;
  }

  /**
   * Created lazily and cached. Under Lambda the constructor runs during
   * bootstrap on a cold start, and building an S3 client there would add to the
   * cold-start budget of every request, including the many that never touch a
   * photo.
   */
  private getClient(): S3Client {
    this.client ??= new S3Client({
      region: this.storage.region,
      ...(this.storage.endpoint
        ? { endpoint: this.storage.endpoint, forcePathStyle: true }
        : {}),
    });
    return this.client;
  }

  /** Null in, null out — an unset photo column is normal, not an error. */
  async resolve(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;

    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      { expiresIn: URL_TTL_SECONDS },
    );
  }

  /**
   * Resolves many keys at once. The source does this with an inline
   * `Promise.all` at each call site; having it here keeps the concurrency
   * decision in one place.
   */
  async resolveAll(
    keys: (string | null | undefined)[],
  ): Promise<(string | null)[]> {
    return Promise.all(keys.map((key) => this.resolve(key)));
  }
}
