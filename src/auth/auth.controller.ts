import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ClientIp, CurrentUser, Public } from '../common/decorators';
import type { AppRequest, AuthUser } from '../common/request-context';
import { ENV, env, type Env } from '../config/env';
import { AuthResult, AuthService } from './auth.service';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from './cookies';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto, SignupDto, VerifyEmailDto } from './dto';

@ApiTags('auth')
@Throttle({ default: { limit: env().AUTH_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create an account and its first workspace' })
  async signup(@Body() body: SignupDto, @ClientIp() ip: string | null, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.signup(body, ip));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(body));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh-token cookie and get a new access token' })
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      clearRefreshCookie(res, this.env);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res, this.env);
  }

  @Public()
  @Post('forgot')
  @HttpCode(202)
  @ApiOperation({ summary: 'Email a password reset link (same response whether or not the account exists)' })
  async forgot(@Body() body: ForgotPasswordDto) {
    await this.auth.forgotPassword(body);
    return { ok: true };
  }

  @Public()
  @Post('reset')
  @HttpCode(200)
  async reset(@Body() body: ResetPasswordDto) {
    await this.auth.resetPassword(body);
    return { ok: true };
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: VerifyEmailDto) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Post('verify/resend')
  @HttpCode(202)
  async resendVerification(@CurrentUser() user: AuthUser) {
    await this.auth.resendVerification(user.id);
    return { ok: true };
  }

  private respond(res: Response, result: AuthResult) {
    setRefreshCookie(res, this.env, result.refreshToken, result.refreshExpiresAt);
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      ...(result.workspaceSlug ? { workspaceSlug: result.workspaceSlug } : {}),
    };
  }
}
