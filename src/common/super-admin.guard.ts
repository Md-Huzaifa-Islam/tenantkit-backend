import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from './app-exception';
import type { AppRequest } from './request-context';

/** Re-checks super-admin status in the database (the JWT claim is only a UI hint). */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw AppException.unauthenticated();
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id }, select: { isSuperAdmin: true } });
    if (!user?.isSuperAdmin) throw AppException.forbidden('Super admin access required');
    return true;
  }
}
