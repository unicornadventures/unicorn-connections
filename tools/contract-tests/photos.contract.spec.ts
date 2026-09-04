import type { INestApplication } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { FIXTURE, authAs, closeFixturePool, resetFixture } from './src/fixtures.js';
import { compare, invokeNest, type LegacyHandler } from './src/harness.js';
import { createNestApp } from './src/nest-app.js';

/**
 * Phase 4 parity gate for the seven deployed photo endpoints.
 *
 * These run against a **real S3-compatible store** (a scratch MinIO the harness
 * script starts), not against a mock, because half of what these endpoints do
 * is delete objects. `AWS_ENDPOINT_URL_S3` redirects both implementations to
 * it; see the script for why that particular lever.
 *
 * No multipart anywhere. Every upload here is a presigned PUT the browser
 * performs directly — the API never sees file bytes. The Express router had a
 * multer handler on `POST /:userId/photo/:photoType`, the same method and path
 * as the presigned one below, but it was never deployed and the frontend never
 * called it. See docs §17.
 */
const LEGACY_REPO =
  process.env.LEGACY_REPO ?? `${process.env.HOME}/Code/ClassYear`;

let app: INestApplication;
let legacy: Record<string, LegacyHandler>;

/** Built like the source's: region only, redirected by the environment. */
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_BUCKET_NAME ?? 'classyear-dev';

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  legacy = (await import(
    `${LEGACY_REPO}/backend/src/lambda/photos.ts`
  )) as unknown as Record<string, LegacyHandler>;

  app = await createNestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixturePool();
});

const asActive = () => authAs(FIXTURE.activeUser);
const asAdmin = () => authAs({ ...FIXTURE.adminUser, is_admin: true });
const asOutsider = () => authAs(FIXTURE.outsiderUser);
const asClassAdmin = () =>
  authAs({ ...FIXTURE.classAdminUser, is_class_admin: true });

describe('POST /api/users/:userId/photo/:photoType', () => {
  it('matches — mints a presigned PUT and records the key', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/then`,
      pathParameters: { userId: String(FIXTURE.activeUser.id), photoType: 'then' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
    // Suffix masked by the harness; everything before it is real and compared.
    expect((a as any).body.key).toBe(
      `photos/${FIXTURE.school.id}/${FIXTURE.class.id}/${FIXTURE.activeUser.id}-then-<suffix>.jpg`,
    );
  });

  /**
   * The single most misleading thing in the source: this method and path also
   * exist in the Express router as a multer file upload. What is deployed —
   * and therefore the contract — takes no body at all and returns a URL.
   */
  it('takes no file body; a multipart-shaped request is ignored', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/now`,
      pathParameters: { userId: String(FIXTURE.activeUser.id), photoType: 'now' },
      headers: asActive(),
      body: { file: 'ignored', anything: 'else' },
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
    expect((a as any).body).toHaveProperty('presignedUrl');
  });

  it('falls back to the other/ prefix for a user in no class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: `/api/users/${FIXTURE.adminUser.id}/photo/then`,
      pathParameters: { userId: String(FIXTURE.adminUser.id), photoType: 'then' },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect((a as any).body.key).toBe(
      `photos/other/${FIXTURE.adminUser.id}-then-<suffix>.jpg`,
    );
  });

  it('matches on an invalid photoType', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/sideways`,
      pathParameters: {
        userId: String(FIXTURE.activeUser.id),
        photoType: 'sideways',
      },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 400,
      // The deployed wording, not the Express router's
      // 'photoType must be "then" or "now".' that docs §5.4 recorded.
      body: { error: 'Valid userId and photoType (then/now) required.' },
    });
  });

  it('refuses a stranger', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/then`,
      pathParameters: { userId: String(FIXTURE.activeUser.id), photoType: 'then' },
      headers: asOutsider(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You do not have permission to manage this photo.' },
    });
  });

  it('refuses a class admin from another class', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/then`,
      pathParameters: { userId: String(FIXTURE.activeUser.id), photoType: 'then' },
      headers: asClassAdmin(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });

  it('matches for an unknown user', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.uploadPhotoHandler, {
      method: 'post',
      path: '/api/users/9999/photo/then',
      pathParameters: { userId: '9999', photoType: 'then' },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'User not found.' } });
  });

  /**
   * The minted URL must actually work. Signing correctly but against the wrong
   * bucket, region or key would pass a body comparison and still be useless in
   * production, so this uploads through it and reads the bytes back.
   */
  it('mints a URL that really accepts an upload', async () => {
    await resetFixture();

    const { body } = (await invokeNest(app, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/then`,
      headers: asActive(),
    })) as { body: { presignedUrl: string; key: string } };

    const put = await fetch(body.presignedUrl, {
      method: 'PUT',
      body: Buffer.from('a-real-jpeg-would-go-here'),
      headers: { 'Content-Type': 'image/jpeg' },
    });
    expect(put.status).toBe(200);

    const stored = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: body.key }),
    );
    expect(await stored.Body!.transformToString()).toBe(
      'a-real-jpeg-would-go-here',
    );
  });
});

