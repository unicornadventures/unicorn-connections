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
const VOLATILE = new Set(['token', 'created_at', 'updated_at', 'timestamp']);

export function normalize(value: unknown): unknown {
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
