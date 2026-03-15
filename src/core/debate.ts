import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Philosophy types ─────────────────────────────────────────────────

export type Philosophy =
  | 'pragmatist'
  | 'purist'
  | 'security-first'
  | 'performance-first'
  | 'user-first'
  | 'minimalist';

export interface DebateAgent {
  name: string;
  philosophy: Philosophy;
  backstory: string;
  biases: string[];
}

export interface DebateConfig {
  topic: string;
  agents: number;
  rounds: number;
  cwd: string;
  model?: string;
  timeout?: number;
}

export interface DebateRound {
  roundNumber: number;
  arguments: DebateArgument[];
}

export interface DebateArgument {
  agent: DebateAgent;
  position: string;
  evidence: string[];
  counters: string[];
  confidence: number;
}

export interface DebateResult {
  topic: string;
  rounds: DebateRound[];
  synthesis: DebateSynthesis;
}

export interface DebateSynthesis {
  recommendation: string;
  reasoning: string;
  tradeoffs: string[];
  actionItems: string[];
  dissent: string[];
  consensus: number;
}

// ── Agent archetypes ─────────────────────────────────────────────────

const AGENT_ARCHETYPES: Record<Philosophy, DebateAgent> = {
  pragmatist: {
    name: 'Maya Okonkwo',
    philosophy: 'pragmatist',
    backstory:
      'Principal engineer at a late-stage startup that has survived two near-death pivots. ' +
      'Maya has shipped code in 9 languages across 14 years and has the scars to prove it. ' +
      'She once rewrote an entire microservice in a weekend because "the elegant solution would ' +
      'have taken three sprints and we had three days." She respects theory but worships results. ' +
      'She will change her mind mid-debate if someone presents better evidence — ego is a bug she patched out years ago.',
    biases: [
      'Favors shipping over perfection',
      'Prefers battle-tested boring tech over shiny new frameworks',
      'Values time-to-market above architectural purity',
      'Willing to take on measured tech debt with a payoff plan',
    ],
  },
  purist: {
    name: 'Professor Dietrich Kessler',
    philosophy: 'purist',
    backstory:
      'Former CS professor turned staff architect at a FAANG company. Dietrich has read the Gang of Four ' +
      'book cover-to-cover seven times and can recite SOLID principles in his sleep. He once blocked a PR ' +
      'for six weeks because the abstraction layers were "insufficiently decoupled." His code has never ' +
      'had a production bug — partly because it takes so long to ship that the bugs die of old age. ' +
      'He genuinely believes that most software failures trace back to a violated design principle.',
    biases: [
      'Cites design patterns and SOLID principles',
      'Favors abstraction and separation of concerns',
      'Prefers type safety and compile-time guarantees',
      'Suspicious of any shortcut or workaround',
    ],
  },
  'security-first': {
    name: 'Zara Al-Rashid',
    philosophy: 'security-first',
    backstory:
      'Ex-NSA red teamer turned CISO at a fintech unicorn. Zara has personally exploited ' +
      'vulnerabilities in systems that Fortune 500 companies swore were secure. She has a framed ' +
      'printout of the OWASP Top 10 above her desk and a tattoo of a padlock on her wrist. She ' +
      'assumes every system is already compromised and architects accordingly. She once vetoed a ' +
      'database choice because the default configuration shipped with auth disabled. "Defaults kill," ' +
      'she says, usually while staring directly into your soul.',
    biases: [
      'Assumes every input is an attack vector',
      'Favors defense-in-depth and zero-trust architectures',
      'Prefers established security standards over custom solutions',
      'Would rather over-engineer auth than ship fast',
    ],
  },
  'performance-first': {
    name: 'Kai Tanaka',
    philosophy: 'performance-first',
    backstory:
      'Systems engineer who spent 8 years at a high-frequency trading firm where every microsecond ' +
      'had a dollar value. Kai can estimate cache-line impacts in his head and has opinions about ' +
      'memory allocators that he will share whether or not you asked. He once profiled a Node.js ' +
      'application, found a 200ms GC pause in a hot path, and rewrote the module in Rust before lunch. ' +
      'He believes that "it\'s fast enough" is what people say right before their system falls over at 10x scale.',
    biases: [
      'Thinks about latency, throughput, and memory first',
      'Favors benchmarks over opinions',
      'Prefers compiled languages and zero-copy abstractions',
      'Skeptical of any layer of indirection without perf data',
    ],
  },
  'user-first': {
    name: 'Amara Obi',
    philosophy: 'user-first',
    backstory:
      'UX engineer and former product designer who can sketch a wireframe, write a React component, ' +
      'and conduct a usability study — all before standup. Amara has watched hundreds of hours of ' +
      'user testing sessions and has developed a sixth sense for "the moment the user\'s face falls." ' +
      'She believes that the best architecture is invisible to the user, and the worst architecture is ' +
      'the one that makes the loading spinner appear. She will fight for the user in every meeting, ' +
      'even when the user isn\'t in the room.',
    biases: [
      'Prioritizes UX, accessibility, and developer experience',
      'Favors progressive disclosure and sensible defaults',
      'Prefers solutions that reduce cognitive load',
      'Values fast perceived performance over raw throughput',
    ],
  },
  minimalist: {
    name: 'Rune Eriksen',
    philosophy: 'minimalist',
    backstory:
      'Independent consultant who has deleted more code than most people have written. Rune spent ' +
      '5 years maintaining a legacy monolith and learned that every line of code is a liability. ' +
      'He once reduced a 40-file microservice to a single 200-line script and the system ran faster, ' +
      'had fewer bugs, and was easier to understand. His favorite refactoring technique is "rm -rf". ' +
      'He believes YAGNI is not just a principle but a way of life, and he will ask "do we even need this?" ' +
      'about every feature, including the one being debated.',
    biases: [
      'Favors deletion over addition',
      'Prefers fewer dependencies and smaller surface area',
      'Suspicious of any feature that "might be needed later"',
      'Values simplicity and readability above all else',
    ],
  },
};