describe('DELETE /api/users/:userId/photo/:photoType', () => {
  it('matches, and really removes the object', async () => {
    // Seeded by resetFixture, so there is something to delete.
    await resetFixture();
    expect(await objectExists(FIXTURE.activeUser.then_photo_url)).toBe(true);

    const { legacy: a, nest: b } = await compare(app, legacy.deletePhotoHandler, {
      method: 'delete',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/then`,
      pathParameters: { userId: String(FIXTURE.activeUser.id), photoType: 'then' },
      headers: asActive(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'Photo deleted successfully.' },
    });
    // The Nest run was the second of the two, so this is its handiwork.
    expect(await objectExists(FIXTURE.activeUser.then_photo_url)).toBe(false);
  });

  it('succeeds for a profile with no photo set', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deletePhotoHandler, {
      method: 'delete',
      path: `/api/users/${FIXTURE.unclaimedUser.id}/photo/then`,
      pathParameters: {
        userId: String(FIXTURE.unclaimedUser.id),
        photoType: 'then',
      },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('404s when the profile does not exist', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deletePhotoHandler, {
      method: 'delete',
      path: '/api/users/9999/photo/then',
      pathParameters: { userId: '9999', photoType: 'then' },
      headers: asAdmin(),
    });

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 404,
      body: { error: 'User profile not found.' },
    });
  });

  it('refuses a stranger', async () => {
    const { legacy: a, nest: b } = await compare(app, legacy.deletePhotoHandler, {
      method: 'delete',
      path: `/api/users/${FIXTURE.activeUser.id}/photo/then`,
      pathParameters: { userId: String(FIXTURE.activeUser.id), photoType: 'then' },
      headers: asOutsider(),
    });

    expect(b).toEqual(a);
    expect((a as any).status).toBe(403);
  });
});

describe('GET /api/photos/presigned', () => {
  it('matches for a supplied key', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPhotoPresignedUrlHandler,
      {
        method: 'get',
        path: '/api/photos/presigned',
        query: { key: FIXTURE.activeUser.then_photo_url },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('matches on a missing key', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPhotoPresignedUrlHandler,
      { method: 'get', path: '/api/photos/presigned', headers: asActive() },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 400, body: { error: 'Photo key required.' } });
  });

  /**
   * No ownership check at all — any authenticated user can presign any key they
   * can name, including another class's. Deployed behaviour, flagged in §9.2.
   */
  it('presigns a key belonging to someone else, identically', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.getPhotoPresignedUrlHandler,
      {
        method: 'get',
        path: '/api/photos/presigned',
        query: { key: FIXTURE.activeUser.now_photo_url },
        headers: asOutsider(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });
});

describe('GET /api/users/:userId/gallery', () => {
  it('matches, with keys resolved to URLs', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listGalleryPhotosHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.photos).toHaveLength(1);
    expect((a as any).body.photos[0].caption).toBe(FIXTURE.galleryPhoto.caption);
    expect((a as any).body.photos[0].url).toContain(
      FIXTURE.activeUser.gallery_key,
    );
  });

  /**
   * Viewing is broader than managing: any classmate may look, not only class
   * admins. That one missing role check is the whole difference between
   * `canViewPhotos` and `canManagePhotos`.
   */
  it('lets a classmate view', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listGalleryPhotosHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: authAs(FIXTURE.unclaimedUser),
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
  });

  it('refuses someone from another class', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.listGalleryPhotosHandler,
      {
        method: 'get',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asOutsider(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You do not have permission to view this gallery.' },
    });
  });
});

describe('POST /api/users/:userId/gallery', () => {
  it('matches — mints a URL, stores the key and the caption', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.uploadGalleryPhotoHandler,
      {
        method: 'post',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: asActive(),
        body: { caption: '  Graduation day  ' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).status).toBe(200);
    expect((a as any).body.key).toBe(
      `photos/${FIXTURE.school.id}/${FIXTURE.class.id}/${FIXTURE.activeUser.id}-gallery-<suffix>.jpg`,
    );
  });

  it('refuses uploading to someone else’s gallery, classmate or not', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.uploadGalleryPhotoHandler,
      {
        method: 'post',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
        pathParameters: { userId: String(FIXTURE.activeUser.id) },
        headers: authAs(FIXTURE.unclaimedUser),
        body: { caption: 'Not mine' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You can only upload to your own gallery.' },
    });
  });

  it('enforces the nine-photo limit', async () => {
    await resetFixture();
    // One is already seeded; add eight to reach the cap.
    for (let i = 0; i < 8; i += 1) {
      await invokeNest(app, {
        method: 'post',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
        headers: asActive(),
        body: { caption: `Filler ${i}` },
      });
    }

    const overflow = await invokeNest(app, {
      method: 'post',
      path: `/api/users/${FIXTURE.activeUser.id}/gallery`,
      headers: asActive(),
      body: { caption: 'One too many' },
    });

    expect(overflow).toEqual({
      status: 400,
      body: { error: 'Gallery limit of 9 photos reached.' },
    });
  });
});

describe('PUT /api/users/:userId/gallery/:photoId', () => {
  it('matches on a caption edit', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateGalleryCaptionHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery/${FIXTURE.galleryPhoto.id}`,
        pathParameters: {
          userId: String(FIXTURE.activeUser.id),
          photoId: String(FIXTURE.galleryPhoto.id),
        },
        headers: asActive(),
        body: { caption: '  Trimmed caption  ' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.photo.caption).toBe('Trimmed caption');
  });

  it('stores an empty caption as null', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateGalleryCaptionHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery/${FIXTURE.galleryPhoto.id}`,
        pathParameters: {
          userId: String(FIXTURE.activeUser.id),
          photoId: String(FIXTURE.galleryPhoto.id),
        },
        headers: asActive(),
        body: { caption: '   ' },
      },
    );

    expect(b).toEqual(a);
    expect((a as any).body.photo.caption).toBeNull();
  });

  it('404s for a photo belonging to someone else', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateGalleryCaptionHandler,
      {
        method: 'put',
        // Admin may act on any gallery, but this photo is not user 13's, so the
        // `AND user_id = $3` in the UPDATE matches nothing.
        path: `/api/users/${FIXTURE.outsiderUser.id}/gallery/${FIXTURE.galleryPhoto.id}`,
        pathParameters: {
          userId: String(FIXTURE.outsiderUser.id),
          photoId: String(FIXTURE.galleryPhoto.id),
        },
        headers: asAdmin(),
        body: { caption: 'Nope' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Photo not found.' } });
  });

  it('refuses a caption edit on someone else’s gallery', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.updateGalleryCaptionHandler,
      {
        method: 'put',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery/${FIXTURE.galleryPhoto.id}`,
        pathParameters: {
          userId: String(FIXTURE.activeUser.id),
          photoId: String(FIXTURE.galleryPhoto.id),
        },
        headers: asOutsider(),
        body: { caption: 'Vandalised' },
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: {
        error: 'You can only edit captions on your own gallery photos.',
      },
    });
  });
});

