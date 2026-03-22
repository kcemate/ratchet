import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import type { Env, ScanResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// Mock KV namespace
// ---------------------------------------------------------------------------

class MockKV implements KVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(): Promise<KVNamespaceListResult<unknown, string>> {
    return { keys: [], list_complete: true, cursor: undefined } as unknown as KVNamespaceListResult<unknown, string>;
  }
  async getWithMetadata<T = unknown>(key: string): Promise<KVNamespaceGetWithMetadataResult<string, T>> {
    const value = this.store.get(key) ?? null;
    return { value, metadata: null } as KVNamespaceGetWithMetadataResult<string, T>;
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_SCAN: ScanResult = {
  owner: 'myorg',
  repo: 'myrepo',
  branch: 'main',
  score: 92,
  maxScore: 100,
  categories: {
    testing:         { score: 22, max: 25 },
    security:        { score: 14, max: 15 },
    'error-handling':{ score: 12, max: 15 },
    'type-safety':   { score: 14, max: 15 },
    performance:     { score: 13, max: 15 },
    'code-quality':  { score: 17, max: 15 },
  },
  timestamp: '2026-03-22T00:00:00Z',
};

function makeEnv(kv: MockKV, apiKey = 'test-api-key'): Env {
  return { RATCHET_SCORES: kv as unknown as KVNamespace, API_KEY: apiKey };
}

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Request {
  return new Request(`https://ratchetcli.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// POST /api/push
// ---------------------------------------------------------------------------

describe('POST /api/push', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv);
  });

  it('rejects missing Authorization header', async () => {
    const res = await worker.fetch(req('POST', '/api/push', SAMPLE_SCAN), env);
    expect(res.status).toBe(401);
  });

  it('rejects wrong API key', async () => {
    const res = await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer wrong-key' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('rejects invalid JSON', async () => {
    const r = new Request('https://ratchetcli.com/api/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-api-key', 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await worker.fetch(r, env);
    expect(res.status).toBe(400);
  });

  it('rejects missing required fields', async () => {
    const res = await worker.fetch(
      req('POST', '/api/push', { owner: 'x' }, { Authorization: 'Bearer test-api-key' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('stores scan result and returns ok', async () => {
    const res = await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; key: string };
    expect(body.ok).toBe(true);
    expect(body.key).toBe('myorg/myrepo');
  });

  it('stores history entry', async () => {
    await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }),
      env,
    );
    const history = await kv.get('myorg/myrepo/history');
    expect(history).not.toBeNull();
    const parsed = JSON.parse(history!) as ScanResult[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].score).toBe(92);
  });

  it('tracks previous scan in stored data', async () => {
    const firstScan = { ...SAMPLE_SCAN, score: 88 };
    await worker.fetch(
      req('POST', '/api/push', firstScan, { Authorization: 'Bearer test-api-key' }),
      env,
    );
    await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }),
      env,
    );
    const stored = await kv.get('myorg/myrepo');
    const parsed = JSON.parse(stored!) as { current: ScanResult; previous: ScanResult };
    expect(parsed.current.score).toBe(92);
    expect(parsed.previous.score).toBe(88);
  });
});

// ---------------------------------------------------------------------------
// GET /api/scores/{owner}/{repo}
// ---------------------------------------------------------------------------

describe('GET /api/scores/{owner}/{repo}', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(async () => {
    kv = new MockKV();
    env = makeEnv(kv);
    // Seed data
    await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }),
      env,
    );
  });

  it('returns 404 for unknown repo', async () => {
    const res = await worker.fetch(req('GET', '/api/scores/unknown/repo'), env);
    expect(res.status).toBe(404);
  });

  it('returns stored scores as JSON', async () => {
    const res = await worker.fetch(req('GET', '/api/scores/myorg/myrepo'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await res.json() as { current: ScanResult };
    expect(body.current.score).toBe(92);
  });
});

// ---------------------------------------------------------------------------
// GET /badge/{owner}/{repo}
// ---------------------------------------------------------------------------

describe('GET /badge — overall', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(async () => {
    kv = new MockKV();
    env = makeEnv(kv);
    await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }),
      env,
    );
  });

  it('returns SVG with correct content-type', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
  });

  it('sets Cache-Control header', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo'), env);
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  it('contains score in SVG', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo'), env);
    const svg = await res.text();
    expect(svg).toContain('92/100');
  });

  it('shows unknown badge for missing repo', async () => {
    const res = await worker.fetch(req('GET', '/badge/nobody/norepo'), env);
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain('unknown');
  });

  it('respects ?style=flat-square', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo?style=flat-square'), env);
    const svg = await res.text();
    expect(svg).toContain('shape-rendering="crispEdges"');
  });

  it('respects ?style=for-the-badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo?style=for-the-badge'), env);
    const svg = await res.text();
    expect(svg).toContain('height="28"');
  });

  it('respects ?label=custom', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo?label=quality'), env);
    const svg = await res.text();
    expect(svg).toContain('quality');
  });
});

// ---------------------------------------------------------------------------
// GET /badge/{owner}/{repo}/{category}
// ---------------------------------------------------------------------------

describe('GET /badge — category', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(async () => {
    kv = new MockKV();
    env = makeEnv(kv);
    await worker.fetch(
      req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }),
      env,
    );
  });

  it('serves testing category badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/testing'), env);
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain('22/25');
  });

  it('serves security category badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/security'), env);
    const svg = await res.text();
    expect(svg).toContain('14/15');
  });

  it('serves error-handling category badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/error-handling'), env);
    const svg = await res.text();
    expect(svg).toContain('12/15');
  });

  it('serves type-safety category badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/type-safety'), env);
    const svg = await res.text();
    expect(svg).toContain('14/15');
  });

  it('serves performance category badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/performance'), env);
    const svg = await res.text();
    expect(svg).toContain('13/15');
  });

  it('serves code-quality category badge', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/code-quality'), env);
    const svg = await res.text();
    expect(svg).toContain('17/15');
  });

  it('returns 404 for unknown category segment', async () => {
    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/invalid-cat'), env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /badge/{owner}/{repo}/trend
// ---------------------------------------------------------------------------

describe('GET /badge — trend', () => {
  let kv: MockKV;
  let env: Env;

  beforeEach(() => {
    kv = new MockKV();
    env = makeEnv(kv);
  });

  it('shows +N when score improved', async () => {
    const first = { ...SAMPLE_SCAN, score: 88 };
    await worker.fetch(req('POST', '/api/push', first, { Authorization: 'Bearer test-api-key' }), env);
    await worker.fetch(req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }), env);

    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/trend'), env);
    const svg = await res.text();
    expect(svg).toContain('+4');
  });

  it('shows -N when score regressed', async () => {
    const first = { ...SAMPLE_SCAN, score: 96 };
    await worker.fetch(req('POST', '/api/push', first, { Authorization: 'Bearer test-api-key' }), env);
    await worker.fetch(req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }), env);

    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/trend'), env);
    const svg = await res.text();
    expect(svg).toContain('-4');
  });

  it('shows = for no change', async () => {
    await worker.fetch(req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }), env);
    await worker.fetch(req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }), env);

    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/trend'), env);
    const svg = await res.text();
    expect(svg).toContain('(=)');
  });

  it('shows = when no previous scan exists', async () => {
    await worker.fetch(req('POST', '/api/push', SAMPLE_SCAN, { Authorization: 'Bearer test-api-key' }), env);

    const res = await worker.fetch(req('GET', '/badge/myorg/myrepo/trend'), env);
    const svg = await res.text();
    expect(svg).toContain('(=)');
  });
});

// ---------------------------------------------------------------------------
// 404 routes
// ---------------------------------------------------------------------------

describe('Unknown routes', () => {
  it('returns 404 for completely unknown paths', async () => {
    const kv = new MockKV();
    const env = makeEnv(kv);
    const res = await worker.fetch(req('GET', '/unknown/path'), env);
    expect(res.status).toBe(404);
  });
});
