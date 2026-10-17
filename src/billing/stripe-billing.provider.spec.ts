import Stripe from 'stripe';
import { loadEnv } from '../config/env';
import { StripeBillingProvider } from './stripe-billing.provider';

const env = loadEnv({
  ...process.env,
  STRIPE_SECRET_KEY: 'sk_test_unit',
  STRIPE_WEBHOOK_SECRET: 'whsec_unit_test_secret',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_BUSINESS: 'price_business',
});
const provider = new StripeBillingProvider(env);
const stripe = new Stripe('sk_test_unit');

function signed(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_unit_test_secret' });
  return { body: Buffer.from(payload), headers: { 'stripe-signature': header } };
}

const subscription = (status: string, price: string) => ({
  id: 'evt_sub_1',
  object: 'event',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_1',
      object: 'subscription',
      customer: 'cus_1',
      status,
      metadata: {},
      items: { data: [{ price: { id: price }, current_period_end: 1_900_000_000 }] },
    },
  },
});

describe('StripeBillingProvider', () => {
  it('verifies the signature and normalises checkout.session.completed', async () => {
    const { body, headers } = signed({
      id: 'evt_checkout_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          object: 'checkout.session',
          mode: 'subscription',
          client_reference_id: 'ws_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { workspaceId: 'ws_1', plan: 'PRO' },
        },
      },
    });
    await expect(provider.parseWebhook(body, headers)).resolves.toEqual({
      id: 'evt_checkout_1',
      rawType: 'checkout.session.completed',
      type: 'checkout.completed',
      workspaceId: 'ws_1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      plan: 'PRO',
    });
  });

  it('rejects a payload whose signature does not match', async () => {
    const { headers } = signed({ id: 'evt_x', type: 'ping', data: { object: {} } });
    await expect(provider.parseWebhook(Buffer.from('{"id":"evt_tampered"}'), headers)).rejects.toThrow('Invalid Stripe signature');
    await expect(provider.parseWebhook(Buffer.from('{}'), {})).rejects.toThrow('Missing Stripe signature');
  });

  it('maps subscription price ids to plans and reads the period end from the item', async () => {
    const { body, headers } = signed(subscription('active', 'price_business'));
    const event = await provider.parseWebhook(body, headers);
    expect(event).toMatchObject({
      type: 'subscription.updated',
      plan: 'BUSINESS',
      status: 'active',
      currentPeriodEnd: new Date(1_900_000_000 * 1000),
    });
  });

  it('passes the subscription status through for downgrade decisions', async () => {
    const { body, headers } = signed(subscription('canceled', 'price_pro'));
    expect(await provider.parseWebhook(body, headers)).toMatchObject({ plan: 'PRO', status: 'canceled' });
  });

  it('normalises invoice.payment_failed and ignores unrelated events', async () => {
    const failed = signed({
      id: 'evt_inv',
      object: 'event',
      type: 'invoice.payment_failed',
      data: { object: { object: 'invoice', customer: 'cus_1', subscription: 'sub_1' } },
    });
    expect(await provider.parseWebhook(failed.body, failed.headers)).toMatchObject({ type: 'payment.failed', customerId: 'cus_1', subscriptionId: 'sub_1' });

    const other = signed({ id: 'evt_other', object: 'event', type: 'customer.created', data: { object: {} } });
    expect(await provider.parseWebhook(other.body, other.headers)).toMatchObject({ type: 'ignored', rawType: 'customer.created' });
  });
});
