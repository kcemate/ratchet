// engine-core.ts — Core engine logic and state management
// Public API: ClassicEngine class (moved from classic.ts)

import type { ScanEngine, ScanEngineOptions } from '../scan-engine.js';
import type { ScanResult } from '../../core/scanner';

/**
 * Core engine interface. Manages project state, file discovery, and orchestration.
 */
export interface EngineCore {
  analyze(cwd: string, options?: ScanEngineOptions): Promise<ScanResult>;
}

// TODO: Move ClassicEngine class here from classic.ts