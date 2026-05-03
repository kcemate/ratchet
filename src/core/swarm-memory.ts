import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { logger } from "../lib/logger.js";
import type { SwarmResult } from "../types.js";
import type { DebateRound } from "./swarm-debate.js";

const log = logger;
const MEMORY_FILE = ".ratchet/swarm-memory.json";

// ─── Types
export interface DebatePattern {
  /** What kind of issue this was (e.g. security, performance) */
  context: string;
  winningPersonality: string;
  losingPersonalities: string[];
  insight: string;
}

export interface PersonalityCombination {
  personalities: string[];
  avgScoreDelta: number;
  runs: number;
}

export interface SwarmMemory {
  version: 1;
  personalityWins: Record<string, { wins: number; losses: number; totalDelta: number }>;
  debatePatterns: DebatePattern[];
  bestCombos: PersonalityCombination[];
}

// ─── Persistence
function emptyMemory(): SwarmMemory {
  return {
    version: 1,
    personalityWins: {},
    debatePatterns: [],
    bestCombos: [],
  };
}

/** Load swarm memory from .ratchet/swarm-memory.json. Returns empty memory if file does not exist. */
export async function loadSwarmMemory(cwd: string): Promise<SwarmMemory> {
  const filePath = join(cwd, MEMORY_FILE);
  if (!existsSync(filePath)) {
    return emptyMemory();
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SwarmMemory;
    if (parsed.version !== 1) {
      log.warn({ filePath }, "swarm-memory: unknown version, resetting");
      return emptyMemory();
    }
    return parsed;
  } catch (err) {
    log.warn({ err, filePath }, "swarm-memory: failed to load, using empty memory");
    return emptyMemory();
  }
}

/** Save swarm memory to .ratchet/swarm-memory.json */
export async function saveSwarmMemory(cwd: string, memory: SwarmMemory): Promise<void> {
  const dir = join(cwd, ".ratchet");
  const filePath = join(cwd, MEMORY_FILE);

  try {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, JSON.stringify(memory, null, 2), "utf-8");
  } catch (err) {
    log.warn({ err, filePath }, "swarm-memory: failed to save");
  }
}

// ─── Learning
/**
 * Record a swarm run outcome into memory.
 * Updates personality win/loss stats, debate patterns, and combo history.
 */
export function recordSwarmOutcome(memory: SwarmMemory, result: SwarmResult, debate?: DebateRound): SwarmMemory {
  const updated = structuredClone(memory) as SwarmMemory;

  // 1. Update per-personality win/loss stats
  const winnerAgent = result.winner
    ? result.allResults.find(r => r.outcome === result.winner || r.outcome.click === result.winner?.click)
    : null;

  const winnerPersonality: string = winnerAgent
    ? ((winnerAgent as { personality?: string }).personality ?? winnerAgent.specialization)
    : "";

  for (const agent of result.allResults) {
    const personality = (agent as { personality?: string }).personality ?? agent.specialization;
    if (!personality) continue;

    if (!updated.personalityWins[personality]) {
      updated.personalityWins[personality] = { wins: 0, losses: 0, totalDelta: 0 };
    }

    const stats = updated.personalityWins[personality];
    if (personality === winnerPersonality) {
      stats.wins++;
      stats.totalDelta += agent.scoreDelta;
    } else {
      stats.losses++;
    }
  }

  // 2. Record debate patterns (if a debate was run)
  if (debate && debate.verdict.confidence >= 0.6) {
    const losingPersonalities = debate.proposals
      .filter(p => p.agentName !== debate.verdict.winner)
      .map(p => p.personality);

    const winnerProposal = debate.proposals.find(p => p.agentName === debate.verdict.winner);
    const context = winnerProposal?.specialization ?? "unknown";

    // Avoid exact duplicate patterns
    const exists = updated.debatePatterns.some(
      dp => dp.context === context && dp.winningPersonality === winnerProposal?.personality
    );

    if (!exists && winnerProposal) {
      updated.debatePatterns.push({
        context,
        winningPersonality: winnerProposal.personality,
        losingPersonalities,
        insight: debate.verdict.reasoning,
      });

      // Cap at 50 patterns (keep most recent)
      if (updated.debatePatterns.length > 50) {
        updated.debatePatterns = updated.debatePatterns.slice(-50);
      }
    }
  }

  // 3. Update personality combination stats
  const personalities = result.allResults
    .map(r => (r as { personality?: string }).personality ?? r.specialization)
    .filter(Boolean)
    .sort();

  if (personalities.length > 0) {
    const comboKey = personalities.join(",");
    const avgDelta = result.allResults.reduce((sum, r) => sum + r.scoreDelta, 0) / result.allResults.length;

    const existingCombo = updated.bestCombos.find(c => c.personalities.sort().join(",") === comboKey);

    if (existingCombo) {
      existingCombo.avgScoreDelta =
        (existingCombo.avgScoreDelta * existingCombo.runs + avgDelta) / (existingCombo.runs + 1);
      existingCombo.runs++;
    } else {
      updated.bestCombos.push({
        personalities,
        avgScoreDelta: avgDelta,
        runs: 1,
      });
    }

    // Sort by avgScoreDelta descending, cap at 20
    updated.bestCombos.sort((a, b) => b.avgScoreDelta - a.avgScoreDelta);
    if (updated.bestCombos.length > 20) {
      updated.bestCombos = updated.bestCombos.slice(0, 20);
    }
  }

  return updated;
}

/**
 * Recommend personalities for N agents based on historical win rates.
 * Falls back to the default assignment if not enough history.
 */
export function recommendPersonalities(memory: SwarmMemory, agentCount: number): string[] | null {
  const { personalityWins } = memory;

  const names = Object.keys(personalityWins);
  if (names.length === 0) return null;

  // Need at least 3 runs per personality to trust the data
  const qualified = names.filter(n => {
    const s = personalityWins[n];
    return s.wins + s.losses >= 3;
  });

  if (qualified.length < agentCount) return null;

  // Sort by win rate, then by avg delta
  const sorted = qualified.sort((a, b) => {
    const sa = personalityWins[a];
    const sb = personalityWins[b];
    const winRateA = sa.wins / (sa.wins + sa.losses);
    const winRateB = sb.wins / (sb.wins + sb.losses);
    if (winRateB !== winRateA) return winRateB - winRateA;
    const avgDeltaA = sa.totalDelta / (sa.wins + sa.losses);
    const avgDeltaB = sb.totalDelta / (sb.wins + sb.losses);
    return avgDeltaB - avgDeltaA;
  });

  return sorted.slice(0, agentCount);
}

/**
 * Get win rate statistics for each personality.
 */
export function getPersonalityStats(memory: SwarmMemory): Array<{
  name: string;
  wins: number;
  losses: number;
  winRate: number;
  avgDelta: number;
}> {
  return Object.entries(memory.personalityWins).map(([name, stats]) => ({
    name,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.wins / Math.max(1, stats.wins + stats.losses),
    avgDelta: stats.totalDelta / Math.max(1, stats.wins + stats.losses),
  }));
}
