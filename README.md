# TenantKit — Backend (API)

NestJS + Prisma + PostgreSQL API for **TenantKit**, a multi-tenant SaaS starter: workspaces, RBAC,
Postgres row-level security, Stripe billing (with a mock provider), audit logs and an admin panel.

> Work in progress — see [`PROGRESS.md`](PROGRESS.md) and [`docs/CHECKLIST.md`](docs/CHECKLIST.md).
> The web app lives in the separate `tenantkit-frontend` repository.

## Quick start (Docker)

```bash
cp .env.example .env          # optional: defaults work out of the box
docker compose up -d --build  # postgres + api on http://localhost:4000
curl localhost:4000/api/v1/health/ready
```

- OpenAPI docs: http://localhost:4000/api/docs
- Stop: `docker compose down` (add `-v` to wipe the database)
- Logs: `docker compose logs -f api`

## Local development

```bash
pnpm install
docker compose up -d postgres
pnpm test        # lint/typecheck: pnpm lint && pnpm typecheck
```
