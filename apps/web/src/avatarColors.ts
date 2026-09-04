import { AVATAR_COLORS } from '@classyear/shared-types';

/**
 * The palette itself now lives in `@classyear/shared-types`, because the API
 * validates against it and this client renders it — the source kept a copy on
 * each side and they were free to drift.
 *
 * `getColorForInitials` stays here: it is presentation, with no server
 * counterpart.
 */
export { AVATAR_COLORS };

/**
 * A stable pseudo-random colour for a user who has not picked one, derived from
 * their initials so the same person is always the same colour.
 */
export const getColorForInitials = (initials: string): string => {
  let hash = 0;
  for (let i = 0; i < initials.length; i++) {
    hash = initials.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};
