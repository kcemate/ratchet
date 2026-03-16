import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { ScanResult, IssueType } from '../commands/scan.js';
import type { LearningData } from './learning.js';

// ── L0 Types — Hot context (always loaded) ────────────────────────────────────

export interface ScanSnapshot {
  score: number;
  maxScore: number;
  totalIssues: number;
  issueCounts: Record<string, number>;
  timestamp: string;
}

export interface RunContext {
  runId: string;
  target: string;
  clickCount: number;
  currentClick: number;
  startedAt: string;
}

interface L0Data {
  currentScan: ScanSnapshot | null;
  activeRun: RunContext | null;
}

// ── L1 Types — Project memory (loaded on demand) ─────────────────────────────

export interface RunResult {
  runId: string;
  finalScore: number;
  initialScore: number;
  issuesFixed: number;
  clicksLanded: number;
  clicksRolled: number;
  duration: number;
  strategiesUsed: string[];
  timestamp: string;
}

export interface ScorePoint {
  score: number;
  issues: number;
  timestamp: string;
  runId: string;
}

export interface IssuePattern {
  issueType: string;
  frequency: number;
  avgFixRate: number;
  bestStrategy: string;
  trend: 'improving' | 'stable' | 'worsening';
}

export interface Strategy {
  description: string;
  issueType: string;
  successRate: number;
  avgScoreDelta: number;
  sampleSize: number;
}

export interface FileHistory {
  filePath: string;
  touchCount: number;
  lastScore: number | null;
  issueTypes: string[];
  avgFixRate: number;
}

interface L1Data {
  runs: RunResult[];
  scoreProgression: ScorePoint[];
  /** issueType → { attempts, successes, strategies: Record<strategy, {attempts, successes, totalDelta}> } */
  issueStats: Record<string, {
    attempts: number;
    successes: number;
    strategies: Record<string, { attempts: number; successes: number; totalDelta: number }>;
  }>;
  fileStats: Record<string, {
    touchCount: number;
    lastScore: number | null;
    issueTypes: string[];
    successes: number;
    attempts: number;
  }>;
}

// ── L2 Types — Cross-project wisdom (global) ──────────────────────────────────

export interface CrossProjectPattern {
  issueType: string;
  projectName: string;
  fixRate: number;
  topStrategies: string[];
}

export interface Insight {
  text: string;
  confidence: number;
  source: 'l1' | 'l2';
  evidence: string;
}

export interface SpecStats {
  specialization: string;
  projectCount: number;
  totalWins: number;
  totalRuns: number;
  avgScoreDelta: number;
}

interface L2Data {
  patterns: Record<string, {
    issueType: string;
    projects: Record<string, { fixRate: number; strategies: string[] }>;
  }>;
  specStats: Record<string, {
    specialization: string;
    projects: Set<string> | string[];
    wins: number;
    runs: number;
    totalDelta: number;
  }>;
}

// ── Query Types ───────────────────────────────────────────────────────────────

export interface ContextQuery {
  issueType?: string;
  filePath?: string;
  phase: 'scan' | 'plan' | 'fix' | 'review';
}

export interface TieredContext {
  l0: object;
  l1: object | null;
  l2: object | null;
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyL0(): L0Data {
  return { currentScan: null, activeRun: null };
}

function emptyL1(): L1Data {
  return { runs: [], scoreProgression: [], issueStats: {}, fileStats: {} };
}

function emptyL2(): L2Data {
  return { patterns: {}, specStats: {} };
}

function computeTrend(points: ScorePoint[], issueType: string): 'improving' | 'stable' | 'worsening' {
  if (points.length < 3) return 'stable';
  const recent = points.slice(-3);
  const first = recent[0]!.issues;
  const last = recent[recent.length - 1]!.issues;
  if (last < first) return 'improving';
  if (last > first) return 'worsening';
  return 'stable';
}

// ── ContextBrain ──────────────────────────────────────────────────────────────

export class ContextBrain {
  private readonly cwd: string;
  private readonly l0Path: string;
  private readonly l1Path: string;
  private readonly l2Path: string;
  private readonly legacyPath: string;

