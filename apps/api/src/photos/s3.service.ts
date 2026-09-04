import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '../config/configuration.js';

/** Matches `lambda/photos.ts` — one hour, long enough for a slideshow to run. */
const URL_TTL_SECONDS = 3600;

/** Everything the app stores is a JPEG, per the source's hardcoded type. */
const UPLOAD_CONTENT_TYPE = 'image/jpeg';

/**
 * The app's entire S3 surface.
 *
 * Phase 2 introduced this as `PhotoUrlService` with only `resolve` on it,
 * because the profile, directory and slideshow endpoints all return presigned
 * GET URLs and shipping raw S3 keys would have been a silent contract break.
 * Phase 4 grows it into the whole thing rather than adding a second client
 * beside it — one bucket, one region, one place where addressing style is
 * decided.
 *
 * **The app never handles file bytes.** Uploads are presigned PUTs that the
 * browser performs directly against S3; the API only mints the URL and records
 * the key. See docs §17 for why that makes the multipart question moot.
 */
@Injectable()
export class S3Service {
  private readonly storage: StorageConfig;
  private client: S3Client | null = null;

  constructor(config: ConfigService) {
    this.storage = config.get<StorageConfig>('storage')!;
  }

  get bucket(): string {
    return this.storage.bucket;
  }

  /**
   * Created lazily and cached. Under Lambda the constructor runs during
   * bootstrap on a cold start, and building an S3 client there would add to the
   * cold-start budget of every request, including the many that never touch a
   * photo.
   *
   * When `S3_ENDPOINT` is unset this is `new S3Client({ region })` and nothing
   * more — identical to the source's construction, which matters because the
   * contract tests redirect *both* implementations with the SDK's standard
   * `AWS_ENDPOINT_URL_S3` variable and any extra configuration here would make
   * the two address the store differently.
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
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
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

  /**
   * A URL the browser can PUT a JPEG to. The object does not exist yet — the
   * key is recorded in the database at the same moment, so a client that mints
   * a URL and never uploads leaves a row pointing at nothing. That is the
   * source's behaviour and the reason `resolve` tolerates missing objects.
   */
  async presignUpload(key: string): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: UPLOAD_CONTENT_TYPE,
      }),
      { expiresIn: URL_TTL_SECONDS },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Deletes every object under a prefix, a page at a time.
   *
   * No consumer in phase 4 — it exists because phase 5's "delete a school" and
   * "unlink a class with cascade" sweep whole photo prefixes, and it is part of
   * this file in the source. Ported here so the S3 surface stays in one place
   * rather than half of it appearing in AdminModule later.
   */
  async deleteFolder(prefix: string): Promise<void> {
    const client = this.getClient();
    let continuationToken: string | undefined;

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const objects = listed.Contents ?? [];
      if (objects.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: objects.map((object) => ({ Key: object.Key! })),
              Quiet: true,
            },
          }),
        );
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }
}
