/**
 * Re-exported from `@classyear/shared-types`, where the palette now lives.
 *
 * It moved there in phase 6, when the web client arrived carrying its own copy
 * — `frontend/src/avatarColors.ts` — and made the duplication concrete. The
 * list is enforced on both sides (the API 400s on anything outside it, the
 * client renders the same swatches), so it is exactly the kind of thing the
 * shared package exists for.
 *
 * This file stays as a re-export so the API's imports do not all have to
 * change, and because `common/` is where a reader looks for it.
 */
export {
  AVATAR_COLORS,
  isValidAvatarColor,
  type AvatarColor,
} from '@classyear/shared-types';