  private l0: L0Data = emptyL0();
  private l1: L1Data = emptyL1();
  private l2: L2Data = emptyL2();

  private l0Loaded = false;
  private l1Loaded = false;
  private l2Loaded = false;

  constructor(cwd: string, globalDir?: string) {
    this.cwd = cwd;
    this.l0Path = join(cwd, '.ratchet', 'brain', 'l0.json');
    this.l1Path = join(cwd, '.ratchet', 'brain', 'l1.json');
    this.l2Path = join(globalDir ?? homedir(), '.ratchet', 'brain', 'l2.json');
    this.legacyPath = join(cwd, '.ratchet', 'learning.json');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async load(tiers?: ('l0' | 'l1' | 'l2')[]): Promise<void> {
    const toLoad = tiers ?? ['l0'];

    // Auto-migrate from legacy learning.json on first load
    if (!existsSync(join(this.cwd, '.ratchet', 'brain')) && existsSync(this.legacyPath)) {
      await this.migrateFromLegacy();
    }

    if (toLoad.includes('l0')) {
      this.l0 = await this.loadJson<L0Data>(this.l0Path, emptyL0);
      this.l0Loaded = true;
    }
    if (toLoad.includes('l1')) {
      this.l1 = await this.loadJson<L1Data>(this.l1Path, emptyL1);
      this.l1Loaded = true;
    }
    if (toLoad.includes('l2')) {
      const raw = await this.loadJson<L2Data>(this.l2Path, emptyL2);
      // Convert specStats projects from array back to Set
      for (const [, val] of Object.entries(raw.specStats)) {
        if (Array.isArray(val.projects)) {
          val.projects = new Set(val.projects);
        }
      }
      this.l2 = raw;
      this.l2Loaded = true;
    }
  }

  async save(): Promise<void> {
    if (this.l0Loaded) {
      await this.saveJson(this.l0Path, this.l0);
    }
    if (this.l1Loaded) {
      await this.saveJson(this.l1Path, this.l1);
    }
    if (this.l2Loaded) {
      // Convert Sets to arrays for JSON serialization
      const serializable = {
        patterns: this.l2.patterns,
        specStats: Object.fromEntries(
          Object.entries(this.l2.specStats).map(([k, v]) => [
            k,
            { ...v, projects: Array.from(v.projects) },
          ])
        ),
      };
      await this.saveJson(this.l2Path, serializable);
    }
  }

  // ── L0 — Hot context ─────────────────────────────────────────────────────

  setCurrentScan(scan: ScanSnapshot): void {
    this.l0.currentScan = scan;
  }

  getCurrentScan(): ScanSnapshot | null {
    return this.l0.currentScan;
  }

  setActiveRun(run: RunContext): void {
    this.l0.activeRun = run;
  }

  getActiveRun(): RunContext | null {
    return this.l0.activeRun;
  }

  /**
   * Create a ScanSnapshot from a ScanResult for convenience.
   */
  static snapshotFromScanResult(result: ScanResult): ScanSnapshot {
    const issueCounts: Record<string, number> = {};
    for (const issue of result.issuesByType) {
      issueCounts[issue.subcategory] = (issueCounts[issue.subcategory] ?? 0) + issue.count;
    }
    return {
      score: result.total,
      maxScore: result.maxTotal,
      totalIssues: result.totalIssuesFound,
      issueCounts,
      timestamp: new Date().toISOString(),
    };
  }

  // ── L1 — Project memory ──────────────────────────────────────────────────

  async recordRunResult(result: RunResult): Promise<void> {
    if (!this.l1Loaded) await this.load(['l1']);

    this.l1.runs.push(result);

    // Update score progression
    this.l1.scoreProgression.push({
      score: result.finalScore,
      issues: result.issuesFixed,
      timestamp: result.timestamp,
      runId: result.runId,
    });

    // Update issue stats from strategies used
    for (const strategy of result.strategiesUsed) {
      // Strategies are in format "issueType:description" or just a description
      const parts = strategy.split(':');
      const issueType = parts.length > 1 ? parts[0]! : 'general';
      const desc = parts.length > 1 ? parts.slice(1).join(':') : strategy;

      if (!this.l1.issueStats[issueType]) {
        this.l1.issueStats[issueType] = { attempts: 0, successes: 0, strategies: {} };
      }
      const stats = this.l1.issueStats[issueType]!;
      stats.attempts++;
      if (result.clicksLanded > 0) {
        stats.successes++;
      }

      if (!stats.strategies[desc]) {
        stats.strategies[desc] = { attempts: 0, successes: 0, totalDelta: 0 };
      }
      const strat = stats.strategies[desc]!;
      strat.attempts++;
      if (result.clicksLanded > 0) {
        strat.successes++;
      }
      strat.totalDelta += result.finalScore - result.initialScore;
    }

    await this.save();
  }

  async getScoreProgression(): Promise<ScorePoint[]> {
    if (!this.l1Loaded) await this.load(['l1']);
    return [...this.l1.scoreProgression];
  }

  async getIssuePatterns(): Promise<IssuePattern[]> {
    if (!this.l1Loaded) await this.load(['l1']);

    return Object.entries(this.l1.issueStats).map(([issueType, stats]) => {
      const avgFixRate = stats.attempts > 0 ? stats.successes / stats.attempts : 0;

      // Find best strategy
      let bestStrategy = 'none';
      let bestRate = 0;
      for (const [desc, strat] of Object.entries(stats.strategies)) {
        const rate = strat.attempts > 0 ? strat.successes / strat.attempts : 0;
        if (rate > bestRate || (rate === bestRate && strat.attempts > (stats.strategies[bestStrategy]?.attempts ?? 0))) {
          bestRate = rate;
          bestStrategy = desc;
        }
      }

      return {
        issueType,
        frequency: stats.attempts,
        avgFixRate,
        bestStrategy,
        trend: computeTrend(this.l1.scoreProgression, issueType),
      };
    });
  }

  async getEffectiveStrategies(issueType: string): Promise<Strategy[]> {
    if (!this.l1Loaded) await this.load(['l1']);

    const stats = this.l1.issueStats[issueType];
    if (!stats) return [];

    return Object.entries(stats.strategies)
      .map(([desc, strat]) => ({
        description: desc,
        issueType,
        successRate: strat.attempts > 0 ? strat.successes / strat.attempts : 0,
        avgScoreDelta: strat.attempts > 0 ? strat.totalDelta / strat.attempts : 0,
        sampleSize: strat.attempts,
      }))
      .sort((a, b) => b.successRate - a.successRate || b.avgScoreDelta - a.avgScoreDelta);
  }

  async getFileHistory(filePath: string): Promise<FileHistory> {
    if (!this.l1Loaded) await this.load(['l1']);

    const stats = this.l1.fileStats[filePath];
    if (!stats) {
      return { filePath, touchCount: 0, lastScore: null, issueTypes: [], avgFixRate: 0 };
    }

    return {
      filePath,
      touchCount: stats.touchCount,
      lastScore: stats.lastScore,
      issueTypes: [...stats.issueTypes],
      avgFixRate: stats.attempts > 0 ? stats.successes / stats.attempts : 0,
    };
  }

  /**
   * Record file-level outcome (called from engine after a click).
   */
  async recordFileOutcome(filePath: string, issueType: string, success: boolean, score: number | null): Promise<void> {
    if (!this.l1Loaded) await this.load(['l1']);

    if (!this.l1.fileStats[filePath]) {
      this.l1.fileStats[filePath] = {
        touchCount: 0,
        lastScore: null,
        issueTypes: [],
        successes: 0,
        attempts: 0,
      };
    }
    const stats = this.l1.fileStats[filePath]!;
    stats.touchCount++;
    stats.attempts++;
    if (success) stats.successes++;
    if (score !== null) stats.lastScore = score;
    if (!stats.issueTypes.includes(issueType)) {
      stats.issueTypes.push(issueType);
    }
  }

  // ── L2 — Cross-project wisdom ────────────────────────────────────────────

  async recordCrossProjectPattern(pattern: CrossProjectPattern): Promise<void> {
    if (!this.l2Loaded) await this.load(['l2']);

    if (!this.l2.patterns[pattern.issueType]) {
      this.l2.patterns[pattern.issueType] = {
        issueType: pattern.issueType,
        projects: {},
      };
    }
    this.l2.patterns[pattern.issueType]!.projects[pattern.projectName] = {
      fixRate: pattern.fixRate,
      strategies: pattern.topStrategies,
    };

    await this.save();
  }

  async getCrossProjectInsights(issueType: string): Promise<Insight[]> {
    if (!this.l2Loaded) await this.load(['l2']);

    const pattern = this.l2.patterns[issueType];
    if (!pattern) return [];

    const projects = Object.entries(pattern.projects);
    if (projects.length === 0) return [];

    const avgFixRate = projects.reduce((sum, [, p]) => sum + p.fixRate, 0) / projects.length;
    const allStrategies = projects.flatMap(([, p]) => p.strategies);
    const strategyCounts = new Map<string, number>();
    for (const s of allStrategies) {
      strategyCounts.set(s, (strategyCounts.get(s) ?? 0) + 1);
    }
    const topStrategies = [...strategyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s]) => s);