const ALL_PHILOSOPHIES: Philosophy[] = [
  'pragmatist',
  'purist',
  'security-first',
  'performance-first',
  'user-first',
  'minimalist',
];

// ── Helpers ──────────────────────────────────────────────────────────

export function getAgent(philosophy: Philosophy): DebateAgent {
  return AGENT_ARCHETYPES[philosophy];
}

export function getAllPhilosophies(): Philosophy[] {
  return [...ALL_PHILOSOPHIES];
}

/**
 * Select N debate agents, cycling through philosophies.
 */
export function selectAgents(count: number): DebateAgent[] {
  if (count <= 0) return [];
  const result: DebateAgent[] = [];
  for (let i = 0; i < count; i++) {
    const philosophy = ALL_PHILOSOPHIES[i % ALL_PHILOSOPHIES.length];
    const base = AGENT_ARCHETYPES[philosophy];
    const cycle = Math.floor(i / ALL_PHILOSOPHIES.length);
    result.push({
      ...base,
      name: cycle > 0 ? `${base.name} (#${cycle + 1})` : base.name,
    });
  }
  return result;
}

/** Read project context for debate prompts. */
function readProjectContext(cwd: string): string {
  const sections: string[] = [];

  for (const name of ['README.md', 'readme.md', 'README']) {
    try {
      const content = readFileSync(join(cwd, name), 'utf-8');
      sections.push(`## README\n\n${content.slice(0, 4000)}`);
      break;
    } catch {
      // skip
    }
  }

  try {
    const pkg = readFileSync(join(cwd, 'package.json'), 'utf-8');
    const parsed = JSON.parse(pkg) as Record<string, unknown>;
    const slim = {
      name: parsed['name'],
      description: parsed['description'],
      scripts: parsed['scripts'],
    };
    sections.push(`## package.json (excerpt)\n\n\`\`\`json\n${JSON.stringify(slim, null, 2)}\n\`\`\``);
  } catch {
    // skip
  }

  return sections.join('\n\n') || '(No project documentation found.)';
}

// ── Prompt builders ──────────────────────────────────────────────────

function buildRound1Prompt(
  agent: DebateAgent,
  topic: string,
  projectContext: string,
): string {
  return (
    `You are role-playing as a specific architect in a structured design debate.\n\n` +
    `## Your Identity\n` +
    `Name: ${agent.name}\n` +
    `Philosophy: ${agent.philosophy}\n` +
    `Background: ${agent.backstory}\n\n` +
    `## Your Biases\n` +
    agent.biases.map((b) => `- ${b}`).join('\n') + '\n\n' +
    `## Project Context\n` +
    `${projectContext}\n\n` +
    `## Design Topic\n` +
    `"${topic}"\n\n` +
    `## Instructions (Round 1: Opening Position)\n` +
    `State your position on this design question. Stay in character. Draw on your background and biases.\n` +
    `Be opinionated but substantive — give real technical reasons, not platitudes.\n\n` +
    `Respond in this EXACT JSON format (no markdown fences, just raw JSON):\n` +
    `{\n` +
    `  "position": "Your 2-4 paragraph argument for your preferred approach",\n` +
    `  "evidence": ["supporting point 1", "supporting point 2", ...],\n` +
    `  "counters": [],\n` +
    `  "confidence": 85\n` +
    `}`
  );
}

