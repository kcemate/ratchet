// scoring.ts — Scoring logic and heuristics
// Public API: scoreTests, scoreSecurity, scoreTypes, scoreErrorHandling, scorePerformance, scoreCodeQuality

/**
 * Scoring interface for all heuristic-based evaluations.
 */
export interface Scoring {
  scoreTests(findings: Finding[]): number;
  scoreSecurity(findings: Finding[]): number;
  scoreTypes(findings: Finding[]): number;
  scoreErrorHandling(findings: Finding[]): number;
  scorePerformance(findings: Finding[]): number;
  scoreCodeQuality(findings: Finding[]): number;
}

// TODO: Move scoring functions here from classic.ts and classic-scoring.ts