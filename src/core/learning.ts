import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { Specialization } from './agents/specialized.js';
import type { AsyncWriter } from './async-writer.js';

// ── Types
export interface IssueTypeRecord {
  issueType: string;
  attempts: number;
  successes: number;
  failures: number;
  bestSpecialization: string | null;
  avgFixTimeMs: number;
  totalFixTimeMs: number;
}

export interface FileRecord {
  filePath: string;
  attempts: number;
  successes: number;
  failures: number;
  failureReasons: string[];
  lastAttemptAt: string;
}

export interface SpecializationRecord {
  specialization: string;
  wins: number;
  losses: number;
  totalRuns: number;
  totalScoreDelta: number;
}

export interface IssueFileKey {
  issueType: string;
  filePath: string;
}

export interface IssueFileRecord {
  key: string; // `${issueType}::${filePath}`
  attempts: number;
  failures: number;
  lastFailedAt: string | null;
}

export interface LearningData {
  version: 1;
  issueTypes: Record<string, IssueTypeRecord>;
  files: Record<string, FileRecord>;
  specializations: Record<string, SpecializationRecord>;
  issueFiles: Record<string, IssueFileRecord>;
  updatedAt: string;
}

export interface Recommendation {
  preferredSpecialization: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface SpecializationRanking {
  specialization: string;
  winRate: number;
  wins: number;
  totalRuns: number;
  avgScoreDelta: number;
}

// ── Constants
const LEARNING_FILE = '.ratchet/learning.json';
const SKIP_FAILURE_THRESHOLD = 3;

// ── Helpers
function emptyLearningData(): LearningData {
  return {
    version: 1,
    issueTypes: {},
    files: {},
    specializations: {},
    issueFiles: {},
    updatedAt: new Date().toISOString(),
  };
}

function issueFileKey(issueType: string, filePath: string): string {
  return `${issueType}::${filePath}`;
}

// ── Learning Store
export class LearningStore {
  private data: LearningData;
  private readonly filePath: string;
  private readonly relPath: string;
  private readonly cwd: string;
  private loaded = false;
  private asyncWriter: AsyncWriter | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.relPath = LEARNING_FILE;
    this.filePath = join(cwd, LEARNING_FILE);
    this.data = emptyLearningData();
  }

  /** Attach an AsyncWriter to batch disk writes instead of writing synchronously. */
  setAsyncWriter(writer: AsyncWriter): void {
    this.asyncWriter = writer;
  }

