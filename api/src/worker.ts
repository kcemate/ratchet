/**
 * Ratchet API — Cloudflare Worker
 * Handles: Stripe webhooks, license validation, key delivery
 */

export interface Env {
  LICENSES: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

// ── Helpers ────────────────────────────────────────────

function generateLicenseKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const segments = 4;
  const segLen = 5;
  const parts: string[] = [];
  for (let i = 0; i < segments; i++) {
    let seg = "";
    for (let j = 0; j < segLen; j++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    parts.push(seg);
  }
  return `RATCHET-${parts.join("-")}`;
}

function tierFromPriceId(priceId: string, metadata?: Record<string, string>): string {
  if (metadata?.tier) return metadata.tier;
  return "unknown";
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...headers },
  });
}

// ── Stripe signature verification (HMAC-SHA256) ───────

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  const parts = sigHeader.split(",").reduce(
    (acc, part) => {
      const [k, v] = part.split("=");
      if (k === "t") acc.timestamp = v;
      if (k === "v1") acc.signatures.push(v);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] }
  );

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  // Tolerance: 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(parts.timestamp)) > 300) return false;

  const signedPayload = `${parts.timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return parts.signatures.some((s) => s === computed);
}

// ── Routes ─────────────────────────────────────────────

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Missing signature or webhook secret" }, 400);
  }

  const valid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return json({ error: "Invalid signature" }, 400);
  }

  const event = JSON.parse(body);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const customerId = session.customer as string;
    const customerEmail = session.customer_details?.email || session.customer_email || "";
    const tier = session.metadata?.tier || "pro";

    // Generate license key
    const licenseKey = generateLicenseKey();

    const licenseData = {
      key: licenseKey,
      tier,
      customerId,
      email: customerEmail,
      status: "active",
      createdAt: new Date().toISOString(),
      stripeSessionId: session.id,
      cyclesUsed: 0,
      cyclesLimit: tier === "builder" ? 30 : tier === "pro" ? 150 : tier === "team" ? 500 : 0,
    };

    // Store by key AND by customer ID for lookups
    await env.LICENSES.put(`key:${licenseKey}`, JSON.stringify(licenseData));
    await env.LICENSES.put(`customer:${customerId}`, JSON.stringify(licenseData));
    if (customerEmail) {
      await env.LICENSES.put(`email:${customerEmail}`, JSON.stringify(licenseData));
    }

    console.log(`License created: ${licenseKey} for ${customerEmail} (${tier})`);
  }

  return json({ received: true });
}

async function handleValidate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";

  if (!key) {
    return json({ valid: false, error: "Missing key parameter" }, 400);
  }

  const data = await env.LICENSES.get(`key:${key}`);
  if (!data) {
    return json({ valid: false, error: "Invalid license key" }, 404);
  }

  const license = JSON.parse(data);

  if (license.status !== "active") {
    return json({ valid: false, error: "License is not active", status: license.status }, 403);
  }

  return json({
    valid: true,
    tier: license.tier,
    cyclesUsed: license.cyclesUsed,
    cyclesLimit: license.cyclesLimit,
    email: license.email,
  });
}

async function handleUsage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST required" }, 405);

  const body = (await request.json()) as { key?: string; cycles?: number };
  const key = body.key || "";
  const cycles = body.cycles || 1;

  const data = await env.LICENSES.get(`key:${key}`);
  if (!data) return json({ valid: false, error: "Invalid key" }, 404);

  const license = JSON.parse(data);
  license.cyclesUsed += cycles;

  await env.LICENSES.put(`key:${key}`, JSON.stringify(license));

  return json({
    cyclesUsed: license.cyclesUsed,
    cyclesLimit: license.cyclesLimit,
    remaining: Math.max(0, license.cyclesLimit - license.cyclesUsed),
  });
}

async function handleLookup(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const email = url.searchParams.get("email") || "";

  if (!email) return json({ error: "Missing email" }, 400);

  const data = await env.LICENSES.get(`email:${email}`);
  if (!data) return json({ found: false }, 404);

  const license = JSON.parse(data);
  return json({
    found: true,
    key: license.key,
    tier: license.tier,
    status: license.status,
  });
}

// ── Welcome page (shows license key after purchase) ───

function welcomePage(key: string, tier: string, email: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Ratchet</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #0a0a0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 48px;
      max-width: 560px;
      width: 90%;
      text-align: center;
    }
    h1 { font-size: 32px; margin-bottom: 8px; color: #fff; }
    .tier { color: #f59e0b; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 24px; }
    .key-box {
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.3);
      border-radius: 8px;
      padding: 16px 24px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 18px;
      color: #f59e0b;
      letter-spacing: 1px;
      cursor: pointer;
      position: relative;
      margin: 24px 0;
    }
    .key-box:hover { background: rgba(245,158,11,0.12); }
    .key-box .copy-hint {
      font-size: 11px;
      color: rgba(245,158,11,0.5);
      display: block;
      margin-top: 8px;
      font-family: 'Inter', sans-serif;
      letter-spacing: 0;
    }
    .steps {
      text-align: left;
      margin: 24px 0;
      padding: 20px 24px;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
    }
    .steps h3 { font-size: 14px; color: #888; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .steps code {
      display: block;
      background: rgba(0,0,0,0.4);
      padding: 10px 14px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      color: #f59e0b;
      margin: 6px 0;
    }
    .email-note { color: #666; font-size: 13px; margin-top: 16px; }
    a { color: #f59e0b; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔧 You're in.</h1>
    <div class="tier">${tier} Plan</div>
    <div class="key-box" onclick="navigator.clipboard.writeText('${key}'); this.querySelector('.copy-hint').textContent = 'Copied!'">
      ${key}
      <span class="copy-hint">Click to copy</span>
    </div>
    <div class="steps">
      <h3>Get started</h3>
      <code>npm i -g ratchet-cli</code>
      <code>ratchet login ${key}</code>
      <code>ratchet torque --target src/ -c 7</code>
    </div>
    <p class="email-note">A copy has been sent to <strong>${email}</strong></p>
    <p style="margin-top: 16px;"><a href="https://ratchetcli.com">← Back to ratchetcli.com</a></p>
  </div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
}

async function handleWelcome(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id") || "";

  if (!sessionId) {
    return new Response("Missing session_id", { status: 400 });
  }

  // Look up session from Stripe to get customer email
  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });

  if (!stripeRes.ok) {
    return new Response("Could not verify session", { status: 400 });
  }

  const session = (await stripeRes.json()) as {
    customer: string;
    customer_details?: { email?: string };
    customer_email?: string;
    metadata?: Record<string, string>;
  };
  const email = session.customer_details?.email || session.customer_email || "";
  const tier = session.metadata?.tier || "pro";

  // Check if license already exists for this customer
  let licenseData = await env.LICENSES.get(`customer:${session.customer}`);
  if (!licenseData && email) {
    licenseData = await env.LICENSES.get(`email:${email}`);
  }

  if (licenseData) {
    const license = JSON.parse(licenseData);
    return welcomePage(license.key, license.tier, license.email);
  }

  // If webhook hasn't fired yet, wait briefly and retry
  await new Promise((r) => setTimeout(r, 2000));
  licenseData = await env.LICENSES.get(`customer:${session.customer}`);
  if (licenseData) {
    const license = JSON.parse(licenseData);
    return welcomePage(license.key, license.tier, license.email);
  }

  // Still nothing — generate key here as fallback
  const key = generateLicenseKey();
  const license = {
    key,
    tier,
    customerId: session.customer,
    email,
    status: "active",
    createdAt: new Date().toISOString(),
    stripeSessionId: sessionId,
    cyclesUsed: 0,
    cyclesLimit: tier === "builder" ? 30 : tier === "pro" ? 150 : tier === "team" ? 500 : 0,
  };
  await env.LICENSES.put(`key:${key}`, JSON.stringify(license));
  await env.LICENSES.put(`customer:${session.customer}`, JSON.stringify(license));
  if (email) await env.LICENSES.put(`email:${email}`, JSON.stringify(license));

  return welcomePage(key, tier, email);
}

// ── CORS preflight ─────────────────────────────────────

function handleOptions(): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// ── Router ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return handleOptions();

    if (path === "/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (path === "/validate" && request.method === "GET") return handleValidate(request, env);
    if (path === "/usage" && request.method === "POST") return handleUsage(request, env);
    if (path === "/lookup" && request.method === "GET") return handleLookup(request, env);
    if (path === "/welcome" && request.method === "GET") return handleWelcome(request, env);

    return json({ api: "ratchet", version: "1.0.0", status: "ok" });
  },
};