    const insights: Insight[] = [];

    if (projects.length >= 2) {
      insights.push({
        text: `"${issueType}" seen across ${projects.length} projects with ${(avgFixRate * 100).toFixed(0)}% avg fix rate.`,
        confidence: Math.min(0.9, 0.3 + projects.length * 0.15),
        source: 'l2',
        evidence: `${projects.length} projects: ${projects.map(([n]) => n).join(', ')}`,
      });
    }

    if (topStrategies.length > 0) {
      insights.push({
        text: `Top strategies for "${issueType}": ${topStrategies.join(', ')}`,
        confidence: Math.min(0.85, 0.2 + topStrategies.length * 0.2),
        source: 'l2',
        evidence: `Based on ${allStrategies.length} strategy uses across ${projects.length} projects`,
      });
    }

    return insights;
  }

  async getGlobalSpecializationStats(): Promise<SpecStats[]> {
    if (!this.l2Loaded) await this.load(['l2']);

    return Object.values(this.l2.specStats).map((s) => ({
      specialization: s.specialization,
      projectCount: s.projects instanceof Set ? s.projects.size : (s.projects as string[]).length,
      totalWins: s.wins,
      totalRuns: s.runs,
      avgScoreDelta: s.runs > 0 ? s.totalDelta / s.runs : 0,
    }));
  }

