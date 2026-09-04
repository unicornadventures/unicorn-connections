import type { INestApplication } from '@nestjs/common';
import { resetFixture } from './fixtures.js';

/** Minimal shape of what a source Lambda handler returns. */
export interface LegacyResult {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

export type LegacyHandler = (event: any) => Promise<LegacyResult>;

export interface HttpCall {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  body?: unknown;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface Observed {
  status: number;
  body: any;
}

/** Builds the APIGatewayProxyEvent the source handlers expect. */
export function toApiGatewayEvent(call: HttpCall): any {
  return {
    httpMethod: call.method.toUpperCase(),
    path: call.path,
    pathParameters: call.pathParameters ?? null,
    queryStringParameters: call.query ?? null,
    headers: call.headers ?? {},
    body: call.body === undefined ? null : JSON.stringify(call.body),
    isBase64Encoded: false,
    requestContext: {},
  };
}

export async function invokeLegacy(
  handler: LegacyHandler,
  call: HttpCall,
): Promise<Observed> {
  const result = await handler(toApiGatewayEvent(call));
  return {
    status: result.statusCode,
    body: result.body ? JSON.parse(result.body) : undefined,
  };
}

export async function invokeNest(
  app: INestApplication,
  call: HttpCall,
): Promise<Observed> {
  const { default: request } = await import('supertest');
  let req = request(app.getHttpServer())[call.method](call.path);

  if (call.query) req = req.query(call.query);
  for (const [key, value] of Object.entries(call.headers ?? {})) {
    req = req.set(key, value);
  }
  if (call.body !== undefined) req = req.send(call.body as object);

  const res = await req;
  return { status: res.status, body: res.body };
}

/**
 * Fields that legitimately differ between two runs and must not be compared:
 * signed tokens (a JWT embeds `iat`), and timestamps.
 *
 * Everything else is compared exactly. Resisting the urge to normalize more
 * than this is the whole point — each added exclusion is parity given up.
 */
const VOLATILE = new Set([
  'token',
  'created_at',
  'updated_at',
  'timestamp',
  // Admin-minted password links expire seven days from *now*, so the two sides
  // differ by however long the first call took.
  'expiresAt',
]);

/**
 * A presigned S3 URL carries `X-Amz-Date` and a signature derived from it, so
 * two invocations a second apart produce different strings for the same object.
 *
 * Dropping the query string keeps everything that is actually under test — the
 * bucket, the region, and the key the row maps to — and discards only the part
 * that is a function of the clock. A photo field that resolved to the wrong
 * object, or failed to resolve at all, still fails the comparison.
 */
function normalizePresignedUrl(value: string): string {
  if (!value.includes('X-Amz-Signature')) return value;

  // Deliberately not scheme- or host-restricted: if one side ends up addressing
  // LocalStack while the other addresses real S3, that is a configuration bug
  // this comparison should catch, not paper over.
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

/**
 * Newly minted photo keys end in a base-36 millisecond timestamp
 * (`…/10-then-mfp2q8x1.jpg`), so the two sides never agree on one — they run
 * milliseconds apart by construction.
 *
 * Only the suffix is masked. The prefix carries the school, the class, the user
 * and the photo type, all of which are the interesting part of key generation
 * and all of which stay compared. A key built under the wrong class, or with
 * the `photos/other/` fallback taken when it should not have been, still fails.
 */
function normalizePhotoKeySuffix(value: string): string {
  return value.replace(
    /-(then|now|gallery)-[0-9a-z]+\.jpg/g,
    '-$1-<suffix>.jpg',
  );
}

/**
 * Password-setup links carry 32 random bytes, so the two sides never match.
 *
 * Only the token is masked; the origin and path stay compared, which is what
 * matters — a link pointing at the wrong host or the wrong page would still
 * fail. The token's *correctness* is not this comparison's job anyway, since
 * neither side's token can be verified against the other's database state.
 */
function normalizeSetupToken(value: string): string {
  return value.replace(/([?&]token=)[0-9a-f]{16,}/g, '$1<token>');
}

export function normalize(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeSetupToken(
      normalizePhotoKeySuffix(normalizePresignedUrl(value)),
    );
  }

  if (Array.isArray(value)) return value.map(normalize);

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        VOLATILE.has(k) ? `<${k}>` : normalize(v),
      ]),
    );
  }

  return value;
}

/**
 * Runs the same call against both implementations, each against a freshly
 * reseeded database, and returns both observations normalized.
 *
 * Reseeding between the two sides is what makes mutating endpoints comparable:
 * without it the second implementation would see state the first one left.
 */
export async function compare(
  app: INestApplication,
  handler: LegacyHandler,
  call: HttpCall,
): Promise<{ legacy: unknown; nest: unknown }> {
  await resetFixture();
  const legacy = await invokeLegacy(handler, call);

  await resetFixture();
  const nest = await invokeNest(app, call);

  return {
    legacy: { status: legacy.status, body: normalize(legacy.body) },
    nest: { status: nest.status, body: normalize(nest.body) },
  };
}
