import crypto from 'node:crypto';
import { TokenService } from './token.service.js';

describe('TokenService', () => {
  const tokens = new TokenService();

  it('generates a 32-byte hex token', () => {
    const { token } = tokens.generate();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores only the SHA-256, never the token itself', () => {
    const { token, hash } = tokens.generate();

    expect(hash).toBe(
      crypto.createHash('sha256').update(token).digest('hex'),
    );
    expect(hash).not.toBe(token);
  });

  it('does not repeat itself', () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => tokens.generate().token),
    );

    expect(seen.size).toBe(50);
  });

  it('expires one hour out, as an ISO string for the TIMESTAMP column', () => {
    const before = Date.now();
    const { expiresAt } = tokens.generate();
    const after = Date.now();

    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    const expiry = new Date(expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expiry).toBeLessThanOrEqual(after + 3_600_000);
  });

  it('verifies a token against its own hash', () => {
    const { token, hash } = tokens.generate();

    expect(tokens.verify(hash, token)).toBe(true);
  });

  it('rejects a different token', () => {
    const { hash } = tokens.generate();
    const other = tokens.generate();

    expect(tokens.verify(hash, other.token)).toBe(false);
  });

  it('rejects rather than throws when the stored hash is missing', () => {
    // The Express reset-password route selected only user_id and then read
    // .token_hash off the row, passing undefined in here. It must not throw —
    // and it must not accidentally match. See docs §14.
    expect(tokens.verify(undefined as unknown as string, 'anything')).toBe(
      false,
    );
  });
});
