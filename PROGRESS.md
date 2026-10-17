# Progress

## Phase 1 — Scaffold (2026-10-17)
- Done: NestJS 11 skeleton with env validation (Zod), pino logging with request ids, global error filter, helmet/CORS, OpenAPI at `/api/docs`, health + readiness endpoints, Dockerfile (multi-stage, non-root, healthcheck, migrations on start), compose with Postgres 16 and the restricted DB role init script, CI workflow.
- Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` (22 passing), `docker compose up` → api healthy, `/api/v1/health/ready` reports DB up, docs return 200.
- Next: Phase 2 — Prisma schema, RLS migration, tenant helper, seed.
