# TenantKit: Multi-Tenant SaaS Starter
> Build spec and PRD. Place this file in an empty repo as `SPEC.md`.

---

## 0. Prompts

### Master Prompt (paste into Claude Code)
```
You are a senior full-stack engineer. Read SPEC.md in this repository completely before writing any code.

Build the entire TenantKit project exactly as specified, following the phases in section 12 (Build Plan) in order.

Rules:
- Do not ask me questions. When something is ambiguous, choose the simplest production-sensible option and record it in DECISIONS.md (one line per decision with a reason).
- After each phase: run install, lint, typecheck and tests. Fix every failure before starting the next phase. Then append a short entry to PROGRESS.md (phase, what was done, what's next).
- Every external service (email, payments) must work through a provider interface with a "mock" implementation that is the default when keys are missing. The app must fully run with `docker compose up` and zero API keys.
- Never commit secrets. Provide .env.example with every variable documented.
- Write real tests, not placeholders. The tenant-isolation tests in section 10 are mandatory.
- Finish by completing every item in section 13 (Acceptance Checklist), then write README.md as described in section 14.

Start now with Phase 1.
```

### Resume Prompt
```
Read SPEC.md, PROGRESS.md and DECISIONS.md. Continue from the next unfinished phase in section 12. Follow the same rules as before: tests green after each phase, log progress and decisions, no questions.
```

---

## 1. Product Overview
**One-liner:** A production-ready foundation for B2B SaaS. It covers workspaces, teams, roles, tenant isolation, subscriptions and an admin panel, so a new SaaS MVP starts from week 3 instead of week 0.

**Portfolio story:** "Every SaaS client needs the same hard foundation. I built a hardened version once: isolation tested, billing wired, roles enforced. That lets me ship MVPs faster and more safely."

**Demo product skin:** The starter ships with a tiny example feature, **Projects & Tasks**, so the tenant scoping is visible in a real UI.

## 2. Tech Stack (fixed)
- **Monorepo:** pnpm workspaces + Turborepo
- **Web:** Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, React Hook Form + Zod
- **API:** NestJS (TypeScript), REST, OpenAPI via @nestjs/swagger
- **DB:** PostgreSQL 16, Prisma ORM, **Postgres Row-Level Security** for tenant isolation
- **Auth:** Email + password (argon2) with JWT access token (15 min) and rotating refresh token (httpOnly cookie). Magic-link invite acceptance.
- **Payments:** Stripe (Checkout + Customer Portal + webhooks) behind a `BillingProvider` interface, with a `MockBillingProvider`
- **Email:** `EmailProvider` interface: `MockEmailProvider` (writes to the DB table `dev_emails` and a `/dev/mailbox` page) and `ResendEmailProvider`
- **Infra:** Docker Compose (postgres, api, web), GitHub Actions CI (lint, typecheck, test, build)
- **Tests:** Vitest/Jest for unit tests, Supertest for API e2e against a real Postgres (testcontainers or the compose DB), Playwright for 3 smoke flows

## 3. Users & Roles
| Role | Scope | Permissions |
|------|-------|-------------|
| Super Admin | Platform | See all workspaces, usage, impersonate (read-only), suspend workspace |
| Owner | Workspace | Everything, incl. billing, delete workspace, transfer ownership |
| Admin | Workspace | Manage members (except owner), all projects, settings (not billing) |
| Member | Workspace | CRUD own tasks, view projects they belong to |

Permissions are defined in one place as a typed matrix (`packages/shared/permissions.ts`) and enforced by a NestJS guard (`@RequirePermission('member.invite')`).

## 4. Features

