import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Plan, Workspace } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { EmailProvider } from '../email/email.provider';
import { emails } from '../email/templates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { PLANS } from '../shared';
import { BillingEvent, BillingProvider, PaidPlan } from './billing.provider';
import { MockBillingProvider } from './mock-billing.provider';
import { PlanLimitsService } from './plan-limits.service';

/** Subscription states in which the paid plan stays in force. */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type ProcessResult = { status: 'processed' | 'duplicate' | 'ignored' };

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: BillingProvider,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
    private readonly email: EmailProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private settingsUrl(slug: string) {
    return `${this.env.APP_URL}/${slug}/settings/billing`;
  }

  async checkout(ws: WorkspaceContext, user: AuthUser, plan: PaidPlan, ip: string | null) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    if (workspace.plan === plan) throw AppException.conflict(`This workspace is already on ${PLANS[plan].name}`);
    // An existing subscription changes plan through the portal, not a second checkout.
    if (workspace.stripeSubscriptionId) {
      throw AppException.conflict('Manage your existing subscription from the billing portal');
    }
    const url = this.settingsUrl(workspace.slug);
    const session = await this.provider.createCheckoutSession({
      workspace,
      plan,
      customerEmail: user.email,
      successUrl: `${url}?checkout=success`,
      cancelUrl: `${url}?checkout=cancelled`,
    });
    await this.prisma.withTenant({ workspaceId: ws.id, userId: user.id }, (tx) =>
      this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: user.id,
        action: 'billing.checkout_started',
        targetType: 'workspace',
        targetId: ws.id,
        metadata: { plan, provider: this.provider.name },
        ip,
      }),
    );
    return session;
  }

  async portal(ws: WorkspaceContext) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    return this.provider.createPortalSession(workspace, this.settingsUrl(workspace.slug));
  }

  async status(ws: WorkspaceContext, userId: string) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    const usage = await this.prisma.withTenant({ workspaceId: ws.id, userId }, async (tx) => ({
      projects: await this.limits.usage(tx, ws.id, 'projects'),
      members: await this.limits.usage(tx, ws.id, 'members'),
    }));
    const plan = PLANS[workspace.plan];
    return {
      plan: workspace.plan,
      provider: this.provider.name,
      hasSubscription: Boolean(workspace.stripeSubscriptionId),
      currentPeriodEnd: workspace.currentPeriodEnd,
      usage: {
        projects: { used: usage.projects, limit: plan.maxProjects },
        members: { used: usage.members, limit: plan.maxMembers },
      },
      plans: Object.values(PLANS),
    };
  }

  async handleWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    if (!rawBody) throw AppException.badRequest('Missing request body');
    const event = await this.provider.parseWebhook(rawBody, headers);
    return this.process(event);
  }

  /**
   * Applies one billing event exactly once. The event id is inserted into
   * `stripe_events` in the same transaction as its effects: a redelivered event finds
   * the row and is skipped, and a failed attempt rolls the marker back so the provider's
   * retry is processed normally.
   */
  async process(event: BillingEvent): Promise<ProcessResult> {
    if (event.type === 'ignored') {
      await this.prisma.stripeEvent.createMany({ data: [{ id: event.id, type: event.rawType }], skipDuplicates: true });
      return { status: 'ignored' };
    }

    const workspace = await this.findWorkspace(event);
    if (!workspace) {
      this.logger.warn({ eventId: event.id, type: event.rawType }, 'Billing event for unknown workspace');
      await this.prisma.stripeEvent.createMany({ data: [{ id: event.id, type: event.rawType }], skipDuplicates: true });
      return { status: 'ignored' };
    }

    let paymentFailed = false;
    const result = await this.prisma.withTenant({ workspaceId: workspace.id }, async (tx) => {
      const inserted = await tx.stripeEvent.createMany({
        data: [{ id: event.id, type: event.rawType }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return 'duplicate' as const;

      switch (event.type) {
        case 'checkout.completed':
          await this.changePlan(tx, workspace, event.plan, event.id, {
            stripeCustomerId: event.customerId,
            stripeSubscriptionId: event.subscriptionId,
          });
          break;
        case 'subscription.updated': {
          const plan: Plan = ACTIVE_STATUSES.has(event.status) ? (event.plan ?? workspace.plan) : 'FREE';
          await this.changePlan(tx, workspace, plan, event.id, {
            stripeSubscriptionId: plan === 'FREE' ? null : event.subscriptionId,
            currentPeriodEnd: plan === 'FREE' ? null : event.currentPeriodEnd,
          });
          break;
        }
        case 'subscription.deleted':
          await tx.workspace.update({
            where: { id: workspace.id },
            data: { plan: 'FREE', stripeSubscriptionId: null, currentPeriodEnd: null },
          });
          await this.audit.record(tx, {
            workspaceId: workspace.id,
            actorId: null,
            action: 'billing.subscription_canceled',
            targetType: 'workspace',
            targetId: workspace.id,
            metadata: { from: workspace.plan, to: 'FREE', eventId: event.id },
          });
          break;
        case 'payment.failed':
          paymentFailed = true;
          await this.audit.record(tx, {
            workspaceId: workspace.id,
            actorId: null,
            action: 'billing.payment_failed',
            targetType: 'workspace',
            targetId: workspace.id,
            metadata: { eventId: event.id, subscriptionId: event.subscriptionId },
          });
          break;
      }
      return 'processed' as const;
    });

    if (paymentFailed && result === 'processed') await this.notifyPaymentFailed(workspace);
    return { status: result };
  }

  // ---------- mock provider flows (used by the web app's mock checkout/portal pages) ----------

  private mock(): MockBillingProvider {
    if (!(this.provider instanceof MockBillingProvider)) {
      throw AppException.notFound('Mock billing is not enabled');
    }
    return this.provider;
  }

  describeMockSession(token: string) {
    const session = this.mock().readSession<{ kind: string; workspaceId: string; plan?: PaidPlan }>(token);
    return this.prisma.workspace
      .findUniqueOrThrow({ where: { id: session.workspaceId }, select: { name: true, slug: true, plan: true, currentPeriodEnd: true } })
      .then((ws) => ({
        kind: session.kind,
        workspace: ws,
        plan: session.plan ? PLANS[session.plan] : null,
        plans: Object.values(PLANS).filter((p) => p.id !== 'FREE'),
      }));
  }

  /** "Pay" on the mock checkout page: emits checkout.completed + subscription.updated. */
  async completeMockCheckout(user: AuthUser, token: string) {
    const session = this.mock().readSession<{ kind: string; workspaceId: string; plan: PaidPlan }>(token);
    if (session.kind !== 'checkout') throw AppException.tokenInvalid();
    await this.assertOwner(user.id, session.workspaceId);
    const customerId = `cus_mock_${session.workspaceId.slice(0, 8)}`;
    const subscriptionId = `sub_mock_${session.sid.slice(0, 12)}`;
    // Deterministic event ids: submitting the same session twice is a duplicate, not a second charge.
    const first = await this.process({
      id: `evt_mock_checkout_${session.sid}`,
      rawType: 'checkout.session.completed',
      type: 'checkout.completed',
      workspaceId: session.workspaceId,
      customerId,
      subscriptionId,
      plan: session.plan,
    });
    await this.process({
      id: `evt_mock_sub_${session.sid}`,
      rawType: 'customer.subscription.updated',
      type: 'subscription.updated',
      customerId,
      subscriptionId,
      plan: session.plan,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: session.workspaceId } });
    return { status: first.status, plan: ws.plan, redirectUrl: `${this.settingsUrl(ws.slug)}?checkout=success` };
  }

  /** Actions on the mock portal page: switch plan, cancel, or simulate a failed payment. */
  async mockPortalAction(user: AuthUser, token: string, action: 'change_plan' | 'cancel' | 'fail_payment', plan?: PaidPlan) {
    const session = this.mock().readSession<{ kind: string; workspaceId: string }>(token);
    if (session.kind !== 'portal') throw AppException.tokenInvalid();
    await this.assertOwner(user.id, session.workspaceId);
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: session.workspaceId } });
    if (!ws.stripeCustomerId || !ws.stripeSubscriptionId) throw AppException.badRequest('No active subscription');
    const base = { customerId: ws.stripeCustomerId, subscriptionId: ws.stripeSubscriptionId };
    const id = `evt_mock_${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (action === 'change_plan') {
      if (!plan) throw AppException.badRequest('Choose a plan');
      await this.process({ id, rawType: 'customer.subscription.updated', type: 'subscription.updated', ...base, plan, status: 'active', currentPeriodEnd: ws.currentPeriodEnd });
    } else if (action === 'cancel') {
      await this.process({ id, rawType: 'customer.subscription.deleted', type: 'subscription.deleted', ...base });
    } else {
      await this.process({ id, rawType: 'invoice.payment_failed', type: 'payment.failed', ...base });
    }
    const updated = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    return { plan: updated.plan, redirectUrl: this.settingsUrl(updated.slug) };
  }

  // ---------- helpers ----------

  private async findWorkspace(event: Exclude<BillingEvent, { type: 'ignored' }>): Promise<Workspace | null> {
    if (event.type === 'checkout.completed') {
      return this.prisma.workspace.findUnique({ where: { id: event.workspaceId } });
    }
    return (
      (event.subscriptionId
        ? await this.prisma.workspace.findUnique({ where: { stripeSubscriptionId: event.subscriptionId } })
        : null) ?? (await this.prisma.workspace.findUnique({ where: { stripeCustomerId: event.customerId } }))
    );
  }

  private async changePlan(
    tx: Tx,
    workspace: Workspace,
    plan: Plan,
    eventId: string,
    extra: Partial<Pick<Workspace, 'stripeCustomerId' | 'stripeSubscriptionId' | 'currentPeriodEnd'>>,
  ) {
    const current = await tx.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    await tx.workspace.update({ where: { id: workspace.id }, data: { plan, ...extra } });
    if (current.plan !== plan) {
      await this.audit.record(tx, {
        workspaceId: workspace.id,
        actorId: null,
        action: 'billing.plan_changed',
        targetType: 'workspace',
        targetId: workspace.id,
        metadata: { from: current.plan, to: plan, eventId, provider: this.provider.name },
      });
    }
  }

  private async assertOwner(userId: string, workspaceId: string) {
    const m = await this.prisma.withUser(userId, (tx) =>
      tx.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } }),
    );
    if (m?.role !== 'OWNER') throw AppException.forbidden('Only the workspace owner can manage billing');
  }

  private async notifyPaymentFailed(workspace: Workspace) {
    const owner = await this.prisma.withTenant({ workspaceId: workspace.id }, (tx) =>
      tx.membership.findFirst({ where: { workspaceId: workspace.id, role: 'OWNER' }, include: { user: true } }),
    );
    if (owner) {
      await this.email.send({ to: owner.user.email, ...emails.paymentFailed(workspace.name, this.settingsUrl(workspace.slug)) });
    }
  }
}
