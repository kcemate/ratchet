/**
 * Score Registry API routes.
 *
 * POST   /api/v1/scores                      — Submit a scan result (API key auth)
 * GET    /api/v1/scores/:owner/:repo         — Latest score + history
 * GET    /api/v1/scores/:owner/:repo/badge.svg — Dynamic SVG badge
 * GET    /api/v1/leaderboard                 — Top scored repos (filterable)
 * GET    /api/v1/stats                       — Aggregate statistics
 * POST   /api/v1/keys                        — Create API key (master secret auth)
 */

import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { getDb } from "./db.js";
import { verifyApiKey, createApiKey } from "./api-keys.js";

const SPEC_VERSION = "1.0";

// ── API key auth middleware ────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response, next: () => void): void {
  const authHeader = req.headers.authorization;
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!raw) {
    res.status(401).json({ error: "Missing API key", ratchet_spec_version: SPEC_VERSION });
    return;
  }
  const db = getDb();
  const record = verifyApiKey(db, raw);
  if (!record) {
    res.status(401).json({ error: "Invalid API key", ratchet_spec_version: SPEC_VERSION });
    return;
  }
  (req as Request & { apiKeyId: string }).apiKeyId = record.id;
  next();
}

/** Master secret auth — for admin operations like key creation. */
function requireMasterSecret(req: Request, res: Response, next: () => void): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || token !== process.env["RATCHET_API_SECRET"]) {
    res.status(401).json({ error: "Unauthorized", ratchet_spec_version: SPEC_VERSION });
    return;
  }
  next();
}

// ── Badge SVG generation ───────────────────────────────────────────────────

function badgeColor(score: number): string {
  if (score > 80) return "#44cc11"; // green
  if (score > 60) return "#dfb317"; // yellow
  return "#e05d44"; // red
}

function textWidth(text: string): number {
  return text.split("").reduce((sum, ch) => {
    if ("filj|:;.,/!r1t".includes(ch)) return sum + 5;
    if ("mwMW".includes(ch)) return sum + 10;
    return sum + 7;
  }, 0);
}

