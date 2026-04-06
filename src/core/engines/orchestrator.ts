// orchestrator.ts — Coordinates engine, providers, and scoring
// Public API: applyFrameworkAdjustments, inferSeverity, parseLocation

import type { Framework } from '../framework-detector.js';
import type { Finding } from '../normalize.js';

/**
 * Orchestrates interactions between engine, providers, and scoring.
 */
export interface Orchestrator {
  applyFrameworkAdjustments(findings: Finding[], frameworks: Framework[]): Finding[];
  inferSeverity(finding: Finding): string;
  parseLocation(location: string): { file: string; line: number; column: number };
}

// TODO: Move orchestration logic here from classic.ts