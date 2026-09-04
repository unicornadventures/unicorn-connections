/**
 * Types for what the API sends this client.
 *
 * The entity shapes are **derived** from `@classyear/shared-types` rather than
 * restated here. That package describes database rows, where timestamps are
 * `Date`; by the time a row reaches the browser it has been through
 * `JSON.stringify`, so `Serialized<T>` maps those fields to `string`. One
 * definition of the field list, two accurate views of it.
 *
 * The source app restated all of this by hand in `frontend/src/types.ts`, and
 * it had drifted: `CurrentUser` did not declare `user_id`, `first_name` or
 * `last_name` even though `Login.tsx` writes all three and sixty-one call sites
 * read them. Nothing caught it because the frontend had no `tsconfig.json` —
 * Vite strips types without checking them. See docs §19.
 *
 * Response *envelopes* (`{ user, profile }`, `{ schools }`) are not here; they
 * live with the calls in `apiClient.ts`, because they are shaped by the
 * endpoint rather than by the table.
 */
import type {
  Comment as CommentRow,
  ClassEntity,
  Feedback as FeedbackRow,
  Profile as ProfileRow,
  School as SchoolRow,
  Serialized,
  User as UserRow,
} from '@classyear/shared-types';

export type { Serialized } from '@classyear/shared-types';
export { AVATAR_COLORS, isValidAvatarColor } from '@classyear/shared-types';

/**
 * `password` never leaves the API, so it is dropped rather than declared and
 * ignored. The remaining optionals are fields not every endpoint selects —
 * `GET /api/users` returns no roles, for instance.
 */
export interface User
  extends Omit<Serialized<UserRow>, 'password' | 'is_class_admin' | 'is_deceased' | 'email_verified' | 'updated_at'> {
  is_class_admin?: boolean;
  is_deceased?: boolean;
  email_verified?: boolean;
  updated_at?: string;
}

export type Profile = Serialized<ProfileRow>;
export type Feedback = Serialized<FeedbackRow>;

/**
 * A class as the API returns it. `school_id` / `school_name` come from the
 * `class_school` join, and `member_count` only from
 * `GET /api/schools/:schoolId/classes` — hence all three optional.
 */
export interface Class extends Serialized<ClassEntity> {
  school_id?: number;
  school_name?: string;
  member_count?: number;
}

/**
 * A class as `GET /api/schools/:schoolId/classes` returns it, where the query
 * always computes a headcount. Narrower than `Class` so the admin screens can
 * rely on `member_count` without a null check — they previously each declared
 * their own near-identical local interface for exactly this.
 */
export interface SchoolClass extends Class {
  member_count: number;
}

/** `updated_at` is selected only by the admin update, so it is optional. */
export interface School extends Omit<Serialized<SchoolRow>, 'updated_at'> {
  updated_at?: string;
}

/** Comment endpoints join one or both name pairs depending on the route. */
export interface Comment extends Serialized<CommentRow> {
  commenter_first_name?: string | null;
  commenter_last_name?: string | null;
  target_first_name?: string | null;
  target_last_name?: string | null;
}

/**
 * A gallery photo as the client sees it: the API resolves `s3_key` into a
 * short-lived presigned `url`, so the row type's key never appears here.
 */
export interface GalleryPhoto {
  id: number;
  url: string | null;
  caption?: string | null;
  created_at: string;
}

/** Flattened then/now/gallery photo for the slideshow. */
export interface SlideshowPhoto {
  url: string;
  userId: number;
}

/**
 * One row of the admin roster form, and of a CSV import.
 *
 * `original_*` map to the `former_*` profile columns — the names someone
 * graduated under. The wire names and the column names disagree; that is the
 * API's contract, not a mistake to tidy up here.
 */
export interface RosterEntry {
  first_name: string;
  last_name: string;
  original_first_name?: string;
  original_last_name?: string;
  email?: string;
  is_deceased?: boolean;
}

/**
 * The session object `Login.tsx` builds and `AppContext` persists to
 * localStorage.
 *
 * `user_id` duplicates `id` because the deployed login response calls it
 * `user_id` (docs §14) and the components read both spellings. `first_name` /
 * `last_name` are flattened out of `profile` for the same reason.
 *
 * `created_at` is optional because the deployed login **never sends it** —
 * §14 records that `Login.tsx` reads a field the Lambda does not return, so it
 * is `undefined` in production today.
 */
export interface CurrentUser extends Omit<User, 'created_at'> {
  user_id: number;
  first_name: string;
  last_name: string;
  profile: SessionProfile | null;
  created_at?: string;
}

/**
 * The profile embedded in a session, which is **not** always a whole one.
 *
 * `POST /api/auth/login` returns the full profile row, but
 * `POST /api/auth/claim-account` returns first and last name only — the
 * deployed handler selects just those two columns. Both responses are turned
 * into a `CurrentUser`, so the session type has to admit either. `Partial` says
 * that honestly; declaring the full `Profile` would be a lie that happens to
 * compile.
 */
export type SessionProfile = Partial<Profile>;

/** `POST /api/auth/login`, as the deployed handler returns it. */
export interface AuthResponse {
  user: {
    user_id: number;
    email: string | null;
    is_admin: boolean;
    is_class_admin: boolean;
    profile: Profile | null;
  };
  token: string;
}
