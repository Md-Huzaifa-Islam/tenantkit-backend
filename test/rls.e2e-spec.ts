import { Prisma } from '@prisma/client';
import { appDb, makeTenant, ownerDb, resetDb } from './db';

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

/** Runs raw queries as the app role inside a transaction with the given RLS context. */
function asTenant<T>(workspaceId: string | null, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return appDb.$transaction(async (tx) => {
    if (workspaceId) {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
    }
    return fn(tx);
  });
}

describe('row-level security (database layer)', () => {
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    await resetDb();
    a = await makeTenant('alpha');
    b = await makeTenant('beta');
  });

  afterAll(async () => {
    await appDb.$disconnect();
    await ownerDb.$disconnect();
  });

  it('connects as a role that is not a superuser and cannot bypass RLS', async () => {
    const [role] = await appDb.$queryRaw<Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.rolname).toBe('tenantkit_app');
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it('does not own any tenant table (owners could bypass non-forced RLS)', async () => {
    const owned = await appDb.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(owned).toEqual([]);
  });

  it('has RLS enabled and forced on every tenant table', async () => {
    const rows = await ownerDb.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('projects', 'tasks', 'audit_logs', 'invites', 'memberships') ORDER BY relname`;
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.relforcerowsecurity).toBe(true);
    }
  });

  it.each(['projects', 'tasks', 'audit_logs', 'invites', 'memberships'])(
    'returns zero %s rows when no workspace context is set',
    async (table) => {
      const [row] = await asTenant(null, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM ${table}`),
      );
      expect(Number(row.count)).toBe(0);
    },
  );

  it.each(['projects', 'tasks', 'audit_logs', 'invites', 'memberships'])(
    'returns zero of workspace B %s rows under workspace A context',
    async (table) => {
      const [row] = await asTenant(a.workspace.id, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*)::bigint AS count FROM ${table} WHERE workspace_id = $1::uuid`,
          b.workspace.id,
        ),
      );
      expect(Number(row.count)).toBe(0);
    },
  );

  it('sees its own rows under the right context', async () => {
    const projects = await asTenant(a.workspace.id, (tx) => tx.project.findMany());
    expect(projects.map((p) => p.id)).toEqual([a.project.id]);
  });

  it('cannot read workspace B data even when querying by primary key', async () => {
    const found = await asTenant(a.workspace.id, (tx) => tx.task.findUnique({ where: { id: b.task.id } }));
    expect(found).toBeNull();
  });

  it('rejects inserting a row into another workspace', async () => {
    await expect(
      asTenant(a.workspace.id, (tx) =>
        tx.project.create({
          data: { workspaceId: b.workspace.id, name: 'smuggled', createdById: a.user.id },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another workspace’s rows', async () => {
    const updated = await asTenant(a.workspace.id, (tx) =>
      tx.project.updateMany({ where: { id: b.project.id }, data: { name: 'hacked' } }),
    );
    const deleted = await asTenant(a.workspace.id, (tx) => tx.task.deleteMany({ where: { id: b.task.id } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const still = await ownerDb.project.findUniqueOrThrow({ where: { id: b.project.id } });
    expect(still.name).toBe('beta project');
  });

  it('cannot move its own row into another workspace', async () => {
    await expect(
      asTenant(a.workspace.id, (tx) =>
        tx.project.update({ where: { id: a.project.id }, data: { workspaceId: b.workspace.id } }),
      ),
    ).rejects.toThrow();
  });

  it('treats the audit log as append-only for the app role', async () => {
    await expect(
      asTenant(a.workspace.id, (tx) => tx.auditLog.updateMany({ data: { action: 'tampered' } })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(a.workspace.id, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/);
  });

  it('settings do not leak outside the transaction that set them', async () => {
    await asTenant(a.workspace.id, async () => undefined);
    const [row] = await appDb.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM projects`;
    expect(Number(row.count)).toBe(0);
  });
});
