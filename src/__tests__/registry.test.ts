/**
 * Integration tests for the Score Registry API.
 * Uses an in-memory SQLite database and supertest to call routes end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createRegistryRouter } from '../registry/routes.js';
import { getDb, resetDb } from '../registry/db.js';
import { createApiKey } from '../registry/api-keys.js';
import { buildSubmission } from '../registry/client.js';
import type { ScanResult } from '../core/scanner';

// ── Test fixtures ──────────────────────────────────────────────────────────

const MASTER_SECRET = 'test-master-secret';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createRegistryRouter());
  return app;
}

function makeScanResult(total = 85): ScanResult {
  return {
    projectName: 'test-project',
    total,
    maxTotal: 100,
    totalIssuesFound: 3,
    issuesByType: [],
    categories: [
      { name: 'Testing',        emoji: '🧪', score: 20, max: 25, summary: 'ok', subcategories: [] },
      { name: 'Security',       emoji: '🔒', score: 13, max: 15, summary: 'ok', subcategories: [] },
      { name: 'Type Safety',    emoji: '🔷', score: 14, max: 15, summary: 'ok', subcategories: [] },
      { name: 'Error Handling', emoji: '⚠️', score: 18, max: 20, summary: 'ok', subcategories: [] },
      { name: 'Performance',    emoji: '⚡', score: 9,  max: 10, summary: 'ok', subcategories: [] },
      { name: 'Code Quality',   emoji: '📖', score: 11, max: 15, summary: 'ok', subcategories: [] },
    ],
  };
}

const SAMPLE_PAYLOAD = {
  repo_owner: 'acme',
  repo_name:  'widget',
  language:   'typescript',
  overall_score: 85,
  testing_score: 20,
  security_score: 13,
  type_safety_score: 14,
  error_handling_score: 18,
  performance_score: 9,
  code_quality_score: 11,
  ratchet_version: '1.1.1',
};

// ── Setup / teardown ───────────────────────────────────────────────────────

let apiKey: string;
let app: ReturnType<typeof makeApp>;

beforeEach(() => {
  // Each test gets a fresh in-memory DB
  resetDb();
  process.env['RATCHET_DB_PATH'] = ':memory:';
  process.env['RATCHET_API_SECRET'] = MASTER_SECRET;

  const db = getDb(':memory:');
  const { key } = createApiKey(db, 'test-key');
  apiKey = key;

  app = makeApp();
});

afterEach(() => {
  resetDb();
  delete process.env['RATCHET_DB_PATH'];
  delete process.env['RATCHET_API_SECRET'];
});

// ── POST /api/v1/scores ────────────────────────────────────────────────────

describe('POST /api/v1/scores', () => {
  it('returns 401 without API key', async () => {
    const res = await request(app).post('/api/v1/scores').send(SAMPLE_PAYLOAD);
    expect(res.status).toBe(401);
    expect(res.body.ratchet_spec_version).toBe('1.0');
  });

  it('returns 401 with invalid API key', async () => {
    const res = await request(app)
      .post('/api/v1/scores')
      .set('Authorization', 'Bearer ratchet_invalid_key')
      .send(SAMPLE_PAYLOAD);
    expect(res.status).toBe(401);
  });

  it('returns 201 and submission_id with valid key', async () => {
    const res = await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(SAMPLE_PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.submission_id).toBe('number');
    expect(res.body.ratchet_spec_version).toBe('1.0');
  });

  it('returns 400 when repo_owner is missing', async () => {
    const { repo_owner: _omit, ...rest } = SAMPLE_PAYLOAD;
    const res = await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(rest);
    expect(res.status).toBe(400);
  });

  it('returns 400 when overall_score is out of range', async () => {
    const res = await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...SAMPLE_PAYLOAD, overall_score: 150 });
    expect(res.status).toBe(400);
  });

  it('accepts optional fields being absent', async () => {
    const minimal = { repo_owner: 'org', repo_name: 'repo', overall_score: 50 };
    const res = await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(minimal);
    expect(res.status).toBe(201);
  });

  it('creates a repo_profile after first submission', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(SAMPLE_PAYLOAD);

    const profile = await request(app).get('/api/v1/scores/acme/widget');
    expect(profile.status).toBe(200);
    expect(profile.body.profile.scan_count).toBe(1);
  });

  it('increments scan_count on repeated submissions', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/scores')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(SAMPLE_PAYLOAD);
    }
    const res = await request(app).get('/api/v1/scores/acme/widget');
    expect(res.body.profile.scan_count).toBe(3);
  });
});

// ── GET /api/v1/scores/:owner/:repo ───────────────────────────────────────

describe('GET /api/v1/scores/:owner/:repo', () => {
  it('returns 404 for unknown repo', async () => {
    const res = await request(app).get('/api/v1/scores/nobody/nothing');
    expect(res.status).toBe(404);
    expect(res.body.ratchet_spec_version).toBe('1.0');
  });

  it('returns latest score and history after submission', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(SAMPLE_PAYLOAD);

    const res = await request(app).get('/api/v1/scores/acme/widget');
    expect(res.status).toBe(200);
    expect(res.body.ratchet_spec_version).toBe('1.0');
    expect(res.body.latest.overall_score).toBe(85);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.profile.best_score).toBe(85);
    expect(res.body.profile.worst_score).toBe(85);
  });

  it('tracks best and worst scores across multiple submissions', async () => {
    for (const score of [70, 85, 60]) {
      await request(app)
        .post('/api/v1/scores')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ ...SAMPLE_PAYLOAD, overall_score: score });
    }
    const res = await request(app).get('/api/v1/scores/acme/widget');
    expect(res.body.profile.best_score).toBe(85);
    expect(res.body.profile.worst_score).toBe(60);
    expect(res.body.profile.scan_count).toBe(3);
  });
});

// ── GET /api/v1/scores/:owner/:repo/badge.svg ─────────────────────────────

describe('GET /api/v1/scores/:owner/:repo/badge.svg', () => {
  // supertest buffers image/svg+xml responses in res.body as a Buffer, not res.text
  function svgText(res: { text?: string; body: unknown }): string {
    return res.text ?? (Buffer.isBuffer(res.body) ? (res.body as Buffer).toString('utf-8') : String(res.body));
  }

  it('returns grey unknown badge for missing repo', async () => {
    const res = await request(app).get('/api/v1/scores/nobody/nothing/badge.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svgText(res)).toContain('<svg');
    expect(svgText(res)).toContain('unknown');
  });

  it('returns green badge for score >80', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...SAMPLE_PAYLOAD, overall_score: 85 });

    const res = await request(app).get('/api/v1/scores/acme/widget/badge.svg');
    expect(res.status).toBe(200);
    expect(svgText(res)).toContain('#44cc11'); // green
    expect(svgText(res)).toContain('85/100');
  });

  it('returns yellow badge for score >60 and <=80', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...SAMPLE_PAYLOAD, overall_score: 70 });

    const res = await request(app).get('/api/v1/scores/acme/widget/badge.svg');
    expect(svgText(res)).toContain('#dfb317'); // yellow
  });

  it('returns red badge for score <=60', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...SAMPLE_PAYLOAD, overall_score: 55 });

    const res = await request(app).get('/api/v1/scores/acme/widget/badge.svg');
    expect(svgText(res)).toContain('#e05d44'); // red
  });

  it('sets Cache-Control header', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(SAMPLE_PAYLOAD);

    const res = await request(app).get('/api/v1/scores/acme/widget/badge.svg');
    expect(res.headers['cache-control']).toContain('public');
  });
});

// ── GET /api/v1/leaderboard ────────────────────────────────────────────────

describe('GET /api/v1/leaderboard', () => {
  async function seedRepos() {
    const repos = [
      { repo_owner: 'org', repo_name: 'alpha', overall_score: 92, language: 'typescript' },
      { repo_owner: 'org', repo_name: 'beta',  overall_score: 78, language: 'python' },
      { repo_owner: 'org', repo_name: 'gamma', overall_score: 65, language: 'typescript' },
    ];
    for (const r of repos) {
      await request(app)
        .post('/api/v1/scores')
        .set('Authorization', `Bearer ${apiKey}`)
        .send(r);
    }
  }

  it('returns empty leaderboard when no repos', async () => {
    const res = await request(app).get('/api/v1/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.ratchet_spec_version).toBe('1.0');
    expect(res.body.leaderboard).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns repos sorted by score descending', async () => {
    await seedRepos();
    const res = await request(app).get('/api/v1/leaderboard');
    expect(res.body.leaderboard[0].score).toBe(92);
    expect(res.body.leaderboard[0].rank).toBe(1);
    expect(res.body.total).toBe(3);
  });

  it('filters by ?language=', async () => {
    await seedRepos();
    const res = await request(app).get('/api/v1/leaderboard?language=typescript');
    expect(res.body.leaderboard).toHaveLength(2);
    expect(res.body.filtered_by_language).toBe('typescript');
  });

  it('respects ?limit= parameter', async () => {
    await seedRepos();
    const res = await request(app).get('/api/v1/leaderboard?limit=2');
    expect(res.body.leaderboard).toHaveLength(2);
  });

  it('caps limit at 100', async () => {
    const res = await request(app).get('/api/v1/leaderboard?limit=9999');
    // should not error, just returns up to 100
    expect(res.status).toBe(200);
  });
});

// ── GET /api/v1/stats ─────────────────────────────────────────────────────

describe('GET /api/v1/stats', () => {
  it('returns zero stats on empty registry', async () => {
    const res = await request(app).get('/api/v1/stats');
    expect(res.status).toBe(200);
    expect(res.body.ratchet_spec_version).toBe('1.0');
    expect(res.body.total_repos).toBe(0);
    expect(res.body.total_scans).toBe(0);
    expect(res.body.average_score).toBeNull();
  });

  it('calculates stats correctly after submissions', async () => {
    for (const score of [80, 90, 70]) {
      await request(app)
        .post('/api/v1/scores')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ ...SAMPLE_PAYLOAD, overall_score: score });
    }
    const res = await request(app).get('/api/v1/stats');
    expect(res.body.total_repos).toBe(1); // all same repo
    expect(res.body.total_scans).toBe(3);
    expect(res.body.average_score).toBe(80);
  });

  it('groups stats by language', async () => {
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...SAMPLE_PAYLOAD, repo_name: 'ts-repo', language: 'typescript', overall_score: 90 });
    await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...SAMPLE_PAYLOAD, repo_name: 'py-repo', language: 'python', overall_score: 70 });

    const res = await request(app).get('/api/v1/stats');
    expect(res.body.by_language['typescript']).toBeDefined();
    expect(res.body.by_language['python']).toBeDefined();
  });
});

// ── POST /api/v1/keys ─────────────────────────────────────────────────────

describe('POST /api/v1/keys', () => {
  it('returns 401 without master secret', async () => {
    const res = await request(app).post('/api/v1/keys').send({ name: 'ci-key' });
    expect(res.status).toBe(401);
  });

  it('creates a new API key with master secret', async () => {
    const res = await request(app)
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${MASTER_SECRET}`)
      .send({ name: 'ci-key' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^ratchet_/);
    expect(typeof res.body.key_id).toBe('string');
  });

  it('newly created key can submit scores', async () => {
    const keyRes = await request(app)
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${MASTER_SECRET}`)
      .send({ name: 'new-key' });

    const newKey = keyRes.body.key as string;
    const res = await request(app)
      .post('/api/v1/scores')
      .set('Authorization', `Bearer ${newKey}`)
      .send(SAMPLE_PAYLOAD);
    expect(res.status).toBe(201);
  });
});

// ── buildSubmission (client helper) ───────────────────────────────────────

describe('buildSubmission', () => {
  it('maps ScanResult categories to submission fields', () => {
    const result = makeScanResult(85);
    const sub = buildSubmission(result, '/fake/cwd', 'typescript', '1.1.1');
    expect(sub).not.toBeNull();
    expect(sub!.overall_score).toBe(85);
    expect(sub!.testing_score).toBe(20);
    expect(sub!.security_score).toBe(13);
    expect(sub!.type_safety_score).toBe(14);
    expect(sub!.error_handling_score).toBe(18);
    expect(sub!.performance_score).toBe(9);
    expect(sub!.code_quality_score).toBe(11);
    expect(sub!.language).toBe('typescript');
    expect(sub!.ratchet_version).toBe('1.1.1');
  });
});
