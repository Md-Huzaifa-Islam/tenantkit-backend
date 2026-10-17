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
- [~] Tenant isolation suite (≥ 15 cases, API + raw RLS) and RBAC tests — 20 DB + 29 API cases so far; audit-log cases added in phase 7

### Phase 5 — Projects & Tasks
- [x] CRUD + reorder, tests

### Phase 6 — Billing
- [ ] `BillingProvider` (mock + Stripe), checkout/portal/status/webhook
- [ ] Idempotent webhook (StripeEvent), plan limits, tests

### Phase 7 — Audit log, admin, dev mailbox
- [ ] Audit entries for membership/role/billing/settings changes; filterable endpoint
- [ ] Admin workspaces list, suspend, metrics
- [ ] Dev mailbox endpoint

### Delivery
- [ ] README (architecture, isolation guarantee, test summary, demo credentials)
- [ ] `docs/architecture.md` (mermaid)

## Acceptance (spec §13, backend items)
- [ ] `docker compose up` then `pnpm seed` works with no API keys
- [ ] All tests green in CI; isolation suite ≥ 15 cases
- [x] API DB role cannot bypass RLS (verified in a test)
- [ ] Plan limits enforced server-side
- [ ] Duplicate Stripe webhook not double-processed
- [ ] Audit log covers every membership, role, billing and settings change
- [x] OpenAPI docs at `/api/docs`