function buildRoundNPrompt(
  agent: DebateAgent,
  topic: string,
  roundNumber: number,
  totalRounds: number,
  previousRounds: DebateRound[],
): string {
  const prevSummary = previousRounds
    .map((round) => {
      const roundArgs = round.arguments
        .map((a) =>
          `### ${a.agent.name} (${a.agent.philosophy}) [confidence: ${a.confidence}%]\n` +
          `${a.position}\n` +
          `Evidence: ${a.evidence.join('; ')}\n` +
          (a.counters.length > 0 ? `Counters: ${a.counters.join('; ')}` : ''),
        )
        .join('\n\n');
      return `## Round ${round.roundNumber}\n\n${roundArgs}`;
    })
    .join('\n\n---\n\n');

  const isFinal = roundNumber === totalRounds;
  const roundInstructions = isFinal
    ? `This is the FINAL round. Give your closing argument. You MAY change your mind if ` +
      `someone made a compelling point. If you do, explain why. Be honest about the ` +
      `strengths of other positions.`
    : `Respond to the other architects' arguments. Challenge their weakest points. ` +
      `Strengthen your own position with new evidence. You may adjust your confidence ` +
      `based on what you've heard.`;

  return (
    `You are role-playing as a specific architect in a structured design debate.\n\n` +
    `## Your Identity\n` +
    `Name: ${agent.name}\n` +
    `Philosophy: ${agent.philosophy}\n` +
    `Background: ${agent.backstory}\n\n` +
    `## Your Biases\n` +
    agent.biases.map((b) => `- ${b}`).join('\n') + '\n\n' +
    `## Design Topic\n` +
    `"${topic}"\n\n` +
    `## Previous Rounds\n\n` +
    `${prevSummary}\n\n` +
    `## Instructions (Round ${roundNumber} of ${totalRounds})\n` +
    `${roundInstructions}\n\n` +
    `Respond in this EXACT JSON format (no markdown fences, just raw JSON):\n` +
    `{\n` +
    `  "position": "Your 2-4 paragraph argument (respond to specific points from others)",\n` +
    `  "evidence": ["supporting point 1", "supporting point 2", ...],\n` +
    `  "counters": ["rebuttal to Agent X: ...", "rebuttal to Agent Y: ..."],\n` +
    `  "confidence": 75\n` +
    `}`
  );
}

function buildSynthesisPrompt(topic: string, rounds: DebateRound[]): string {
  const transcript = rounds
    .map((round) => {
      const roundArgs = round.arguments
        .map((a) =>
          `### ${a.agent.name} (${a.agent.philosophy}) [confidence: ${a.confidence}%]\n` +
          `${a.position}\n` +
          `Evidence: ${a.evidence.join('; ')}\n` +
          (a.counters.length > 0 ? `Counters: ${a.counters.join('; ')}` : ''),
        )
        .join('\n\n');
      return `## Round ${round.roundNumber}\n\n${roundArgs}`;
    })
    .join('\n\n---\n\n');

  return (
    `You are a senior technical advisor synthesizing the results of a structured architecture debate.\n\n` +
    `## Design Topic\n` +
    `"${topic}"\n\n` +
    `## Full Debate Transcript\n\n` +
    `${transcript}\n\n` +
    `## Instructions\n` +
    `Analyze the full debate across all rounds. Consider:\n` +
    `- Which arguments were strongest and why\n` +
    `- Where did agents change their minds (or should have)?\n` +
    `- What tradeoffs are unavoidable?\n` +
    `- What is the best path forward for this specific project?\n\n` +
    `Respond in this EXACT JSON format (no markdown fences, just raw JSON):\n` +
    `{\n` +
    `  "recommendation": "The recommended approach in 2-4 paragraphs",\n` +
    `  "reasoning": "Why this approach won the debate — reference specific arguments",\n` +
    `  "tradeoffs": ["acknowledged downside 1", "acknowledged downside 2", ...],\n` +
    `  "actionItems": ["concrete next step 1", "concrete next step 2", ...],\n` +
    `  "dissent": ["minority opinion worth noting 1", ...],\n` +
    `  "consensus": 72\n` +
    `}`
  );
}

