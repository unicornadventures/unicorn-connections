import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/auth-user.js';
import type {
  ClaimAccountDto,
  ClaimSearchDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';

/**
 * `/api/auth` — 10 endpoints.
 *
 * Seven are ported from the deployed Lambda handlers. Three (`/me`, `/logout`,
 * `/verify-email`) exist only in the Express app and have no deployed route;
 * they are included here, which among other things fixes email verification,
 * since VerifyEmail.tsx calls an endpoint that does not exist in production.
 * See docs §14.
 *
 * Bodies arrive as loose types and are checked in the service: the contract
 * pins both the message strings and the order they are checked in.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginDto) {
    return this.auth.login(body?.email, body?.password);
  }

  @Post('register')
  register() {
    return this.auth.register();
  }

  @Get('registration-link/:hash')
  getRegistrationLink(@Param('hash') hash: string) {
    return this.auth.getRegistrationLink(hash);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body?.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(
      body?.token,
      body?.password,
      body?.confirmPassword,
    );
  }

  @Post('claim-search')
  @HttpCode(HttpStatus.OK)
  claimSearch(@Body() body: ClaimSearchDto) {
    return this.auth.claimSearch(
      body?.first_name,
      body?.last_name,
      body?.class_id,
    );
  }

  @Post('claim-account')
  @HttpCode(HttpStatus.OK)
  claimAccount(@Body() body: ClaimAccountDto) {
    return this.auth.claimAccount(body?.user_id, body?.email, body?.password);
  }

  // ---- Express-only, no deployed counterpart -----------------------------

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() body: VerifyEmailDto) {
    return this.auth.verifyEmail(body?.token);
  }

  /**
   * Echoes back the token's claims. No database read — whatever was signed is
   * what comes back, which is the source's behaviour.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser | undefined) {
    if (!user) {
      throw new UnauthorizedException({ error: 'Not authenticated' });
    }
    return { user };
  }

  /**
   * Clears the cookie the Express app used to set. The deployed login never
   * set one and neither does this port, so for a token-in-localStorage client
   * this is a no-op that returns 200 — matching the source.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    return { message: 'Logged out successfully' };
  }
}
