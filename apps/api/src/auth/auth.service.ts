import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Profile } from '@classyear/shared-types';
import { AuthRepository, type ClaimMatch } from './auth.repository.js';
import { TokenService } from '../tokens/token.service.js';
import { PasswordResetDispatcher } from '../email/password-reset-dispatcher.service.js';
import { decodeRegistrationHash } from '../common/registration-link.js';
import { rethrowAsInternal } from '../common/http-errors.js';

const BCRYPT_ROUNDS = 10;
const TOKEN_TTL = '24h';

/** Shape returned by login and claim-account. */
export interface AuthenticatedUser {
  user_id: number;
  email: string | null;
  is_admin: boolean;
  is_class_admin: boolean;
  profile: Profile | Pick<Profile, 'first_name' | 'last_name'> | null;
}

/**
 * Auth logic, ported from the deployed handlers (`lambda/auth.ts`,
 * `lambda/forgotPassword.ts`) plus the three Express-only endpoints. See
 * docs §14 for why the deployed versions are the reference.
 *
 * Argument checks are written out longhand rather than expressed as DTO
 * decorators. The contract fixes both the exact message strings and the *order*
 * they are checked in — reset-password reports "required" before "do not match"
 * before "too short" — and class-validator does not promise either.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly passwordReset: PasswordResetDispatcher,
  ) {}

  private sign(claims: Record<string, unknown>): string {
    return jwt.sign(claims, this.config.get<string>('jwtSecret')!, {
      expiresIn: TOKEN_TTL,
    });
  }

  /**
   * Wraps an unexpected failure in a 500 carrying the source's endpoint-specific
   * text, while letting deliberate HttpExceptions through untouched.
   *
   * Phase 2 moved the body to `common/http-errors.ts` — Users, Schools and
   * Classes all end their handlers the same way, and three more private copies
   * of it would be the start of exactly the drift this port exists to undo.
   */
  private rethrow(error: unknown, message: string): never {
    rethrowAsInternal(error, message, this.logger);
  }

  async login(email?: string, password?: string) {
    try {
      if (!email || !password) {
        // Note: 'required.', not 'are required.' — the deployed wording.
        throw new BadRequestException({
          error: 'Email and password required.',
        });
      }

      const user = await this.repo.findLoginCandidate(
        email.toLowerCase().trim(),
      );

      // The password check is explicit because unclaimed roster entries have a
      // null password; bcrypt.compare(pw, null) throws, which the Express route
      // turned into a 500.
      if (!user || !user.password) {
        throw new UnauthorizedException({ error: 'Invalid credentials.' });
      }

      if (!(await bcrypt.compare(password, user.password))) {
        throw new UnauthorizedException({ error: 'Invalid credentials.' });
      }

      const profile = await this.repo.findProfile(user.id);

      const token = this.sign({
        id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        is_class_admin: user.is_class_admin,
      });

      const authenticated: AuthenticatedUser = {
        user_id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        is_class_admin: user.is_class_admin,
        profile,
      };

      return { user: authenticated, token };
    } catch (error) {
      // Yes, really — the deployed login answers with the filename in it.
      this.rethrow(error, 'Internal server error (auth.ts).');
    }
  }

  /**
   * Registration is switched off. The source's handler returns this on its
   * first line and leaves ~80 lines of unreachable code behind it; the port
   * keeps the 403 and drops the dead code rather than carrying it (docs §9.3).
   */
  register(): never {
    throw new ForbiddenException({
      error: 'Registration is currently disabled.',
    });
  }

  async getRegistrationLink(hash?: string) {
    try {
      if (!hash) {
        throw new BadRequestException({ error: 'Hash parameter required.' });
      }

      const decoded = decodeRegistrationHash(hash);
      if (!decoded) {
        throw new BadRequestException({ error: 'Invalid registration link.' });
      }

      const school = await this.repo.findSchool(decoded.schoolId);
      if (!school) {
        throw new NotFoundException({ error: 'School not found.' });
      }

      // Re-checks the pairing: the hash is an encoding, not a signature.
      const klass = await this.repo.findClassInSchool(
        decoded.classId,
        decoded.schoolId,
      );
      if (!klass) {
        throw new NotFoundException({ error: 'Class not found.' });
      }

      return { school, class: klass };
    } catch (error) {
      this.rethrow(error, 'Internal server error.');
    }
  }

  async forgotPassword(email?: string) {
    // Same body whether or not the address exists, so the endpoint can't be
    // used to enumerate accounts.
    const opaque = {
      message: 'If the email exists, a password reset link has been sent.',
    };

    try {
      if (!email) {
        throw new BadRequestException({ error: 'Email is required.' });
      }

      const normalized = email.toLowerCase().trim();
      const userId = await this.repo.findUserIdByEmail(normalized);
      if (userId === undefined) {
        return opaque;
      }

      await this.repo.deletePasswordResetTokens(userId);

      const { token, hash, expiresAt } = this.tokens.generate();
      await this.repo.insertPasswordResetToken(userId, hash, expiresAt);
      await this.passwordReset.dispatch(normalized, token);

      return opaque;
    } catch (error) {
      this.rethrow(error, 'Internal server error.');
    }
  }

  async resetPassword(
    token?: string,
    password?: string,
    confirmPassword?: string,
  ) {
    try {
      if (!token || !password || !confirmPassword) {
        throw new BadRequestException({
          error: 'Token, password, and password confirmation are required.',
        });
      }
      if (password !== confirmPassword) {
        throw new BadRequestException({ error: 'Passwords do not match.' });
      }
      if (password.length < 6) {
        throw new BadRequestException({
          error: 'Password must be at least 6 characters long.',
        });
      }

      const userId = await this.repo.findUserIdByResetTokenHash(
        this.tokens.hash(token),
      );
      if (userId === undefined) {
        throw new BadRequestException({
          error: 'Invalid or expired reset token.',
        });
      }

      await this.repo.updatePassword(
        userId,
        await bcrypt.hash(password, BCRYPT_ROUNDS),
      );
      await this.repo.deletePasswordResetTokens(userId);

      return { message: 'Password reset successful.' };
    } catch (error) {
      this.rethrow(error, 'Internal server error.');
    }
  }

  /**
   * Express-only endpoint, with one deliberate fix: the token is looked up by
   * hash. The source selected the most recent unexpired unverified token
   * *globally* and then compared, so two users verifying in the same window
   * would lock each other out. See docs §14.
   */
  async verifyEmail(token?: string) {
    try {
      if (!token) {
        throw new BadRequestException({
          error: 'Verification token is required.',
        });
      }

      const userId = await this.repo.findUserIdByVerificationTokenHash(
        this.tokens.hash(token),
      );
      if (userId === undefined) {
        throw new BadRequestException({
          error: 'Invalid or expired verification token.',
        });
      }

      await this.repo.markEmailVerified(userId);

      return {
        message: 'Email verified successfully. You can now login to your account.',
      };
    } catch (error) {
      this.rethrow(error, 'Internal server error.');
    }
  }

  async claimSearch(
    firstName?: string,
    lastName?: string,
    classId?: number,
  ): Promise<{ matches: ClaimMatch[] }> {
    try {
      if (!firstName?.trim() || !lastName?.trim() || !classId) {
        throw new BadRequestException({
          error: 'first_name, last_name, and class_id are required.',
        });
      }

      const matches = await this.repo.searchClaimable(
        firstName.trim(),
        lastName.trim(),
        classId,
      );

      return { matches };
    } catch (error) {
      this.rethrow(error, 'Internal server error.');
    }
  }

  async claimAccount(userId?: number, email?: string, password?: string) {
    try {
      if (!userId || !email || !password) {
        throw new BadRequestException({
          error: 'user_id, email, and password are required.',
        });
      }
      // Note: no 'long' here, unlike reset-password. Both strings are the
      // source's; the inconsistency is theirs and is preserved.
      if (password.length < 6) {
        throw new BadRequestException({
          error: 'Password must be at least 6 characters.',
        });
      }

      const normalized = email.toLowerCase().trim();

      if ((await this.repo.findUnclaimedUser(userId)) === undefined) {
        throw new NotFoundException({
          error: 'Account not found or already registered.',
        });
      }

      if ((await this.repo.findUserIdByEmail(normalized)) !== undefined) {
        throw new ConflictException({
          error: 'This email is already registered.',
        });
      }

      const user = await this.repo.claimAccount(
        userId,
        normalized,
        await bcrypt.hash(password, BCRYPT_ROUNDS),
      );
      const profile = await this.repo.findNameOnlyProfile(user.id);

      const token = this.sign({
        id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        is_class_admin: user.is_class_admin,
      });

      const authenticated: AuthenticatedUser = {
        user_id: user.id,
        email: user.email,
        is_admin: user.is_admin,
        is_class_admin: user.is_class_admin,
        profile,
      };

      return { token, user: authenticated };
    } catch (error) {
      this.rethrow(error, 'Internal server error.');
    }
  }
}
