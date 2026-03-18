import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

// Use in-memory SQLite for all tests
process.env.RATCHET_DB_PATH = ':memory:';
process.env.RATCHET_JWT_SECRET = 'test-secret-key';

// ─── Pure unit tests for tier logic ─────────────────────────────────────────

import { checkTierLimit, getPeriodStart, TIER_LIMITS } from '../api/lib/tiers.js';

describe('TIER_LIMITS', () => {
  it('free: 3 cycles per 7-day period, no torque', () => {
    expect(TIER_LIMITS.free.cyclesPerPeriod).toBe(3);
    expect(TIER_LIMITS.free.periodDays).toBe(7);
    expect(TIER_LIMITS.free.allowedTypes).not.toContain('torque');
  });

  it('builder: 30 cycles per 30-day period', () => {
    expect(TIER_LIMITS.builder.cyclesPerPeriod).toBe(30);
    expect(TIER_LIMITS.builder.periodDays).toBe(30);
    expect(TIER_LIMITS.builder.allowedTypes).toContain('torque');
  });

  it('pro: 150 cycles per 30-day period', () => {
    expect(TIER_LIMITS.pro.cyclesPerPeriod).toBe(150);
  });

  it('team: 500 cycles per 30-day period', () => {
    expect(TIER_LIMITS.team.cyclesPerPeriod).toBe(500);
  });

  it('enterprise: unlimited', () => {
    expect(TIER_LIMITS.enterprise.cyclesPerPeriod).toBe(Infinity);
  });
});

describe('checkTierLimit', () => {
  it('allows scan on free plan within limit', () => {
    const result = checkTierLimit('free', 'scan', 2);
    expect(result.allowed).toBe(true);
    expect(result.cyclesRemaining).toBe(1);
  });

  it('blocks when free limit reached (3/week)', () => {
    const result = checkTierLimit('free', 'scan', 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('cycle_limit_reached');
    expect(result.cyclesRemaining).toBe(0);
  });

  it('blocks torque on free plan', () => {
    const result = checkTierLimit('free', 'torque', 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('torque');
  });

  it('allows builder at 29/30 cycles', () => {
    const result = checkTierLimit('builder', 'torque', 29);
    expect(result.allowed).toBe(true);
    expect(result.cyclesRemaining).toBe(1);
  });

  it('blocks builder at limit (30/30)', () => {
    const result = checkTierLimit('builder', 'torque', 30);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('cycle_limit_reached');
  });

  it('allows pro at 149/150', () => {
    const result = checkTierLimit('pro', 'scan', 149);
    expect(result.allowed).toBe(true);
    expect(result.cyclesRemaining).toBe(1);
  });

  it('blocks pro at limit (150/150)', () => {
    const result = checkTierLimit('pro', 'scan', 150);
    expect(result.allowed).toBe(false);
  });

  it('always allows enterprise', () => {
    const result = checkTierLimit('enterprise', 'torque', 999999);
    expect(result.allowed).toBe(true);
    expect(result.cyclesRemaining).toBe(Infinity);
  });
});

describe('getPeriodStart', () => {
  it('returns 7 days ago for free plan', () => {
    const now = new Date('2025-01-15T12:00:00Z');
    const start = getPeriodStart('free', now);
    expect(start.toISOString().slice(0, 10)).toBe('2025-01-08');
  });

  it('returns 30 days ago for builder plan', () => {
    const now = new Date('2025-01-31T00:00:00Z');
    const start = getPeriodStart('builder', now);
    expect(start.toISOString().slice(0, 10)).toBe('2025-01-01');
  });
});

// ─── Unit tests for crypto helpers ──────────────────────────────────────────

import { generateApiKey, hashApiKey, verifyApiKey, generateId } from '../api/lib/crypto.js';

describe('crypto helpers', () => {
  it('generateApiKey returns rk_ prefix + 64 hex chars', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^rk_[0-9a-f]{64}$/);
  });

  it('verifyApiKey validates correctly', () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(verifyApiKey(key, hash)).toBe(true);
    expect(verifyApiKey('rk_wrong', hash)).toBe(false);
  });

  it('generateId returns 24 hex chars', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{24}$/);
  });
});

// ─── JWT middleware unit tests ───────────────────────────────────────────────

import jwt from 'jsonwebtoken';
import { requireAuth, signToken } from '../api/middleware/auth.js';
import type { AuthRequest } from '../api/middleware/auth.js';
import type { Response, NextFunction } from 'express';

