-- Adds the owner's user id to the super-admin aggregate (still no tenant content).
DROP FUNCTION IF EXISTS admin_workspace_stats();

CREATE FUNCTION admin_workspace_stats()
  RETURNS TABLE (workspace_id uuid, owner_id uuid, member_count bigint, project_count bigint, task_count bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT w.id,
           (SELECT m.user_id FROM memberships m WHERE m.workspace_id = w.id AND m.role = 'OWNER' LIMIT 1),
           (SELECT count(*) FROM memberships m WHERE m.workspace_id = w.id),
           (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id),
           (SELECT count(*) FROM tasks t WHERE t.workspace_id = w.id)
    FROM workspaces w
  $$;
REVOKE ALL ON FUNCTION admin_workspace_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_workspace_stats() TO tenantkit_app;
