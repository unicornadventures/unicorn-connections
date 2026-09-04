import { HttpException } from '@nestjs/common';
import { expect } from 'vitest';

/**
 * Asserts a service rejected with the exact status and `{ error }` body the
 * contract requires.
 *
 * Services throw HttpExceptions whose *response body* carries the message,
 * while `.message` stays Nest's generic text — the body is what
 * AllExceptionsFilter puts on the wire, so that is what gets asserted. Writing
 * this as `rejects.toThrow(...)` would match on `.message` and pass for the
 * wrong reason.
 *
 * Lives under `test/` rather than `src/` so it never reaches a build: spec
 * files are excluded from tsconfig.build.json, so nothing tsc compiles ever
 * follows an import of this file.
 */
export async function expectRejection(
  promise: Promise<unknown>,
  status: number,
  error: string,
): Promise<void> {
  try {
    await promise;
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(status);
    expect((thrown as HttpException).getResponse()).toEqual({ error });
    return;
  }
  throw new Error(
    `expected a rejection with ${status} '${error}', but the call resolved`,
  );
}
