import { PrismaClient } from '@prisma/client';

/** Owner connection for arranging test data across tenants (bypasses RLS as superuser). */
export const ownerDb = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_MIGRATION_URL } },
});

/** Restricted connection, identical to what the API uses at runtime. */
export const appDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export async function resetDb() {
  await ownerDb.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, tasks, projects, invites, memberships, refresh_tokens,
       password_reset_tokens, email_verification_tokens, workspaces, users, stripe_events, dev_emails
     RESTART IDENTITY CASCADE`,
  );
}

let n = 0;
export async function makeTenant(label: string) {
  n++;
  const user = await ownerDb.user.create({
    data: { email: `${label}-${n}-${Date.now()}@test.dev`, name: label, passwordHash: 'x' },
  });
  const workspace = await ownerDb.workspace.create({
    data: { name: `${label} ws`, slug: `${label}-${n}-${Date.now()}`.toLowerCase() },
  });
  await ownerDb.membership.create({
    data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
  });
  const project = await ownerDb.project.create({
    data: { workspaceId: workspace.id, name: `${label} project`, createdById: user.id },
  });
  const task = await ownerDb.task.create({
    data: { workspaceId: workspace.id, projectId: project.id, title: `${label} task`, createdById: user.id },
  });
  await ownerDb.auditLog.create({
    data: { workspaceId: workspace.id, actorId: user.id, action: 'workspace.created' },
  });
  await ownerDb.invite.create({
    data: {
      workspaceId: workspace.id,
      email: `invitee-${n}@test.dev`,
      role: 'MEMBER',
      tokenHash: `hash-${label}-${n}-${Date.now()}`,
      invitedById: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return { user, workspace, project, task };
}
