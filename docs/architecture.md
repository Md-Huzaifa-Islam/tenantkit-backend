# TenantKit — Backend Architecture

## System overview

```mermaid
flowchart LR
  Browser["Browser<br/>(tenantkit-frontend)"] -->|"/api/v1/* (same origin)"| Web["Next.js server<br/>rewrites /api/v1 → API"]
  Web --> API
  Stripe["Stripe<br/>(or mock provider)"] -->|"signed webhooks"| API
  subgraph API["NestJS API (this repo)"]
    direction TB
    G1["JwtAuthGuard<br/>(global)"] --> G2["WorkspaceGuard<br/>@RequirePermission"]
    G2 --> S["Services"]
    S --> TX["prisma.withTenant()<br/>SET LOCAL app.workspace_id"]
  end
  TX -->|"role: tenantkit_app<br/>(no superuser, no BYPASSRLS)"| PG[("PostgreSQL 16<br/>Row-Level Security")]
  API --> Mail["EmailProvider<br/>mock → dev_emails · Resend"]
  API --> Files["StorageProvider<br/>local disk · S3"]
```

Two database roles are involved:

| Role | Used by | Privileges |
|------|---------|------------|
| `tenantkit` (owner) | `prisma migrate`, `seed` | Owns every table. Never used by the running API. |
| `tenantkit_app` | API runtime (`DATABASE_URL`) | `SELECT/INSERT/UPDATE/DELETE` only; no superuser, no `BYPASSRLS`, owns nothing. `UPDATE/DELETE` revoked on `audit_logs`. |

## Request lifecycle on a tenant route

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant J as JwtAuthGuard
  participant W as WorkspaceGuard
  participant S as Service
  participant DB as Postgres (tenantkit_app)

  C->>J: GET /api/v1/projects<br/>Authorization: Bearer …<br/>X-Workspace-Id: W1
  J->>J: verify HS256 JWT (15 min)<br/>read-only token? reject non-GET
  J->>W: req.user
  W->>DB: membership(user, W1)?<br/>(RLS: user_id = app.user_id)
  alt not a member
    W-->>C: 403 FORBIDDEN
  else workspace suspended
    W-->>C: 403 WORKSPACE_SUSPENDED
  else role lacks permission (shared matrix)
    W-->>C: 403 FORBIDDEN
  end
  W->>S: req.workspace = {id, role, plan}
  S->>DB: BEGIN
  S->>DB: SELECT set_config('app.workspace_id', W1, true)
  S->>DB: SELECT … FROM projects
  Note over DB: policy: workspace_id = app_current_workspace_id()
  DB-->>S: only W1 rows
  S->>DB: COMMIT (setting discarded)
  S-->>C: 200 [...]
```

`set_config(..., true)` makes the setting **transaction-local**, so it can never leak to
another request that reuses the pooled connection (covered by a test).

## Data model

```mermaid
erDiagram
  USER ||--o{ MEMBERSHIP : has
  WORKSPACE ||--o{ MEMBERSHIP : has
  WORKSPACE ||--o{ INVITE : has
  WORKSPACE ||--o{ PROJECT : has
  PROJECT ||--o{ TASK : has
  WORKSPACE ||--o{ AUDIT_LOG : has
  USER ||--o{ REFRESH_TOKEN : has
  USER ||--o{ PASSWORD_RESET_TOKEN : has
  USER ||--o{ EMAIL_VERIFICATION_TOKEN : has

  WORKSPACE { uuid id string slug enum plan enum status string stripeCustomerId string stripeSubscriptionId }
  MEMBERSHIP { uuid userId uuid workspaceId enum role }
  INVITE { uuid workspaceId string email enum role string tokenHash datetime expiresAt }
  PROJECT { uuid workspaceId string name }
  TASK { uuid workspaceId uuid projectId enum status int position uuid assigneeId date dueDate }
  AUDIT_LOG { uuid workspaceId uuid actorId string action jsonb metadata string ip }
  REFRESH_TOKEN { string tokenHash uuid familyId datetime revokedAt }
  STRIPE_EVENT { string id PK string type }
  DEV_EMAIL { string to string subject text html }
```

RLS is enabled **and forced** on `projects`, `tasks`, `audit_logs`, `invites` and
`memberships` (see `prisma/migrations/*_row_level_security`).

## Refresh-token rotation

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  B->>A: POST /auth/refresh (cookie R1)
  A->>A: R1 valid → mark revoked, issue R2 (same family)
  A-->>B: access token + cookie R2
  Note over B,A: An attacker replays the stolen R1
  B->>A: POST /auth/refresh (cookie R1)
  A->>A: R1 already revoked → reuse detected
  A->>A: revoke every token in the family (R2 too)
  A-->>B: 401, cookie cleared
```

The rotation uses a conditional `UPDATE … WHERE revoked_at IS NULL`, so two concurrent
refreshes with the same token can't both succeed; the loser triggers the reuse path.

## Billing events

Both providers turn their input into one provider-neutral `BillingEvent`. A single handler
applies it inside one transaction that also inserts the event id into `stripe_events`
(`ON CONFLICT DO NOTHING`). A redelivered event changes nothing, and a failed attempt
rolls back the marker so the provider's retry is processed normally.

```mermaid
flowchart LR
  SW["Stripe webhook<br/>(signature verified)"] --> N1["normalize()"]
  MC["Mock checkout / portal<br/>(HMAC-signed session)"] --> N2["BillingEvent"]
  N1 --> H
  N2 --> H
  H["BillingService.process()"] -->|"BEGIN<br/>INSERT stripe_events ON CONFLICT DO NOTHING"| D{"inserted?"}
  D -->|no| Dup["duplicate → no-op"]
  D -->|yes| Apply["update plan / subscription<br/>+ audit entry<br/>COMMIT"]
```

## Module map

| Module | Responsibility |
|--------|----------------|
| `auth` | Signup, login, refresh rotation, logout, reset, verification, `/me`, global JWT guard |
| `workspaces` | Workspace CRUD, slug rules, ownership transfer, logo upload |
| `members` | Members, invites, magic-link acceptance |
| `projects` | Projects, tasks, Kanban reordering |
| `billing` | Plan limits, `BillingProvider` (mock, Stripe), webhook handling |
| `audit` | `AuditService.record()` inside tenant transactions, `/audit-logs` |
| `admin` | Super-admin listing, suspension, metrics, read-only impersonation |
| `dev` | Dev mailbox for the mock email provider |
| `email`, `storage` | Provider interfaces with mock/local defaults |
| `shared` | Permission matrix, plans and Zod schemas (copy kept in sync with the frontend) |
