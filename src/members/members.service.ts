import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { canManageMember, type AssignableRole } from '../shared';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ws: WorkspaceContext, userId: string) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId }, async (tx) => {
      const members = await tx.membership.findMany({
        where: { workspaceId: ws.id },
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      });
      return members.map((m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.createdAt,
        user: m.user,
      }));
    });
  }

  updateRole(ws: WorkspaceContext, actor: AuthUser, membershipId: string, role: AssignableRole, ip: string | null) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId: actor.id }, async (tx) => {
      // RLS makes memberships of other workspaces invisible, so a foreign id is simply "not found".
      const target = await tx.membership.findFirst({ where: { id: membershipId, workspaceId: ws.id } });
      if (!target) throw AppException.notFound('Member');
      if (target.userId === actor.id) throw AppException.forbidden('You cannot change your own role');
      if (!canManageMember(ws.role, target.role)) throw AppException.forbidden('You cannot change this member’s role');
      if (target.role === role) return { id: target.id, role };

      const updated = await tx.membership.update({ where: { id: target.id }, data: { role } });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: actor.id,
        action: 'member.role_changed',
        targetType: 'membership',
        targetId: target.id,
        metadata: { userId: target.userId, from: target.role, to: role },
        ip,
      });
      return { id: updated.id, role: updated.role };
    });
  }

  remove(ws: WorkspaceContext, actor: AuthUser, membershipId: string, ip: string | null) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId: actor.id }, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, workspaceId: ws.id },
        include: { user: { select: { email: true } } },
      });
      if (!target) throw AppException.notFound('Member');
      if (target.userId === actor.id) throw AppException.forbidden('You cannot remove yourself');
      if (!canManageMember(ws.role, target.role)) throw AppException.forbidden('You cannot remove this member');

      await tx.membership.delete({ where: { id: target.id } });
      await tx.task.updateMany({ where: { workspaceId: ws.id, assigneeId: target.userId }, data: { assigneeId: null } });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: actor.id,
        action: 'member.removed',
        targetType: 'membership',
        targetId: target.id,
        metadata: { userId: target.userId, email: target.user.email, role: target.role },
        ip,
      });
    });
  }
}
