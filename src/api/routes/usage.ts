import { Router } from 'express';
import { eq, gte, sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { usageRecords, users } from '../db/schema.js';
import { generateId } from '../lib/crypto.js';
import { checkTierLimit, getPeriodStart, TIER_LIMITS } from '../lib/tiers.js';
import type { Plan, UsageType } from '../lib/tiers.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';

const router = Router();

/** POST /api/usage/record — record a cycle (scan or torque click), enforce tier limits */
router.post('/record', requireAuth, (req: AuthRequest, res) => {
  const { type, cycleCount = 1, metadata } = req.body as {
    type?: UsageType;
    cycleCount?: number;
    metadata?: Record<string, unknown>;
  };

  if (!type || !['scan', 'torque', 'vision'].includes(type)) {
    res.status(400).json({ error: 'type must be one of: scan, torque, vision' });
    return;
  }

  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, req.user!.id)).get();
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const plan = user.plan as Plan;
  const periodStart = getPeriodStart(plan);
  // Drizzle stores timestamps as Unix seconds; convert ms → s for SQL comparison
  const periodStartSec = Math.floor(periodStart.getTime() / 1000);

  const periodUsage = db
    .select({ total: sql<number>`COALESCE(SUM(cycle_count), 0)` })
    .from(usageRecords)
    .where(
      sql`user_id = ${user.id} AND created_at >= ${periodStartSec}`
    )
    .get() as { total: number } | undefined;

  const usedThisPeriod = periodUsage?.total ?? 0;

  const check = checkTierLimit(plan, type, usedThisPeriod);
  if (!check.allowed) {
    if (check.reason === 'cycle_limit_reached') {
      res.status(402).json({
        error: 'cycle_limit_reached',
        upgrade_url: 'https://ratchetcli.com/#pricing',
        cyclesUsed: usedThisPeriod,
        cyclesRemaining: 0,
        plan,
      });
    } else {
      res.status(403).json({ error: check.reason, plan });
    }
    return;
  }

  const record = {
    id: generateId(),
    userId: user.id,
    type,
    cycleCount: cycleCount ?? 1,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: new Date(),
  };

  db.insert(usageRecords).values(record).run();

  res.status(201).json({
    id: record.id,
    type,
    cycleCount: record.cycleCount,
    cyclesUsed: usedThisPeriod + record.cycleCount,
    cyclesRemaining: check.cyclesRemaining !== undefined && check.cyclesRemaining !== Infinity
      ? check.cyclesRemaining - record.cycleCount
      : null,
    createdAt: record.createdAt,
  });
});

/** GET /api/usage — current period usage summary */
router.get('/', requireAuth, (req: AuthRequest, res) => {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, req.user!.id)).get();
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const plan = user.plan as Plan;
  const limits = TIER_LIMITS[plan];
  const periodStart = getPeriodStart(plan);
  const now = new Date();
  const periodStartSec = Math.floor(periodStart.getTime() / 1000);

  const periodUsage = db
    .select({ total: sql<number>`COALESCE(SUM(cycle_count), 0)` })
    .from(usageRecords)
    .where(sql`user_id = ${user.id} AND created_at >= ${periodStartSec}`)
    .get() as { total: number } | undefined;

  const cyclesUsed = periodUsage?.total ?? 0;
  const cyclesRemaining = limits.cyclesPerPeriod === Infinity
    ? null
    : Math.max(0, limits.cyclesPerPeriod - cyclesUsed);

  res.json({
    plan,
    cyclesUsed,
    cyclesRemaining,
    cyclesPerPeriod: limits.cyclesPerPeriod === Infinity ? null : limits.cyclesPerPeriod,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
  });
});

/** GET /api/usage/history — last 30 days of usage by day */
router.get('/history', requireAuth, (req: AuthRequest, res) => {
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, req.user!.id)).get();
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoSec = Math.floor(thirtyDaysAgo.getTime() / 1000);

  const rows = db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', datetime(created_at, 'unixepoch'))`,
      cycles: sql<number>`SUM(cycle_count)`,
      scans: sql<number>`SUM(CASE WHEN type = 'scan' THEN cycle_count ELSE 0 END)`,
      torque: sql<number>`SUM(CASE WHEN type = 'torque' THEN cycle_count ELSE 0 END)`,
      vision: sql<number>`SUM(CASE WHEN type = 'vision' THEN cycle_count ELSE 0 END)`,
    })
    .from(usageRecords)
    .where(sql`user_id = ${user.id} AND created_at >= ${thirtyDaysAgoSec}`)
    .groupBy(sql`strftime('%Y-%m-%d', datetime(created_at / 1000, 'unixepoch'))`)
    .orderBy(sql`day DESC`)
    .all();

  res.json({ history: rows });
});

export default router;