// ── Claude runner ────────────────────────────────────────────────────

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

// ── JSON parsing ─────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1);
  }

  return raw;
}

function parseArgumentResponse(raw: string, agent: DebateAgent): DebateArgument {
  try {
    const json = JSON.parse(extractJSON(raw)) as {
      position?: string;
      evidence?: string[];
      counters?: string[];
      confidence?: number;
    };

    return {
      agent,
      position: typeof json.position === 'string' ? json.position : '(no position stated)',
      evidence: Array.isArray(json.evidence) ? json.evidence.filter((e): e is string => typeof e === 'string') : [],
      counters: Array.isArray(json.counters) ? json.counters.filter((c): c is string => typeof c === 'string') : [],
      confidence: typeof json.confidence === 'number' ? Math.max(0, Math.min(100, json.confidence)) : 50,
    };
  } catch {
    return {
      agent,
      position: raw.slice(0, 2000),
      evidence: [],
      counters: [],
      confidence: 50,
    };
  }
}

function parseSynthesisResponse(raw: string): DebateSynthesis {
  try {
    const json = JSON.parse(extractJSON(raw)) as {
      recommendation?: string;
      reasoning?: string;
      tradeoffs?: string[];
      actionItems?: string[];
      dissent?: string[];
      consensus?: number;
    };
    return {
      recommendation: typeof json.recommendation === 'string' ? json.recommendation : 'No recommendation produced',
      reasoning: typeof json.reasoning === 'string' ? json.reasoning : '',
      tradeoffs: Array.isArray(json.tradeoffs) ? json.tradeoffs.filter((t): t is string => typeof t === 'string') : [],
      actionItems: Array.isArray(json.actionItems) ? json.actionItems.filter((a): a is string => typeof a === 'string') : [],
      dissent: Array.isArray(json.dissent) ? json.dissent.filter((d): d is string => typeof d === 'string') : [],
      consensus: typeof json.consensus === 'number' ? Math.max(0, Math.min(100, json.consensus)) : 50,
    };
  } catch {
    return {
      recommendation: 'Unable to synthesize — raw output could not be parsed',
      reasoning: '',
      tradeoffs: [],
      actionItems: [],
      dissent: [],
      consensus: 0,
    };
  }
}

// ── Local synthesis fallback ─────────────────────────────────────────

/**
 * Build a DebateSynthesis from rounds without calling an LLM.
 * Used as a fallback or for testing.
 */
export function aggregateDebate(rounds: DebateRound[]): DebateSynthesis {
  if (rounds.length === 0) {
    return {
      recommendation: 'No debate rounds to synthesize',
      reasoning: '',
      tradeoffs: [],
      actionItems: [],
      dissent: [],
      consensus: 0,
    };
  }

  // Find the agent with highest confidence in the final round
  const finalRound = rounds[rounds.length - 1];
  const sorted = [...finalRound.arguments].sort((a, b) => b.confidence - a.confidence);
  const winner = sorted[0];

  const avgConfidence = finalRound.arguments.reduce((sum, a) => sum + a.confidence, 0) / finalRound.arguments.length;

  const dissent = sorted
    .slice(1)
    .filter((a) => a.confidence > 60)
    .map((a) => `${a.agent.name} (${a.agent.philosophy}): ${a.position.slice(0, 200)}`);

  return {
    recommendation: winner ? winner.position : 'No clear winner',
    reasoning: winner ? `${winner.agent.name} (${winner.agent.philosophy}) had the highest confidence at ${winner.confidence}%` : '',
    tradeoffs: [],
    actionItems: [],
    dissent,
    consensus: Math.round(avgConfidence),
  };
}

// ── Validation ───────────────────────────────────────────────────────

export const MAX_AGENTS = 8;
export const MAX_ROUNDS = 5;
export const DEFAULT_TIMEOUT = 120_000;

export function validateDebateConfig(config: DebateConfig): string[] {
  const errors: string[] = [];
  if (!config.topic || config.topic.trim() === '') {
    errors.push('topic is required');
  }
  if (config.agents < 1) {
    errors.push('agents must be at least 1');
  }
  if (config.agents > MAX_AGENTS) {
    errors.push(`agents must be at most ${MAX_AGENTS}`);
  }
  if (config.rounds < 1) {
    errors.push('rounds must be at least 1');
  }
  if (config.rounds > MAX_ROUNDS) {
    errors.push(`rounds must be at most ${MAX_ROUNDS}`);
  }
  return errors;
}

