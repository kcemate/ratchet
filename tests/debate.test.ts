import { describe, it, expect } from 'vitest';
import {
  getAgent,
  getAllPhilosophies,
  selectAgents,
  aggregateDebate,
  validateDebateConfig,
  formatDebateReport,
  DebateEngine,
  MAX_AGENTS,
  MAX_ROUNDS,
  DEFAULT_TIMEOUT,
} from '../src/core/debate.js';
import type {
  Philosophy,
  DebateAgent,
  DebateConfig,
  DebateRound,
  DebateArgument,
  DebateResult,
  DebateSynthesis,
} from '../src/core/debate.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<DebateAgent> = {}): DebateAgent {
  return {
    name: 'Test Agent',
    philosophy: 'pragmatist',
    backstory: 'A test agent',
    biases: ['bias 1'],
    ...overrides,
  };
}

function makeArgument(overrides: Partial<DebateArgument> = {}): DebateArgument {
  return {
    agent: makeAgent(),
    position: 'We should use the simple approach.',
    evidence: ['evidence 1'],
    counters: [],
    confidence: 75,
    ...overrides,
  };
}

function makeRound(roundNumber: number, args?: DebateArgument[]): DebateRound {
  return {
    roundNumber,
    arguments: args ?? [makeArgument()],
  };
}

function makeConfig(overrides: Partial<DebateConfig> = {}): DebateConfig {
  return {
    topic: 'REST vs GraphQL',
    agents: 4,
    rounds: 3,
    cwd: process.cwd(),
    ...overrides,
  };
}

