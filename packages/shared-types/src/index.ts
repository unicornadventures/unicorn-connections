/**
 * Entity types shared by the API and the web client.
 *
 * The source app kept two independent copies of these — `backend/src/types.ts`
 * and `frontend/src/types.ts` — which drifted from each other and from the
 * actual schema. This package is the single definition; that drift is the main
 * reason the port is a monorepo rather than two repos.
 *
 * These describe database rows. HTTP request/response DTOs live with the
 * feature module that owns them, because they are shaped by the endpoint
 * contract rather than by the table.
 *
 * Faithful to `schema.ts` rather than to the source's types.ts, which had gone
 * stale — divergences are called out inline.
 */

export interface School {
  id: number;
  name: string;
  location: string | null;
  /** IANA name, e.g. "America/Chicago". Renders event times in school-local time. */
  timezone: string | null;
  created_at: Date;
  updated_at: Date;
}

/** One row per graduating year, global across schools. Linked via `class_school`. */
export interface ClassEntity {
  id: number;
  year: number;
  created_at: Date;
}

export interface ClassSchool {
  class_id: number;
  school_id: number;
}

export interface User {
  id: number;
  /**
   * Null for admin-created roster entries that nobody has claimed yet — the
   * schema drops NOT NULL on both email and password for exactly this case,
   * and `POST /api/auth/claim-account` is what fills them in. The source's
   * types.ts declared these non-null, which was wrong.
   */
  email: string | null;
  password: string | null;
  is_admin: boolean;
  is_class_admin: boolean;
  email_verified: boolean;
  is_deceased: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Profile {
  id: number;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  former_first_name: string | null;
  former_last_name: string | null;
  bio: string | null;
  then_photo_url: string | null;
  now_photo_url: string | null;
  avatar_color: string | null;
  /** jsonb, defaults to []. Indexed with a GIN index for tag search. */
  tags: string[];
  created_at: Date;
  updated_at: Date;
}

/** Membership of a user in a class year, carrying which school it was at. */
export interface ClassUser {
  id: number;
  class_id: number;
  user_id: number;
  school_id: number | null;
}

export interface EventEntity {
  id: number;
  class_id: number;
  school_id: number | null;
  event_name: string;
  event_date: Date;
  /** TIME column — comes back from pg as a "HH:MM:SS" string, not a Date. */
  event_time: string;
  location: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Comment {
  id: number;
  target_user_id: number;
  commenter_id: number;
  content: string;
  /** Comments are unpublished until the profile owner or an admin approves. */
  published: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface GalleryPhoto {
  id: number;
  user_id: number;
  s3_key: string;
  caption: string | null;
  created_at: Date;
}

export interface Feedback {
  id: number;
  user_id: number;
  comment: string;
  created_at: Date;
}

export interface PasswordResetToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

export interface EmailVerificationToken {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  verified: boolean;
  created_at: Date;
}

/** The three role levels, enforced in both routing and the API's guards. */
export type Role = 'user' | 'class_admin' | 'super_admin';

/**
 * JWT payload minted by `POST /api/auth/login`.
 *
 * Note it carries no `is_class_admin` claim — the source's login handler does
 * not sign one, and code that needs it re-reads the user row. Adding it here
 * would change what `GET /api/auth/me` returns to the client, so it stays off.
 */
export interface JwtPayload {
  id: number;
  email: string | null;
  is_admin: boolean;
  user_id: number;
  first_name: string;
  last_name: string;
  profile: Profile | null;
  iat?: number;
  exp?: number;
}
