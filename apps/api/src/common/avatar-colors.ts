/**
 * Port of `backend/src/utils/avatarColors.ts`.
 *
 * The palette a user can pick from for their profile circle, used when they
 * have no photo. `PUT /api/users/:userId/profile` rejects anything outside it
 * with 400 'Invalid avatar color.', so this list is part of the API contract,
 * not just a UI concern — the values and their order are copied verbatim.
 *
 * The web client keeps its own copy in `frontend/src/avatarColors.ts`. That is
 * the duplication `@classyear/shared-types` exists to remove, and this constant
 * should move there in phase 6 when the frontend lands in this monorepo.
 */
export const AVATAR_COLORS = [
  '#E91E63',
  '#3F51B5',
  '#009688',
  '#FF5722',
  '#9C27B0',
  '#4CAF50',
  '#FF9800',
  '#607D8B',
  '#795548',
  '#00BCD4',
  '#F06292',
  '#7986CB',
] as const;

export const isValidAvatarColor = (color: unknown): color is string =>
  typeof color === 'string' && (AVATAR_COLORS as readonly string[]).includes(color);
