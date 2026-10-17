# Progress

## Phase 1 — Scaffold (2026-10-17)
- Done: NestJS 11 skeleton with env validation (Zod), pino logging with request ids, global error filter, helmet/CORS, OpenAPI at `/api/docs`, health + readiness endpoints, Dockerfile (multi-stage, non-root, healthcheck, migrations on start), compose with Postgres 16 and the restricted DB role init script, CI workflow.
- Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` (22 passing), `docker compose up` → api healthy, `/api/v1/health/ready` reports DB up, docs return 200.
- Next: Phase 2 — Prisma schema, RLS migration, tenant helper, seed.

## Phase 2 — Database (2026-10-17)
- Done: full Prisma schema (spec §5 + `EmailVerificationToken`, `Task.createdById`), init migration, a separate RLS migration (helper functions, grants, `FORCE ROW LEVEL SECURITY`, tenant policies, membership read policy, append-only audit log, `admin_workspace_stats()` SECURITY DEFINER aggregate), `withTenant`/`withUser` transaction helpers, deterministic seed.
- Verified: 42 tests passing (20 new RLS tests at the DB layer: role is not superuser/bypass/owner, zero rows without context, zero cross-tenant rows for all 5 tables, cross-tenant insert/update/delete/move rejected, audit log append-only, settings don't leak across transactions). `pnpm seed` in the API container creates the §9 demo data.
- Next: Phase 3 — auth module.
