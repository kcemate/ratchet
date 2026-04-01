/**
 * Tests for the robust JSON extraction fallback chain in deep-parser.ts.
 *
 * Covers all 5 extraction strategies:
 *   1. Direct JSON (well-behaved models)
 *   2. Markdown code fences
 *   3. Bracket extraction from prose
 *   4. Individual JSON object extraction from reasoning text
 *   5. Graceful failure on unparseable text
 */

import { describe, it, expect } from 'vitest';
import { parseDeepFindings } from '../core/engines/deep-parser.js';

// ---------------------------------------------------------------------------
// Strategy 1: Direct valid JSON
// ---------------------------------------------------------------------------

describe('parseDeepFindings — direct JSON', () => {
  it('parses a clean JSON array', () => {
    const response = JSON.stringify([
      {
        ruleId: 'SEC-001',
        subcategory: 'Secrets & env vars',
        severity: 'high',
        file: 'config.ts',
        line: 10,
        message: 'Hardcoded API key',
        confidence: 0.9,
        suggestion: 'Use env var',
      },
    ]);
    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('SEC-001');
    expect(findings[0]!.source).toBe('deep');
  });

  it('returns empty array for "[]"', () => {
    expect(parseDeepFindings('[]', 'Security')).toHaveLength(0);
  });

  it('parses JSON with leading/trailing whitespace', () => {
    const response = `  \n  [{"subcategory": "Secrets & env vars", "severity": "high", "message": "test finding"}]  \n  `;
    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Strategy 2: Markdown code fences
// ---------------------------------------------------------------------------

describe('parseDeepFindings — markdown fences', () => {
  it('extracts from ```json fence', () => {
    const response = `Here is my analysis of the security issues:

\`\`\`json
[
  {
    "ruleId": "SEC-002",
    "subcategory": "Input validation",
    "severity": "critical",
    "file": "routes.ts",
    "line": 45,
    "message": "SQL injection via unvalidated user input",
    "confidence": 0.95,
    "suggestion": "Use parameterized queries"
  }
]
\`\`\`

These findings represent the most critical issues.`;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.subcategory).toBe('Input validation');
  });

  it('extracts from plain ``` fence (no json tag)', () => {
    const response = `Analysis complete:

\`\`\`
[{"subcategory": "Auth & rate limiting", "severity": "medium", "message": "Missing rate limit on login"}]
\`\`\``;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
  });

  it('picks the valid JSON fence when multiple fences exist', () => {
    const response = `Here's the code:

\`\`\`typescript
const secret = "sk-test-12345";
\`\`\`

And here are the findings:

\`\`\`json
[{"subcategory": "Secrets & env vars", "severity": "high", "message": "Hardcoded secret key"}]
\`\`\``;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('Hardcoded secret');
  });
});

// ---------------------------------------------------------------------------
// Strategy 3: Bracket extraction from prose
// ---------------------------------------------------------------------------

describe('parseDeepFindings — bracket extraction', () => {
  it('extracts JSON array embedded in prose', () => {
    const response = `After reviewing the code, I found the following issues: [{"subcategory": "Secrets & env vars", "severity": "high", "message": "API key in source"}] These should be fixed immediately.`;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
  });

  it('handles multi-line embedded array', () => {
    const response = `My analysis reveals:
[
  {"subcategory": "Input validation", "severity": "medium", "message": "Missing sanitization"},
  {"subcategory": "Auth & rate limiting", "severity": "high", "message": "No rate limit"}
]
Please review these findings carefully.`;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Strategy 4: Individual JSON objects from reasoning text (GLM-5 style)
// ---------------------------------------------------------------------------

describe('parseDeepFindings — individual object extraction', () => {
  it('extracts findings scattered in reasoning text', () => {
    const response = `Let me analyze this code step by step.

Looking at routes.ts line 45, I see a security issue:
{"ruleId": "SEC-002", "subcategory": "Input validation", "severity": "critical", "file": "routes.ts", "line": 45, "message": "User input passed directly to SQL query", "confidence": 0.9, "suggestion": "Use parameterized query"}

And in auth.ts line 12:
{"ruleId": "SEC-001", "subcategory": "Secrets & env vars", "severity": "high", "file": "auth.ts", "line": 12, "message": "Hardcoded JWT secret", "confidence": 0.95, "suggestion": "Move to env var"}

Overall the security posture needs improvement.`;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(2);
    expect(findings[0]!.file).toBe('routes.ts');
    expect(findings[1]!.file).toBe('auth.ts');
  });

  it('ignores non-finding JSON objects in prose', () => {
    const response = `The config looks like {"port": 3000, "host": "localhost"} which is fine.

But this is a real issue:
{"subcategory": "Secrets & env vars", "severity": "high", "message": "Secret in config"}

And {"name": "test"} is just metadata.`;

    const findings = parseDeepFindings(response, 'Security');
    // Only the finding-like object (with message) should be extracted
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('Secret in config');
  });

  it('handles GLM-5 style output with code blocks and reasoning', () => {
    const response = `typescript
if (!sessionSecret && process.env.NODE_ENV === "production") {
  logger.warn("[AUTH] WARNING: SESSION_SECRET is not set in production — using insecure default");
}
return session({
  secret: sessionSecret || 'local-dev-secret'

The issue here is that a hardcoded fallback secret is used when the environment variable is missing.

{"ruleId": "SEC-001", "subcategory": "Secrets & env vars", "severity": "high", "file": "server/index.ts", "line": 74, "message": "Hardcoded session secret fallback", "confidence": 0.95, "suggestion": "Throw error in production if SESSION_SECRET is not set"}`;

    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('session secret');
  });
});

// ---------------------------------------------------------------------------
// Strategy 5: Graceful failure
// ---------------------------------------------------------------------------

describe('parseDeepFindings — graceful failure', () => {
  it('returns empty array for pure prose with no JSON', () => {
    const response = `I've reviewed all the files and found no security issues. The code uses parameterized queries, proper auth middleware, and environment variables for all secrets.`;
    const findings = parseDeepFindings(response, 'Security');
    expect(findings).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    expect(parseDeepFindings('', 'Security')).toHaveLength(0);
  });

  it('returns empty array for just code with no findings', () => {
    const response = `typescript
const app = express();
app.use(helmet());
app.use(cors());`;
    expect(parseDeepFindings(response, 'Security')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Validation edge cases
// ---------------------------------------------------------------------------

describe('parseDeepFindings — validation', () => {
  it('skips findings without message', () => {
    const response = JSON.stringify([
      { subcategory: 'Testing', severity: 'high' }, // no message
      { subcategory: 'Testing', severity: 'medium', message: 'Valid finding' },
    ]);
    const findings = parseDeepFindings(response, 'Testing');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe('Valid finding');
  });

  it('skips findings without subcategory', () => {
    const response = JSON.stringify([
      { message: 'Has message but no subcategory', severity: 'high' },
      { subcategory: 'Coverage', message: 'Valid', severity: 'low' },
    ]);
    const findings = parseDeepFindings(response, 'Testing');
    expect(findings).toHaveLength(1);
  });

  it('defaults severity to medium for invalid values', () => {
    const response = JSON.stringify([
      { subcategory: 'Coverage', message: 'Test', severity: 'extreme' },
    ]);
    const findings = parseDeepFindings(response, 'Testing');
    expect(findings[0]!.severity).toBe('medium');
  });

  it('parses line numbers from strings', () => {
    const response = JSON.stringify([
      { subcategory: 'Coverage', message: 'Test', line: '42' },
    ]);
    const findings = parseDeepFindings(response, 'Testing');
    expect(findings[0]!.line).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Provider integration smoke test
// ---------------------------------------------------------------------------

describe('provider → engine pipeline', () => {
  it('detectProvider resolves for each env var combo', async () => {
    const { detectProvider } = await import('../core/providers/index.js');

    // Save and clear env
    const saved = { ...process.env };

    // Anthropic
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    delete process.env['RATCHET_PROVIDER'];
    delete process.env['RATCHET_SI_KEY'];
    delete process.env['OLLAMA_CLOUD_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    const p1 = detectProvider();
    expect(p1.name).toBe('Anthropic');

    // Ollama Cloud
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['OLLAMA_CLOUD_API_KEY'] = 'test-key';
    const p2 = detectProvider();
    expect(p2.name).toBe('OllamaCloud');

    // Restore env
    Object.assign(process.env, saved);
  });

  it('createEngine("deep") with provider does not throw', async () => {
    const { createEngine } = await import('../core/engine-router.js');
    // With RATCHET_PROVIDER but no real API key, it should still construct
    const saved = process.env['RATCHET_PROVIDER'];
    const savedKey = process.env['OLLAMA_CLOUD_API_KEY'];
    process.env['RATCHET_PROVIDER'] = 'ollama-cloud';
    process.env['OLLAMA_CLOUD_API_KEY'] = 'test-key';

    const engine = createEngine('deep');
    expect(engine.name).toBe('DeepEngine');
    expect(engine.mode).toBe('deep');

    process.env['RATCHET_PROVIDER'] = saved;
    process.env['OLLAMA_CLOUD_API_KEY'] = savedKey;
  });
});