  /** Load learning data from disk. Creates empty data if file doesn't exist. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as LearningData;
      if (parsed.version === 1) {
        this.data = parsed;
      }
    } catch {
      // File doesn't exist or is corrupt — start fresh
      this.data = emptyLearningData();
    }
    this.loaded = true;
  }

  /** Persist learning data to disk. */
  async save(): Promise<void> {
    this.data.updatedAt = new Date().toISOString();
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /** Ensure data is loaded before accessing it. */
  private ensureLoaded(): void {
    if (!this.loaded) {
      // Graceful: use empty defaults if not loaded yet
      this.data = emptyLearningData();
    }
  }

  // ── Record Outcomes
  /**
   * Record the outcome of a click attempt.
   */
  async recordOutcome(params: {
    issueType: string;
    filePath: string;
    specialization: string;
    success: boolean;
    fixTimeMs: number;
    scoreDelta: number;
    failureReason?: string;
  }): Promise<void> {
    this.ensureLoaded();
    const { issueType, filePath, specialization, success, fixTimeMs, scoreDelta, failureReason } = params;

    // Update issue type record
    if (!this.data.issueTypes[issueType]) {
      this.data.issueTypes[issueType] = {
        issueType,
        attempts: 0,
        successes: 0,
        failures: 0,
        bestSpecialization: null,
        avgFixTimeMs: 0,
        totalFixTimeMs: 0,
      };
    }
    const issue = this.data.issueTypes[issueType]!;
    issue.attempts++;
    if (success) {
      issue.successes++;
      issue.totalFixTimeMs += fixTimeMs;
      issue.avgFixTimeMs = issue.totalFixTimeMs / issue.successes;
      // Update best specialization if this one has a better success rate
      if (!issue.bestSpecialization) {
        issue.bestSpecialization = specialization;
      } else {
        const current = this.data.specializations[issue.bestSpecialization];
        const candidate = this.data.specializations[specialization];
        if (candidate && current) {
          const currentRate = current.totalRuns > 0 ? current.wins / current.totalRuns : 0;
          const candidateRate = candidate.totalRuns > 0 ? candidate.wins / candidate.totalRuns : 0;
          if (candidateRate > currentRate) {
            issue.bestSpecialization = specialization;
          }
        }
      }
    } else {
      issue.failures++;
    }

    // Update file record
    if (!this.data.files[filePath]) {
      this.data.files[filePath] = {
        filePath,
        attempts: 0,
        successes: 0,
        failures: 0,
        failureReasons: [],
        lastAttemptAt: '',
      };
    }
    const file = this.data.files[filePath]!;
    file.attempts++;
    file.lastAttemptAt = new Date().toISOString();
    if (success) {
      file.successes++;
    } else {
      file.failures++;
      if (failureReason && file.failureReasons.length < 10) {
        file.failureReasons.push(failureReason);
      }
    }

    // Update specialization record
    if (!this.data.specializations[specialization]) {
      this.data.specializations[specialization] = {
        specialization,
        wins: 0,
        losses: 0,
        totalRuns: 0,
        totalScoreDelta: 0,
      };
    }
    const spec = this.data.specializations[specialization]!;
    spec.totalRuns++;
    spec.totalScoreDelta += scoreDelta;
    if (success) {
      spec.wins++;
    } else {
      spec.losses++;
    }

    // Update issue+file record
    const ifKey = issueFileKey(issueType, filePath);
    if (!this.data.issueFiles[ifKey]) {
      this.data.issueFiles[ifKey] = {
        key: ifKey,
        attempts: 0,
        failures: 0,
        lastFailedAt: null,
      };
    }
    const ifRec = this.data.issueFiles[ifKey]!;
    ifRec.attempts++;
    if (!success) {
      ifRec.failures++;
      ifRec.lastFailedAt = new Date().toISOString();
    }

    if (this.asyncWriter) {
      this.asyncWriter.enqueue(this.relPath, this.data);
    } else {
      await this.save();
    }
  }

  // ── Query Functions
  /**
   * Get a recommendation for which specialization to use for a given issue type.
   */
  getRecommendation(issueType: string): Recommendation {
    this.ensureLoaded();

    const issue = this.data.issueTypes[issueType];
    if (!issue || issue.attempts < 2) {
      return {
        preferredSpecialization: null,
        confidence: 'low',
        reason: 'Not enough data — fewer than 2 attempts recorded for this issue type.',
      };
    }

    if (issue.bestSpecialization) {
      const spec = this.data.specializations[issue.bestSpecialization];
      const winRate = spec && spec.totalRuns > 0 ? spec.wins / spec.totalRuns : 0;
      const confidence: Recommendation['confidence'] =
        issue.attempts >= 5 && winRate >= 0.6 ? 'high' :
        issue.attempts >= 3 ? 'medium' : 'low';

      return {
        preferredSpecialization: issue.bestSpecialization,
        confidence,
        reason: `"${issue.bestSpecialization}" has the best track record for "${issueType}" issues ` +
          `(${issue.successes}/${issue.attempts} success rate)`,
      };
    }

    return {
      preferredSpecialization: null,
      confidence: 'low',
      reason: `No successful specialization recorded for "${issueType}" yet.`,
    };
  }

  /**
   * Get specialization rankings sorted by win rate.
   */
  getSpecializationRanking(): SpecializationRanking[] {
    this.ensureLoaded();

    return Object.values(this.data.specializations)
      .map((s) => ({
        specialization: s.specialization,
        winRate: s.totalRuns > 0 ? s.wins / s.totalRuns : 0,
        wins: s.wins,
        totalRuns: s.totalRuns,
        avgScoreDelta: s.totalRuns > 0 ? s.totalScoreDelta / s.totalRuns : 0,
      }))
      .sort((a, b) => b.winRate - a.winRate || b.avgScoreDelta - a.avgScoreDelta);
  }

  /**
   * Returns true if the same issue+file combination has failed 3+ times.
   * The engine should skip this combination to avoid wasting clicks.
   */
  shouldSkip(issueType: string, filePath: string): boolean {
    this.ensureLoaded();

    const ifKey = issueFileKey(issueType, filePath);
    const rec = this.data.issueFiles[ifKey];
    if (!rec) return false;
    return rec.failures >= SKIP_FAILURE_THRESHOLD;
  }

  /**
   * Get specialization weights for swarm mode.
   * Returns a map of specialization → weight (higher = more likely to win).
   * Weights are based on historical win rate; defaults to 1.0 for unknown specs.
   */
  getSpecializationWeights(): Map<string, number> {
    this.ensureLoaded();
    const weights = new Map<string, number>();

    for (const [name, rec] of Object.entries(this.data.specializations)) {
      if (rec.totalRuns >= 2) {
        // Weight = 0.5 + winRate (range 0.5–1.5) so even low performers get a chance
        const winRate = rec.wins / rec.totalRuns;
        weights.set(name, 0.5 + winRate);
      } else {
        weights.set(name, 1.0);
      }
    }

    return weights;
  }

  /** Get raw data — useful for testing. */
  getData(): Readonly<LearningData> {
    return this.data;
  }

  /** Get the issue+file failure count — useful for testing. */
  getIssueFileFailures(issueType: string, filePath: string): number {
    this.ensureLoaded();
    const rec = this.data.issueFiles[issueFileKey(issueType, filePath)];
    return rec?.failures ?? 0;
  }
}
