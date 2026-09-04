import {
  decodeRegistrationHash,
  encodeRegistrationHash,
} from './registration-link.js';

describe('registration links', () => {
  it('round-trips a school and class', () => {
    const hash = encodeRegistrationHash(7, 42);

    expect(decodeRegistrationHash(hash)).toEqual({ schoolId: 7, classId: 42 });
  });

  it('produces url-safe output', () => {
    // These end up in a link, so no +, / or = may appear.
    for (let schoolId = 1; schoolId < 60; schoolId++) {
      expect(encodeRegistrationHash(schoolId, schoolId * 7)).toMatch(
        /^[A-Za-z0-9_-]+$/,
      );
    }
  });

  it('returns null for input that is not base64', () => {
    expect(decodeRegistrationHash('!!!not base64!!!')).toBeNull();
  });

  it('returns null for base64 that is not JSON', () => {
    expect(
      decodeRegistrationHash(Buffer.from('nope').toString('base64url')),
    ).toBeNull();
  });

  it('returns null when the expected keys are absent', () => {
    const hash = Buffer.from(JSON.stringify({ x: 1 })).toString('base64url');

    expect(decodeRegistrationHash(hash)).toBeNull();
  });

  it('treats a zero id as absent, matching the source', () => {
    // The source checks `data.s && data.c`, so 0 fails. Preserved deliberately;
    // ids are serial and start at 1, so nothing real is affected.
    const hash = Buffer.from(JSON.stringify({ s: 0, c: 3 })).toString(
      'base64url',
    );

    expect(decodeRegistrationHash(hash)).toBeNull();
  });

  it('is an encoding, not a signature — anyone can mint one', () => {
    // Documents *why* the handler re-checks that the class belongs to the
    // school rather than trusting the decoded ids.
    const forged = Buffer.from(JSON.stringify({ s: 999, c: 999 })).toString(
      'base64url',
    );

    expect(decodeRegistrationHash(forged)).toEqual({
      schoolId: 999,
      classId: 999,
    });
  });
});
