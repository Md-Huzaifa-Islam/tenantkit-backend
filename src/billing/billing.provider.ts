import type { Plan, Workspace } from '@prisma/client';

export type PaidPlan = Exclude<Plan, 'FREE'>;

/** Provider-neutral billing events. Both Stripe and the mock provider produce these. */
export type BillingEvent = { id: string; rawType: string } & (
  | { type: 'checkout.completed'; workspaceId: string; customerId: string; subscriptionId: string; plan: PaidPlan }
  | {
      type: 'subscription.updated';
      customerId: string;
      subscriptionId: string;
      plan: PaidPlan | null;
      /** Stripe subscription status, e.g. active, trialing, past_due, canceled, unpaid. */
      status: string;
      currentPeriodEnd: Date | null;
    }
  | { type: 'subscription.deleted'; customerId: string; subscriptionId: string }
  | { type: 'payment.failed'; customerId: string; subscriptionId: string | null }
  | { type: 'ignored' }
);

export interface CheckoutRequest {
  workspace: Workspace;
  plan: PaidPlan;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export abstract class BillingProvider {
  abstract readonly name: 'mock' | 'stripe';
  abstract createCheckoutSession(req: CheckoutRequest): Promise<{ url: string }>;
  abstract createPortalSession(workspace: Workspace, returnUrl: string): Promise<{ url: string }>;
  /** Verifies the webhook signature and normalises the payload. Throws on a bad signature. */
  abstract parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<BillingEvent>;
}