  /**
   * Record a specialization outcome at L2 level.
   */
  async recordSpecOutcome(specialization: string, projectName: string, won: boolean, scoreDelta: number): Promise<void> {
    if (!this.l2Loaded) await this.load(['l2']);

    if (!this.l2.specStats[specialization]) {
      this.l2.specStats[specialization] = {
        specialization,
        projects: new Set<string>(),
        wins: 0,
        runs: 0,
        totalDelta: 0,
      };
    }
    const stats = this.l2.specStats[specialization]!;
    if (stats.projects instanceof Set) {
      stats.projects.add(projectName);
    }
    stats.runs++;
    if (won) stats.wins++;
    stats.totalDelta += scoreDelta;

    await this.save();
  }

  // ── Tiered retrieval ──────────────────────────────────────────────────────

  async getContext(query: ContextQuery): Promise<TieredContext> {
    // L0 is always available
    const l0Context: object = {
      currentScan: this.l0.currentScan,
      activeRun: this.l0.activeRun,
    };

    let l1Context: object | null = null;
    let l2Context: object | null = null;
    const summaryParts: string[] = [];

    // L0 summary
    if (this.l0.currentScan) {
      summaryParts.push(`Current score: ${this.l0.currentScan.score}/${this.l0.currentScan.maxScore}, ${this.l0.currentScan.totalIssues} issues`);
    }

    // L1 — include for plan/fix/review phases or when we have relevant data
    if (this.l1Loaded || query.phase !== 'scan') {
      if (!this.l1Loaded) {
        try {
          await this.load(['l1']);
        } catch {
          // L1 not available, that's fine
        }
      }

      if (this.l1Loaded) {
        const l1: Record<string, unknown> = {};

        if (query.issueType) {
          const strategies = await this.getEffectiveStrategies(query.issueType);
          if (strategies.length > 0) {
            l1['effectiveStrategies'] = strategies.slice(0, 5);
            summaryParts.push(`${strategies.length} known strategies for "${query.issueType}"`);
          }
        }

        if (query.filePath) {
          const history = await this.getFileHistory(query.filePath);
          if (history.touchCount > 0) {
            l1['fileHistory'] = history;
            summaryParts.push(`File "${query.filePath}" touched ${history.touchCount}x, ${(history.avgFixRate * 100).toFixed(0)}% fix rate`);
          }
        }

        if (query.phase === 'plan' || query.phase === 'review') {
          const patterns = await this.getIssuePatterns();
          if (patterns.length > 0) {
            l1['issuePatterns'] = patterns;
          }
          const progression = await this.getScoreProgression();
          if (progression.length > 0) {
            l1['recentScores'] = progression.slice(-10);
          }
        }

        if (Object.keys(l1).length > 0) {
          l1Context = l1;
        }
      }
    }

    // L2 — only for novel situations or when L1 has no data
    if (query.issueType && (l1Context === null || query.phase === 'plan')) {
      if (!this.l2Loaded) {
        try {
          await this.load(['l2']);
        } catch {
          // L2 not available, that's fine
        }
      }

      if (this.l2Loaded) {
        const insights = await this.getCrossProjectInsights(query.issueType);
        if (insights.length > 0) {
          l2Context = { insights };
          summaryParts.push(`${insights.length} cross-project insights for "${query.issueType}"`);
        }
      }
    }

    return {
      l0: l0Context,
      l1: l1Context,
      l2: l2Context,
      summary: summaryParts.join('. ') || 'No context available.',
    };
  }

