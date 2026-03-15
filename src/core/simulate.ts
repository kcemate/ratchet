import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Persona types ──────────────────────────────────────────────────────

export type PersonaType =
  | 'power-user'
  | 'casual'
  | 'new-user'
  | 'mobile'
  | 'accessibility'
  | 'api-developer';

export interface Persona {
  type: PersonaType;
  name: string;
  description: string;
  goals: string[];
  painPoints: string[];
  technicalLevel: 'low' | 'medium' | 'high';
}

// ── Simulation config & results ────────────────────────────────────────

export interface SimulationConfig {
  personas: number;
  scenario: string;
  targetUrl?: string;
  cwd: string;
  model?: string;
  timeout?: number;
}

export interface SimulationResult {
  scenario: string;
  personas: PersonaSimResult[];
  summary: SimulationSummary;
}

export interface PersonaSimResult {
  persona: Persona;
  journey: string;
  painPoints: string[];
  droppedAt?: string;
  suggestions: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface SimulationSummary {
  overallSentiment: string;
  topPainPoints: string[];
  topSuggestions: string[];
  criticalDropoffs: string[];
  featureRequests: string[];
}

// ── Built-in persona archetypes ────────────────────────────────────────

const PERSONA_ARCHETYPES: Record<PersonaType, Persona> = {
  'power-user': {
    type: 'power-user',
    name: 'Priya Kapoor',
    description:
      'Staff engineer at a Series C startup. Has 12 years of experience, maintains 3 OSS projects, ' +
      'and types 140 WPM. She reads changelogs before updating and has strong opinions about CLI ergonomics. ' +
      'She will find every edge case and file an issue for each one.',
    goals: [
      'Integrate the tool into existing CI/CD pipelines',
      'Automate repetitive workflows end-to-end',
      'Customize every setting to match team conventions',
    ],
    painPoints: [
      'Verbose output that cannot be silenced',
      'Missing machine-readable output formats (JSON, NDJSON)',
      'Poor composability with other CLI tools (pipes, exit codes)',
      'Undocumented behavior or inconsistent flag naming',
    ],
    technicalLevel: 'high',
  },
  casual: {
    type: 'casual',
    name: 'Marcus Chen',
    description:
      'Mid-level frontend dev who heard about the tool on a podcast. He has 30 minutes to try it out ' +
      'before his next standup. He skims READMEs, copies examples, and moves on if something doesn\'t ' +
      'click within two tries. Appreciates good defaults and clear error messages.',
    goals: [
      'Get a quick win to show the team',
      'Understand what the tool does in under 5 minutes',
      'Run a basic workflow without reading full docs',
    ],
    painPoints: [
      'Too many required flags or config before first use',
      'Error messages that assume deep domain knowledge',
      'No examples in help text or README',
      'Unclear what just happened after a command runs',
    ],
    technicalLevel: 'medium',
  },
  'new-user': {
    type: 'new-user',
    name: 'Sofia Rodriguez',
    description:
      'Junior developer, 6 months into her first job. She\'s comfortable with git basics and npm install ' +
      'but panics at stack traces. She follows tutorials step-by-step and needs encouragement that ' +
      'she\'s on the right track. Typos in commands are common.',
    goals: [
      'Install the tool without breaking anything',
      'Complete the getting-started tutorial successfully',
      'Understand what each command does before running it',
    ],
    painPoints: [
      'Jargon-heavy docs with no glossary',
      'Destructive operations without confirmation prompts',
      'Silent failures that leave her unsure if it worked',
      'No undo or recovery path when something goes wrong',
    ],
    technicalLevel: 'low',
  },
  mobile: {
    type: 'mobile',
    name: 'Jamal Washington',
    description:
      'DevOps engineer who triages issues from his phone during on-call rotations. He SSH\'s into ' +
      'servers from a tablet with a cramped terminal. Bandwidth is sometimes limited. He needs output ' +
      'that fits in 80 columns and commands he can type without autocomplete.',
    goals: [
      'Quickly check status and recent activity',
      'Trigger a run remotely without complex flag combinations',
      'Read output on a small screen without horizontal scrolling',
    ],
    painPoints: [
      'Wide tables that overflow terminal width',
      'Interactive prompts that don\'t work over SSH',
      'Commands that require a graphical browser',
      'Long-running commands with no progress indication',
    ],
    technicalLevel: 'high',
  },
  accessibility: {
    type: 'accessibility',
    name: 'Dr. Elena Vasquez',
    description:
      'Backend architect who is legally blind and uses a screen reader (NVDA) with a braille display. ' +
      'She has 20 years of experience and an encyclopedic knowledge of POSIX. She will find every ' +
      'accessibility gap and knows exactly how to fix it.',
    goals: [
      'Use every feature with a screen reader',
      'Navigate output without relying on color alone',
      'Understand progress and status through text, not spinners',
    ],
    painPoints: [
      'Information conveyed only through color or emoji',
      'Animated spinners that flood screen reader buffers',
      'Missing alt text or descriptions for visual elements',
      'Output that relies on spatial layout rather than structure',
    ],
    technicalLevel: 'high',
  },
  'api-developer': {
    type: 'api-developer',
    name: 'Tom Kowalski',
    description:
      'Full-stack developer building a SaaS dashboard. He wants to integrate the tool programmatically ' +
      'and cares about API contracts, versioning, and error codes. He reads source code when docs are ' +
      'unclear and has been burned by breaking changes in minor versions before.',
    goals: [
      'Call the tool programmatically from a Node.js script',
      'Parse structured output (JSON) reliably',
      'Handle errors gracefully with predictable exit codes',
    ],
    painPoints: [
      'No programmatic API — CLI-only interface',
      'Exit codes that don\'t distinguish error types',
      'Output format changes without semver bump',
      'Rate limiting or auth with no clear error message',
    ],
    technicalLevel: 'high',
  },
};

const ALL_PERSONA_TYPES: PersonaType[] = [
  'power-user',
  'casual',
  'new-user',
  'mobile',
  'accessibility',
  'api-developer',
];

// ── Scenario descriptions ──────────────────────────────────────────────

const SCENARIOS: Record<string, string> = {
  onboarding:
    'First-time setup: discovering the tool, installing it, reading docs, ' +
    'running the first command, and evaluating whether to keep using it.',
  'daily-use':
    'Routine daily usage: running common workflows, checking status, ' +
    'integrating with existing development habits, and handling edge cases.',
  'premium-upgrade':
    'Evaluating whether to upgrade to a paid tier or recommend the tool to ' +
    'the team: assessing advanced features, limits of the free tier, and ROI.',
};

// ── Helpers ────────────────────────────────────────────────────────────

export function getPersona(type: PersonaType): Persona {
  return PERSONA_ARCHETYPES[type];
}

export function getAllPersonaTypes(): PersonaType[] {
  return [...ALL_PERSONA_TYPES];
}

export function getScenarioDescription(scenario: string): string | undefined {
  return SCENARIOS[scenario];
}

export function getAvailableScenarios(): string[] {
  return Object.keys(SCENARIOS);
}

/**
 * Select N personas, cycling through archetypes.
 * If N <= 6, pick the first N distinct types.
 * If N > 6, cycle and append a numeric suffix to names.
 */
export function selectPersonas(count: number): Persona[] {
  if (count <= 0) return [];
  const result: Persona[] = [];
  for (let i = 0; i < count; i++) {
    const type = ALL_PERSONA_TYPES[i % ALL_PERSONA_TYPES.length];
    const base = PERSONA_ARCHETYPES[type];
    const cycle = Math.floor(i / ALL_PERSONA_TYPES.length);
    result.push({
      ...base,
      name: cycle > 0 ? `${base.name} (#${cycle + 1})` : base.name,
    });
  }
  return result;
}

/** Read project context (README, package.json) for persona prompts. */
function readProjectContext(cwd: string): string {
  const sections: string[] = [];

  // README
  for (const name of ['README.md', 'readme.md', 'README']) {
    try {
      const content = readFileSync(join(cwd, name), 'utf-8');
      sections.push(`## README\n\n${content.slice(0, 4000)}`);
      break;
    } catch {
      // skip
    }
  }

  // package.json
  try {
    const pkg = readFileSync(join(cwd, 'package.json'), 'utf-8');
    const parsed = JSON.parse(pkg) as Record<string, unknown>;
    const slim = {
      name: parsed['name'],
      description: parsed['description'],
      scripts: parsed['scripts'],
      bin: parsed['bin'],
    };
    sections.push(`## package.json (excerpt)\n\n\`\`\`json\n${JSON.stringify(slim, null, 2)}\n\`\`\``);
  } catch {
    // skip
  }

  return sections.join('\n\n') || '(No project documentation found.)';
}

// ── Prompt builders ────────────────────────────────────────────────────

function buildPersonaPrompt(
  persona: Persona,
  scenario: string,
  scenarioDesc: string,
  projectContext: string,
  targetUrl?: string,
): string {
  const urlNote = targetUrl
    ? `\nThe product has a running instance at: ${targetUrl}\nYou may reference API endpoints or pages you would try to visit.`
    : '';

  return (
    `You are role-playing as a specific user persona to help evaluate a software product.\n\n` +
    `## Your Identity\n` +
    `Name: ${persona.name}\n` +
    `Type: ${persona.type}\n` +
    `Technical level: ${persona.technicalLevel}\n` +
    `Background: ${persona.description}\n\n` +
    `## Your Goals\n` +
    persona.goals.map((g) => `- ${g}`).join('\n') + '\n\n' +
    `## Things That Frustrate You\n` +
    persona.painPoints.map((p) => `- ${p}`).join('\n') + '\n\n' +
    `## Scenario: "${scenario}"\n` +
    `${scenarioDesc}\n${urlNote}\n\n` +
    `## Product Context\n` +
    `${projectContext}\n\n` +
    `## Instructions\n` +
    `Walk through this scenario AS this person. Stay in character. Think about:\n` +
    `1. What would you try first?\n` +
    `2. Where would you get confused or frustrated?\n` +
    `3. Would you give up at any point? If so, where and why?\n` +
    `4. What would make the experience better?\n\n` +
    `Respond in this EXACT JSON format (no markdown fences, just raw JSON):\n` +
    `{\n` +
    `  "journey": "A 3-5 paragraph narrative of your experience, written in first person as ${persona.name}.",\n` +
    `  "painPoints": ["specific issue 1", "specific issue 2", ...],\n` +
    `  "droppedAt": "step where you gave up (or null if you completed the flow)",\n` +
    `  "suggestions": ["concrete UX improvement 1", "concrete UX improvement 2", ...],\n` +
    `  "sentiment": "positive" | "neutral" | "negative"\n` +
    `}`
  );
}

function buildSynthesisPrompt(results: PersonaSimResult[]): string {
  const summaries = results.map((r) => {
    const dropped = r.droppedAt ? ` DROPPED AT: ${r.droppedAt}` : ' (completed flow)';
    return (
      `### ${r.persona.name} (${r.persona.type}, ${r.persona.technicalLevel} technical level)\n` +
      `Sentiment: ${r.sentiment}${dropped}\n` +
      `Pain points: ${r.painPoints.join('; ')}\n` +
      `Suggestions: ${r.suggestions.join('; ')}`
    );
  });

  return (
    `You are a UX researcher synthesizing findings from ${results.length} user simulation sessions.\n\n` +
    `## Individual Results\n\n` +
    summaries.join('\n\n') + '\n\n' +
    `## Instructions\n` +
    `Analyze the patterns across all personas and produce a synthesis report.\n\n` +
    `Respond in this EXACT JSON format (no markdown fences, just raw JSON):\n` +
    `{\n` +
    `  "overallSentiment": "A one-sentence summary of how users felt overall",\n` +
    `  "topPainPoints": ["ranked by how many personas mentioned it, most common first"],\n` +
    `  "topSuggestions": ["ranked by frequency and impact"],\n` +
    `  "criticalDropoffs": ["steps where personas abandoned the flow"],\n` +
    `  "featureRequests": ["features multiple personas wished existed"]\n` +
    `}`
  );
}

// ── Claude runner ──────────────────────────────────────────────────────

interface ClaudeRunOptions {
  prompt: string;
  model?: string;
  timeout: number;
}

function runClaude(options: ClaudeRunOptions): Promise<string> {
  const args = ['--print', '--permission-mode', 'bypassPermissions'];
  if (options.model) {
    args.push('--model', options.model);
  }
  args.push(options.prompt);

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeout);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(
          'claude CLI not found. Install it: npm install -g @anthropic-ai/claude-code',
        ));
      } else {
        reject(err);
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Claude call timed out after ${Math.round(options.timeout / 1000)}s`));
        return;
      }
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (code === 0 || output) {
        resolve(output);
      } else {
        reject(new Error(`claude exited with code ${code}`));
      }
    });
  });
}

// ── JSON parsing ───────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  // Try to find JSON in the response (may be wrapped in markdown fences)
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find a raw JSON object
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }

  return raw;
}

function parsePersonaResponse(raw: string, persona: Persona): PersonaSimResult {
  try {
    const json = JSON.parse(extractJSON(raw)) as {
      journey?: string;
      painPoints?: string[];
      droppedAt?: string | null;
      suggestions?: string[];
      sentiment?: string;
    };

    const validSentiments = ['positive', 'neutral', 'negative'] as const;
    const sentiment = validSentiments.includes(json.sentiment as typeof validSentiments[number])
      ? (json.sentiment as PersonaSimResult['sentiment'])
      : 'neutral';

    return {
      persona,
      journey: typeof json.journey === 'string' ? json.journey : '(no journey narrative)',
      painPoints: Array.isArray(json.painPoints) ? json.painPoints.filter((p): p is string => typeof p === 'string') : [],
      droppedAt: typeof json.droppedAt === 'string' ? json.droppedAt : undefined,
      suggestions: Array.isArray(json.suggestions) ? json.suggestions.filter((s): s is string => typeof s === 'string') : [],
      sentiment,
    };
  } catch {
    // Fallback: treat raw text as the journey
    return {
      persona,
      journey: raw.slice(0, 2000),
      painPoints: [],
      suggestions: [],
      sentiment: 'neutral',
    };
  }
}

function parseSynthesisResponse(raw: string): SimulationSummary {
  try {
    const json = JSON.parse(extractJSON(raw)) as {
      overallSentiment?: string;
      topPainPoints?: string[];
      topSuggestions?: string[];
      criticalDropoffs?: string[];
      featureRequests?: string[];
    };
    return {
      overallSentiment: typeof json.overallSentiment === 'string' ? json.overallSentiment : 'Mixed sentiment',
      topPainPoints: Array.isArray(json.topPainPoints) ? json.topPainPoints.filter((p): p is string => typeof p === 'string') : [],
      topSuggestions: Array.isArray(json.topSuggestions) ? json.topSuggestions.filter((s): s is string => typeof s === 'string') : [],
      criticalDropoffs: Array.isArray(json.criticalDropoffs) ? json.criticalDropoffs.filter((d): d is string => typeof d === 'string') : [],
      featureRequests: Array.isArray(json.featureRequests) ? json.featureRequests.filter((f): f is string => typeof f === 'string') : [],
    };
  } catch {
    return {
      overallSentiment: 'Unable to synthesize — raw output could not be parsed',
      topPainPoints: [],
      topSuggestions: [],
      criticalDropoffs: [],
      featureRequests: [],
    };
  }
}

// ── Local aggregation (no LLM) ─────────────────────────────────────────

/**
 * Build a SimulationSummary from persona results without calling an LLM.
 * Used as a fallback or for testing.
 */
export function aggregateResults(results: PersonaSimResult[]): SimulationSummary {
  // Count frequency of pain points and suggestions
  const painFreq = new Map<string, number>();
  const suggFreq = new Map<string, number>();
  const dropoffs: string[] = [];
  const sentiments = { positive: 0, neutral: 0, negative: 0 };

  for (const r of results) {
    sentiments[r.sentiment]++;
    if (r.droppedAt) dropoffs.push(r.droppedAt);
    for (const p of r.painPoints) {
      painFreq.set(p, (painFreq.get(p) ?? 0) + 1);
    }
    for (const s of r.suggestions) {
      suggFreq.set(s, (suggFreq.get(s) ?? 0) + 1);
    }
  }

  const sortByFreq = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const dominant =
    sentiments.negative > sentiments.positive
      ? 'Mostly negative'
      : sentiments.positive > sentiments.negative
        ? 'Mostly positive'
        : 'Mixed';

  return {
    overallSentiment: `${dominant} (${sentiments.positive} positive, ${sentiments.neutral} neutral, ${sentiments.negative} negative)`,
    topPainPoints: sortByFreq(painFreq).slice(0, 10),
    topSuggestions: sortByFreq(suggFreq).slice(0, 10),
    criticalDropoffs: dropoffs,
    featureRequests: [],
  };
}

// ── Simulation Engine ──────────────────────────────────────────────────

export const MAX_PERSONAS = 20;
export const DEFAULT_TIMEOUT = 120_000; // 2 minutes per persona call

export function validateConfig(config: SimulationConfig): string[] {
  const errors: string[] = [];
  if (config.personas < 1) {
    errors.push('personas must be at least 1');
  }
  if (config.personas > MAX_PERSONAS) {
    errors.push(`personas must be at most ${MAX_PERSONAS}`);
  }
  if (!config.scenario || config.scenario.trim() === '') {
    errors.push('scenario is required');
  }
  if (config.targetUrl && !/^https?:\/\/.+/.test(config.targetUrl)) {
    errors.push('targetUrl must be a valid HTTP(S) URL');
  }
  return errors;
}

export class SimulationEngine {
  private config: SimulationConfig;
  private timeout: number;

  constructor(config: SimulationConfig) {
    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid simulation config: ${errors.join(', ')}`);
    }
    this.config = config;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async run(): Promise<SimulationResult> {
    const { scenario, personas: count, targetUrl, cwd, model } = this.config;

    const scenarioDesc =
      getScenarioDescription(scenario) ??
      `Custom scenario: "${scenario}" — simulate realistic user behavior for this flow.`;

    const projectContext = readProjectContext(cwd);
    const personas = selectPersonas(count);

    // Run all persona agents in parallel
    const personaPromises = personas.map(async (persona): Promise<PersonaSimResult> => {
      const prompt = buildPersonaPrompt(persona, scenario, scenarioDesc, projectContext, targetUrl);
      try {
        const raw = await runClaude({ prompt, model, timeout: this.timeout });
        return parsePersonaResponse(raw, persona);
      } catch (err) {
        return {
          persona,
          journey: `(Agent error: ${err instanceof Error ? err.message : String(err)})`,
          painPoints: [],
          suggestions: [],
          sentiment: 'neutral',
        };
      }
    });

    const personaResults = await Promise.all(personaPromises);

    // Run synthesis agent
    let summary: SimulationSummary;
    try {
      const synthesisPrompt = buildSynthesisPrompt(personaResults);
      const raw = await runClaude({ prompt: synthesisPrompt, model, timeout: this.timeout });
      summary = parseSynthesisResponse(raw);
    } catch {
      // Fallback to local aggregation
      summary = aggregateResults(personaResults);
    }

    return {
      scenario,
      personas: personaResults,
      summary,
    };
  }
}

