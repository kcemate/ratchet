/**
 * Stripe product + price setup for Ratchet CLI
 * Run: npx tsx scripts/stripe-setup.ts
 * Requires STRIPE_SECRET_KEY in .env
 */
import Stripe from "stripe";
import * as fs from "fs";
import * as path from "path";

// Load .env
const envPath = path.join(__dirname, "..", ".env");
const envContent = fs.readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Missing STRIPE_SECRET_KEY in .env");
  process.exit(1);
}

const stripe = new Stripe(key);

interface TierConfig {
  name: string;
  description: string;
  monthlyPrice: number | null; // cents, null = custom/contact
  annualPrice: number | null; // cents per month billed annually
  metadata: Record<string, string>;
}

const tiers: TierConfig[] = [
  {
    name: "Ratchet Builder",
    description: "30 improvement cycles/month. BYOK. ratchet improve access.",
    monthlyPrice: 1200, // $12
    annualPrice: 12000, // $120/year ($10/mo)
    metadata: { tier: "builder", cycles: "30", torque: "false", improve: "true" },
  },
  {
    name: "Ratchet Pro",
    description: "150 improvement cycles/month. BYOK. Full torque + improve, vision, PDF reports.",
    monthlyPrice: 3500, // $35
    annualPrice: 33600, // $336/year ($28/mo)
    metadata: { tier: "pro", cycles: "150", torque: "true", improve: "true" },
  },
  {
    name: "Ratchet Team",
    description: "5 seats. 500 cycles/month. Hosted — no API key needed. CI/CD, dashboard, notifications.",
    monthlyPrice: 14900, // $149
    annualPrice: 142800, // $1,428/year ($119/mo)
    metadata: { tier: "team", cycles: "500", torque: "true", improve: "true", seats: "5" },
  },
];

async function main() {
  console.log("🔧 Setting up Stripe products for Ratchet...\n");

  const results: Record<string, { productId: string; monthlyPriceId: string; annualPriceId: string }> = {};

  for (const tier of tiers) {
    // Create product
    const product = await stripe.products.create({
      name: tier.name,
      description: tier.description,
      metadata: tier.metadata,
    });
    console.log(`✅ Product: ${tier.name} → ${product.id}`);

    // Monthly price
    const monthlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: tier.monthlyPrice!,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { billing: "monthly", tier: tier.metadata.tier },
    });
    console.log(`   Monthly: $${tier.monthlyPrice! / 100}/mo → ${monthlyPrice.id}`);

    // Annual price
    const annualPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: tier.annualPrice!,
      currency: "usd",
      recurring: { interval: "year" },
      metadata: { billing: "annual", tier: tier.metadata.tier },
    });
    console.log(`   Annual:  $${tier.annualPrice! / 100}/yr → ${annualPrice.id}`);

    results[tier.metadata.tier] = {
      productId: product.id,
      monthlyPriceId: monthlyPrice.id,
      annualPriceId: annualPrice.id,
    };
  }

  // Overage price (metered, per-cycle)
  const overageProduct = await stripe.products.create({
    name: "Ratchet Overage Cycles",
    description: "Additional improvement cycles beyond plan limit. $0.75/cycle.",
    metadata: { tier: "overage" },
  });
  const overagePrice = await stripe.prices.create({
    product: overageProduct.id,
    unit_amount: 75, // $0.75
    currency: "usd",
    recurring: { interval: "month", usage_type: "metered" },
    metadata: { tier: "overage" },
  });
  console.log(`\n✅ Overage: $0.75/cycle → ${overagePrice.id}`);

  // Create Payment Links for each tier
  console.log("\n🔗 Creating Payment Links...\n");

  const links: Record<string, { monthly: string; annual: string }> = {};

  for (const [tierName, ids] of Object.entries(results)) {
    const monthlyLink = await stripe.paymentLinks.create({
      line_items: [{ price: ids.monthlyPriceId, quantity: 1 }],
      metadata: { tier: tierName, billing: "monthly" },
      after_completion: { type: "redirect", redirect: { url: "https://ratchetcli.com?welcome=1" } },
    });

    const annualLink = await stripe.paymentLinks.create({
      line_items: [{ price: ids.annualPriceId, quantity: 1 }],
      metadata: { tier: tierName, billing: "annual" },
      after_completion: { type: "redirect", redirect: { url: "https://ratchetcli.com?welcome=1" } },
    });

    links[tierName] = { monthly: monthlyLink.url, annual: annualLink.url };
    console.log(`${tierName}:`);
    console.log(`  Monthly: ${monthlyLink.url}`);
    console.log(`  Annual:  ${annualLink.url}`);
  }

  // Save everything to a config file
  const config = {
    products: results,
    overage: { productId: overageProduct.id, priceId: overagePrice.id },
    paymentLinks: links,
    createdAt: new Date().toISOString(),
  };

  const configPath = path.join(__dirname, "..", "stripe-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n📄 Config saved to stripe-config.json`);
  console.log("\nDone! Update landing page CTAs with the payment links above.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
