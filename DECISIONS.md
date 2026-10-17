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
- Added `EmailVerificationToken` and `Task.createdById` to the spec's data model: verification needs a stored token, and "members CRUD their own tasks" needs to know who created a task.
- "Own task" = created by or assigned to the member.
- Members can view all projects in their workspace: the spec's data model has no per-project membership table.
- RLS is FORCED on tenant tables, so even the table owner is subject to policies (only superusers bypass, and the API never uses one).
- The super-admin panel reads cross-tenant counts through a single `SECURITY DEFINER` function that returns aggregates only, instead of granting the app role any bypass.
- The audit log is append-only for the app role (UPDATE/DELETE revoked).
- Invite tokens are `<workspaceId>.<secret>`; only the SHA-256 of the secret is stored. The workspace prefix lets the API set the RLS context before looking the invite up.
- The seed truncates all tables first: re-running it always produces the same demo state.
- Refresh tokens are strictly single-use: two concurrent refreshes with the same token count as reuse and revoke the family. The web client de-duplicates in-flight refresh calls to avoid self-inflicted logouts.
- The refresh cookie is `HttpOnly; SameSite=Lax; Path=/api/v1/auth`, so it is only ever sent to the auth endpoints.
- Unverified users can still sign in (with a banner in the UI); verification is not a hard gate because the spec doesn't require one.
- `isSuperAdmin` in the access token is only a UI hint; admin routes re-check the database.
