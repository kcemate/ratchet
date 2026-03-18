import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();

type BillingPlan = 'builder' | 'pro' | 'team';

const PLAN_PRICE_IDS: Record<BillingPlan, string> = {
  builder: process.env.STRIPE_PRICE_BUILDER ?? 'price_builder_placeholder',
  pro:     process.env.STRIPE_PRICE_PRO     ?? 'price_pro_placeholder',
  team:    process.env.STRIPE_PRICE_TEAM    ?? 'price_team_placeholder',
};

/** POST /api/billing/checkout — create Stripe checkout session */
router.post('/checkout', requireAuth, (req: AuthRequest, res) => {
  const { plan } = req.body as { plan?: BillingPlan };

  if (!plan || !['builder', 'pro', 'team'].includes(plan)) {
    res.status(400).json({ error: 'plan must be one of: builder, pro, team' });
    return;
  }

  // Stub: return placeholder checkout URL
  // In production: create a real Stripe checkout session via Stripe SDK
  const priceId = PLAN_PRICE_IDS[plan];
  const checkoutUrl = process.env.STRIPE_SECRET_KEY
    ? `https://checkout.stripe.com/pay/${priceId}?client_reference_id=${req.user!.id}`
    : `https://ratchetcli.com/#pricing?plan=${plan}`;

  res.json({
    url: checkoutUrl,
    plan,
    priceId,
  });
});

/** GET /api/billing/portal — return Stripe billing portal URL */
router.get('/portal', requireAuth, (req: AuthRequest, res) => {
  // Stub: return placeholder portal URL
  // In production: create a real Stripe billing portal session
  const portalUrl = process.env.STRIPE_SECRET_KEY
    ? `https://billing.stripe.com/p/login/placeholder?prefilled_email=${req.user!.id}`
    : `https://ratchetcli.com/billing`;

  res.json({ url: portalUrl });
});

/** POST /api/billing/webhook — Stripe webhook handler */
router.post('/webhook', (req, res) => {
  const signature = req.headers['stripe-signature'];

  // Stub: log and acknowledge webhook
  // In production: verify signature with Stripe SDK and process event
  const event = req.body as { type?: string; id?: string };
  console.log('[billing/webhook] received event:', event.type ?? 'unknown', event.id ?? '');

  // TODO: handle these events in Phase 2:
  //   customer.subscription.created
  //   customer.subscription.updated
  //   customer.subscription.deleted
  //   invoice.payment_succeeded
  //   invoice.payment_failed

  res.json({ received: true });
});

export default router;
