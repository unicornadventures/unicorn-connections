/**
 * Verbatim port of the source's `utils/registrationLink.ts`.
 *
 * Registration links carry the school and class in a base64url-encoded JSON
 * blob: `{ s: schoolId, c: classId }`. This is an *encoding*, not a signature —
 * anyone can mint one — which is why the handler that consumes it re-checks
 * that the class is actually linked to the school before trusting either id.
 */
export interface RegistrationData {
  schoolId: number;
  classId: number;
}

export function encodeRegistrationHash(
  schoolId: number,
  classId: number,
): string {
  const data = { s: schoolId, c: classId };
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeRegistrationHash(
  hash: string,
): RegistrationData | null {
  try {
    const json = Buffer.from(hash, 'base64url').toString('utf-8');
    const data = JSON.parse(json);
    // Truthiness, not presence — matching the source, so id 0 decodes to null.
    if (data.s && data.c) {
      return { schoolId: data.s, classId: data.c };
    }
    return null;
  } catch {
    return null;
  }
}
