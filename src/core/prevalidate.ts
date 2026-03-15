import { execFileSync } from 'child_process';
import { spawn } from 'child_process';

export interface PrevalidateResult {
  approved: boolean;
  confidence: number; // 0-1
  concerns: string[];
  recommendation: 'proceed' | 'escalate-swarm' | 'reject';
  /** Why prevalidate fell back to a default result (undefined when Claude reviewed normally) */
  reason?: string;
}

export interface PrevalidateOptions {
  /** When true, failures (timeout, parse error) reject instead of proceeding */
  strict?: boolean;
}

/**
 * Pre-commit validation agent.
 * Reads the current git diff (staged + unstaged) and sends it to Claude
 * for a confidence-scored review before running tests.
 *
 * On confidence < 0.5 → reject (saves test time by rolling back early)
 * On confidence 0.5–0.7 → escalate-swarm (needs more eyes)
 * On confidence > 0.7 → proceed
 */
export async function prevalidate(cwd: string, model?: string, options?: PrevalidateOptions): Promise<PrevalidateResult> {
  const strict = options?.strict ?? false;

  // 1. Collect the diff
  let diff: string;
  try {
    const staged = execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf8' });
    const unstaged = execFileSync('git', ['diff'], { cwd, encoding: 'utf8' });
    diff = [staged, unstaged].filter(Boolean).join('\n');
  } catch {
    // Can't get diff — this is an environment issue, not a review verdict
    const reason = 'git diff failed (git unavailable or not a repo)';
    if (strict) {
      return {
        approved: false,
        confidence: 0.3,
        concerns: [`prevalidate: ${reason}`],
        recommendation: 'reject',
        reason,
      };
    }
    return {
      approved: true,
      confidence: 0.8,
      concerns: [],
      recommendation: 'proceed',
      reason,
    };
  }

  if (!diff.trim()) {
    // No changes — nothing to validate, proceed
    return {
      approved: true,
      confidence: 1.0,
      concerns: [],
      recommendation: 'proceed',
    };
  }

  // Truncate very large diffs to avoid token limits
  const MAX_DIFF_CHARS = 12_000;
  const truncated = diff.length > MAX_DIFF_CHARS;
  const diffSnippet = truncated ? diff.slice(0, MAX_DIFF_CHARS) + '\n[... diff truncated ...]' : diff;

  const prompt = `You are a code review agent. Review this git diff for correctness, safety, and completeness.

DIFF:
${diffSnippet}

Respond ONLY with a JSON object in exactly this format (no markdown, no prose):
{
  "confidence": <number 0-1>,
  "concerns": [<string>, ...],
  "summary": "<one sentence>"
}

Rules:
- confidence = how confident you are that this change is correct and safe (0 = very bad, 1 = perfect)
- concerns = list of specific issues found (empty array if none)
- summary = brief one-line verdict

Be strict but fair. Focus on: correctness, broken logic, security issues, missing error handling, incomplete changes.`;

  try {
    const args: string[] = ['--print', '--permission-mode', 'bypassPermissions'];
    if (model) args.push('--model', model);
    args.push(prompt);

    const raw = await runClaude(args, cwd);
    return parseClaudeResponse(raw, diff, strict);
  } catch (err: unknown) {
    // Claude unavailable (timeout, crash, not installed) — environment failure
    const msg = err instanceof Error ? err.message : 'unknown error';
    const isTimeout = msg.includes('timed out');
    const reason = isTimeout ? 'Claude timed out' : `Claude call failed: ${msg}`;

    if (strict) {
      return {
        approved: false,
        confidence: 0.3,
        concerns: [`prevalidate: ${reason}`],
        recommendation: 'reject',
        reason,
      };
    }
    return {
      approved: true,
      confidence: 0.75,
      concerns: [`prevalidate: ${reason}, proceeding with caution`],
      recommendation: 'proceed',
      reason,
    };
  }
}

function runClaude(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('prevalidate: Claude timed out after 60s'));
    }, 60_000);

    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`prevalidate: Claude exited ${code}: ${err.slice(0, 200)}`));
      }
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function parseClaudeResponse(raw: string, _diff: string, strict: boolean = false): PrevalidateResult {
  // Extract JSON from Claude's output (may be wrapped in markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const reason = 'could not parse Claude response (no JSON found)';
    return fallbackResult(`prevalidate: ${reason}`, strict, reason);
  }

  let parsed: { confidence?: unknown; concerns?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    const reason = 'invalid JSON from Claude';
    return fallbackResult(`prevalidate: ${reason}`, strict, reason);
  }

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.75;

  const concerns: string[] = Array.isArray(parsed.concerns)
    ? parsed.concerns.filter((c): c is string => typeof c === 'string')
    : [];

  if (parsed.summary && typeof parsed.summary === 'string') {
    concerns.unshift(`Summary: ${parsed.summary}`);
  }

  const recommendation = getRecommendation(confidence);

  return {
    approved: recommendation !== 'reject',
    confidence,
    concerns,
    recommendation,
  };
}

function getRecommendation(confidence: number): PrevalidateResult['recommendation'] {
  if (confidence > 0.7) return 'proceed';
  if (confidence >= 0.5) return 'escalate-swarm';
  return 'reject';
}

function fallbackResult(concern: string, strict: boolean = false, reason?: string): PrevalidateResult {
  if (strict) {
    return {
      approved: false,
      confidence: 0.3,
      concerns: [concern],
      recommendation: 'reject',
      reason,
    };
  }
  return {
    approved: true,
    confidence: 0.75,
    concerns: [concern],
    recommendation: 'proceed',
    reason,
  };
}
