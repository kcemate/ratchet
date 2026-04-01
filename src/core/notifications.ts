import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import type { ScanHistoryEntry } from './scan-history.js';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

export interface ScoreDrop {
  before: number;
  after: number;
  delta: number; // always negative
  categoryBreakdown: Array<{
    name: string;
    before: number;
    after: number;
    delta: number;
  }>;
  timestamp: string;
}

export interface NotificationConfig {
  'score-drop'?: boolean;
  threshold?: number;        // minimum drop to trigger notification (default: 5)
  'create-issue'?: boolean;
  webhook?: string;
}

/**
 * Reads notifications config from .ratchet.yml if present.
 * Returns empty object when the file is absent or has no notifications section.
 */
export function loadNotificationConfig(cwd: string): NotificationConfig {
  const configPath = join(cwd, '.ratchet.yml');
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const data = parse(raw) as { notifications?: NotificationConfig } | null;
    return data?.notifications ?? {};
  } catch (err) {
    logger.warn({ err, configPath }, 'Failed to parse .ratchet.yml notifications config');
    return {};
  }
}

/**
 * Compares the last two history entries and returns a ScoreDrop if the score
 * decreased by >= threshold points. Returns null if no significant drop.
 */
export function detectScoreDrop(
  history: ScanHistoryEntry[],
  threshold = 5,
): ScoreDrop | null {
  if (history.length < 2) return null;

  const latest = history[history.length - 1]!;
  const previous = history[history.length - 2]!;
  const delta = latest.score - previous.score;

  if (delta > -threshold) return null;

  const categoryBreakdown: ScoreDrop['categoryBreakdown'] = [];
  for (const [name, afterScore] of Object.entries(latest.categories)) {
    const beforeScore = previous.categories[name] ?? afterScore;
    const catDelta = afterScore - beforeScore;
    if (catDelta < 0) {
      categoryBreakdown.push({ name, before: beforeScore, after: afterScore, delta: catDelta });
    }
  }

  return {
    before: previous.score,
    after: latest.score,
    delta,
    categoryBreakdown,
    timestamp: latest.timestamp,
  };
}

/**
 * Creates a GitHub issue using the `gh` CLI reporting the score drop.
 * Requires `gh` to be installed and authenticated.
 */
export async function createGitHubIssue(drop: ScoreDrop): Promise<void> {
  const title = `⚠️ Ratchet score dropped: ${drop.before} → ${drop.after}`;

  const categoryLines =
    drop.categoryBreakdown.length > 0
      ? drop.categoryBreakdown
          .map((c) => `- **${c.name}**: ${c.before} → ${c.after} (${c.delta})`)
          .join('\n')
      : '_(no per-category data)_';

  const body = [
    `## Ratchet Score Drop Detected`,
    ``,
    `**Score**: ${drop.before} → ${drop.after} (${drop.delta} points)`,
    `**Detected at**: ${drop.timestamp}`,
    ``,
    `### Categories Regressed`,
    categoryLines,
    ``,
    `Run \`ratchet scan\` locally to investigate, then \`ratchet torque\` to fix.`,
  ].join('\n');

  await execFileAsync('gh', ['issue', 'create', '--title', title, '--body', body]);
}

/**
 * POSTs a JSON payload to the given webhook URL.
 * Uses Node's built-in http/https — no extra dependencies.
 */
export async function webhookNotify(url: string, payload: unknown): Promise<void> {
  const { default: https } = await import('https');
  const { default: http } = await import('http');

  const body = JSON.stringify(payload);
  const lib = url.startsWith('https://') ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'ratchet-run',
        },
      },
      (res) => {
        res.resume(); // drain the response
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
        } else {
          resolve();
        }
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
