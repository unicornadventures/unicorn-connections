import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';

export interface GeneratedToken {
  /** Sent to the user by email. Never stored. */
  token: string;
  /** SHA-256 of the token. This is what goes in the database. */
  hash: string;
  /** ISO string, one hour out — the column is a TIMESTAMP. */
  expiresAt: string;
}

/**
 * Port of the source's `services/tokenService.ts`.
 *
 * Password-reset and email-verification tokens are generated the same way: 32
 * random bytes hex-encoded, with only the SHA-256 stored, so a database leak
 * does not hand over working reset links.
 */
@Injectable()
export class TokenService {
  private static readonly TTL_MS = 60 * 60 * 1000;

  generate(): GeneratedToken {
    const token = crypto.randomBytes(32).toString('hex');

    return {
      token,
      hash: this.hash(token),
      expiresAt: new Date(Date.now() + TokenService.TTL_MS).toISOString(),
    };
  }

  hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Plain equality is fine here: both sides are SHA-256 hex of attacker-known
   * length, so there is no secret length to leak, and the lookup is by hash
   * anyway. Kept for the call sites that compare rather than query.
   */
  verify(storedHash: string, providedToken: string): boolean {
    return storedHash === this.hash(providedToken);
  }
}
