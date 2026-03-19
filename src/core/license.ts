/**
 * License key management for Ratchet CLI.
 *
 * License keys are stored in ~/.ratchet/license.json
 * Gated commands (torque, improve) check for a valid license before running.
 * Free commands (scan, vision, badge, status, log, report, init, build) are always available.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface LicenseData {
  key: string;
  email?: string;
  tier: 'builder' | 'pro' | 'team' | 'enterprise';
  cyclesRemaining?: number;
  cyclesTotal?: number;
  expiresAt?: string;
  validatedAt: string;
}

export interface LicenseValidationResult {
  valid: boolean;
  license?: LicenseData;
  error?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────────────────────────────────────

const RATCHET_DIR = join(homedir(), '.ratchet');
const LICENSE_FILE = join(RATCHET_DIR, 'license.json');

// ──────────────────────────────────────────────────────────────────────────────
// Commands that require a license
// ──────────────────────────────────────────────────────────────────────────────

const GATED_COMMANDS = new Set(['torque', 'improve']);

/** Commands that require Pro tier or above (torque is Pro-only) */
const PRO_COMMANDS = new Set(['torque']);

// ──────────────────────────────────────────────────────────────────────────────
// Tier hierarchy for comparison
// ──────────────────────────────────────────────────────────────────────────────

const TIER_LEVEL: Record<string, number> = {
  free: 0,
  builder: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

// ──────────────────────────────────────────────────────────────────────────────
// License file operations
// ──────────────────────────────────────────────────────────────────────────────

export function getLicensePath(): string {
  return LICENSE_FILE;
}

export function loadLicense(): LicenseData | null {
  try {
    if (!existsSync(LICENSE_FILE)) return null;
    const raw = readFileSync(LICENSE_FILE, 'utf-8');
    return JSON.parse(raw) as LicenseData;
  } catch {
    return null;
  }
}

export function saveLicense(data: LicenseData): void {
  mkdirSync(RATCHET_DIR, { recursive: true });
  writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2));
}

export function clearLicense(): boolean {
  try {
    if (existsSync(LICENSE_FILE)) {
      writeFileSync(LICENSE_FILE, '');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Validation API
// ──────────────────────────────────────────────────────────────────────────────

const VALIDATE_URL = process.env.RATCHET_LICENSE_URL || 'https://api.ratchetcli.com/validate';

export async function validateLicenseRemote(key: string): Promise<LicenseValidationResult> {
  try {
    const resp = await fetch(VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        return { valid: false, error: 'Invalid or expired license key.' };
      }
      return { valid: false, error: `Validation server error (${resp.status})` };
    }

    const data = await resp.json() as LicenseData;
    return { valid: true, license: { ...data, key, validatedAt: new Date().toISOString() } };
  } catch (err: any) {
    // If validation server is unreachable, allow offline use with cached license
    const cached = loadLicense();
    if (cached && cached.key === key) {
      return { valid: true, license: cached };
    }
    return { valid: false, error: 'Cannot reach license server. Check your connection.' };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Gate check — call this at the top of gated commands
// ──────────────────────────────────────────────────────────────────────────────

export function requireLicense(commandName: string): LicenseData {
  if (!GATED_COMMANDS.has(commandName)) return null as any; // ungated

  const license = loadLicense();

  if (!license || !license.key) {
    console.error('');
    console.error(chalk.red('  ⛔ License required'));
    console.error('');
    console.error(`  ${chalk.dim('ratchet ' + commandName)} requires a paid subscription.`);
    console.error('');
    console.error(`  ${chalk.cyan('→')} Subscribe at ${chalk.bold('https://ratchetcli.com/#pricing')}`);
    console.error(`  ${chalk.cyan('→')} Then run: ${chalk.bold('ratchet login <your-key>')}`);
    console.error('');
    process.exit(1);
  }

  // Check tier access
  if (PRO_COMMANDS.has(commandName)) {
    const level = TIER_LEVEL[license.tier] ?? 0;
    if (level < TIER_LEVEL.pro) {
      console.error('');
      console.error(chalk.red('  ⛔ Pro plan required'));
      console.error('');
      console.error(`  ${chalk.dim('ratchet ' + commandName)} requires the Pro plan or higher.`);
      console.error(`  Your current plan: ${chalk.yellow(license.tier)}`);
      console.error('');
      console.error(`  ${chalk.cyan('→')} Upgrade at ${chalk.bold('https://ratchetcli.com/#pricing')}`);
      console.error('');
      process.exit(1);
    }
  }

  // Check expiration
  if (license.expiresAt) {
    const exp = new Date(license.expiresAt);
    if (exp < new Date()) {
      console.error('');
      console.error(chalk.red('  ⛔ License expired'));
      console.error('');
      console.error(`  Your license expired on ${chalk.yellow(exp.toLocaleDateString())}.`);
      console.error(`  ${chalk.cyan('→')} Renew at ${chalk.bold('https://ratchetcli.com/#pricing')}`);
      console.error('');
      process.exit(1);
    }
  }

  return license;
}

// ──────────────────────────────────────────────────────────────────────────────
// Check if a command is gated
// ──────────────────────────────────────────────────────────────────────────────

export function isGatedCommand(name: string): boolean {
  return GATED_COMMANDS.has(name);
}

export function isProCommand(name: string): boolean {
  return PRO_COMMANDS.has(name);
}
