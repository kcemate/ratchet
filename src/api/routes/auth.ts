import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { generateId, generateApiKey, hashApiKey, verifyApiKey } from '../lib/crypto.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();

/** POST /api/auth/login — GitHub OAuth code exchange */
router.post('/login', async (req, res) => {
  const { provider, code } = req.body as { provider?: string; code?: string };

  if (provider !== 'github' || !code) {
    res.status(400).json({ error: 'provider must be "github" and code is required' });
    return;
  }

  try {
    // Exchange code for GitHub access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.RATCHET_GITHUB_CLIENT_ID,
        client_secret: process.env.RATCHET_GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      res.status(401).json({ error: 'GitHub OAuth failed', detail: tokenData.error });
      return;
    }

    // Fetch GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const githubUser = (await userRes.json()) as {
      id: number;
      login: string;
      email?: string;
      avatar_url?: string;
    };

    const db = getDb();
    const now = new Date();

    // Upsert user
    const existing = db
      .select()
      .from(users)
      .where(eq(users.githubId, String(githubUser.id)))
      .get();

    let userId: string;
    let plan: string;

    if (existing) {
      db.update(users)
        .set({
          email: githubUser.email ?? existing.email,
          username: githubUser.login,
          avatarUrl: githubUser.avatar_url,
          updatedAt: now,
        })
        .where(eq(users.id, existing.id))
        .run();
      userId = existing.id;
      plan = existing.plan;
    } else {
      userId = generateId();
      plan = 'free';
      db.insert(users)
        .values({
          id: userId,
          githubId: String(githubUser.id),
          email: githubUser.email,
          username: githubUser.login,
          avatarUrl: githubUser.avatar_url,
          plan: 'free',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const token = signToken({ id: userId, username: githubUser.login, plan });
    res.json({ token, user: { id: userId, username: githubUser.login, plan } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /api/auth/verify-key — validate API key, return user + plan */
router.post('/verify-key', (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }

  const db = getDb();
  // Scan all users who have an API key set (keyed by hash lookup)
  const keyHash = hashApiKey(apiKey);
  const user = db
    .select()
    .from(users)
    .all()
    .find((u) => u.apiKey === keyHash);

  if (!user) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  // Verify using timing-safe compare (already hashed above, re-verify for safety)
  if (!verifyApiKey(apiKey, user.apiKey!)) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  res.json({ user: { id: user.id, username: user.username, plan: user.plan, email: user.email } });
});

/** GET /api/auth/me — JWT-protected, returns current user + subscription status */
router.get('/me', requireAuth, (req: AuthRequest, res) => {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, req.user!.id)).get();

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    plan: user.plan,
    createdAt: user.createdAt,
  });
});

/** POST /api/auth/generate-key — JWT-protected, generates a new API key */
router.post('/generate-key', requireAuth, (req: AuthRequest, res) => {
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);
  const db = getDb();

  db.update(users)
    .set({ apiKey: keyHash, updatedAt: new Date() })
    .where(eq(users.id, req.user!.id))
    .run();

  // Return the raw key once — it won't be retrievable again
  res.json({ apiKey });
});

export default router;
