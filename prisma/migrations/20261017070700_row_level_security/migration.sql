-- =============================================================================
-- Tenant isolation with Postgres Row-Level Security
--
-- The API connects as `tenantkit_app`: not a superuser, no BYPASSRLS, and not the
-- owner of any table. Each request runs inside a transaction that sets
--   app.workspace_id  (active workspace, verified by the API's membership guard)
--   app.user_id       (authenticated user)
-- with set_config(..., true), so the values are scoped to that transaction only.
-- Without them, tenant tables return zero rows.
-- =============================================================================

-- The login role is normally created (with a password) by the database bootstrap
-- script. Create a NOLOGIN placeholder if it is missing so grants never fail.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenantkit_app') THEN
    CREATE ROLE tenantkit_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ---------- Privileges ----------
GRANT USAGE ON SCHEMA public TO tenantkit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenantkit_app;
REVOKE ALL ON TABLE "_prisma_migrations" FROM tenantkit_app;
-- The audit log is append-only for the application.
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM tenantkit_app;
GRANT EXECUTE ON FUNCTION app_current_workspace_id() TO tenantkit_app;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO tenantkit_app;

-- ---------- Tenant-scoped tables ----------
ALTER TABLE projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects   FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks      FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE invites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites    FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON projects
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (workspace_id = app_current_workspace_id());

CREATE POLICY tenant_isolation ON tasks
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (workspace_id = app_current_workspace_id());

CREATE POLICY tenant_isolation ON audit_logs
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (workspace_id = app_current_workspace_id());

CREATE POLICY tenant_isolation ON invites
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (workspace_id = app_current_workspace_id());

-- ---------- Memberships ----------
-- Readable inside the active workspace, or by the member themself (needed for the
-- workspace switcher and for the guard's membership check). Writable only inside
-- the active workspace.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_select ON memberships FOR SELECT
  USING (workspace_id = app_current_workspace_id() OR user_id = app_current_user_id());
CREATE POLICY membership_insert ON memberships FOR INSERT
  WITH CHECK (workspace_id = app_current_workspace_id());
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (workspace_id = app_current_workspace_id())
  WITH CHECK (workspace_id = app_current_workspace_id());
CREATE POLICY membership_delete ON memberships FOR DELETE
  USING (workspace_id = app_current_workspace_id());

-- ---------- Platform admin aggregate ----------
-- The super-admin panel needs per-workspace counts across tenants. Instead of giving
-- the app role any bypass, this SECURITY DEFINER function exposes counts only (no
-- tenant content). The API calls it only after verifying the caller is a super admin.
CREATE OR REPLACE FUNCTION admin_workspace_stats()
  RETURNS TABLE (workspace_id uuid, member_count bigint, project_count bigint, task_count bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT w.id,
           (SELECT count(*) FROM memberships m WHERE m.workspace_id = w.id),
           (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id),
           (SELECT count(*) FROM tasks t WHERE t.workspace_id = w.id)
    FROM workspaces w
  $$;
REVOKE ALL ON FUNCTION admin_workspace_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_workspace_stats() TO tenantkit_app;
