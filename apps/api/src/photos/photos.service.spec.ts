import type { AuthUser } from '../common/auth-user.js';
import type { ClassScopeService } from '../common/class-scope/class-scope.service.js';
import { expectRejection } from '../../test/support/expect-rejection.js';
import { PhotosService } from './photos.service.js';
import type { PhotosRepository } from './photos.repository.js';
import type { S3Service } from './s3.service.js';

const asUser = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 10,
  email: 'ada@example.com',
  is_admin: false,
  is_class_admin: false,
  ...over,
});

/** Records what was asked of S3 without talking to one. */
function fakeS3() {
  const deleted: string[] = [];
  const presigned: string[] = [];
  const service = {
    resolve: async (key: string | null) => (key ? `signed:${key}` : null),
    resolveAll: async (keys: (string | null)[]) =>
      keys.map((k) => (k ? `signed:${k}` : null)),
    presignUpload: async (key: string) => {
      presigned.push(key);
      return `put:${key}`;
    },
    deleteObject: async (key: string) => {
      deleted.push(key);
    },
  } as unknown as S3Service;
  return { service, deleted, presigned };
}

const scopeAllowing = (over: Partial<Record<string, boolean>> = {}) =>
  ({
    canManagePhotos: async () => over.manage ?? true,
    canViewPhotos: async () => over.view ?? true,
  }) as unknown as ClassScopeService;

function serviceWith(
  repo: Partial<PhotosRepository>,
  s3: S3Service = fakeS3().service,
  scope: ClassScopeService = scopeAllowing(),
) {
  return new PhotosService(repo as PhotosRepository, s3, scope);
}

const placement = { id: 10, school_id: 1, class_id: 1 };

describe('PhotosService key generation', () => {
  it('builds a school/class-scoped key', async () => {
    const s3 = fakeS3();
    const service = serviceWith(
      { findPlacement: async () => placement, setPhotoKey: async () => {} },
      s3.service,
    );

    const { key } = await service.createPhotoUploadUrl('10', 'then', asUser());

    expect(key).toMatch(/^photos\/1\/1\/10-then-[0-9a-z]+\.jpg$/);
    expect(s3.presigned).toEqual([key]);
  });

  it('falls back to other/ for a user in no class', async () => {
    const service = serviceWith({
      findPlacement: async () => ({ id: 10, school_id: null, class_id: null }),
      setPhotoKey: async () => {},
    });

    const { key } = await service.createPhotoUploadUrl('10', 'now', asUser());

    expect(key).toMatch(/^photos\/other\/10-now-[0-9a-z]+\.jpg$/);
  });

  /**
   * A fresh suffix per mint means a new upload never overwrites the previous
   * object — it just stops being referenced. Worth pinning: it is why storage
   * grows and why nothing is ever clobbered.
   */
  it('mints a different key each time', async () => {
    const service = serviceWith({
      findPlacement: async () => placement,
      setPhotoKey: async () => {},
    });

    const first = await service.createPhotoUploadUrl('10', 'then', asUser());
    await new Promise((r) => setTimeout(r, 2));
    const second = await service.createPhotoUploadUrl('10', 'then', asUser());

    expect(first.key).not.toBe(second.key);
  });

  it('records the key before any upload has happened', async () => {
    let recorded: [string, string, string | null] | null = null;
    const service = serviceWith({
      findPlacement: async () => placement,
      setPhotoKey: async (userId, photoType, key) => {
        recorded = [userId, photoType, key];
      },
    });

    const { key } = await service.createPhotoUploadUrl('10', 'then', asUser());

    expect(recorded).toEqual(['10', 'then', key]);
  });
});

describe('PhotosService photoType validation', () => {
  it.each(['sideways', 'THEN', '', 'then; DROP TABLE profiles'])(
    'rejects %o',
    async (bad) => {
      const service = serviceWith({});

      await expectRejection(
        service.createPhotoUploadUrl('10', bad, asUser()),
        400,
        'Valid userId and photoType (then/now) required.',
      );
    },
  );

  it.each(['then', 'now'])('accepts %o', async (good) => {
    const service = serviceWith({
      findPlacement: async () => placement,
      setPhotoKey: async () => {},
    });

    await expect(
      service.createPhotoUploadUrl('10', good, asUser()),
    ).resolves.toBeDefined();
  });

  /** Validation runs before authorization here, matching the source's order. */
  it('reports a bad photoType even when the caller has no rights', async () => {
    const service = serviceWith({}, fakeS3().service, scopeAllowing({ manage: false }));

    await expectRejection(
      service.createPhotoUploadUrl('10', 'sideways', asUser({ id: 99 })),
      400,
      'Valid userId and photoType (then/now) required.',
    );
  });
});

describe('PhotosService.deletePhoto', () => {
  it('removes the object and clears the column', async () => {
    const s3 = fakeS3();
    let cleared = false;
    const service = serviceWith(
      {
        findPhotoKey: async () => ({ key: 'photos/1/1/10-then-abc.jpg' }),
        setPhotoKey: async (_u, _t, key) => {
          cleared = key === null;
        },
      },
      s3.service,
    );

    await service.deletePhoto('10', 'then', asUser());

    expect(s3.deleted).toEqual(['photos/1/1/10-then-abc.jpg']);
    expect(cleared).toBe(true);
  });

  it('succeeds without touching S3 when no photo is set', async () => {
    const s3 = fakeS3();
    const service = serviceWith(
      { findPhotoKey: async () => ({ key: null }), setPhotoKey: async () => {} },
      s3.service,
    );

    await expect(service.deletePhoto('10', 'then', asUser())).resolves.toEqual({
      message: 'Photo deleted successfully.',
    });
    expect(s3.deleted).toEqual([]);
  });

  it('404s when the profile is missing', async () => {
    const service = serviceWith({ findPhotoKey: async () => undefined });

    await expectRejection(
      service.deletePhoto('9999', 'then', asUser()),
      404,
      'User profile not found.',
    );
  });

  it('403s without manage rights', async () => {
    const service = serviceWith(
      {},
      fakeS3().service,
      scopeAllowing({ manage: false }),
    );

    await expectRejection(
      service.deletePhoto('10', 'then', asUser({ id: 99 })),
      403,
      'You do not have permission to manage this photo.',
    );
  });
});