function makeSynthesis(overrides: Partial<DebateSynthesis> = {}): DebateSynthesis {
  return {
    recommendation: 'Use REST for simplicity',
    reasoning: 'REST won the debate',
    tradeoffs: ['less flexible queries'],
    actionItems: ['design REST endpoints'],
    dissent: ['GraphQL would scale better'],
    consensus: 72,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('getAgent', () => {
  it('returns an agent for each built-in philosophy', () => {
    const philosophies: Philosophy[] = [
      'pragmatist', 'purist', 'security-first',
      'performance-first', 'user-first', 'minimalist',
    ];
    for (const philosophy of philosophies) {
      const agent = getAgent(philosophy);
      expect(agent).toBeDefined();
      expect(agent.philosophy).toBe(philosophy);
      expect(agent.name).toBeTruthy();
      expect(agent.backstory.length).toBeGreaterThan(50);
      expect(agent.biases.length).toBeGreaterThan(0);
    }
  });

  it('agents have distinct names', () => {
    const philosophies = getAllPhilosophies();
    const names = philosophies.map((p) => getAgent(p).name);
    expect(new Set(names).size).toBe(6);
  });
});

describe('getAllPhilosophies', () => {
  it('returns all 6 philosophies', () => {
    const philosophies = getAllPhilosophies();
    expect(philosophies).toHaveLength(6);
    expect(philosophies).toContain('pragmatist');
    expect(philosophies).toContain('purist');
    expect(philosophies).toContain('security-first');
    expect(philosophies).toContain('performance-first');
    expect(philosophies).toContain('user-first');
    expect(philosophies).toContain('minimalist');
  });

  it('returns a new array each time (no mutation risk)', () => {
    const a = getAllPhilosophies();
    const b = getAllPhilosophies();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('selectAgents', () => {
  it('returns empty array for count 0', () => {
    expect(selectAgents(0)).toEqual([]);
  });

  it('returns empty array for negative count', () => {
    expect(selectAgents(-1)).toEqual([]);
  });

  it('returns distinct philosophies when count <= 6', () => {
    const agents = selectAgents(4);
    expect(agents).toHaveLength(4);
    const philosophies = agents.map((a) => a.philosophy);
    expect(new Set(philosophies).size).toBe(4);
  });

  it('returns all 6 philosophies when count is 6', () => {
    const agents = selectAgents(6);
    expect(agents).toHaveLength(6);
    const philosophies = new Set(agents.map((a) => a.philosophy));
    expect(philosophies.size).toBe(6);
  });

  it('cycles philosophies and appends suffix when count > 6', () => {
    const agents = selectAgents(8);
    expect(agents).toHaveLength(8);
    // First 6 have original names
    expect(agents[0].name).not.toContain('#');
    expect(agents[5].name).not.toContain('#');
    // 7th and 8th have suffixed names
    expect(agents[6].name).toContain('#2');
    expect(agents[7].name).toContain('#2');
    // Philosophies wrap around
    expect(agents[6].philosophy).toBe(agents[0].philosophy);
    expect(agents[7].philosophy).toBe(agents[1].philosophy);
  });
});

describe('validateDebateConfig', () => {
  it('returns no errors for valid config', () => {
    const errors = validateDebateConfig(makeConfig());
    expect(errors).toHaveLength(0);
  });

  it('rejects empty topic', () => {
    const errors = validateDebateConfig(makeConfig({ topic: '' }));
    expect(errors).toContain('topic is required');
  });

  it('rejects whitespace-only topic', () => {
    const errors = validateDebateConfig(makeConfig({ topic: '   ' }));
    expect(errors).toContain('topic is required');
  });

  it('rejects agents < 1', () => {
    const errors = validateDebateConfig(makeConfig({ agents: 0 }));
    expect(errors).toContain('agents must be at least 1');
  });

  it('rejects agents > MAX_AGENTS', () => {
    const errors = validateDebateConfig(makeConfig({ agents: MAX_AGENTS + 1 }));
    expect(errors.some((e) => e.includes('at most'))).toBe(true);
  });

  it('rejects rounds < 1', () => {
    const errors = validateDebateConfig(makeConfig({ rounds: 0 }));
    expect(errors).toContain('rounds must be at least 1');
  });

  it('rejects rounds > MAX_ROUNDS', () => {
    const errors = validateDebateConfig(makeConfig({ rounds: MAX_ROUNDS + 1 }));
    expect(errors.some((e) => e.includes('at most'))).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const errors = validateDebateConfig(makeConfig({ topic: '', agents: 0, rounds: 0 }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('DebateEngine construction', () => {
  it('throws on invalid config', () => {
    expect(() => new DebateEngine(makeConfig({ topic: '' }))).toThrow('Invalid debate config');
  });

  it('constructs with valid config', () => {
    const engine = new DebateEngine(makeConfig());
    expect(engine).toBeDefined();
  });

  it('accepts 1-agent debate', () => {
    const engine = new DebateEngine(makeConfig({ agents: 1 }));
    expect(engine).toBeDefined();
  });

  it('accepts max agents', () => {
    const engine = new DebateEngine(makeConfig({ agents: MAX_AGENTS }));
    expect(engine).toBeDefined();
  });

  it('accepts 1-round debate', () => {
    const engine = new DebateEngine(makeConfig({ rounds: 1 }));
    expect(engine).toBeDefined();
  });
});

describe('aggregateDebate', () => {
  it('handles empty rounds', () => {
    const synthesis = aggregateDebate([]);
    expect(synthesis.recommendation).toContain('No debate rounds');
    expect(synthesis.consensus).toBe(0);
  });

  it('picks highest-confidence agent as winner', () => {
    const highConfAgent = makeAgent({ name: 'Winner', philosophy: 'purist' });
    const lowConfAgent = makeAgent({ name: 'Loser', philosophy: 'minimalist' });
    const rounds: DebateRound[] = [
      makeRound(1, [
        makeArgument({ agent: highConfAgent, confidence: 90, position: 'Purist wins' }),
        makeArgument({ agent: lowConfAgent, confidence: 40, position: 'Minimalist loses' }),
      ]),
    ];
    const synthesis = aggregateDebate(rounds);
    expect(synthesis.recommendation).toContain('Purist wins');
    expect(synthesis.reasoning).toContain('Winner');
  });

  it('uses final round for synthesis', () => {
    const agent = makeAgent({ name: 'Final' });
    const rounds: DebateRound[] = [
      makeRound(1, [makeArgument({ agent, confidence: 50 })]),
      makeRound(2, [makeArgument({ agent, confidence: 90, position: 'Changed my mind' })]),
    ];
    const synthesis = aggregateDebate(rounds);
    expect(synthesis.recommendation).toContain('Changed my mind');
  });

  it('calculates average confidence as consensus', () => {
    const rounds: DebateRound[] = [
      makeRound(1, [
        makeArgument({ confidence: 80 }),
        makeArgument({ confidence: 60 }),
      ]),
    ];
    const synthesis = aggregateDebate(rounds);
    expect(synthesis.consensus).toBe(70);
  });

  it('includes dissent from agents with high confidence', () => {
    const winner = makeAgent({ name: 'Winner' });
    const dissenter = makeAgent({ name: 'Dissenter', philosophy: 'security-first' });
    const rounds: DebateRound[] = [
      makeRound(1, [
        makeArgument({ agent: winner, confidence: 95 }),
        makeArgument({ agent: dissenter, confidence: 70, position: 'Security concerns' }),
      ]),
    ];
    const synthesis = aggregateDebate(rounds);
    expect(synthesis.dissent.length).toBe(1);
    expect(synthesis.dissent[0]).toContain('Dissenter');
  });
});

describe('formatDebateReport', () => {
  it('produces markdown with topic title', () => {
    const result: DebateResult = {
      topic: 'REST vs GraphQL',
      rounds: [makeRound(1, [makeArgument({ agent: makeAgent({ name: 'Alice' }) })])],
      synthesis: makeSynthesis(),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('# Architecture Debate: "REST vs GraphQL"');
    expect(report).toContain('Alice');
    expect(report).toContain('Use REST for simplicity');
  });

  it('includes tradeoffs section', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [makeRound(1)],
      synthesis: makeSynthesis({ tradeoffs: ['less flexibility', 'more boilerplate'] }),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('Tradeoffs');
    expect(report).toContain('less flexibility');
    expect(report).toContain('more boilerplate');
  });

  it('includes action items section', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [makeRound(1)],
      synthesis: makeSynthesis({ actionItems: ['design endpoints', 'write RFC'] }),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('Action Items');
    expect(report).toContain('design endpoints');
  });

  it('includes dissenting opinions', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [makeRound(1)],
      synthesis: makeSynthesis({ dissent: ['GraphQL would be better at scale'] }),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('Dissenting Opinions');
    expect(report).toContain('GraphQL would be better at scale');
  });

  it('includes consensus percentage', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [makeRound(1)],
      synthesis: makeSynthesis({ consensus: 85 }),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('85%');
  });

  it('shows round numbers in transcript', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [makeRound(1), makeRound(2)],
      synthesis: makeSynthesis(),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('Round 1');
    expect(report).toContain('Round 2');
  });

  it('shows counterarguments when present', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [
        makeRound(1, [
          makeArgument({ counters: ['rebuttal to Maya: shipping fast is risky'] }),
        ]),
      ],
      synthesis: makeSynthesis(),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('Counterarguments');
    expect(report).toContain('rebuttal to Maya');
  });

  it('shows confidence level for each agent', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [makeRound(1, [makeArgument({ confidence: 92 })])],
      synthesis: makeSynthesis(),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('confidence: 92%');
  });

  it('handles empty rounds gracefully', () => {
    const result: DebateResult = {
      topic: 'test',
      rounds: [],
      synthesis: makeSynthesis(),
    };
    const report = formatDebateReport(result);
    expect(report).toContain('0 architects');
  });
});

describe('constants', () => {
  it('MAX_AGENTS is 8', () => {
    expect(MAX_AGENTS).toBe(8);
  });

  it('MAX_ROUNDS is 5', () => {
    expect(MAX_ROUNDS).toBe(5);
  });

  it('DEFAULT_TIMEOUT is 120 seconds', () => {
    expect(DEFAULT_TIMEOUT).toBe(120_000);
  });
});
