/**
 * Shared utility functions used by engine.ts and all specialized engine variants
 * (engine-architect, engine-feature, engine-sweep, tier-engine).
 *
 * Kept in a separate module to avoid circular imports — engine.ts re-exports
 * from engine-architect.ts and engine-sweep.ts, so helpers must live outside engine.ts.
 */

import { randomUUID } from 'crypto';
import type { RatchetRun, Target } from '../types.js';
import * as git from './git.js';

/**
 * Create the initial RatchetRun object for a new engine invocation.
 * All engine variants use this to avoid repeating the same 7-line initialization block.
 */
export function createInitialRun(target: Target): RatchetRun {
  return {
    id: randomUUID(),
    target,
    clicks: [],
    startedAt: new Date(),
    status: 'running',
  };
}

/**
 * Throw a standardized error if the git repo is in detached HEAD state.
 * Specialized engines call this before creating a branch.
 */
export async function requireNamedBranch(cwd: string): Promise<void> {
  if (await git.isDetachedHead(cwd)) {
    throw new Error('Git repository is in detached HEAD state. Ratchet requires a named branch.');
  }
}
