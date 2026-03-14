import type { Target, BuildResult } from '../../types.js';
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

  async analyze(context: string): Promise<string> {
    return this.provider.sendMessage(buildAnalyzePrompt(context), this.providerOptions);
  }

  async propose(analysis: string, target: Target): Promise<string> {
    return this.provider.sendMessage(buildProposePrompt(analysis, target), this.providerOptions);
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

function buildAnalyzePrompt(context: string): string {
  return (
    `You are a code improvement assistant. Analyze the following target and provide a concise analysis of what can be improved.\n\n` +
    `${context}\n\n` +
    `Focus on: code quality, error handling, performance, maintainability. ` +
    `Be specific and actionable. List the top 3 improvement opportunities.`
  );
}

function buildProposePrompt(analysis: string, target: Target): string {
  return (
    `You are a code improvement assistant. Based on the following analysis, propose ONE specific, focused improvement.\n\n` +
    `Target path: ${target.path}\n` +
    `Analysis:\n${analysis}\n\n` +
    `Respond with:\n` +
    `1. The specific change to make (one sentence)\n` +
    `2. Which file(s) to modify\n` +
    `3. The exact code change\n\n` +
    `Keep it minimal — one change, one commit.`
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

function parseModifiedFiles(output: string): string[] {
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
