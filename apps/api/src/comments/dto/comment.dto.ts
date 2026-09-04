/**
 * Request shapes for the comment endpoints. Plain interfaces for the reason
 * given in `auth/dto/auth.dto.ts` — the source validates by hand with exact
 * strings and a fixed order, and the global ValidationPipe would change both.
 */
export interface CreateCommentDto {
  content?: string;
  /**
   * Sent by the frontend and **ignored** — the commenter is taken from the
   * token. Declared so the field is documented as deliberately unused rather
   * than looking like an oversight.
   */
  commenterId?: number;
}

export interface UpdateCommentDto {
  /** Editing content sends the comment back to unpublished. */
  content?: string;
  published?: boolean;
}
