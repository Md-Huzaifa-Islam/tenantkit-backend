# TenantKit Backend — Checklist

Spec: `requirements/PROJECT_REQUIREMENTS.md` (full product spec; this repo covers the API).
Companion repo: `tenantkit-frontend`. Legend: `[ ]` pending · `[~]` in progress · `[x]` done & verified · `[!]` blocked.

### Phase 1 — Scaffold
- [x] NestJS 11 app, pnpm, ESLint/Prettier/TS config
- [x] `GET /api/v1/health` (liveness) and `/health/ready` (DB check)
- [x] Consistent error format `{error:{code,message,details}}`, pino JSON logs with request id, helmet, CORS allowlist
- [x] OpenAPI at `/api/docs` (+ `/api/docs/json`)
- [x] Dockerfile + `docker-compose.yml` (postgres, api) on named network `tenantkit-net`
- [x] `.env.example` documented; zero keys required
- [x] GitHub Actions CI (lint, typecheck, test with Postgres, build, Docker build)

### Phase 2 — Database
- [x] Prisma schema (all spec §5 models)
- [x] Migration with RLS policies (Project, Task, AuditLog, Invite, Membership)
- [x] Restricted `tenantkit_app` role (no superuser, no BYPASSRLS, not owner)
- [x] Tenant transaction helper (`set_config('app.workspace_id', …, true)`)
- [x] Seed script (spec §9)

### Phase 3 — Auth
- [x] signup (+ first workspace), login, logout, refresh, forgot, reset, verify
- [x] argon2id; JWT access 15 min; rotating refresh cookie with family reuse detection
- [x] Hashed, single-use, expiring tokens; rate limit 10/min/IP
- [x] Tests

### Phase 4 — Workspaces, members, invites, RBAC
- [x] Permission matrix + `@RequirePermission()` guard, `X-Workspace-Id`, suspended → 403
- [x] Workspaces CRUD, transfer, logo upload (local + S3 providers)
- [x] Members + invites (create/list/resend/revoke/accept)
- [x] Tenant isolation suite (≥ 15 cases, API + raw RLS) and RBAC tests — 20 DB-layer + 33 API-layer cases

### Phase 5 — Projects & Tasks
- [x] CRUD + reorder, tests

### Phase 6 — Billing
- [x] `BillingProvider` (mock + Stripe), checkout/portal/status/webhook
- [x] Idempotent webhook (StripeEvent), plan limits, tests

### Phase 7 — Audit log, admin, dev mailbox
- [x] Audit entries for membership/role/billing/settings changes; filterable endpoint
- [x] Admin workspaces list, suspend, metrics
- [x] Dev mailbox endpoint

- [x] Read-only impersonation for super admins (spec §3 role table), audited

### Delivery
- [x] README (architecture, isolation guarantee, test summary, demo credentials)
- [x] `docs/architecture.md` (mermaid)

## Acceptance (spec §13, backend items)
- [x] `docker compose up` then `pnpm seed` works with no API keys
- [x] All tests green in CI; isolation suite ≥ 15 cases (53)
- [x] API DB role cannot bypass RLS (verified in a test)
- [x] Plan limits enforced server-side
- [x] Duplicate Stripe webhook not double-processed
- [x] Audit log covers every membership, role, billing and settings change
- [x] OpenAPI docs at `/api/docs`
