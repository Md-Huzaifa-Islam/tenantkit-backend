import { randomUUID } from 'node:crypto';
import type { PrismaService, Tx } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { RESERVED_SLUGS } from '../shared';
import { slugify, slugWithSuffix } from './slug';

/** Picks a free slug: the requested/derived one, or a suffixed variant if taken. */
export async function availableSlug(prisma: PrismaService | Tx, name: string, requested?: string) {
  const base = requested ?? slugify(name);
  const reserved = (RESERVED_SLUGS as readonly string[]).includes(base);
  const taken = reserved || (await prisma.workspace.findUnique({ where: { slug: base }, select: { id: true } }));
  if (!taken) return base;
  if (requested) return null; // an explicitly requested slug must be exact
  for (let i = 0; i < 5; i++) {
    const candidate = slugWithSuffix(base);
    const exists = await prisma.workspace.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return slugWithSuffix(base);
}

/**
 * Creates a workspace, the owner membership and the first audit entry inside a
 * transaction whose RLS context is the new workspace.
 */
export async function createWorkspaceWithOwner(
  tx: Tx,
  audit: AuditService,
  input: { workspaceId?: string; name: string; slug: string; ownerId: string; ip?: string | null },
) {
  const workspace = await tx.workspace.create({
    data: { id: input.workspaceId ?? randomUUID(), name: input.name, slug: input.slug },
  });
  await tx.membership.create({
    data: { userId: input.ownerId, workspaceId: workspace.id, role: 'OWNER' },
  });
  await audit.record(tx, {
    workspaceId: workspace.id,
    actorId: input.ownerId,
    action: 'workspace.created',
    targetType: 'workspace',
    targetId: workspace.id,
    metadata: { name: workspace.name, slug: workspace.slug },
    ip: input.ip,
  });
  return workspace;
}
