/**
 * ScanEngine interface — pluggable scoring backend for ratchet scan.
 *
 * Two implementations ship out of the box:
 *   - ClassicEngine  fast, free, deterministic heuristics (<2 s)
 *   - DeepEngine     SI-powered semantic analysis (requires Pro subscription)
 */

import type { SupportedLanguage } from './language-rules.js';
import type { ScanResult } from '../commands/scan.js';

export type { ScanResult };

export interface ScanEngineOptions {
  /** Limit analysis to specific categories (e.g. ['Testing', 'Security']). */
  categories?: string[];
  /** Maximum number of files to analyse (deep mode). */
  maxFiles?: number;
  /** Maximum spend in USD (deep mode only). */
  budget?: number;
  /** Override language detection. */
  lang?: SupportedLanguage;
  /** Show top N issues (quick-fix mode). */
  top?: number;
  // ── Classic engine options (also accepted by DeepEngine for baseline) ──
  /** Include test files in scoring (default: false). */
  includeTests?: boolean;
  /** Explicit list of files to scan (e.g. from --diff). */
  files?: string[];
  /** Include non-production directories (scripts/, migrations/, etc.). */
  includeNonProduction?: boolean;
}

export interface ScanEngine {
  /** Human-readable name of this engine. */
  name: string;
  /** Engine mode — 'classic' for heuristics, 'deep' for LLM-powered analysis. */
  mode: 'classic' | 'deep';
  /** Run the scan and return a normalised ScanResult. */
  analyze(cwd: string, options?: ScanEngineOptions): Promise<ScanResult>;
}