### MVP (must build)
1. **Auth:** sign up, login, logout, refresh, forgot/reset password, email verification.
2. **Workspaces:** creating one is part of sign-up. A user can belong to many workspaces and has a workspace switcher. Workspace has a slug, name and logo upload (stored locally in dev, S3-compatible interface).
3. **Members & invites:** invite by email with a role, accept via link, resend, revoke, change role, remove member, transfer ownership.
4. **RBAC:** permission matrix and guard. The frontend hides actions the user can't perform; the backend enforces them anyway.
5. **Tenant isolation:** every tenant table has `workspace_id`. RLS policies use `current_setting('app.workspace_id')`. A Prisma middleware or extension sets it per request inside a transaction. The API's DB user is **not** a superuser and does not bypass RLS.
6. **Billing:**
   - Plans: Free (3 projects, 2 members), Pro ($19/mo, unlimited projects, 10 members), Business ($49/mo, unlimited).
   - Stripe Checkout to upgrade, Customer Portal to manage.
   - Webhook handler is idempotent (stores the event id) and handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.payment_failed`.
   - Plan limits are enforced server-side, with a clear upgrade prompt in the UI.
7. **Audit log:** records who did what, when, and from which IP for membership, role, billing and settings changes. Filterable table in the UI.
8. **Example feature, Projects & Tasks:** CRUD projects, tasks with status (todo/doing/done), assignee and due date. A Kanban board view.
9. **Super Admin panel** (`/admin`): workspace list with plan, member count and created date; suspend/unsuspend; platform metrics cards (workspaces, MRR from mock or Stripe data, active users over 7 days).
10. **Dev mailbox** (`/dev/mailbox`, dev only): shows emails sent by the mock provider.

### Nice-to-have (only after the checklist passes)
- Google OAuth
- API keys per workspace
- Usage-based metering example

## 5. Data Model (Prisma)
```
User(id, email unique, passwordHash, name, avatarUrl, emailVerifiedAt, isSuperAdmin bool, createdAt)
Workspace(id, name, slug unique, logoUrl, plan enum[FREE,PRO,BUSINESS], status enum[ACTIVE,SUSPENDED], stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, createdAt)
Membership(id, userId, workspaceId, role enum[OWNER,ADMIN,MEMBER], createdAt) unique(userId, workspaceId)
Invite(id, workspaceId, email, role, tokenHash, invitedById, expiresAt, acceptedAt, revokedAt)
RefreshToken(id, userId, tokenHash, familyId, expiresAt, revokedAt, createdAt)
PasswordResetToken(id, userId, tokenHash, expiresAt, usedAt)
Project(id, workspaceId, name, description, createdById, createdAt)
Task(id, workspaceId, projectId, title, status enum, assigneeId nullable, dueDate nullable, position int, createdAt)
AuditLog(id, workspaceId, actorId, action string, targetType, targetId, metadata jsonb, ip, createdAt)
StripeEvent(id = stripe event id, type, processedAt)
DevEmail(id, to, subject, html, createdAt)
```
RLS is enabled on: Project, Task, AuditLog, Invite, Membership (read). Write the SQL policies in a Prisma migration.

## 6. API (prefix `/api/v1`, documented at `/api/docs`)
- `POST /auth/signup` (creates user plus first workspace), `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot`, `POST /auth/reset`, `POST /auth/verify`
- `GET /me`, `GET /me/workspaces`
- `POST /workspaces`, `GET/PATCH/DELETE /workspaces/:id`, `POST /workspaces/:id/transfer`
- `GET /workspaces/:id/members`, `PATCH /members/:id` (role), `DELETE /members/:id`
- `POST /workspaces/:id/invites`, `GET /workspaces/:id/invites`, `POST /invites/:id/resend`, `DELETE /invites/:id`, `POST /invites/accept`
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`
- `GET/POST /projects/:id/tasks`, `PATCH/DELETE /tasks/:id`, `POST /tasks/reorder`
- `POST /billing/checkout`, `POST /billing/portal`, `GET /billing/status`, `POST /billing/webhook` (raw body)
- `GET /audit-logs?action=&actor=&from=&to=&page=`
- `GET /admin/workspaces`, `POST /admin/workspaces/:id/suspend`, `GET /admin/metrics`

The active workspace is sent in the `X-Workspace-Id` header. The guard verifies membership before RLS is set.

## 7. Pages (web)
`/login`, `/signup`, `/forgot`, `/reset`, `/invite/[token]`, `/[workspace]/projects`, `/[workspace]/projects/[id]` (Kanban), `/[workspace]/settings/general`, `/[workspace]/settings/members`, `/[workspace]/settings/billing`, `/[workspace]/settings/audit-log`, `/admin`, `/dev/mailbox`

**UI quality bar:**
- Clean, modern dashboard: sidebar, workspace switcher, user menu.
- Dark mode.
- Empty states, loading skeletons and toast notifications.
- Fully responsive down to 375 px.