describe('DELETE /api/users/:userId/gallery/:photoId', () => {
  it('matches, and really removes the object', async () => {
    await resetFixture();
    expect(await objectExists(FIXTURE.activeUser.gallery_key)).toBe(true);

    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteGalleryPhotoHandler,
      {
        method: 'delete',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery/${FIXTURE.galleryPhoto.id}`,
        pathParameters: {
          userId: String(FIXTURE.activeUser.id),
          photoId: String(FIXTURE.galleryPhoto.id),
        },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 200,
      body: { message: 'Gallery photo deleted.' },
    });
    expect(await objectExists(FIXTURE.activeUser.gallery_key)).toBe(false);
  });

  it('404s for an unknown photo', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteGalleryPhotoHandler,
      {
        method: 'delete',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery/9999`,
        pathParameters: {
          userId: String(FIXTURE.activeUser.id),
          photoId: '9999',
        },
        headers: asActive(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({ status: 404, body: { error: 'Photo not found.' } });
  });

  it('refuses deleting from someone else’s gallery', async () => {
    const { legacy: a, nest: b } = await compare(
      app,
      legacy.deleteGalleryPhotoHandler,
      {
        method: 'delete',
        path: `/api/users/${FIXTURE.activeUser.id}/gallery/${FIXTURE.galleryPhoto.id}`,
        pathParameters: {
          userId: String(FIXTURE.activeUser.id),
          photoId: String(FIXTURE.galleryPhoto.id),
        },
        headers: asOutsider(),
      },
    );

    expect(b).toEqual(a);
    expect(a).toEqual({
      status: 403,
      body: { error: 'You can only delete your own gallery photos.' },
    });
  });
});
