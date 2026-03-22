import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, rmSync } from 'fs';

// Personalities
import {
  getPersonality,
  getAllPersonalities,
  buildPersonalityPrompt,
  assignPersonalities,
} from '../src/core/agents/personalities.js';

// Debate
import {
  shouldDebate,
  buildJudgePrompt,
  parseVerdict,
  type AgentProposal,
} from '../src/core/swarm-debate.js';

// Memory
import {
  loadSwarmMemory,
  saveSwarmMemory,
  recommendPersonalities,
  getPersonalityStats,
  type SwarmMemory,
} from '../src/core/swarm-memory.js';

// ── Personalities ─────────────────────────────────────────────────────────────

describe('Personalities', () => {
  it('has at least 5 built-in personalities', () => {
    const all = getAllPersonalities();
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it('getPersonality returns a valid personality by name', () => {
    const surgeon = getPersonality('the-surgeon');
    expect(surgeon).toBeDefined();
    expect(surgeon!.name).toBe('The Surgeon');
    expect(surgeon!.style).toBe('minimalist');
    expect(surgeon!.riskTolerance).toBe('low');
  });

  it('getPersonality returns undefined for unknown name', () => {
    expect(getPersonality('nonexistent')).toBeUndefined();
  });

  it('each personality has required fields', () => {
    for (const p of getAllPersonalities()) {
      expect(p.name).toBeTruthy();
      expect(['conservative', 'aggressive', 'minimalist', 'thorough']).toContain(p.style);
      expect(['low', 'medium', 'high']).toContain(p.riskTolerance);
      expect(p.promptPrefix).toBeTruthy();
      expect(p.debateStyle).toBeTruthy();
      expect(p.preferredGuard).toBeTruthy();
    }
  });

  it('buildPersonalityPrompt combines personality and specialization', () => {
    const surgeon = getPersonality('the-surgeon')!;
    const prompt = buildPersonalityPrompt(surgeon, 'security');
    expect(prompt).toContain(surgeon.promptPrefix);
    expect(prompt.toLowerCase()).toContain('security');
  });

  it('buildPersonalityPrompt works without specialization', () => {
    const surgeon = getPersonality('the-surgeon')!;
    const prompt = buildPersonalityPrompt(surgeon);
    expect(prompt).toContain(surgeon.promptPrefix);
  });

  it('assignPersonalities returns requested count', () => {
    const assigned = assignPersonalities(3);
    expect(assigned).toHaveLength(3);
    for (const p of assigned) {
      expect(p.name).toBeTruthy();
    }
  });

  it('assignPersonalities returns all when count >= total', () => {
    const all = getAllPersonalities();
    const assigned = assignPersonalities(all.length + 2);
    expect(assigned.length).toBe(all.length + 2);
  });

  it('assignPersonalities with count 1 returns one personality', () => {
    const assigned = assignPersonalities(1);
    expect(assigned).toHaveLength(1);
  });

  it('all personality names are unique', () => {
    const all = getAllPersonalities();
    const names = all.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ── Debate ────────────────────────────────────────────────────────────────────

describe('Debate System', () => {
  const makeProposal = (name: string, scoreDelta: number, files: string[] = ['file.ts']): AgentProposal => ({
    agentName: name,
    personality: 'the-surgeon',
    specialization: 'quality',
    filesChanged: files,
    scoreDelta,
    summary: `Agent ${name} fixed things`,
    diffStats: { additions: 10, deletions: 5 },
  });

  describe('shouldDebate', () => {
    it('returns false for 0 proposals', () => {
      expect(shouldDebate([])).toBe(false);
    });

    it('returns false for 1 proposal', () => {
      expect(shouldDebate([makeProposal('a', 2)])).toBe(false);
    });

    it('returns true for 2+ proposals with different scores', () => {
      expect(shouldDebate([makeProposal('a', 2), makeProposal('b', 5)])).toBe(true);
    });

    it('returns false when all proposals have same score delta', () => {
      expect(shouldDebate([makeProposal('a', 3), makeProposal('b', 3)])).toBe(false);
    });
  });

  describe('buildJudgePrompt', () => {
    it('includes all proposal summaries', () => {
      const proposals = [makeProposal('alpha', 3), makeProposal('beta', 5)];
      const prompt = buildJudgePrompt(proposals);
      expect(prompt).toContain('alpha');
      expect(prompt).toContain('beta');
    });

    it('includes strategy context when provided', () => {
      const proposals = [makeProposal('a', 1), makeProposal('b', 2)];
      const prompt = buildJudgePrompt(proposals, 'Prefer minimal changes');
      expect(prompt).toContain('Prefer minimal changes');
    });
  });

  describe('parseVerdict', () => {
    const proposals = [makeProposal('alpha', 3), makeProposal('beta', 5)];

    it('parses valid JSON verdict', () => {
      const response = JSON.stringify({
        winner: 'alpha',
        reasoning: 'Best balance of risk and reward',
        dissent: ['beta'],
        confidence: 0.85,
      });
      const verdict = parseVerdict(response, proposals);
      expect(verdict).toBeDefined();
      expect(verdict.winner).toBe('alpha');
      expect(verdict.confidence).toBe(0.85);
    });

    it('parses JSON wrapped in markdown fences', () => {
      const response = '```json\n{"winner":"alpha","reasoning":"good","dissent":[],"confidence":0.9}\n```';
      const verdict = parseVerdict(response, proposals);
      expect(verdict).toBeDefined();
      expect(verdict.winner).toBe('alpha');
    });

    it('returns fallback verdict for unparseable response', () => {
      const verdict = parseVerdict('just random text', proposals);
      // Should fall back to highest score delta
      expect(verdict).toBeDefined();
      expect(verdict.winner).toBe('beta'); // highest score
      expect(verdict.confidence).toBeLessThan(0.5);
    });
  });
});

// ── Swarm Memory ──────────────────────────────────────────────────────────────

describe('Swarm Memory', () => {
  const tmpDir = resolve('/tmp/ratchet-swarm-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(join(tmpDir, '.ratchet'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadSwarmMemory returns empty memory when no file exists', async () => {
    const mem = await loadSwarmMemory(tmpDir);
    expect(mem.version).toBe(1);
    expect(mem.personalityWins).toEqual({});
  });

  it('saveSwarmMemory and loadSwarmMemory roundtrip', async () => {
    const mem: SwarmMemory = {
      version: 1,
      personalityWins: { 'the-surgeon': { wins: 3, losses: 1, totalDelta: 12 } },
      debatePatterns: [],
      bestCombos: [],
    };
    await saveSwarmMemory(tmpDir, mem);
    const loaded = await loadSwarmMemory(tmpDir);
    expect(loaded.personalityWins['the-surgeon']).toEqual({ wins: 3, losses: 1, totalDelta: 12 });
  });

  it('getPersonalityStats computes win rates', () => {
    const mem: SwarmMemory = {
      version: 1,
      personalityWins: {
        'the-surgeon': { wins: 7, losses: 3, totalDelta: 20 },
        'the-bulldozer': { wins: 2, losses: 8, totalDelta: 5 },
      },
      debatePatterns: [],
      bestCombos: [],
    };

    const stats = getPersonalityStats(mem);
    const surgeonStat = stats.find(s => s.name === 'the-surgeon');
    const bulldozerStat = stats.find(s => s.name === 'the-bulldozer');

    expect(surgeonStat).toBeDefined();
    expect(surgeonStat!.winRate).toBe(0.7);
    expect(bulldozerStat!.winRate).toBe(0.2);
  });

  it('recommendPersonalities prefers high win-rate personalities', () => {
    const mem: SwarmMemory = {
      version: 1,
      personalityWins: {
        'the-surgeon': { wins: 10, losses: 0, totalDelta: 50 },
        'the-bulldozer': { wins: 0, losses: 10, totalDelta: 0 },
        'the-hawk': { wins: 5, losses: 5, totalDelta: 15 },
      },
      debatePatterns: [],
      bestCombos: [],
    };

    const recommended = recommendPersonalities(mem, 2);
    expect(recommended).not.toBeNull();
    expect(recommended!).toHaveLength(2);
    expect(recommended![0]).toBe('the-surgeon');
  });

  it('recommendPersonalities returns null when no memory data', () => {
    const mem: SwarmMemory = {
      version: 1,
      personalityWins: {},
      debatePatterns: [],
      bestCombos: [],
    };
    const recommended = recommendPersonalities(mem, 3);
    expect(recommended).toBeNull();
  });
});
