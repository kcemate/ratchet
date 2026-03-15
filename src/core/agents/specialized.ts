import { ShellAgent } from './shell.js';
import type { ShellAgentConfig } from './shell.js';

/**
 * Agent specialization — a focus area that shapes the system prompt
 * prefix injected into every Claude call.
 */
export type Specialization = 'security' | 'performance' | 'quality' | 'errors' | 'types';

export const ALL_SPECIALIZATIONS: readonly Specialization[] = [
  'security',
  'performance',
  'quality',
  'errors',
  'types',
] as const;

export const DEFAULT_SPECIALIZATIONS: readonly Specialization[] = [
  'security',
  'quality',
  'errors',
] as const;

const SPECIALIZATION_PROMPTS: Record<Specialization, string> = {
  security: [
    'You are a SECURITY-focused code improvement agent.',
    'Prioritize: authentication flaws, input validation gaps, injection vulnerabilities (SQL, XSS, command),',
    'secrets/credentials exposure, insecure defaults, missing authorization checks, and CSRF protection.',
    'Fix the most critical security issue you can find.',
  ].join(' '),

  performance: [
    'You are a PERFORMANCE-focused code improvement agent.',
    'Prioritize: inefficient async patterns, N+1 query problems, missing caching opportunities,',
    'unnecessary re-renders, memory leaks, blocking I/O on hot paths, and unoptimized data structures.',
    'Fix the most impactful performance issue you can find.',
  ].join(' '),

  quality: [
    'You are a CODE QUALITY-focused improvement agent.',
    'Prioritize: code duplication (DRY violations), overly long functions, poor readability,',
    'high cyclomatic complexity, unclear naming, dead code, and missing abstractions.',
    'Fix the most impactful quality issue you can find.',
  ].join(' '),

  errors: [
    'You are an ERROR HANDLING-focused code improvement agent.',
    'Prioritize: empty catch blocks, swallowed errors, missing error propagation,',
    'unstructured logging, missing try/catch around I/O, unhelpful error messages,',
    'and missing error boundaries or fallback behavior.',
    'Fix the most critical error handling issue you can find.',
  ].join(' '),

  types: [
    'You are a TYPE SAFETY-focused code improvement agent.',
    'Prioritize: usage of `any` types, missing type annotations, loose type assertions,',
    'missing strict null checks, untyped function parameters/returns, missing Zod/io-ts schemas',
    'at system boundaries, and implicit any from untyped dependencies.',
    'Fix the most impactful type safety issue you can find.',
  ].join(' '),
};

/**
 * A ShellAgent with a specialization prompt prefix that gets prepended
 * to all prompts sent to Claude. This steers the agent toward a specific
 * focus area without changing any execution mechanics.
 */
export class SpecializedAgent extends ShellAgent {
  readonly specialization: Specialization;

  constructor(specialization: Specialization, config: ShellAgentConfig = {}) {
    super(config);
    this.specialization = specialization;
  }

  /** Returns the specialization prompt prefix for this agent */
  get promptPrefix(): string {
    return SPECIALIZATION_PROMPTS[this.specialization];
  }

  override async analyze(
    context: string,
    hardenPhase?: import('../../types.js').HardenPhase,
    issues?: import('../issue-backlog.js').IssueTask[],
  ): Promise<string> {
    const prefixedContext = `${this.promptPrefix}\n\n${context}`;
    return super.analyze(prefixedContext, hardenPhase, issues);
  }
}

/**
 * Create a specialized agent for a given focus area.
 */
export function createSpecializedAgent(
  specialization: Specialization,
  config: ShellAgentConfig = {},
): SpecializedAgent {
  return new SpecializedAgent(specialization, config);
}

/**
 * Validate that a string is a valid specialization name.
 */
export function isValidSpecialization(value: string): value is Specialization {
  return ALL_SPECIALIZATIONS.includes(value as Specialization);
}