  // ── Migration ─────────────────────────────────────────────────────────────

  private async migrateFromLegacy(): Promise<void> {
    try {
      const raw = await readFile(this.legacyPath, 'utf-8');
      const legacy = JSON.parse(raw) as LearningData;

      if (legacy.version !== 1) return;

      // Migrate issue types → L1 issueStats
      const issueStats: L1Data['issueStats'] = {};
      for (const [key, record] of Object.entries(legacy.issueTypes)) {
        issueStats[key] = {
          attempts: record.attempts,
          successes: record.successes,
          strategies: record.bestSpecialization
            ? { [record.bestSpecialization]: { attempts: record.successes, successes: record.successes, totalDelta: 0 } }
            : {},
        };
      }

      // Migrate file records → L1 fileStats
      const fileStats: L1Data['fileStats'] = {};
      for (const [key, record] of Object.entries(legacy.files)) {
        fileStats[key] = {
          touchCount: record.attempts,
          lastScore: null,
          issueTypes: [],
          successes: record.successes,
          attempts: record.attempts,
        };
      }

      // Migrate specializations → L1 (we'll keep them in L1 as run data context)
      this.l1 = {
        runs: [],
        scoreProgression: [],
        issueStats,
        fileStats,
      };
      this.l1Loaded = true;

      // Ensure brain directory exists and save
      await mkdir(dirname(this.l0Path), { recursive: true });
      await this.saveJson(this.l1Path, this.l1);

      // Also init empty L0
      this.l0 = emptyL0();
      this.l0Loaded = true;
      await this.saveJson(this.l0Path, this.l0);
    } catch {
      // Migration failed — start fresh, non-fatal
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async loadJson<T>(path: string, fallback: () => T): Promise<T> {
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback();
    }
  }

  private async saveJson(path: string, data: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }
}
