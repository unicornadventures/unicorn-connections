import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Rejects a path parameter that is not a positive integer, **without changing
 * its type**.
 *
 * Fixes known-bugs #14: `GET /api/users/abc` used to reach Postgres, fail on
 * `invalid input syntax for type integer`, and answer 500. A 500 is a claim
 * that the server broke; a malformed id is the caller's mistake and deserves a
 * 400.
 *
 * **Why not `ParseIntPipe`.** Every repository in this app takes ids as strings
 * and interpolates them straight into parameterised SQL — deliberately, because
 * the port kept the source's queries byte-identical (docs §3.3, §15). Coercing
 * to `number` here would mean changing every signature it touches, for no gain:
 * Postgres accepts the string form of an integer for an `int` column perfectly
 * well. So this validates and passes the original string through.
 *
 * The pattern is deliberately strict — no sign, no whitespace, no leading zeros
 * beyond a bare `0`, nothing `parseInt` would silently truncate. `parseInt('1x')`
 * is `1`, and an endpoint that quietly served user 1 for `/api/users/1x` would
 * be worse than one that 400s.
 */
const POSITIVE_INTEGER = /^(0|[1-9]\d*)$/;

/**
 * Postgres `integer` tops out here. A digits-only string beyond it is still
 * rejected by the database — with the 500 this pipe exists to prevent — so the
 * range is part of "is this a valid id", not a separate concern.
 */
const MAX_INT4 = 2147483647;

@Injectable()
export class NumericIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (
      typeof value === 'string' &&
      POSITIVE_INTEGER.test(value) &&
      Number(value) <= MAX_INT4
    ) {
      return value;
    }

    // One message for every id parameter. Naming which one would be friendlier,
    // but the pipe does not know its own parameter name, and inventing a
    // per-route message is more surface than this is worth.
    throw new BadRequestException({ error: 'Invalid id.' });
  }
}