function scoreBadgeSvg(score: number): string {
  const color = badgeColor(score);
  const label = "ratchet";
  const value = `${score}/100`;
  const pad = 10;
  const ltw = textWidth(label);
  const vtw = textWidth(value);
  const lw = ltw + pad * 2;
  const vw = vtw + pad * 2;
  const tw = lw + vw;
  const lmx = Math.round(lw / 2);
  const vmx = lw + Math.round(vw / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${tw}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${tw}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif"
     text-rendering="geometricPrecision" font-size="110">
    <text x="${lmx * 10}" y="150" fill="#010101" fill-opacity=".3"
      transform="scale(.1)" textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${lmx * 10}" y="140" transform="scale(.1)" fill="#fff"
      textLength="${ltw * 10}" lengthAdjust="spacing">${label}</text>
    <text x="${vmx * 10}" y="150" fill="#010101" fill-opacity=".3"
      transform="scale(.1)" textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
    <text x="${vmx * 10}" y="140" transform="scale(.1)" fill="#fff"
      textLength="${vtw * 10}" lengthAdjust="spacing">${value}</text>
  </g>
</svg>`;
}

function unknownBadgeSvg(): string {
  return scoreBadgeSvg(0).replace("0/100", "unknown").replace("#e05d44", "#9f9f9f");
}

// ── Validation helpers ─────────────────────────────────────────────────────

function isValidScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
}

// ── Row types (what SQLite returns) ───────────────────────────────────────

interface SubmissionRow {
  id: number;
  repo_owner: string;
  repo_name: string;
  repo_url: string | null;
  language: string | null;
  overall_score: number;
  testing_score: number | null;
  security_score: number | null;
  type_safety_score: number | null;
  error_handling_score: number | null;
  performance_score: number | null;
  code_quality_score: number | null;
  ratchet_version: string | null;
  submitted_at: string;
  submitted_by: string | null;
  metadata: string | null;
}

interface ProfileRow {
  id: number;
  owner: string;
  name: string;
  first_scanned: string;
  latest_score: number | null;
  scan_count: number;
  language: string | null;
  best_score: number | null;
  worst_score: number | null;
  latest_submission_id: number | null;
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createRegistryRouter(): Router {
  const router = Router();

  // Rate limiters created fresh per router instance so tests don't share state.
  const writeLimit = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
  const readLimit = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
  const badgeLimit = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });

  // ── POST /api/v1/scores ─────────────────────────────────────────────────
  router.post("/scores", writeLimit, requireApiKey, (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const {
      repo_owner,
      repo_name,
      repo_url,
      language,
      overall_score,
      testing_score,
      security_score,
      type_safety_score,
      error_handling_score,
      performance_score,
      code_quality_score,
      ratchet_version,
      metadata,
    } = body;

    if (typeof repo_owner !== "string" || !repo_owner.trim()) {
      res.status(400).json({ error: "repo_owner is required", ratchet_spec_version: SPEC_VERSION });
      return;
    }
    if (typeof repo_name !== "string" || !repo_name.trim()) {
      res.status(400).json({ error: "repo_name is required", ratchet_spec_version: SPEC_VERSION });
      return;
    }
    if (!isValidScore(overall_score)) {
      res.status(400).json({ error: "overall_score must be an integer 0–100", ratchet_spec_version: SPEC_VERSION });
      return;
    }

    const metadataStr = metadata != null ? JSON.stringify(metadata) : null;
    const keyId = (req as Request & { apiKeyId?: string }).apiKeyId ?? null;

    const db = getDb();
    const now = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO score_submissions
        (repo_owner, repo_name, repo_url, language, overall_score,
         testing_score, security_score, type_safety_score, error_handling_score,
         performance_score, code_quality_score, ratchet_version,
         submitted_at, submitted_by, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      repo_owner,
      repo_name,
      repo_url ?? null,
      language ?? null,
      overall_score,
      isValidScore(testing_score) ? testing_score : null,
      isValidScore(security_score) ? security_score : null,
      isValidScore(type_safety_score) ? type_safety_score : null,
      isValidScore(error_handling_score) ? error_handling_score : null,
      isValidScore(performance_score) ? performance_score : null,
      isValidScore(code_quality_score) ? code_quality_score : null,
      typeof ratchet_version === "string" ? ratchet_version : null,
      now,
      keyId,
      metadataStr
    );

    const submissionId = result.lastInsertRowid as number;

    // Upsert repo_profiles
    const profile = db
      .prepare(`SELECT * FROM repo_profiles WHERE owner = ? AND name = ?`)
      .get(repo_owner, repo_name) as ProfileRow | undefined;

    if (!profile) {
      db.prepare(
        `
        INSERT INTO repo_profiles
          (owner, name, first_scanned, latest_score, scan_count, language, best_score, worst_score, latest_submission_id)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
      `
      ).run(repo_owner, repo_name, now, overall_score, language ?? null, overall_score, overall_score, submissionId);
    } else {
      db.prepare(
        `
        UPDATE repo_profiles SET
          latest_score         = ?,
          scan_count           = scan_count + 1,
          language             = COALESCE(?, language),
          best_score           = MAX(COALESCE(best_score, 0), ?),
          worst_score          = MIN(COALESCE(worst_score, 100), ?),
          latest_submission_id = ?
        WHERE owner = ? AND name = ?
      `
      ).run(overall_score, language ?? null, overall_score, overall_score, submissionId, repo_owner, repo_name);
    }

    res.status(201).json({ ratchet_spec_version: SPEC_VERSION, ok: true, submission_id: submissionId });
  });

  // ── GET /api/v1/scores/:owner/:repo ────────────────────────────────────
  router.get("/scores/:owner/:repo", readLimit, (req: Request, res: Response) => {
    const { owner, repo } = req.params;
    const db = getDb();

    const profile = db.prepare(`SELECT * FROM repo_profiles WHERE owner = ? AND name = ?`).get(owner, repo) as
      | ProfileRow
      | undefined;

    if (!profile) {
      res.status(404).json({ error: "Repo not found", ratchet_spec_version: SPEC_VERSION });
      return;
    }

    const history = db
      .prepare(
        `
        SELECT id, overall_score, testing_score, security_score, type_safety_score,
               error_handling_score, performance_score, code_quality_score,
               ratchet_version, submitted_at, language
        FROM score_submissions
        WHERE repo_owner = ? AND repo_name = ?
        ORDER BY submitted_at DESC
        LIMIT 50
      `
      )
      .all(owner, repo) as SubmissionRow[];

    res.json({
      ratchet_spec_version: SPEC_VERSION,
      repo: { owner, name: repo, url: history[0]?.repo_url ?? null },
      latest: history[0] ?? null,
      history,
      profile: {
        first_scanned: profile.first_scanned,
        scan_count: profile.scan_count,
        best_score: profile.best_score,
        worst_score: profile.worst_score,
        language: profile.language,
      },
    });
  });

  // ── GET /api/v1/scores/:owner/:repo/badge.svg ──────────────────────────
  router.get("/scores/:owner/:repo/badge.svg", badgeLimit, (req: Request, res: Response) => {
    const { owner, repo } = req.params;
    const db = getDb();

    const profile = db
      .prepare(`SELECT latest_score FROM repo_profiles WHERE owner = ? AND name = ?`)
      .get(owner, repo) as { latest_score: number | null } | undefined;

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache

    if (!profile || profile.latest_score == null) {
      res.send(unknownBadgeSvg());
      return;
    }

    res.send(scoreBadgeSvg(profile.latest_score));
  });

  // ── GET /api/v1/leaderboard ────────────────────────────────────────────
  router.get("/leaderboard", readLimit, (req: Request, res: Response) => {
    const language = typeof req.query["language"] === "string" ? req.query["language"] : null;
    const limitRaw = parseInt(String(req.query["limit"] ?? "20"), 10);
    const limit = isNaN(limitRaw) || limitRaw < 1 ? 20 : Math.min(limitRaw, 100);

    const db = getDb();

    const rows = language
      ? (db
          .prepare(
            `
          SELECT owner, name, latest_score, language, scan_count,
                 best_score, worst_score
          FROM repo_profiles
          WHERE latest_score IS NOT NULL AND language = ?
          ORDER BY latest_score DESC
          LIMIT ?
        `
          )
          .all(language, limit) as ProfileRow[])
      : (db
          .prepare(
            `
          SELECT owner, name, latest_score, language, scan_count,
                 best_score, worst_score
          FROM repo_profiles
          WHERE latest_score IS NOT NULL
          ORDER BY latest_score DESC
          LIMIT ?
        `
          )
          .all(limit) as ProfileRow[]);

    const total = language
      ? (
          db
            .prepare(`SELECT COUNT(*) as n FROM repo_profiles WHERE language = ? AND latest_score IS NOT NULL`)
            .get(language) as { n: number }
        ).n
      : (db.prepare(`SELECT COUNT(*) as n FROM repo_profiles WHERE latest_score IS NOT NULL`).get() as { n: number }).n;

    res.json({
      ratchet_spec_version: SPEC_VERSION,
      leaderboard: rows.map((r, i) => ({
        rank: i + 1,
        owner: r.owner,
        name: r.name,
        score: r.latest_score,
        language: r.language,
        scan_count: r.scan_count,
        best_score: r.best_score,
        worst_score: r.worst_score,
      })),
      total,
      filtered_by_language: language ?? null,
    });
  });

  // ── GET /api/v1/stats ──────────────────────────────────────────────────
  router.get("/stats", readLimit, (_req: Request, res: Response) => {
    const db = getDb();

    const { total_repos } = db.prepare(`SELECT COUNT(*) as total_repos FROM repo_profiles`).get() as {
      total_repos: number;
    };

    const { total_scans } = db.prepare(`SELECT COUNT(*) as total_scans FROM score_submissions`).get() as {
      total_scans: number;
    };

    const { avg_score } = db.prepare(`SELECT AVG(overall_score) as avg_score FROM score_submissions`).get() as {
      avg_score: number | null;
    };

    const byLanguage = db
      .prepare(
        `
        SELECT language, COUNT(*) as count, AVG(latest_score) as avg
        FROM repo_profiles
        WHERE language IS NOT NULL AND latest_score IS NOT NULL
        GROUP BY language
        ORDER BY count DESC
      `
      )
      .all() as Array<{ language: string; count: number; avg: number }>;

    res.json({
      ratchet_spec_version: SPEC_VERSION,
      total_repos,
      total_scans,
      average_score: avg_score != null ? Math.round(avg_score * 10) / 10 : null,
      by_language: Object.fromEntries(
        byLanguage.map(r => [r.language, { count: r.count, avg: Math.round(r.avg * 10) / 10 }])
      ),
    });
  });

  // ── POST /api/v1/keys — admin: create API key ─────────────────────────
  router.post("/keys", writeLimit, requireMasterSecret, (req: Request, res: Response) => {
    const name =
      typeof (req.body as Record<string, unknown>)["name"] === "string"
        ? ((req.body as Record<string, unknown>)["name"] as string)
        : undefined;

    const db = getDb();
    const { key, id } = createApiKey(db, name);

    res.status(201).json({
      ratchet_spec_version: SPEC_VERSION,
      ok: true,
      key,
      key_id: id,
      message: "Store this key securely — it will not be shown again.",
    });
  });

  return router;
}
