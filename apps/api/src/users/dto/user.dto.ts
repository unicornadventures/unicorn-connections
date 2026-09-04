/**
 * Request shapes for `/api/users`.
 *
 * These are plain interfaces, not class-validator DTOs, for the same reason
 * auth's are (see auth/dto/auth.dto.ts): the source validates by hand, in a
 * fixed order, with exact message strings, and the global ValidationPipe would
 * both reorder those checks and reword them. The types document the contract;
 * the service enforces it.
 */
export interface UpdateProfileDto {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  former_first_name?: string | null;
  former_last_name?: string | null;
  bio?: string | null;
  email?: string | null;
  tags?: string[] | null;
  /** null is meaningful: it clears the colour. Absent means "leave it alone". */
  avatar_color?: string | null;
}

/** Response shape shared by the profile fetch and the profile update. */
export interface UserProfileResponse {
  user: {
    user_id: number;
    email: string | null;
    is_admin: boolean;
    is_class_admin: boolean;
  };
  profile: {
    first_name: string | null;
    last_name: string | null;
    nickname: string | null;
    former_first_name: string | null;
    former_last_name: string | null;
    bio: string | null;
    then_photo_url: string | null;
    now_photo_url: string | null;
    avatar_color: string | null;
    tags: string[];
  };
}