describe('requireAuth middleware', () => {
  const mockNext = vi.fn() as unknown as NextFunction;
  const mockRes = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() with valid token', () => {
    const token = signToken({ id: 'user1', username: 'alice', plan: 'pro' });
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as AuthRequest;

    requireAuth(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledOnce();
    expect(req.user?.id).toBe('user1');
    expect(req.user?.plan).toBe('pro');
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} } as AuthRequest;
    requireAuth(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 on invalid token', () => {
    const req = {
      headers: { authorization: 'Bearer not-a-valid-token' },
    } as AuthRequest;
    requireAuth(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 with "Token expired" on expired token', () => {
    const expired = jwt.sign(
      { id: 'user1', username: 'alice', plan: 'free' },
      'test-secret-key',
      { expiresIn: -1 },
    );
    const req = {
      headers: { authorization: `Bearer ${expired}` },
    } as AuthRequest;
    requireAuth(req, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    const jsonCall = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { error: string };
    expect(jsonCall.error).toBe('Token expired');
  });
});

// ─── HTTP integration tests ──────────────────────────────────────────────────

import { resetDb, getDb } from '../api/db/client.js';
import { users, usageRecords } from '../api/db/schema.js';
import { createServer } from '../api/server.js';

// Reset DB singleton before each HTTP test group so each test gets a clean DB
function makeApp() {
  resetDb();
  return createServer();
}

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const app = makeApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /api/auth/verify-key', () => {
  it('returns 400 when apiKey is missing', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/auth/verify-key').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for unknown key', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/auth/verify-key')
      .send({ apiKey: 'rk_doesnotexist' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = makeApp();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer badtoken');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/usage/record — tier enforcement', () => {
  it('returns 400 for unknown type', async () => {
    const app = makeApp();
    const token = signToken({ id: 'u1', username: 'bob', plan: 'pro' });
    const res = await request(app)
      .post('/api/usage/record')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/usage/record').send({ type: 'scan' });
    expect(res.status).toBe(401);
  });

  it('records a cycle and returns 201 for existing user', async () => {
    resetDb();
    const { getDb } = await import('../api/db/client.js');
    const { users } = await import('../api/db/schema.js');
    const db = getDb();
    const now = new Date();
    db.insert(users).values({
      id: 'user-pro-1',
      githubId: '11111',
      username: 'prouser',
      plan: 'pro',
      createdAt: now,
      updatedAt: now,
    }).run();

    const app = createServer();
    const token = signToken({ id: 'user-pro-1', username: 'prouser', plan: 'pro' });
    const res = await request(app)
      .post('/api/usage/record')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'scan' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('scan');
    expect(res.body.cyclesUsed).toBe(1);
  });

  it('returns 402 when free tier limit exceeded', async () => {
    resetDb();
    const { getDb } = await import('../api/db/client.js');
    const { users, usageRecords } = await import('../api/db/schema.js');
    const { generateId } = await import('../api/lib/crypto.js');
    const db = getDb();
    const now = new Date();

    db.insert(users).values({
      id: 'user-free-1',
      githubId: '22222',
      username: 'freeuser',
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    }).run();

    // Insert 3 scans (free limit = 3/week)
    for (let i = 0; i < 3; i++) {
      db.insert(usageRecords).values({
        id: generateId(),
        userId: 'user-free-1',
        type: 'scan',
        cycleCount: 1,
        createdAt: now,
      }).run();
    }

    const app = createServer();
    const token = signToken({ id: 'user-free-1', username: 'freeuser', plan: 'free' });
    const res = await request(app)
      .post('/api/usage/record')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'scan' });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('cycle_limit_reached');
    expect(res.body.upgrade_url).toContain('ratchetcli.com');
  });

  it('blocks torque on free plan with 403', async () => {
    resetDb();
    const db = getDb();
    const now = new Date();
    const uid = `user-free-torque-${Date.now()}`;
    db.insert(users).values({
      id: uid,
      githubId: `gh-${Date.now()}`,
      username: 'freeuser-torque',
      plan: 'free',
      createdAt: now,
      updatedAt: now,
    }).run();

    const app = createServer();
    const token = signToken({ id: uid, username: 'freeuser-torque', plan: 'free' });
    const res = await request(app)
      .post('/api/usage/record')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'torque' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/usage', () => {
  it('returns 401 without auth', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/usage');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/usage/history', () => {
  it('returns 401 without auth', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/usage/history');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/billing/checkout', () => {
  it('returns 400 for invalid plan', async () => {
    const app = makeApp();
    const token = signToken({ id: 'u1', username: 'bob', plan: 'free' });
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns checkout URL for valid plan', async () => {
    const app = makeApp();
    const token = signToken({ id: 'u1', username: 'bob', plan: 'free' });
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
    expect(res.body.plan).toBe('pro');
  });
});

describe('POST /api/billing/webhook', () => {
  it('acknowledges webhook with received: true', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/billing/webhook')
      .send({ type: 'invoice.payment_succeeded', id: 'evt_test' });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
