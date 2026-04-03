/**
 * CLI client for submitting scan results to the Ratchet Score Registry.
 *
 * Reads config from environment:
 *   RATCHET_REGISTRY_URL  — registry base URL (default: https://api.ratchetcli.com)
 *   RATCHET_REGISTRY_KEY  — API key; submission is skipped when absent
 */

import type { ScanResult } from '../core/scanner';

export interface RegistrySubmission {
  repo_owner: string;
  repo_name: string;
  repo_url?: string;
  language?: string;
  overall_score: number;
  testing_score?: number;
  security_score?: number;
  type_safety_score?: number;
  error_handling_score?: number;
  performance_score?: number;
  code_quality_score?: number;
  ratchet_version?: string;
}

export interface SubmitResult {
  ok: boolean;
  submission_id?: number;
  error?: string;
}

const DEFAULT_REGISTRY_URL = 'https://api.ratchetcli.com';
const SUBMIT_PATH = '/api/v1/scores';

/**
 * Attempt to detect the GitHub owner/repo from the git remote of cwd.
 * Returns null if not a GitHub repo or git is unavailable.
 */
export function detectGitRepo(cwd: string): { owner: string; name: string; url: string } | null {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const remote = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // ssh: git@github.com:owner/repo.git  or  https://github.com/owner/repo.git
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
    if (match) {
      return {
        owner: match[1]!,
        name: match[2]!,
        url: `https://github.com/${match[1]}/${match[2]}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a registry submission payload from a ScanResult.
 * Returns null when no registry key is configured (no-op).
 */
export function buildSubmission(
  result: ScanResult,
  cwd: string,
  language: string,
  version: string,
): RegistrySubmission | null {
  const gitRepo = detectGitRepo(cwd);

  const owner = gitRepo?.owner ?? 'unknown';
  const name  = gitRepo?.name ?? result.projectName ?? 'unknown';

  const catScore = (name: string): number | undefined => {
    const cat = result.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    return cat?.score;
  };

  return {
    repo_owner: owner,
    repo_name:  name,
    repo_url:   gitRepo?.url,
    language,
    overall_score:       result.total,
    testing_score:       catScore('testing'),
    security_score:      catScore('security'),
    type_safety_score:   catScore('type safety'),
    error_handling_score: catScore('error handling'),
    performance_score:   catScore('performance'),
    code_quality_score:  catScore('code quality'),
    ratchet_version: version,
  };
}

/**
 * Submit a scan result to the registry.
 * Returns immediately without throwing — failures are soft.
 */
export async function submitToRegistry(
  result: ScanResult,
  cwd: string,
  language: string,
  version: string,
): Promise<SubmitResult> {
  const key = process.env['RATCHET_REGISTRY_KEY'];
  if (!key) return { ok: false, error: 'no key' };

  const baseUrl = (process.env['RATCHET_REGISTRY_URL'] ?? DEFAULT_REGISTRY_URL).replace(/\/$/, '');
  const payload = buildSubmission(result, cwd, language, version);
  if (!payload) return { ok: false, error: 'could not build payload' };

  try {
    const resp = await fetch(`${baseUrl}${SUBMIT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, error: `HTTP ${resp.status}: ${body}` };
    }

    const data = await resp.json() as { submission_id?: number };
    return { ok: true, submission_id: data.submission_id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
