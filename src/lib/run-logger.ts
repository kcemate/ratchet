import { mkdir, appendFile } from 'fs/promises';
import { join } from 'path';

export type AuditEventType =
  | 'click_start'
  | 'click_end'
  | 'agent_prompt'
  | 'agent_response'
  | 'test_result'
  | 'rollback'
  | 'score_delta';

export interface AuditEvent {
  timestamp: string;
  event: AuditEventType;
  clickNumber: number;
  data: Record<string, unknown>;
}

/**
 * RunLogger writes structured JSONL audit events to .ratchet/runs/<runId>.jsonl.
 * Each line is a JSON object with: timestamp, event, clickNumber, data.
 */
export class RunLogger {
  private readonly filePath: string;
  private readonly dirReady: Promise<void>;

  constructor(runId: string, cwd: string) {
    const dir = join(cwd, '.ratchet', 'runs');
    this.filePath = join(dir, `${runId}.jsonl`);
    this.dirReady = mkdir(dir, { recursive: true }).then(() => undefined);
  }

  async log(
    event: AuditEventType,
    clickNumber: number,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.dirReady;
    const entry: AuditEvent = {
      timestamp: new Date().toISOString(),
      event,
      clickNumber,
      data,
    };
    await appendFile(this.filePath, JSON.stringify(entry) + '\n');
  }

  async logClickStart(clickNumber: number, data?: Record<string, unknown>): Promise<void> {
    return this.log('click_start', clickNumber, data);
  }

  async logClickEnd(
    clickNumber: number,
    data: { testsPassed: boolean; rolled_back: boolean; commitHash?: string },
  ): Promise<void> {
    return this.log('click_end', clickNumber, data);
  }

  async logAgentPrompt(clickNumber: number, prompt: string): Promise<void> {
    return this.log('agent_prompt', clickNumber, { prompt });
  }

  async logAgentResponse(clickNumber: number, response: string): Promise<void> {
    return this.log('agent_response', clickNumber, { response });
  }

  async logTestResult(
    clickNumber: number,
    data: { passed: boolean; gate: string; durationMs?: number; failedTests?: string[] },
  ): Promise<void> {
    return this.log('test_result', clickNumber, data);
  }

  async logRollback(clickNumber: number, reason: string): Promise<void> {
    return this.log('rollback', clickNumber, { reason });
  }

  async logScoreDelta(
    clickNumber: number,
    data: { before: number; after: number; delta: number },
  ): Promise<void> {
    return this.log('score_delta', clickNumber, data);
  }
}
