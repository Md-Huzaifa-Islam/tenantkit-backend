# Decisions

One line per decision, with the reason.

- Frontend and backend are separate repositories that share no code: the owner's standard layout. Shared definitions (permission matrix, plans, Zod schemas) are duplicated in `src/shared/` and must be kept in sync with `tenantkit-frontend/src/lib/shared/`.
- The spec lives at `requirements/PROJECT_REQUIREMENTS.md` (not `SPEC.md`): the owner's standard layout.
- Pinned majors: NestJS 11, Prisma 6, TypeScript 5.9, Zod 3.25: newest stable lines with proven compatibility (Nest 12 / Prisma 7 / TS 7 are too fresh for the libraries used).
- Zod (via `nestjs-zod`) validates every input instead of class-validator: the spec allows either, and it keeps schemas identical to the frontend's form validation.
- Two DB connection strings: `DATABASE_URL` (restricted `tenantkit_app` role, used at runtime) and `DATABASE_MIGRATION_URL` (schema owner, Prisma `directUrl`, used by migrations and seeding only).
- Backend compose names its network `tenantkit-net` and aliases the API as `api`, so the separately-managed frontend compose can join it without sharing files.
- `pnpm seed` runs inside the API container (`docker compose exec`), matching the spec's "docker compose up then pnpm seed" with no host DB setup.
- Docker images use `node:24-bookworm-slim` + corepack pnpm: glibc avoids musl issues with argon2 and Prisma engines.
- Host Postgres port defaults to 5433 to avoid clashing with a locally installed Postgres on 5432.
- Tests run against a separate `tenantkit_test` database on the compose Postgres (created automatically by Jest global setup).