## 8. Security & Non-Functional
- argon2id password hashing. Rate-limit auth endpoints (e.g. 10/min/IP).
- Refresh token rotation with reuse detection: reuse revokes the whole token family.
- Tokens (invite, reset) are stored hashed. Single use, with expiry.
- Helmet, CORS allowlist, Zod/class-validator on every input, consistent error format `{error:{code,message,details}}`.
- Suspended workspaces get 403 on all tenant routes.
- Structured JSON logging (pino) with a request id.
- p95 API latency under 200 ms on seeded data, running locally.

## 9. Seed / Demo Data
Run with `pnpm seed`:
- `demo@tenantkit.dev` / `Demo1234!`: owner of **Acme Inc** (Pro) and member of **Globex** (Free).
- `admin@tenantkit.dev` / `Admin1234!`: super admin.
- Acme: 6 members, 4 projects, about 40 tasks, about 30 audit log entries.
- Globex: at the Free plan limit, so the upgrade prompt is demoable.

## 10. Testing Requirements
- **Tenant isolation suite (mandatory):** user A in workspace 1 cannot read, update or delete workspace 2's projects, tasks, members, invites or audit logs. Test both at the API level and with a raw Prisma query that sets the wrong `app.workspace_id` (RLS must return 0 rows).
- RBAC: a member cannot invite, an admin cannot change billing, only the owner can transfer.
- Billing webhook: idempotency (same event twice = processed once), plan upgrade and downgrade, limit enforcement.
- Auth: refresh rotation and reuse detection.
- Playwright: sign-up → create project → add task; invite → accept; upgrade via mock checkout.
- CI must run all of the above.

## 11. Repo Structure
```
apps/web        Next.js
apps/api        NestJS
packages/shared permissions, zod schemas, types
packages/config eslint, tsconfig
docker-compose.yml, .env.example, .github/workflows/ci.yml
docs/architecture.md (mermaid diagram)
```

## 12. Build Plan (phases)
1. Monorepo scaffold, Docker Compose, CI, shared config, health endpoints.
2. Prisma schema, migrations including RLS policies, seed script.
3. Auth module, plus tests.
4. Workspaces, memberships, invites, RBAC guard, plus isolation and RBAC tests.
5. Projects & Tasks API, plus tests.
6. Billing provider (mock + Stripe), webhooks, plan limits, plus tests.
7. Audit log, admin API, dev mailbox.
8. Web: auth pages, layout, workspace switcher.
9. Web: projects, Kanban, settings, billing, audit log, admin.
10. Playwright smoke tests, polish (dark mode, empty states, responsive), README, docs.

## 13. Acceptance Checklist
- [ ] `docker compose up` then `pnpm seed`, and the whole app works with no API keys
- [ ] All tests green in CI. The isolation suite has at least 15 cases.
- [ ] The DB role used by the API cannot bypass RLS (verified in a test)
- [ ] Plan limits are enforced server-side, and the UI shows an upgrade prompt
- [ ] A duplicate Stripe webhook event does not double-process
- [ ] Audit log records every membership, role, billing and settings change
- [ ] Lighthouse at least 90 on performance and accessibility for the dashboard
- [ ] OpenAPI docs are available at `/api/docs`
- [ ] README complete (section 14)

## 14. Portfolio Deliverables
**README must include:**
- Hero screenshot and a mermaid architecture diagram.
- Feature list and tech stack.
- Quick start in 3 commands.
- An "How tenant isolation is guaranteed" section.
- Test coverage summary.
- Demo credentials.

**Upwork portfolio title:** `TenantKit: Multi-Tenant SaaS Platform | Next.js, NestJS, PostgreSQL RLS, Stripe`

**Case study text (fill in the numbers):**
> **Problem:** Every SaaS MVP needs teams, roles, billing and strict data isolation. Building these per project is slow and error-prone.
> **Approach:** I built a reusable foundation with Postgres row-level security, a central permission matrix, idempotent Stripe webhooks and a full audit log, all covered by an automated isolation test suite.
> **Result:** __ automated tests, including __ cross-tenant attack cases, all passing. New SaaS projects start with auth, teams and billing done on day one.

**Loom script (75 s):** sign up → create workspace → invite teammate (dev mailbox) → Kanban → hit Free limit → upgrade → audit log entries → admin panel → show isolation tests passing in the terminal.