describe('PhotosService caption handling', () => {
  const captionCases: [unknown, string | null][] = [
    ['  spaced  ', 'spaced'],
    ['', null],
    ['   ', null],
    [undefined, null],
    [null, null],
    [42, null],
    [{ nope: true }, null],
  ];

  it.each(captionCases)('normalizes %o to %o', async (input, expected) => {
    let stored: string | null | undefined;
    const service = serviceWith({
      countGalleryPhotos: async () => 0,
      findPlacement: async () => placement,
      insertGalleryPhoto: async (_u, _k, caption) => {
        stored = caption;
        return 1;
      },
    });

    await service.createGalleryUploadUrl('10', input, asUser());

    expect(stored).toBe(expected);
  });

  it('caps a caption at the column width', async () => {
    let stored: string | null | undefined;
    const service = serviceWith({
      countGalleryPhotos: async () => 0,
      findPlacement: async () => placement,
      insertGalleryPhoto: async (_u, _k, caption) => {
        stored = caption;
        return 1;
      },
    });

    await service.createGalleryUploadUrl('10', 'x'.repeat(300), asUser());

    expect(stored).toHaveLength(255);
  });
});

describe('PhotosService gallery limit', () => {
  it('refuses at nine photos', async () => {
    const service = serviceWith({ countGalleryPhotos: async () => 9 });

    await expectRejection(
      service.createGalleryUploadUrl('10', 'One more', asUser()),
      400,
      'Gallery limit of 9 photos reached.',
    );
  });

  it('allows the ninth', async () => {
    const service = serviceWith({
      countGalleryPhotos: async () => 8,
      findPlacement: async () => placement,
      insertGalleryPhoto: async () => 9,
    });

    await expect(
      service.createGalleryUploadUrl('10', 'Ninth', asUser()),
    ).resolves.toBeDefined();
  });

  /**
   * The limit is checked before the user is looked up, so an over-quota id that
   * does not exist reports the limit rather than a 404. Source ordering, and
   * the sort of thing that silently flips when a method is reordered.
   */
  it('reports the limit before checking the user exists', async () => {
    const service = serviceWith({
      countGalleryPhotos: async () => 9,
      findPlacement: async () => undefined,
    });

    await expectRejection(
      service.createGalleryUploadUrl('9999', 'x', asUser({ is_admin: true })),
      400,
      'Gallery limit of 9 photos reached.',
    );
  });
});

describe('PhotosService gallery authorization', () => {
  it('refuses uploading to another user’s gallery even for a classmate', async () => {
    // Classmates may *view* but not contribute — canViewPhotos is irrelevant here.
    const service = serviceWith({}, fakeS3().service, scopeAllowing({ view: true }));

    await expectRejection(
      service.createGalleryUploadUrl('10', 'x', asUser({ id: 11 })),
      403,
      'You can only upload to your own gallery.',
    );
  });

  it('lets an admin upload to anyone’s gallery', async () => {
    const service = serviceWith({
      countGalleryPhotos: async () => 0,
      findPlacement: async () => placement,
      insertGalleryPhoto: async () => 1,
    });

    await expect(
      service.createGalleryUploadUrl('10', 'x', asUser({ id: 12, is_admin: true })),
    ).resolves.toBeDefined();
  });

  it('403s listing without view rights', async () => {
    const service = serviceWith(
      {},
      fakeS3().service,
      scopeAllowing({ view: false }),
    );

    await expectRejection(
      service.listGallery('10', asUser({ id: 13 })),
      403,
      'You do not have permission to view this gallery.',
    );
  });

  it('deletes the object before the row', async () => {
    const order: string[] = [];
    const s3 = {
      deleteObject: async () => {
        order.push('s3');
      },
    } as unknown as S3Service;

    const service = serviceWith(
      {
        findGalleryPhoto: async () => ({ id: 1, s3_key: 'photos/x.jpg' }),
        deleteGalleryPhoto: async () => {
          order.push('db');
        },
      },
      s3,
    );

    await service.deleteGalleryPhoto('10', '1', asUser());

    // If S3 throws, the row survives and the photo stays listed — better than
    // an object nobody can find.
    expect(order).toEqual(['s3', 'db']);
  });
});

describe('PhotosService.createViewUrl', () => {
  it('400s without a key', async () => {
    const service = serviceWith({});

    await expectRejection(
      service.createViewUrl(undefined),
      400,
      'Photo key required.',
    );
  });

  /** No ownership check — see the service, and §9.2. */
  it('presigns any key it is handed', async () => {
    const service = serviceWith({});

    await expect(
      service.createViewUrl('photos/9/9/999-then-abc.jpg'),
    ).resolves.toEqual({
      presignedUrl: 'signed:photos/9/9/999-then-abc.jpg',
    });
  });
});
