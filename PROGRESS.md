# Progress

## Phase 1 — Scaffold (2026-10-17)
- Done: NestJS 11 skeleton with env validation (Zod), pino logging with request ids, global error filter, helmet/CORS, OpenAPI at `/api/docs`, health + readiness endpoints, Dockerfile (multi-stage, non-root, healthcheck, migrations on start), compose with Postgres 16 and the restricted DB role init script, CI workflow.
- Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` (22 passing), `docker compose up` → api healthy, `/api/v1/health/ready` reports DB up, docs return 200.
- Next: Phase 2 — Prisma schema, RLS migration, tenant helper, seed.

## Phase 2 — Database (2026-10-17)
- Done: full Prisma schema (spec §5 + `EmailVerificationToken`, `Task.createdById`), init migration, a separate RLS migration (helper functions, grants, `FORCE ROW LEVEL SECURITY`, tenant policies, membership read policy, append-only audit log, `admin_workspace_stats()` SECURITY DEFINER aggregate), `withTenant`/`withUser` transaction helpers, deterministic seed.
- Verified: 42 tests passing (20 new RLS tests at the DB layer: role is not superuser/bypass/owner, zero rows without context, zero cross-tenant rows for all 5 tables, cross-tenant insert/update/delete/move rejected, audit log append-only, settings don't leak across transactions). `pnpm seed` in the API container creates the §9 demo data.
- Next: Phase 3 — auth module.

## Phase 3 — Auth (2026-10-17)
- Done: `EmailProvider` (mock → `dev_emails`, Resend via HTTP), signup (user + workspace + owner membership + audit in one RLS transaction), login with timing-safe unknown-email path, refresh rotation with family reuse detection (also catches concurrent replays via a conditional update), logout, forgot/reset (hashed, single-use, 1 h, revokes all sessions), email verification (+ resend), global JWT guard with `@Public()`, `/me` and `/me/workspaces`, 10/min/IP throttle on auth routes.
- Verified: 65 tests passing (23 new auth/rate-limit cases).
- Next: Phase 4 — workspace guard + RBAC, workspaces, members, invites, isolation suite.

## Phase 4 — Workspaces, members, invites, RBAC (2026-10-17)
- Done: `@RequirePermission()` (membership check for `X-Workspace-Id` or `:workspaceId`, suspended → 403 `WORKSPACE_SUSPENDED`, permission matrix), `@SuperAdminOnly()`; workspaces create/get (with plan usage)/update/delete/transfer/logo upload (signature-checked PNG/JPEG/WebP ≤ 1 MB; local + S3 storage providers); members list/role change/remove; invites create/list/resend/revoke/preview/accept (magic link, single use, `<workspaceId>.<secret>` tokens); server-side member limit (members + pending invites) with an advisory lock; audit entries for every change.
- Verified: 115 tests passing — new suites: workspaces (9), members & invites (15), RBAC (11), API isolation (16).
- Next: Phase 5 — projects & tasks (+ isolation cases for them).

## Phase 5 — Projects & Tasks (2026-10-17)
- Done: projects CRUD (with per-status task counts), project plan limit, tasks CRUD with column positions, "own task" rule for members (creator or assignee), assignee must be a workspace member, Kanban reorder endpoint (rewrites positions; cross-column moves need edit rights).
- Verified: 142 tests passing — projects suite (14, incl. a parallel-request race against the Free limit: exactly 3 of 6 succeed) and 13 new API isolation cases.
- Next: Phase 6 — billing providers, webhooks, plan changes.
