import { requireAccount } from '../app.js';

const FOREVER = 253402300799000; // 9999-12-31: lifetime purchases never expire
const DAY = 86_400_000;
const GRACE = 3 * DAY; // renewals can land a little after the period ends

export class BillingError extends Error {}

const periodEnd = (sub) => (sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end ?? 0) * 1000;

export default async function billingRoutes(app) {
  const { db, cfg } = app;
  if (!cfg.billingEnabled) {
    app.all('/*', async (_req, reply) => reply.code(404).send({ error: 'Premium isn’t enabled on this server.' }));
    return;
  }
  const { stripe } = app;
  const base = (req) => cfg.publicUrl || `${req.protocol}://${req.headers.host}`;
  const q = {
    setPremium: db.prepare('UPDATE users SET premium_until = ?, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE id = ?'),
    revoke: db.prepare('UPDATE users SET premium_until = ? WHERE id = ?'),
    bySub: db.prepare('SELECT id FROM users WHERE stripe_subscription_id = ?'),
    byCustomer: db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?'),
    seen: db.prepare('INSERT OR IGNORE INTO stripe_events (id, created_at) VALUES (?, ?)'),
  };

  app.post('/checkout', { preHandler: requireAccount, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (req.user.isPremium) return reply.code(400).send({ error: 'You already have Premium.' });
    const existing = req.user.stripe_customer_id;
    const session = await stripe.checkout.sessions.create({
      mode: cfg.stripe.mode,
      line_items: [{ price: cfg.stripe.priceId, quantity: 1 }],
      client_reference_id: String(req.user.id),
      ...(existing ? { customer: existing } : cfg.stripe.mode === 'payment' ? { customer_creation: 'always' } : {}),
      metadata: { userId: String(req.user.id) },
      allow_promotion_codes: true,
      success_url: `${base(req)}/#/me?premium=success`,
      cancel_url: `${base(req)}/#/me?premium=cancelled`,
    });
    return { url: session.url };
  });

  app.post('/portal', { preHandler: requireAccount }, async (req, reply) => {
    if (!req.user.stripe_customer_id) return reply.code(400).send({ error: 'No billing account yet.' });
    const portal = await stripe.billingPortal.sessions.create({ customer: req.user.stripe_customer_id, return_url: `${base(req)}/#/me` });
    return { url: portal.url };
  });

  // Webhook needs the exact raw bytes for signature verification.
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scoped.post('/webhook', { config: { rateLimit: false }, bodyLimit: 1024 * 1024 }, async (req, reply) => {
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], cfg.stripe.webhookSecret);
      } catch {
        return reply.code(400).send({ error: 'Bad signature.' });
      }
      if (!q.seen.run(event.id, Date.now()).changes) return { received: true, duplicate: true };
      try {
        await handle(event);
      } catch (err) {
        db.prepare('DELETE FROM stripe_events WHERE id = ?').run(event.id); // let Stripe's retry try again
        throw err;
      }
      return { received: true };
    });
  });

  async function handle(event) {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        // Delayed methods (bank debits) complete as "unpaid" first, then send async_payment_succeeded.
        if (obj.payment_status === 'unpaid') return;
        const userId = Number(obj.client_reference_id);
        if (!userId) return;
        let until = FOREVER;
        if (obj.mode === 'subscription') {
          const sub = await stripe.subscriptions.retrieve(obj.subscription); // real period: monthly or annual
          until = Math.max(periodEnd(sub), Date.now() + DAY) + GRACE;
        }
        q.setPremium.run(until, obj.customer || null, obj.subscription || null, userId);
        return;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const user = q.bySub.get(obj.id);
        if (!user) return;
        const active = event.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(obj.status);
        q.revoke.run(active ? Math.max(periodEnd(obj), Date.now()) + GRACE : Date.now(), user.id);
        return;
      }
      case 'charge.refunded':
      case 'charge.dispute.created': {
        // Full refunds and chargebacks remove Premium (partial refunds don't).
        if (event.type === 'charge.refunded' && !obj.refunded) return;
        const user = obj.customer && q.byCustomer.get(obj.customer);
        if (user) q.revoke.run(Date.now(), user.id);
        return;
      }
      default:
    }
  }
}

/** Cancels an active subscription before account deletion. Throws BillingError if Stripe can't confirm it. */
export async function cancelSubscription(app, user) {
  if (!app.cfg.billingEnabled || !user.stripe_subscription_id) return;
  try {
    await app.stripe.subscriptions.cancel(user.stripe_subscription_id);
  } catch (err) {
    if (err?.code === 'resource_missing') return; // already gone
    throw new BillingError('cancel failed', { cause: err });
  }
}
