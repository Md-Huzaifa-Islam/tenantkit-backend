import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { AppException } from '../common/app-exception';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, type CreateWorkspaceInput, type UpdateWorkspaceInput } from '../shared';
import { StorageProvider } from '../storage/storage.provider';
import { availableSlug, createWorkspaceWithOwner } from './workspace-factory';

const LOGO_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};
export const MAX_LOGO_BYTES = 1024 * 1024;

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
    private readonly storage: StorageProvider,
  ) {}

  async create(user: AuthUser, input: CreateWorkspaceInput, ip: string | null) {
    const slug = await availableSlug(this.prisma, input.name, input.slug);
    if (!slug) throw AppException.conflict('That workspace URL is already taken');
    const workspaceId = randomUUID();
    return this.prisma.withTenant({ workspaceId, userId: user.id }, (tx) =>
      createWorkspaceWithOwner(tx, this.audit, { workspaceId, name: input.name, slug, ownerId: user.id, ip }),
    );
  }

  async get(ws: WorkspaceContext, userId: string) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId }, async (tx) => {
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ws.id } });
      const [projects, members] = await Promise.all([
        this.limits.usage(tx, ws.id, 'projects'),
        this.limits.usage(tx, ws.id, 'members'),
      ]);
      const plan = PLANS[workspace.plan];
      return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        logoUrl: workspace.logoUrl,
        plan: workspace.plan,
        status: workspace.status,
        createdAt: workspace.createdAt,
        role: ws.role,
        usage: {
          projects: { used: projects, limit: plan.maxProjects },
          members: { used: members, limit: plan.maxMembers },
        },
      };
    });
  }

  async update(ws: WorkspaceContext, user: AuthUser, input: UpdateWorkspaceInput, ip: string | null) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId: user.id }, async (tx) => {
      const before = await tx.workspace.findUniqueOrThrow({ where: { id: ws.id } });
      if (input.slug && input.slug !== before.slug) {
        const taken = await tx.workspace.findUnique({ where: { slug: input.slug } });
        if (taken) throw AppException.conflict('That workspace URL is already taken');
      }
      const updated = await tx.workspace.update({ where: { id: ws.id }, data: input });
      const changes = Object.fromEntries(
        (Object.keys(input) as Array<keyof UpdateWorkspaceInput>)
          .filter((k) => before[k] !== updated[k])
          .map((k) => [k, { from: before[k], to: updated[k] }]),
      );
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          workspaceId: ws.id,
          actorId: user.id,
          action: 'workspace.updated',
          targetType: 'workspace',
          targetId: ws.id,
          metadata: changes,
          ip,
        });
      }
      return updated;
    });
  }

  async remove(ws: WorkspaceContext) {
    // Cascades remove memberships, invites, projects, tasks and audit logs.
    await this.prisma.workspace.delete({ where: { id: ws.id } });
  }

  async transferOwnership(ws: WorkspaceContext, user: AuthUser, targetUserId: string, ip: string | null) {
    if (targetUserId === user.id) throw AppException.badRequest('You already own this workspace');
    return this.prisma.withTenant({ workspaceId: ws.id, userId: user.id }, async (tx) => {
      const target = await tx.membership.findUnique({
        where: { userId_workspaceId: { userId: targetUserId, workspaceId: ws.id } },
      });
      if (!target) throw AppException.notFound('Member');
      await tx.membership.update({ where: { id: target.id }, data: { role: 'OWNER' } });
      await tx.membership.update({
        where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
        data: { role: 'ADMIN' },
      });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: user.id,
        action: 'workspace.ownership_transferred',
        targetType: 'membership',
        targetId: target.id,
        metadata: { fromUserId: user.id, toUserId: targetUserId },
        ip,
      });
      return { ok: true };
    });
  }

  async uploadLogo(ws: WorkspaceContext, user: AuthUser, file: Express.Multer.File | undefined, ip: string | null) {
    if (!file) throw AppException.badRequest('Attach an image file in the "file" field');
    const type = LOGO_TYPES[file.mimetype];
    // Check the real file signature, not just the client-supplied content type.
    if (!type || !type.magic(file.buffer)) throw AppException.badRequest('Logo must be a PNG, JPEG or WebP image');
    if (file.size > MAX_LOGO_BYTES) throw AppException.badRequest('Logo must be 1 MB or smaller');

    const url = await this.storage.put(`logos/${ws.id}/${randomUUID()}.${type.ext}`, file.buffer, file.mimetype);
    return this.prisma.withTenant({ workspaceId: ws.id, userId: user.id }, async (tx) => {
      const updated = await tx.workspace.update({ where: { id: ws.id }, data: { logoUrl: url } });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: user.id,
        action: 'workspace.logo_updated',
        targetType: 'workspace',
        targetId: ws.id,
        metadata: { logoUrl: url },
        ip,
      });
      return { logoUrl: updated.logoUrl };
    });
  }
}
