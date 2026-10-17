import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS } from '../shared';

interface StatsRow {
  workspace_id: string;
  owner_id: string | null;
  member_count: bigint;
  project_count: bigint;
  task_count: bigint;
}

const IMPERSONATION_TTL_SECONDS = 15 * 60;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  /** Cross-tenant counts come only from the SECURITY DEFINER aggregate (no tenant rows). */
  private async stats(): Promise<Map<string, StatsRow>> {
    const rows = await this.prisma.$queryRaw<StatsRow[]>`SELECT * FROM admin_workspace_stats()`;
    return new Map(rows.map((r) => [r.workspace_id, r]));
  }

  async workspaces(q: string | undefined, page: number, pageSize: number) {
    const where = q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { slug: { contains: q, mode: 'insensitive' as const } }] }
      : {};
    const [workspaces, total, stats] = await Promise.all([
      this.prisma.workspace.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.workspace.count({ where }),
      this.stats(),
    ]);
    const ownerIds = workspaces.map((w) => stats.get(w.id)?.owner_id).filter((id): id is string => Boolean(id));
    const owners = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
    );
    return {
      items: workspaces.map((w) => {
        const s = stats.get(w.id);
        return {
          id: w.id,
          name: w.name,
          slug: w.slug,
          plan: w.plan,
          status: w.status,
          createdAt: w.createdAt,
          memberCount: Number(s?.member_count ?? 0),
          projectCount: Number(s?.project_count ?? 0),
          taskCount: Number(s?.task_count ?? 0),
          owner: s?.owner_id ? (owners.get(s.owner_id) ?? null) : null,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async setSuspended(admin: AuthUser, workspaceId: string, suspended: boolean, ip: string | null) {
    return this.prisma.withTenant({ workspaceId, userId: admin.id }, async (tx) => {
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!ws) throw AppException.notFound('Workspace');
      const status = suspended ? 'SUSPENDED' : 'ACTIVE';
      if (ws.status === status) return { id: ws.id, status };
      await tx.workspace.update({ where: { id: workspaceId }, data: { status } });
      await this.audit.record(tx, {
        workspaceId,
        actorId: admin.id,
        action: suspended ? 'workspace.suspended' : 'workspace.unsuspended',
        targetType: 'workspace',
        targetId: workspaceId,
        metadata: { by: 'super_admin' },
        ip,
      });
      return { id: workspaceId, status };
    });
  }

  async metrics() {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(now - 30 * 86_400_000);
    const [byPlanStatus, activeUsers7d, totalUsers, recent] = await Promise.all([
      this.prisma.workspace.groupBy({ by: ['plan', 'status'], _count: { _all: true } }),
      this.prisma.user.count({ where: { lastActiveAt: { gte: sevenDaysAgo } } }),
      this.prisma.user.count(),
      this.prisma.workspace.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true } }),
    ]);

    const count = (pred: (r: (typeof byPlanStatus)[number]) => boolean) =>
      byPlanStatus.filter(pred).reduce((n, r) => n + r._count._all, 0);
    // MRR from the plan stored on each active workspace (kept in sync by mock or Stripe webhooks).
    const mrrCents = byPlanStatus
      .filter((r) => r.status === 'ACTIVE')
      .reduce((sum, r) => sum + PLANS[r.plan].priceMonthlyCents * r._count._all, 0);

    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now - (29 - i) * 86_400_000);
      return d.toISOString().slice(0, 10);
    });
    const perDay = new Map(days.map((d) => [d, 0]));
    for (const w of recent) {
      const key = w.createdAt.toISOString().slice(0, 10);
      if (perDay.has(key)) perDay.set(key, perDay.get(key)! + 1);
    }

    return {
      workspaces: {
        total: count(() => true),
        active: count((r) => r.status === 'ACTIVE'),
        suspended: count((r) => r.status === 'SUSPENDED'),
        byPlan: { FREE: count((r) => r.plan === 'FREE'), PRO: count((r) => r.plan === 'PRO'), BUSINESS: count((r) => r.plan === 'BUSINESS') },
      },
      mrrCents,
      activeUsers7d,
      totalUsers,
      signups30d: days.map((date) => ({ date, workspaces: perDay.get(date)! })),
    };
  }

  /**
   * Read-only impersonation of a workspace owner for support. The token carries
   * `ro: true` (the JWT guard rejects every non-GET request), expires in 15 minutes,
   * has no refresh token, and the session is recorded in the workspace's audit log.
   */
  async impersonate(admin: AuthUser, workspaceId: string, ip: string | null) {
    const stats = await this.stats();
    const ownerId = stats.get(workspaceId)?.owner_id;
    if (!ownerId) throw AppException.notFound('Workspace');
    const [owner, workspace] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: ownerId } }),
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    ]);
    await this.prisma.withTenant({ workspaceId, userId: admin.id }, (tx) =>
      this.audit.record(tx, {
        workspaceId,
        actorId: admin.id,
        action: 'workspace.impersonated',
        targetType: 'user',
        targetId: owner.id,
        metadata: { readOnly: true, viewedAs: owner.email },
        ip,
      }),
    );
    const accessToken = this.jwt.sign(
      { sub: owner.id, email: owner.email, sa: false, imp: admin.id, ro: true },
      { expiresIn: IMPERSONATION_TTL_SECONDS },
    );
    return {
      accessToken,
      expiresIn: IMPERSONATION_TTL_SECONDS,
      user: { id: owner.id, email: owner.email, name: owner.name, avatarUrl: owner.avatarUrl, emailVerified: true, isSuperAdmin: false },
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      readOnly: true,
    };
  }
}
