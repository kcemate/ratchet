import type { Env, ScanResult, CategoryName, StoredScores } from './types.js';
import { VALID_CATEGORIES } from './types.js';
import {
  generateScoreBadge,
  generateCategoryBadge,
  generateTrendBadge,
  generateErrorBadge,
} from './badge.js';
import type { BadgeStyle } from './badge.js';

const BADGE_CACHE = 'public, max-age=3600, s-maxage=3600';

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Route: POST /api/push
    if (request.method === 'POST' && pathname === '/api/push') {
      return handlePush(request, env);
    }

    // Route: GET /api/scores/{owner}/{repo}
    const scoresMatch = pathname.match(/^\/api\/scores\/([^/]+)\/([^/]+)$/);
    if (request.method === 'GET' && scoresMatch) {
      return handleGetScores(scoresMatch[1], scoresMatch[2], env);
    }

    // Route: GET /badge/{owner}/{repo}[/{category|trend}]
    const badgeMatch = pathname.match(/^\/badge\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/);
    if (request.method === 'GET' && badgeMatch) {
      const owner    = badgeMatch[1];
      const repo     = badgeMatch[2];
      const segment  = badgeMatch[3]; // undefined | 'trend' | category name
      const style    = parseStyle(url.searchParams.get('style'));
      const label    = url.searchParams.get('label') ?? undefined;
      const branch   = url.searchParams.get('branch') ?? undefined;
      return handleBadge(owner, repo, segment, style, label, branch, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ---------------------------------------------------------------------------
// Badge handler
// ---------------------------------------------------------------------------

async function handleBadge(
  owner: string,
  repo: string,
  segment: string | undefined,
  style: BadgeStyle,
  customLabel: string | undefined,
  _branch: string | undefined,
  env: Env,
): Promise<Response> {
  const stored = await loadScores(owner, repo, env);

  if (!stored) {
    const label = customLabel ?? 'ratchet';
    const svg = generateErrorBadge(label, 'unknown', style);
    return svgResponse(svg, BADGE_CACHE);
  }

  const { current, previous } = stored;
  let svg: string;

  if (!segment) {
    // Overall score badge
    const label = customLabel ?? 'ratchet';
    svg = generateScoreBadge(label, current.score, current.maxScore, style);
  } else if (segment === 'trend') {
    // Trend badge: delta vs previous scan
    const delta = previous ? current.score - previous.score : 0;
    svg = generateTrendBadge(current.score, current.maxScore, delta, style);
  } else if (VALID_CATEGORIES.has(segment)) {
    // Per-category badge
    const cat = current.categories[segment as CategoryName];
    if (!cat) {
      const label = customLabel ?? segment;
      svg = generateErrorBadge(label, 'no data', style);
    } else {
      const label = customLabel ?? segment;
      svg = generateCategoryBadge(label, cat.score, cat.max, style);
    }
  } else {
    return new Response('Not Found', { status: 404 });
  }

  return svgResponse(svg, BADGE_CACHE);
}

// ---------------------------------------------------------------------------
// API: GET /api/scores/{owner}/{repo}
// ---------------------------------------------------------------------------

async function handleGetScores(owner: string, repo: string, env: Env): Promise<Response> {
  const stored = await loadScores(owner, repo, env);
  if (!stored) {
    return jsonResponse({ error: 'Not found' }, 404);
  }
  return jsonResponse(stored);
}

// ---------------------------------------------------------------------------
// API: POST /api/push
// ---------------------------------------------------------------------------

async function handlePush(request: Request, env: Env): Promise<Response> {
  // Authenticate
  const authHeader = request.headers.get('Authorization');
  const expectedKey = env.API_KEY;
  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body: ScanResult;
  try {
    body = await request.json() as ScanResult;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { owner, repo, score, maxScore, categories, branch, timestamp } = body;

  if (!owner || !repo || typeof score !== 'number' || typeof maxScore !== 'number') {
    return jsonResponse({ error: 'Missing required fields: owner, repo, score, maxScore' }, 400);
  }

  const key = `${owner}/${repo}`;
  const historyKey = `${key}/history`;

  // Load existing to track previous
  const existing = await loadScores(owner, repo, env);
  const newEntry: ScanResult = { owner, repo, branch: branch ?? 'main', score, maxScore, categories, timestamp };

  const toStore: StoredScores = {
    current: newEntry,
    previous: existing?.current,
  };
  await env.RATCHET_SCORES.put(key, JSON.stringify(toStore));

  // Append to history (keep last 90 entries)
  const rawHistory = await env.RATCHET_SCORES.get(historyKey);
  const history: ScanResult[] = rawHistory ? JSON.parse(rawHistory) : [];
  history.push(newEntry);
  if (history.length > 90) history.splice(0, history.length - 90);
  await env.RATCHET_SCORES.put(historyKey, JSON.stringify(history));

  return jsonResponse({ ok: true, key });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadScores(owner: string, repo: string, env: Env): Promise<StoredScores | null> {
  const key = `${owner}/${repo}`;
  const raw = await env.RATCHET_SCORES.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredScores;
  } catch {
    return null;
  }
}

function parseStyle(raw: string | null): BadgeStyle {
  if (raw === 'flat-square' || raw === 'for-the-badge') return raw;
  return 'flat';
}

function svgResponse(svg: string, cacheControl: string): Response {
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
