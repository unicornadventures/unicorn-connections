/**
 * Request shapes for `/api/admin`. Plain interfaces for the reason given in
 * `auth/dto/auth.dto.ts` — the source validates by hand, in a fixed order, with
 * exact message strings.
 */

export interface SetClassAdminDto {
  is_class_admin?: boolean;
}

export interface UpdateAdminProfileDto {
  is_deceased?: unknown;
  first_name?: string;
  last_name?: string;
  former_first_name?: string;
  former_last_name?: string;
}

/**
 * One roster entry, as sent by the admin "add user" form and by each row of a
 * CSV import.
 *
 * `original_first_name` / `original_last_name` map to the `former_*` profile
 * columns — the names someone graduated under. The wire names and the column
 * names disagree; that is the source's, and renaming either would break a
 * client or a query.
 */
export interface RosterEntryDto {
  email?: string;
  first_name?: string;
  last_name?: string;
  original_first_name?: string;
  original_last_name?: string;
  is_deceased?: boolean;
}

export interface ImportUsersDto {
  users?: RosterEntryDto[];
}

export interface RegistrationLinkDto {
  classId?: number;
  schoolId?: number;
}

export interface MoveClassDto {
  class_id?: number | string;
}

/** Why a CSV row was not imported. `index` is zero-based into the input array. */
export interface SkippedRow {
  index: number;
  name: string;
  reason: string;
}
