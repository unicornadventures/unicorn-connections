/**
 * Request body shapes for `/api/auth`.
 *
 * Types only — no class-validator decorators, and deliberately so. The contract
 * fixes the exact 400 message for each missing field *and* the order the checks
 * run in (reset-password answers "required" before "do not match" before "too
 * short"). class-validator guarantees neither, so the checks live in
 * AuthService and these interfaces just describe what arrives.
 *
 * Every field is optional because the endpoints must answer a specific 400 for
 * a missing field rather than fail to bind.
 */

export interface LoginDto {
  email?: string;
  password?: string;
}

export interface ForgotPasswordDto {
  email?: string;
}

export interface ResetPasswordDto {
  token?: string;
  password?: string;
  confirmPassword?: string;
}

export interface VerifyEmailDto {
  token?: string;
}

export interface ClaimSearchDto {
  first_name?: string;
  last_name?: string;
  class_id?: number;
}

export interface ClaimAccountDto {
  user_id?: number;
  email?: string;
  password?: string;
}
