import type { Target, BuildResult, HardenPhase } from '../../types.js';
import type { Agent, AgentOptions } from './base.js';
import type { Provider, ProviderOptions } from '../providers/base.js';

export interface APIAgentConfig extends AgentOptions {
  provider: Provider;
  providerOptions?: ProviderOptions;
}

export class APIAgent implements Agent {
  private provider: Provider;
  private providerOptions: ProviderOptions;

  constructor(config: APIAgentConfig) {
    this.provider = config.provider;
    this.providerOptions = config.providerOptions ?? {};
  }

  async analyze(context: string, hardenPhase?: HardenPhase): Promise<string> {
    const prompt = hardenPhase === 'harden:tests'
      ? buildHardenAnalyzePrompt(context)
      : buildAnalyzePrompt(context);
    return this.provider.sendMessage(prompt, this.providerOptions);
  }

  async propose(analysis: string, target: Target, hardenPhase?: HardenPhase): Promise<string> {
    const prompt = hardenPhase === 'harden:tests'
      ? buildHardenProposePrompt(analysis, target)
      : buildProposePrompt(analysis, target);
    return this.provider.sendMessage(prompt, this.providerOptions);
  }

  async build(proposal: string, _cwd: string): Promise<BuildResult> {
    try {
      const output = await this.provider.sendMessage(
        buildBuildPrompt(proposal),
        this.providerOptions,
      );
      const filesModified = parseModifiedFiles(output);
      return { success: true, output, filesModified };
    } catch (err: unknown) {
      const error = err as Error;
      return { success: false, output: error.message ?? '', filesModified: [], error: error.message };
    }
  }
}

export function buildAnalyzePrompt(context: string): string {
  return (
    `You are a code improvement assistant. Analyze the following target and ` +
    `provide a concise analysis of what can be improved.\n\n` +
    `${context}\n\n` +
    `Focus on: code quality, error handling, performance, maintainability. ` +
    `Be specific and actionable. List the top 3 improvement opportunities.`
  );
}

export function buildProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a code improvement assistant. Based on the following analysis, ` +
    `propose ONE specific, focused improvement.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific change to make (one sentence)\n` +
    `2. Which file(s) to modify\n` +
    `3. The exact code change\n\n` +
    `Keep it minimal — one change, one commit.`
  );
}

export function buildHardenAnalyzePrompt(context: string): string {
  return (
    `You are a test-writing assistant. Analyze the following target and identify what test coverage is missing.\n\n` +
    `${context}\n\n` +
    `Focus on: untested functions, uncovered edge cases, missing error condition tests. ` +
    `Be specific and actionable. List the top 3 missing test scenarios.`
  );
}

export function buildHardenProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a test-writing assistant. Based on the following analysis, ` +
    `propose ONE specific set of tests to write.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific test(s) to write (one sentence)\n` +
    `2. Which test file to create or modify\n` +
    `3. The exact test code\n\n` +
    `Write comprehensive tests for the target code. Focus on correctness, not style.`
  );
}

function buildBuildPrompt(proposal: string): string {
  return (
    `You are a code improvement assistant. Implement the following proposed change.\n\n` +
    `${proposal}\n\n` +
    `Make ONLY the described change. Do not refactor unrelated code. ` +
    `After making the change, output the list of modified files in this format:\n` +
    `MODIFIED: <filepath>\n` +
    `(one line per file)`
  );
}

export function parseModifiedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^MODIFIED:\s*(.+)$/);
    if (match) files.push(match[1].trim());
  }
  return files;
}

export function createAPIAgent(config: APIAgentConfig): APIAgent {
  return new APIAgent(config);
}
