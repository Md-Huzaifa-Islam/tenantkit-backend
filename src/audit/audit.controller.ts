import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { CurrentUser, CurrentWorkspace, RequirePermission } from '../common/decorators';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { auditLogQuerySchema } from '../shared';

class AuditLogQueryDto extends createZodDto(auditLogQuerySchema) {}

/** A bare date means the whole day: `from` is its start and `to` its end (UTC). */
function bound(value: string | undefined, edge: 'start' | 'end') {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
  }
  return new Date(value);
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Query() q: AuditLogQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      workspaceId: ws.id,
      ...(q.action ? { action: q.action.endsWith('.*') ? { startsWith: q.action.slice(0, -1) } : q.action } : {}),
      ...(q.actor ? { actorId: q.actor } : {}),
      ...(q.from || q.to ? { createdAt: { gte: bound(q.from, 'start'), lte: bound(q.to, 'end') } } : {}),
    };
    return this.prisma.withTenant({ workspaceId: ws.id, userId: user.id }, async (tx) => {
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.auditLog.count({ where }),
      ]);
      return {
        items: items.map((i) => ({
          id: i.id,
          action: i.action,
          actor: i.actor,
          targetType: i.targetType,
          targetId: i.targetId,
          metadata: i.metadata,
          ip: i.ip,
          createdAt: i.createdAt,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      };
    });
  }
}
