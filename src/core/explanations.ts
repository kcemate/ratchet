/**
 * "Why This?" Explanations
 *
 * Human-readable explanations for each subcategory scanned by Ratchet.
 * Used when --explain is passed to the scan command.
 */

export interface Explanation {
  /** Why this issue matters — 1-2 sentences */
  why: string;
  /** How to fix it — 1-2 sentences */
  fix: string;
  /** Optional short code snippet showing the fix */
  example?: string;
}

export const EXPLANATIONS: Record<string, Explanation> = {
  'Coverage ratio': {
    why: 'Code without tests is a liability — bugs go undetected and refactoring becomes dangerous.',
    fix: 'Add unit/integration tests for each source file. Aim for test files to exist alongside source files.',
    example: `// If you have src/user.ts, add src/user.test.ts
import { describe, it, expect } from 'vitest';
import { getUser } from '../src/user';

describe('getUser', () => {
  it('returns user by id', async () => {
    const user = await getUser(1);
    expect(user).toBeDefined();
  });
});`,
  },

  'Edge case depth': {
    why: 'Happy-path tests miss boundary conditions, null inputs, and error scenarios that cause production outages.',
    fix: 'Write tests for error, invalid, empty, null, undefined, and boundary values.',
    example: `it('handles null user', async () => {
  await expect(getUser(null)).rejects.toThrow('Invalid user ID');
});
it('handles empty array', () => {
  expect(filterUsers([])).toEqual([]);
});`,
  },

  'Test quality': {
    why: 'Tests without assertions are noise — they pass but verify nothing.',
    fix: 'Ensure every test has meaningful assertions (expect/assert calls). Use descriptive test names.',
    example: `// Good: specific assertions
it('returns 400 when email is missing', async () => {
  const res = await api.post('/users', {});
  expect(res.status).toBe(400);
  expect(res.body.error).toContain('email required');
});`,
  },

  'Secrets & env vars': {
    why: 'Hardcoded secrets (API keys, passwords, tokens) leak via version control and are a primary attack vector.',
    fix: 'Use environment variables and never commit secrets. Add sensitive files to .gitignore.',
    example: `// ❌ Bad
const apiKey = 'sk-' + '1234567890abcdef'; // example only — not a real key
// ✅ Good
const apiKey = process.env.OPENAI_API_KEY;`,
  },

  'Input validation': {
    why: 'Unvalidated inputs enable injection attacks, type errors, and unexpected crashes.',
    fix: 'Validate all external input (req.body, req.params, req.query) with a schema library like Zod or Joi.',
    example: `import { z } from 'zod';
const Schema = z.object({ email: z.string().email() });
app.post('/users', (req, res) => {
  const result = Schema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error });
});`,
  },

  'Auth & rate limiting': {
    why: 'Without authentication, anyone can access your API. ' +
      'Without rate limiting, attackers can abuse your resources.',
    fix: 'Add auth middleware to all protected routes and configure rate limiting on public endpoints.',
    example: `const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(cors(corsOptions));               // configure CORS headers
app.post('/api/login', limiter);          // scope to specific routes
app.get('/api/users', authenticate, getUsers);`,
  },

  'Strict config': {
    why: 'TypeScript without strict mode allows any-type values and null reference errors to slip through.',
    fix: 'Enable strict mode in tsconfig.json, or at minimum noImplicitAny and strictNullChecks.',
    example: `// tsconfig.json
{ "compilerOptions": { "strict": true } }`,
  },

  'Any type count': {
    why: "Using `any` disables TypeScript's type checking, making bugs silent and refactoring dangerous.",
    fix: 'Replace `any` with specific types. Use `unknown` with type guards if the type is truly unknown.',
    example: `// ❌ Bad
function process(data: any) { return data.value; }
// ✅ Good
function process(data: { value: string }) { return data.value; }`,
  },

  'Coverage': {
    why: 'Async functions without try/catch will crash on unhandled rejections, often in production.',
    fix: 'Wrap async route handlers in try/catch, or use a global async error handler utility.',
    example: `app.get('/users/:id', async (req, res) => {
  try {
    const user = await db.users.find(req.params.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});`,
  },

  'Empty catches': {
    why: 'Empty catch blocks silently swallow errors, making debugging nearly impossible.',
    fix: "Log errors, re-throw them, or handle explicitly. At minimum, comment why it's intentionally empty.",
    example: `// ❌ Bad
try { await sendEmail(email); } catch (e) { /* intentionally empty — example only */ }
// ✅ Good
try { await sendEmail(email); } catch (err) {
  logger.error('Email failed', { email, err });
}`,
  },

  'Structured logging': {
    why: "console.log produces unstructured text that's hard to search and parse in production.",
    fix: 'Use a structured logger (pino, winston, bunyan) that outputs JSON with consistent fields.',
    example: `import pino from 'pino';
const logger = pino({ level: 'info' });
// ❌ console.log('User created:', userId);
// ✅ logger.info({ userId, event: 'user_created' }, 'User created');`,
  },

  'Async patterns': {
    why: 'Awaiting calls inside loops causes N sequential queries instead of parallel fetches, killing performance.',
    fix: 'Use Promise.all() to run multiple async operations in parallel, or batch via a single query.',
    example: `// ❌ Bad: sequential
// for (const id of ids) { const u = await db.find(id); }
// ✅ Good: parallel
const users = await Promise.all(ids.map(id => db.find(id)));`,
  },

  'Console cleanup': {
    why: 'console.log in production creates noise, exposes debugging info, and slows down I/O.',
    fix: 'Remove console.log before shipping. Use a structured logger with appropriate log levels.',
  },

  'Import hygiene': {
    why: 'Circular imports and excessive star exports cause cryptic runtime errors and slow bundling.',
    fix: 'Use explicit named exports. Avoid circular dependencies and self-referencing imports.',
    example: `// ❌ export * from './users';
// ✅ export { getUser, createUser } from './users.js';`,
  },

  'Function length': {
    why: 'Long functions are hard to understand, test, and debug — they usually do too many things.',
    fix: 'Break functions into smaller, single-purpose helpers. Each function should do one thing well.',
    example: `// ❌ 60-line processOrder()
// ✅ Composed helpers:
async function processOrder(order) {
  await validateOrder(order);
  const payment = await chargePayment(order);
  await sendConfirmationEmail(order, payment);
}`,
  },

  'Line length': {
    why: "Long lines are hard to read and don't display well in editors or code review diffs.",
    fix: 'Break long lines at logical points. Use intermediate variables.',
    example: `// ❌ 150-char one-liner
// ✅ 
const name = [user.firstName, user.lastName]
  .filter(Boolean).join(' ');`,
  },

  'Dead code': {
    why: 'Commented-out code and TODO comments confuse readers and bloat the codebase.',
    fix: 'Delete dead code. Create tickets for deferred work instead of leaving TODO comments.',
  },

  'Duplication': {
    why: 'Duplicated code multiplies the cost of changes and creates inconsistency bugs.',
    fix: 'Extract common logic into shared functions, constants, or utilities.',
    example: `// ❌ Same validation in 3 places
// ✅ import { isValidEmail } from './utils/validation.js';`,
  },
};

/**
 * Get the explanation for a subcategory, if one exists.
 * Returns undefined for unknown subcategories.
 */
export function getExplanation(subcategoryName: string): Explanation | undefined {
  return EXPLANATIONS[subcategoryName];
}
