import Stripe from 'stripe';
import { requireAccount } from '../app.js';

const FOREVER = 253402300799000; // 9999-12-31: lifetime purchases never expire

export default async function billingRoutes(app) {
  const { db, cfg } = app;
  if (!cfg.billingEnabled) {
    app.all('/*', async (_req, reply) => reply.code(404).send({ error: 'Premium isn’t enabled on this server.' }));
    return;
  }
  const stripe = new Stripe(cfg.stripe.secretKey);
  const base = (req) => cfg.publicUrl || `${req.protocol}://${req.headers.host}`;
  const q = {
    setPremium: db.prepare('UPDATE users SET premium_until = ?, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE id = ?'),
    bySub: db.prepare('SELECT id FROM users WHERE stripe_subscription_id = ?'),
    seen: db.prepare('INSERT OR IGNORE INTO stripe_events (id, created_at) VALUES (?, ?)'),
  };

  app.post('/checkout', { preHandler: requireAccount, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (req.user.isPremium) return reply.code(400).send({ error: 'You already have Premium.' });
    const session = await stripe.checkout.sessions.create({
      mode: cfg.stripe.mode,
      line_items: [{ price: cfg.stripe.priceId, quantity: 1 }],
      client_reference_id: String(req.user.id),
      customer: req.user.stripe_customer_id || undefined,
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
      const obj = event.data.object;
      const paid = (event.type === 'checkout.session.completed' && obj.payment_status !== 'unpaid')
        || event.type === 'checkout.session.async_payment_succeeded'; // delayed methods (e.g. bank debits)
      if (paid) {
        const userId = Number(obj.client_reference_id);
        if (userId) {
          const until = obj.mode === 'subscription' ? Date.now() + 35 * 86_400_000 : FOREVER;
          q.setPremium.run(until, obj.customer || null, obj.subscription || null, userId);
        }
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const user = q.bySub.get(obj.id);
        if (user) {
          const active = event.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(obj.status);
          const periodEnd = (obj.items?.data?.[0]?.current_period_end ?? obj.current_period_end ?? 0) * 1000;
          q.setPremium.run(active ? Math.max(periodEnd, Date.now()) + 3 * 86_400_000 : Date.now(), null, null, user.id);
        }
      }
      return { received: true };
    });
  });

}

export async function cancelSubscription(cfg, user, log) {
  if (!cfg.billingEnabled || !user.stripe_subscription_id) return;
  try {
    await new Stripe(cfg.stripe.secretKey).subscriptions.cancel(user.stripe_subscription_id);
  } catch (err) {
    log.error({ err }, 'failed to cancel subscription on account deletion');
  }
}