// ── Report formatter ───────────────────────────────────────────────────

export function formatReport(result: SimulationResult): string {
  const lines: string[] = [];

  lines.push(`# Simulation Report: "${result.scenario}"`);
  lines.push('');
  lines.push(`**${result.personas.length} personas simulated**`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`**Overall sentiment:** ${result.summary.overallSentiment}`);
  lines.push('');

  if (result.summary.topPainPoints.length > 0) {
    lines.push('### Top Pain Points');
    for (const p of result.summary.topPainPoints) {
      lines.push(`- ${p}`);
    }
    lines.push('');
  }

  if (result.summary.criticalDropoffs.length > 0) {
    lines.push('### Critical Drop-off Points');
    for (const d of result.summary.criticalDropoffs) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (result.summary.topSuggestions.length > 0) {
    lines.push('### Top Suggestions');
    for (const s of result.summary.topSuggestions) {
      lines.push(`- ${s}`);
    }
    lines.push('');
  }

  if (result.summary.featureRequests.length > 0) {
    lines.push('### Feature Requests');
    for (const f of result.summary.featureRequests) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  // Individual journeys
  lines.push('---');
  lines.push('');
  lines.push('## Individual Persona Journeys');
  lines.push('');

  for (const r of result.personas) {
    const icon = r.sentiment === 'positive' ? '+' : r.sentiment === 'negative' ? '-' : '~';
    lines.push(`### [${icon}] ${r.persona.name} (${r.persona.type})`);
    lines.push('');
    lines.push(`> ${r.persona.description.slice(0, 200)}`);
    lines.push('');
    lines.push(r.journey);
    lines.push('');

    if (r.droppedAt) {
      lines.push(`**Dropped at:** ${r.droppedAt}`);
      lines.push('');
    }

    if (r.painPoints.length > 0) {
      lines.push('**Pain points:**');
      for (const p of r.painPoints) {
        lines.push(`- ${p}`);
      }
      lines.push('');
    }

    if (r.suggestions.length > 0) {
      lines.push('**Suggestions:**');
      for (const s of r.suggestions) {
        lines.push(`- ${s}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
