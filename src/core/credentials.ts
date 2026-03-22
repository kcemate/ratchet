/**
 * API key credential management for ratchetcli.com push features.
 * Stores credentials in ~/.ratchet/credentials.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../lib/logger.js';

const execFileAsync = promisify(execFile);

export interface Credentials {
  apiKey: string;
  owner?: string;
  repo?: string;
}

export function getCredentialsPath(): string {
  return join(homedir(), '.ratchet', 'credentials.json');
}

export function loadCredentials(): Credentials | null {
  const p = getCredentialsPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Credentials;
  } catch (err) {
    logger.warn({ err, path: p }, 'Failed to parse credentials file');
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  const dir = join(homedir(), '.ratchet');
  mkdirSync(dir, { recursive: true });
  writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2), 'utf-8');
}

export function clearCredentials(): void {
  const p = getCredentialsPath();
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch (err) {
      logger.warn({ err, path: p }, 'Failed to remove credentials file');
    }
  }
}

/**
 * Parse owner/repo from a git remote URL.
 * Handles both HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
export function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo(.git)?
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  }
  // SSH: git@github.com:owner/repo(.git)?
  const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }
  return null;
}

/**
 * Detect owner/repo from the git remote origin of a local repo.
 * Returns null if not a git repo or remote not set.
 */
export async function detectOwnerRepo(cwd: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
    return parseOwnerRepo(stdout.trim());
  } catch (err) {
    logger.debug({ err, cwd }, 'Could not detect git remote origin');
    return null;
  }
}

/** Build the hosted badge URL for the overall score. */
export function hostedBadgeUrl(owner: string, repo: string, style?: string): string {
  const base = `https://ratchetcli.com/badge/${owner}/${repo}`;
  return style && style !== 'flat' ? `${base}?style=${style}` : base;
}

/** Build a hosted badge URL for a specific category. */
export function hostedCategoryBadgeUrl(owner: string, repo: string, category: string, style?: string): string {
  const slug = category.toLowerCase().replace(/\s+/g, '-');
  const base = `https://ratchetcli.com/badge/${owner}/${repo}/${slug}`;
  return style && style !== 'flat' ? `${base}?style=${style}` : base;
}