// ── Debate Engine ────────────────────────────────────────────────────

export class DebateEngine {
  private config: DebateConfig;
  private timeout: number;

  constructor(config: DebateConfig) {
    const errors = validateDebateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid debate config: ${errors.join(', ')}`);
    }
    this.config = config;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async run(): Promise<DebateResult> {
    const { topic, agents: agentCount, rounds: roundCount, cwd, model } = this.config;

    const projectContext = readProjectContext(cwd);
    const agents = selectAgents(agentCount);
    const rounds: DebateRound[] = [];

    // Run each round sequentially (agents within a round run in parallel)
    for (let r = 1; r <= roundCount; r++) {
      const round = await this.runRound(r, roundCount, agents, topic, projectContext, rounds, model);
      rounds.push(round);
    }

    // Run synthesis
    let synthesis: DebateSynthesis;
    try {
      const synthesisPrompt = buildSynthesisPrompt(topic, rounds);
      const raw = await runClaude({ prompt: synthesisPrompt, model, timeout: this.timeout });
      synthesis = parseSynthesisResponse(raw);
    } catch {
      synthesis = aggregateDebate(rounds);
    }

    return { topic, rounds, synthesis };
  }

  private async runRound(
    roundNumber: number,
    totalRounds: number,
    agents: DebateAgent[],
    topic: string,
    projectContext: string,
    previousRounds: DebateRound[],
    model?: string,
  ): Promise<DebateRound> {
    const argumentPromises = agents.map(async (agent): Promise<DebateArgument> => {
      const prompt = roundNumber === 1
        ? buildRound1Prompt(agent, topic, projectContext)
        : buildRoundNPrompt(agent, topic, roundNumber, totalRounds, previousRounds);

      try {
        const raw = await runClaude({ prompt, model, timeout: this.timeout });
        return parseArgumentResponse(raw, agent);
      } catch (err) {
        return {
          agent,
          position: `(Agent error: ${err instanceof Error ? err.message : String(err)})`,
          evidence: [],
          counters: [],
          confidence: 0,
        };
      }
    });

    const args = await Promise.all(argumentPromises);
    return { roundNumber, arguments: args };
  }
}

// ── Report formatter ─────────────────────────────────────────────────

export function formatDebateReport(result: DebateResult): string {
  const lines: string[] = [];

  lines.push(`# Architecture Debate: "${result.topic}"`);
  lines.push('');
  lines.push(`**${result.rounds[0]?.arguments.length ?? 0} architects, ${result.rounds.length} rounds**`);
  lines.push('');

  // Synthesis
  lines.push('## Recommendation');
  lines.push('');
  lines.push(result.synthesis.recommendation);
  lines.push('');

  if (result.synthesis.reasoning) {
    lines.push('### Reasoning');
    lines.push('');
    lines.push(result.synthesis.reasoning);
    lines.push('');
  }

  if (result.synthesis.tradeoffs.length > 0) {
    lines.push('### Tradeoffs');
    for (const t of result.synthesis.tradeoffs) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }

  if (result.synthesis.actionItems.length > 0) {
    lines.push('### Action Items');
    for (const a of result.synthesis.actionItems) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }

  if (result.synthesis.dissent.length > 0) {
    lines.push('### Dissenting Opinions');
    for (const d of result.synthesis.dissent) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  lines.push(`**Consensus level:** ${result.synthesis.consensus}%`);
  lines.push('');

  // Full transcript
  lines.push('---');
  lines.push('');
  lines.push('## Debate Transcript');
  lines.push('');

  for (const round of result.rounds) {
    lines.push(`### Round ${round.roundNumber}`);
    lines.push('');

    for (const arg of round.arguments) {
      lines.push(`#### ${arg.agent.name} (${arg.agent.philosophy}) — confidence: ${arg.confidence}%`);
      lines.push('');
      lines.push(arg.position);
      lines.push('');

      if (arg.evidence.length > 0) {
        lines.push('**Evidence:**');
        for (const e of arg.evidence) {
          lines.push(`- ${e}`);
        }
        lines.push('');
      }

      if (arg.counters.length > 0) {
        lines.push('**Counterarguments:**');
        for (const c of arg.counters) {
          lines.push(`- ${c}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}
