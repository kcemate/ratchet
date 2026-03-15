import { describe, it, expect } from 'vitest';
import {
  getPersona,
  getAllPersonaTypes,
  getScenarioDescription,
  getAvailableScenarios,
  selectPersonas,
  aggregateResults,
  validateConfig,
  formatReport,
  SimulationEngine,
  MAX_PERSONAS,
  DEFAULT_TIMEOUT,
} from '../src/core/simulate.js';
import type {
  PersonaType,
  Persona,
  PersonaSimResult,
  SimulationConfig,
  SimulationResult,
  SimulationSummary,
} from '../src/core/simulate.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    type: 'casual',
    name: 'Test User',
    description: 'A test persona',
    goals: ['goal 1'],
    painPoints: ['pain 1'],
    technicalLevel: 'medium',
    ...overrides,
  };
}

function makePersonaResult(overrides: Partial<PersonaSimResult> = {}): PersonaSimResult {
  return {
    persona: makePersona(),
    journey: 'I tried the tool and it was fine.',
    painPoints: [],
    suggestions: [],
    sentiment: 'neutral',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    personas: 3,
    scenario: 'onboarding',
    cwd: process.cwd(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('getPersona', () => {
  it('returns a persona for each built-in type', () => {
    const types: PersonaType[] = ['power-user', 'casual', 'new-user', 'mobile', 'accessibility', 'api-developer'];
    for (const type of types) {
      const persona = getPersona(type);
      expect(persona).toBeDefined();
      expect(persona.type).toBe(type);
      expect(persona.name).toBeTruthy();
      expect(persona.description.length).toBeGreaterThan(10);
      expect(persona.goals.length).toBeGreaterThan(0);
      expect(persona.painPoints.length).toBeGreaterThan(0);
    }
  });

  it('returns personas with correct technical levels', () => {
    expect(getPersona('new-user').technicalLevel).toBe('low');
    expect(getPersona('casual').technicalLevel).toBe('medium');
    expect(getPersona('power-user').technicalLevel).toBe('high');
  });
});

describe('getAllPersonaTypes', () => {
  it('returns all 6 persona types', () => {
    const types = getAllPersonaTypes();
    expect(types).toHaveLength(6);
    expect(types).toContain('power-user');
    expect(types).toContain('casual');
    expect(types).toContain('new-user');
    expect(types).toContain('mobile');
    expect(types).toContain('accessibility');
    expect(types).toContain('api-developer');
  });

  it('returns a new array each time (no mutation risk)', () => {
    const a = getAllPersonaTypes();
    const b = getAllPersonaTypes();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('getScenarioDescription', () => {
  it('returns description for built-in scenarios', () => {
    expect(getScenarioDescription('onboarding')).toBeTruthy();
    expect(getScenarioDescription('daily-use')).toBeTruthy();
    expect(getScenarioDescription('premium-upgrade')).toBeTruthy();
  });

  it('returns undefined for unknown scenarios', () => {
    expect(getScenarioDescription('nonexistent')).toBeUndefined();
  });
});

describe('getAvailableScenarios', () => {
  it('returns all 3 built-in scenarios', () => {
    const scenarios = getAvailableScenarios();
    expect(scenarios).toHaveLength(3);
    expect(scenarios).toContain('onboarding');
    expect(scenarios).toContain('daily-use');
    expect(scenarios).toContain('premium-upgrade');
  });
});

describe('selectPersonas', () => {
  it('returns empty array for count 0', () => {
    expect(selectPersonas(0)).toEqual([]);
  });

  it('returns empty array for negative count', () => {
    expect(selectPersonas(-1)).toEqual([]);
  });

  it('returns distinct persona types when count <= 6', () => {
    const personas = selectPersonas(3);
    expect(personas).toHaveLength(3);
    const types = personas.map((p) => p.type);
    expect(new Set(types).size).toBe(3);
  });

  it('returns all 6 types when count is 6', () => {
    const personas = selectPersonas(6);
    expect(personas).toHaveLength(6);
    const types = new Set(personas.map((p) => p.type));
    expect(types.size).toBe(6);
  });

  it('cycles types and appends suffix when count > 6', () => {
    const personas = selectPersonas(8);
    expect(personas).toHaveLength(8);
    // First 6 have original names
    expect(personas[0].name).not.toContain('#');
    expect(personas[5].name).not.toContain('#');
    // 7th and 8th have suffixed names
    expect(personas[6].name).toContain('#2');
    expect(personas[7].name).toContain('#2');
    // Types wrap around
    expect(personas[6].type).toBe(personas[0].type);
    expect(personas[7].type).toBe(personas[1].type);
  });
});

describe('validateConfig', () => {
  it('returns no errors for valid config', () => {
    const errors = validateConfig(makeConfig());
    expect(errors).toHaveLength(0);
  });

  it('rejects personas < 1', () => {
    const errors = validateConfig(makeConfig({ personas: 0 }));
    expect(errors).toContain('personas must be at least 1');
  });

  it('rejects personas > MAX_PERSONAS', () => {
    const errors = validateConfig(makeConfig({ personas: MAX_PERSONAS + 1 }));
    expect(errors.some((e) => e.includes('at most'))).toBe(true);
  });

  it('rejects empty scenario', () => {
    const errors = validateConfig(makeConfig({ scenario: '' }));
    expect(errors).toContain('scenario is required');
  });

  it('rejects whitespace-only scenario', () => {
    const errors = validateConfig(makeConfig({ scenario: '   ' }));
    expect(errors).toContain('scenario is required');
  });

  it('rejects invalid targetUrl', () => {
    const errors = validateConfig(makeConfig({ targetUrl: 'not-a-url' }));
    expect(errors.some((e) => e.includes('targetUrl'))).toBe(true);
  });

  it('accepts valid http targetUrl', () => {
    const errors = validateConfig(makeConfig({ targetUrl: 'http://localhost:3000' }));
    expect(errors).toHaveLength(0);
  });

  it('accepts valid https targetUrl', () => {
    const errors = validateConfig(makeConfig({ targetUrl: 'https://example.com/api' }));
    expect(errors).toHaveLength(0);
  });

  it('accumulates multiple errors', () => {
    const errors = validateConfig(makeConfig({ personas: 0, scenario: '', targetUrl: 'bad' }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SimulationEngine construction', () => {
  it('throws on invalid config', () => {
    expect(() => new SimulationEngine(makeConfig({ personas: 0 }))).toThrow('Invalid simulation config');
  });

  it('constructs with valid config', () => {
    const engine = new SimulationEngine(makeConfig());
    expect(engine).toBeDefined();
  });

  it('accepts custom scenario names', () => {
    const engine = new SimulationEngine(makeConfig({ scenario: 'my-custom-flow' }));
    expect(engine).toBeDefined();
  });
});

describe('aggregateResults', () => {
  it('handles empty results', () => {
    const summary = aggregateResults([]);
    expect(summary.overallSentiment).toContain('Mixed');
    expect(summary.topPainPoints).toHaveLength(0);
    expect(summary.topSuggestions).toHaveLength(0);
  });

  it('counts sentiment correctly', () => {
    const results = [
      makePersonaResult({ sentiment: 'positive' }),
      makePersonaResult({ sentiment: 'positive' }),
      makePersonaResult({ sentiment: 'negative' }),
    ];
    const summary = aggregateResults(results);
    expect(summary.overallSentiment).toContain('positive');
  });

  it('reports negative when more negatives', () => {
    const results = [
      makePersonaResult({ sentiment: 'negative' }),
      makePersonaResult({ sentiment: 'negative' }),
      makePersonaResult({ sentiment: 'positive' }),
    ];
    const summary = aggregateResults(results);
    expect(summary.overallSentiment).toContain('negative');
  });

  it('ranks pain points by frequency', () => {
    const results = [
      makePersonaResult({ painPoints: ['slow install', 'confusing docs'] }),
      makePersonaResult({ painPoints: ['slow install', 'bad error messages'] }),
      makePersonaResult({ painPoints: ['slow install'] }),
    ];
    const summary = aggregateResults(results);
    expect(summary.topPainPoints[0]).toBe('slow install');
  });

  it('collects dropoffs', () => {
    const results = [
      makePersonaResult({ droppedAt: 'step 2' }),
      makePersonaResult({}),
      makePersonaResult({ droppedAt: 'step 5' }),
    ];
    const summary = aggregateResults(results);
    expect(summary.criticalDropoffs).toEqual(['step 2', 'step 5']);
  });

  it('limits pain points to 10', () => {
    const painPoints = Array.from({ length: 15 }, (_, i) => `pain ${i}`);
    const results = [makePersonaResult({ painPoints })];
    const summary = aggregateResults(results);
    expect(summary.topPainPoints.length).toBeLessThanOrEqual(10);
  });
});

describe('formatReport', () => {
  it('produces markdown with scenario title', () => {
    const result: SimulationResult = {
      scenario: 'onboarding',
      personas: [makePersonaResult({ persona: makePersona({ name: 'Alice' }) })],
      summary: {
        overallSentiment: 'Mostly positive',
        topPainPoints: ['confusing docs'],
        topSuggestions: ['add examples'],
        criticalDropoffs: [],
        featureRequests: ['dark mode'],
      },
    };
    const report = formatReport(result);
    expect(report).toContain('# Simulation Report: "onboarding"');
    expect(report).toContain('Mostly positive');
    expect(report).toContain('confusing docs');
    expect(report).toContain('add examples');
    expect(report).toContain('Alice');
    expect(report).toContain('dark mode');
  });

  it('uses sentiment icons for persona sections', () => {
    const result: SimulationResult = {
      scenario: 'test',
      personas: [
        makePersonaResult({ sentiment: 'positive', persona: makePersona({ name: 'Happy' }) }),
        makePersonaResult({ sentiment: 'negative', persona: makePersona({ name: 'Sad' }) }),
        makePersonaResult({ sentiment: 'neutral', persona: makePersona({ name: 'Meh' }) }),
      ],
      summary: { overallSentiment: 'Mixed', topPainPoints: [], topSuggestions: [], criticalDropoffs: [], featureRequests: [] },
    };
    const report = formatReport(result);
    expect(report).toContain('[+] Happy');
    expect(report).toContain('[-] Sad');
    expect(report).toContain('[~] Meh');
  });

  it('includes drop-off info when present', () => {
    const result: SimulationResult = {
      scenario: 'test',
      personas: [makePersonaResult({ droppedAt: 'installation step' })],
      summary: { overallSentiment: 'Negative', topPainPoints: [], topSuggestions: [], criticalDropoffs: ['installation step'], featureRequests: [] },
    };
    const report = formatReport(result);
    expect(report).toContain('installation step');
    expect(report).toContain('Critical Drop-off');
  });
});

describe('constants', () => {
  it('MAX_PERSONAS is 20', () => {
    expect(MAX_PERSONAS).toBe(20);
  });

  it('DEFAULT_TIMEOUT is 120 seconds', () => {
    expect(DEFAULT_TIMEOUT).toBe(120_000);
  });
});
