import type { Workspace } from '@prisma/client';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { AppException } from '../common/app-exception';
import { safeEqual } from '../common/tokens';
import type { Env } from '../config/env';
import { BillingEvent, BillingProvider, CheckoutRequest } from './billing.provider';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

/**
 * Stripe stand-in for keyless demos. Checkout and portal sessions are signed tokens that
 * the web app renders as mock pages; completing them emits the same normalised events a
 * real Stripe webhook would, through the same handler. Webhooks are HMAC-signed.
 */
export class MockBillingProvider extends BillingProvider {
  readonly name = 'mock' as const;
  private readonly key: Buffer;

  constructor(private readonly env: Env) {
    super();
    this.key = createHash('sha256').update(`mock-billing:${env.JWT_ACCESS_SECRET}`).digest();
  }

  sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('hex');
  }

  /** `<base64url json>.<hmac>` carrying the session details. */
  issueSession(data: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify({ ...data, sid: randomUUID(), exp: Date.now() + 30 * 60_000 })).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  readSession<T extends Record<string, unknown>>(token: string): T & { sid: string } {
    const [body, sig] = token.split('.');
    if (!body || !sig || !safeEqual(sig, this.sign(body))) throw AppException.tokenInvalid('Invalid checkout session');
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { sid: string; exp: number };
    if (data.exp < Date.now()) throw AppException.tokenInvalid('Checkout session expired');
    return data;
  }

  async createCheckoutSession(req: CheckoutRequest) {
    const session = this.issueSession({ kind: 'checkout', workspaceId: req.workspace.id, plan: req.plan });
    return { url: `${this.env.APP_URL}/billing/mock-checkout?session=${encodeURIComponent(session)}` };
  }

  async createPortalSession(workspace: Workspace) {
    if (!workspace.stripeSubscriptionId) throw AppException.badRequest('This workspace has no subscription yet');
    const session = this.issueSession({ kind: 'portal', workspaceId: workspace.id });
    return { url: `${this.env.APP_URL}/billing/mock-portal?session=${encodeURIComponent(session)}` };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<BillingEvent> {
    const signature = headers[MOCK_SIGNATURE_HEADER];
    if (typeof signature !== 'string' || !safeEqual(signature, this.sign(rawBody.toString('utf8')))) {
      throw AppException.badRequest('Invalid webhook signature');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as BillingEvent & { currentPeriodEnd?: string | null };
    if ('currentPeriodEnd' in event && typeof event.currentPeriodEnd === 'string') {
      (event as { currentPeriodEnd: Date | null }).currentPeriodEnd = new Date(event.currentPeriodEnd);
    }
    return event;
  }
}
