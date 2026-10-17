import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app-exception';
import { IS_PUBLIC } from '../common/metadata';
import type { AppRequest } from '../common/request-context';

interface AccessPayload {
  sub: string;
  email: string;
  sa?: boolean;
}

/** Global guard: every route needs a valid Bearer access token unless marked `@Public()`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppException.unauthenticated();
    try {
      const payload = this.jwt.verify<AccessPayload>(header.slice(7));
      req.user = { id: payload.sub, email: payload.email, isSuperAdmin: payload.sa === true };
      return true;
    } catch {
      throw AppException.unauthenticated('Access token is invalid or expired');
    }
  }
}
