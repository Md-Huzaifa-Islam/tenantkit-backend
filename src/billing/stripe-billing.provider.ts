import type { Workspace } from '@prisma/client';
import Stripe from 'stripe';
import { AppException } from '../common/app-exception';
import type { Env } from '../config/env';
import { BillingEvent, BillingProvider, CheckoutRequest, PaidPlan } from './billing.provider';

export class StripeBillingProvider extends BillingProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(private readonly env: Env) {
    super();
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY ?? 'sk_test_missing');
  }

  private priceFor(plan: PaidPlan): string {
    const price = plan === 'PRO' ? this.env.STRIPE_PRICE_PRO : this.env.STRIPE_PRICE_BUSINESS;
    if (!price) throw new Error(`STRIPE_PRICE_${plan} is not configured`);
    return price;
  }

  private planForPrice(priceId: string | undefined): PaidPlan | null {
    if (!priceId) return null;
    if (priceId === this.env.STRIPE_PRICE_PRO) return 'PRO';
    if (priceId === this.env.STRIPE_PRICE_BUSINESS) return 'BUSINESS';
    return null;
  }

  async createCheckoutSession(req: CheckoutRequest) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: req.workspace.id,
      ...(req.workspace.stripeCustomerId
        ? { customer: req.workspace.stripeCustomerId }
        : { customer_email: req.customerEmail }),
      line_items: [{ price: this.priceFor(req.plan), quantity: 1 }],
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      metadata: { workspaceId: req.workspace.id, plan: req.plan },
      subscription_data: { metadata: { workspaceId: req.workspace.id, plan: req.plan } },
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { url: session.url };
  }

  async createPortalSession(workspace: Workspace, returnUrl: string) {
    if (!workspace.stripeCustomerId) throw AppException.badRequest('This workspace has no billing account yet');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<BillingEvent> {
    const signature = headers['stripe-signature'];
    if (typeof signature !== 'string' || !this.env.STRIPE_WEBHOOK_SECRET) {
      throw AppException.badRequest('Missing Stripe signature');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw AppException.badRequest('Invalid Stripe signature');
    }
    return this.normalize(event);
  }

  normalize(event: Stripe.Event): BillingEvent {
    const base = { id: event.id, rawType: event.type };
    const id = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : (v?.id ?? null));

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const plan = s.metadata?.plan as PaidPlan | undefined;
        const workspaceId = s.client_reference_id ?? s.metadata?.workspaceId;
        const customerId = id(s.customer);
        const subscriptionId = id(s.subscription);
        if (s.mode !== 'subscription' || !workspaceId || !customerId || !subscriptionId || !plan) {
          return { ...base, type: 'ignored' };
        }
        return { ...base, type: 'checkout.completed', workspaceId, customerId, subscriptionId, plan };
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const item = sub.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
        // Newer API versions moved current_period_end from the subscription onto its items.
        const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
        return {
          ...base,
          type: 'subscription.updated',
          customerId: id(sub.customer)!,
          subscriptionId: sub.id,
          plan: this.planForPrice(item?.price.id) ?? ((sub.metadata?.plan as PaidPlan | undefined) ?? null),
          status: sub.status,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        };
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        return { ...base, type: 'subscription.deleted', customerId: id(sub.customer)!, subscriptionId: sub.id };
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null };
        return {
          ...base,
          type: 'payment.failed',
          customerId: id(invoice.customer)!,
          subscriptionId: id(invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null),
        };
      }
      default:
        return { ...base, type: 'ignored' };
    }
  }
}
