import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppException } from '../common/app-exception';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { permissionsFor } from '../shared';
import { toPublicUser } from './auth.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() auth: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw AppException.unauthenticated();
    return { ...toPublicUser(user), readOnly: auth.readOnly === true, impersonatorId: auth.impersonatorId ?? null };
  }

  /** Workspaces the user belongs to, with their role and permissions (for the switcher). */
  @Get('workspaces')
  async workspaces(@CurrentUser() auth: AuthUser) {
    const memberships = await this.prisma.withUser(auth.id, (tx) =>
      tx.membership.findMany({
        where: { userId: auth.id },
        include: { workspace: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      logoUrl: m.workspace.logoUrl,
      plan: m.workspace.plan,
      status: m.workspace.status,
      role: m.role,
      permissions: permissionsFor(m.role),
    }));
  }
}
