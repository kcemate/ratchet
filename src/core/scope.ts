/**
 * Git-aware scope locking for Ratchet.
 * Constrains which files the engine can modify during a run.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve, isAbsolute, relative } from 'path';
import { glob } from 'fs/promises';
import * as git from './git.js';

const execFileAsync = promisify(execFile);

export type ScopeType = 'diff' | 'branch' | 'staged' | 'glob' | 'file';

export interface ScopeSpec {
  type: ScopeType;
  /** For glob patterns */
  pattern?: string;
  /** For file: prefix — explicit file list */
  files?: string[];
}

/**
 * Parse a --scope CLI argument into a structured spec.
 *
 * Supported formats:
 *   diff          — all uncommitted changes (staged + unstaged + untracked)
 *   branch        — files changed on current branch vs main/master
 *   staged        — only staged files
 *   src/**\/*.ts  — glob pattern
 *   file:a.ts,b.ts — explicit comma-separated file list
 */
export function parseScopeArg(arg: string): ScopeSpec {
  const trimmed = arg.trim();

  if (trimmed === 'diff')   return { type: 'diff' };
  if (trimmed === 'branch') return { type: 'branch' };
  if (trimmed === 'staged') return { type: 'staged' };

  if (trimmed.startsWith('file:')) {
    const files = trimmed.slice(5).split(',').map(f => f.trim()).filter(Boolean);
    return { type: 'file', files };
  }

  return { type: 'glob', pattern: trimmed };
}

/** Normalize path to use forward slashes (cross-platform consistency). */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Resolve relative paths to absolute, normalizing separators. */
function toAbsolute(files: string[], cwd: string): string[] {
  return files
    .filter(Boolean)
    .map(f => normalizePath(isAbsolute(f) ? f : resolve(cwd, f)));
}

/**
 * Detect the base branch to diff against for `branch` scope.
 * Prefers the tracked upstream, then looks for local main/master.
 */
async function findBaseBranch(cwd: string): Promise<string | undefined> {
  // Try upstream first
  const branch = await git.currentBranch(cwd);
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`], { cwd });
    const upstream = stdout.trim();
    if (upstream) return upstream.split('/').pop();
  } catch {
    // No upstream — fall through
  }

  // Check for local main / master
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--list', 'main', 'master'], { cwd });
    const branches = stdout.split('\n').map(b => b.replace(/^\*?\s+/, '').trim()).filter(Boolean);
    for (const b of ['main', 'master']) {
      if (branches.includes(b)) return b;
    }
    return branches[0];
  } catch {
    return undefined;
  }
}

/** Get files changed on the current branch vs the base branch. */
async function getBranchFiles(cwd: string): Promise<string[]> {
  const base = await findBaseBranch(cwd);
  if (!base) return [];
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd });
    return stdout.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve a ScopeSpec into a list of absolute file paths.
 */
export async function resolveScope(spec: ScopeSpec, cwd: string): Promise<string[]> {
  switch (spec.type) {
    case 'diff': {
      const s = await git.status(cwd);
      return toAbsolute([...s.staged, ...s.unstaged, ...s.untracked], cwd);
    }
    case 'branch': {
      return toAbsolute(await getBranchFiles(cwd), cwd);
    }
    case 'staged': {
      const s = await git.status(cwd);
      return toAbsolute(s.staged, cwd);
    }
    case 'glob': {
      if (!spec.pattern) return [];
      const results: string[] = [];
      for await (const f of glob(spec.pattern, { cwd })) {
        results.push(normalizePath(resolve(cwd, f as string)));
      }
      return results;
    }
    case 'file': {
      return toAbsolute(spec.files ?? [], cwd);
    }
    default:
      return [];
  }
}

/**
 * Returns true if `filePath` is within the scope.
 * An empty scopeFiles array means no restriction (always in scope).
 */
export function isFileInScope(filePath: string, scopeFiles: string[], cwd: string): boolean {
  if (scopeFiles.length === 0) return true;

  const normalized = normalizePath(isAbsolute(filePath) ? filePath : resolve(cwd, filePath));
  return scopeFiles.some(s => {
    const ns = normalizePath(s);
    return normalized === ns || normalized.startsWith(ns + '/');
  });
}

/** Returns files from `files` that are outside scope. */
export function findFilesOutsideScope(files: string[], scopeFiles: string[], cwd: string): string[] {
  return files.filter(f => !isFileInScope(f, scopeFiles, cwd));
}

/** Returns true if every file is within scope. */
export function allFilesInScope(files: string[], scopeFiles: string[], cwd: string): boolean {
  return findFilesOutsideScope(files, scopeFiles, cwd).length === 0;
}

export interface ScopeValidation {
  valid: boolean;
  scopeViolations: string[];
  scopeFiles: string[];
}

/** Validate modified files against scope; returns violations if any. */
export function validateScope(
  modifiedFiles: string[],
  scopeFiles: string[],
  cwd: string,
): ScopeValidation {
  const scopeViolations = findFilesOutsideScope(modifiedFiles, scopeFiles, cwd);
  return { valid: scopeViolations.length === 0, scopeViolations, scopeFiles };
}

/** Format scope for display in run summaries. */
export function formatScopeForDisplay(
  scopeArg: string | undefined,
  scopeFiles: string[],
  cwd: string,
): string {
  if (!scopeArg) return 'all files';
  if (scopeFiles.length === 0) return `${scopeArg} (no files matched)`;

  const display = scopeFiles.slice(0, 5).map(f => relative(cwd, f));
  const rest = scopeFiles.length - display.length;
  const list = display.join(', ') + (rest > 0 ? `, +${rest} more` : '');
  return `${scopeArg} (${list})`;
}
