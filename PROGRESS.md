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

## Phase 6 — Billing (2026-10-17)
- Done: `BillingProvider` interface; `StripeBillingProvider` (Checkout, Customer Portal, signature-verified webhooks normalised to provider-neutral events for `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`); `MockBillingProvider` (HMAC-signed sessions rendered by the web app as mock checkout/portal pages; signed webhooks). One idempotent handler: event id inserted into `stripe_events` in the same transaction as the effects. Plan changes, cancellation → Free, unpaid/canceled status → Free, payment-failed audit + owner email. Billing status endpoint with usage.
- Verified: 162 tests passing — billing e2e (16, incl. 5 concurrent duplicate deliveries → processed once, tampered signature rejected, upgrade lifts limits, cancel re-applies them) and Stripe provider unit tests (5, real Stripe SDK signatures generated offline).
- Not verified: calls to the live Stripe API (no keys in this environment). Normalisation and signature checks are tested offline with the Stripe SDK.
- Next: Phase 7 — audit log endpoint, admin API, dev mailbox.

## Phase 7 — Audit log, admin, dev mailbox (2026-10-17)
- Done: `GET /audit-logs` (action / `prefix.*` / actor / inclusive date range / pagination, actor details, IP); admin API (`@SuperAdminOnly`, DB re-check): workspace list with search, member/project/task counts and owner via the counts-only SECURITY DEFINER function (new migration adds `owner_id`), suspend/unsuspend (audited), metrics (workspaces by plan/status, MRR, 7-day active users, 30-day signup series), read-only impersonation (15-min token with `ro`, every non-GET rejected by the JWT guard, audited as `workspace.impersonated`); dev mailbox list/get/clear, 404 unless `ENABLE_DEV_MAILBOX`.
- Verified: 180 tests passing (audit coverage of every membership/role/billing/settings change, filters, admin access control and flows, impersonation read-only enforcement, mailbox enabled/disabled). Isolation suite: 33 API + 20 DB cases.
- Next: Docker re-verification with seed, then frontend phases 8–10.
