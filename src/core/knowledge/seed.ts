/**
 * Seed data for the LLM Knowledge Base.
 *
 * Covers all six Ratchet scoring categories with real TypeScript/Node.js
 * patterns, examples, and anti-patterns derived from Ratchet's own scan rules.
 */

import type { KnowledgeEntry } from "./types.js";

export const SEED_ENTRIES: KnowledgeEntry[] = [
  // ── Error Handling ──────────────────────────────────────────────────────────

  {
    id: "eh-structured-logging-001",
    category: "error-handling",
    subcategory: "Structured logging",
    pattern: "console\\.log|console\\.error|console\\.warn",
    description:
      "Use a structured logger instead of console calls. Structured loggers " +
      "produce machine-readable output with log levels, timestamps, and context.",
    severity: "medium",
    language: "typescript",
    examples: [
      "import { logger } from './core/logger.js';\nlogger.info({ userId }, 'User signed in');",
      "logger.error({ err, requestId }, 'Failed to fetch resource');",
    ],
    antiPatterns: ["console.log('User signed in:', userId);", "console.error('Failed:', err.message);"],
    references: ["src/core/logger.ts"],
  },

  {
    id: "eh-empty-catches-001",
    category: "error-handling",
    subcategory: "Empty catches",
    pattern: "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}",
    description:
      "Empty catch blocks silently swallow errors. At minimum, log the " + "caught error so failures are observable.",
    severity: "high",
    language: "typescript",
    examples: ["try {\n  await op();\n} catch (err) {\n  logger.warn({ err }, 'op failed, continuing');\n}"],
    antiPatterns: ["try {\n  await op();\n} catch (_) {\n  // ignore\n}", "try {\n  parse(data);\n} catch {}\n"],
    references: [],
  },

  {
    id: "eh-async-coverage-001",
    category: "error-handling",
    subcategory: "Coverage",
    pattern: "async function|async \\(",
    description:
      "Async functions that lack try/catch let unhandled rejections crash " +
      "the process. Wrap async bodies in error handlers.",
    severity: "high",
    language: "typescript",
    examples: [
      "async function fetchUser(id: string): Promise<User> {\n  try {\n    return await db.find(id);\n  } catch (err) {\n    logger.error({ err, id }, 'fetchUser failed');\n    throw err;\n  }\n}",
    ],
    antiPatterns: ["async function fetchUser(id: string): Promise<User> {\n  return await db.find(id);\n}"],
    references: [],
  },

  {
    id: "eh-toerror-001",
    category: "error-handling",
    subcategory: "Structured logging",
    pattern: "err instanceof Error \\? err\\.message : String\\(err\\)",
    description:
      "Use toErrorMessage() from core/utils to extract error messages from " +
      "unknown catch values instead of repeating the instanceof guard inline.",
    severity: "low",
    language: "typescript",
    examples: [
      "import { toErrorMessage } from './core/utils.js';\n// ...\n} catch (err) {\n  logger.error({ msg: toErrorMessage(err) }, 'operation failed');\n}",
    ],
    antiPatterns: [
      "} catch (err) {\n  const msg = err instanceof Error ? err.message : String(err);\n  console.error(msg);\n}",
    ],
    references: ["src/core/utils.ts"],
  },

  // ── Performance ─────────────────────────────────────────────────────────────

  {
    id: "perf-console-cleanup-001",
    category: "performance",
    subcategory: "Console cleanup",
    pattern: "console\\.log",
    description:
      "console.log calls in production code add I/O overhead and create " +
      "unstructured noise. Replace with structured logger or remove.",
    severity: "low",
    language: "typescript",
    examples: ["logger.debug({ value }, 'computed value');"],
    antiPatterns: ["console.log('computed value:', value);"],
    references: ["src/core/logger.ts"],
  },

  {
    id: "perf-await-in-loop-001",
    category: "performance",
    subcategory: "Async patterns",
    pattern: "for.*await|while.*await",
    description:
      "Awaiting inside a loop forces sequential execution. Use Promise.all " +
      "or batching to run independent async operations concurrently.",
    severity: "high",
    language: "typescript",
    examples: [
      "const results = await Promise.all(items.map(item => process(item)));",
      "// Batch with concurrency limit:\nconst results = await Promise.all(\n  chunks.map(chunk => Promise.all(chunk.map(process)))\n);",
    ],
    antiPatterns: [
      "const results = [];\nfor (const item of items) {\n  results.push(await process(item)); // sequential!\n}",
    ],
    references: [],
  },

  {
    id: "perf-import-hygiene-001",
    category: "performance",
    subcategory: "Import hygiene",
    pattern: "import \\* as|self-import",
    description:
      "Wildcard re-exports from barrel files and self-imports inflate bundle " +
      "size and can cause circular dependency issues.",
    severity: "medium",
    language: "typescript",
    examples: ["export { loadKnowledge, query, getByCategory } from './store.js';"],
    antiPatterns: [
      "export * from './store.js'; // barrel wildcard",
      "import { foo } from './myFile.js'; // inside myFile.ts itself",
    ],
    references: [],
  },

  {
    id: "perf-promise-all-settled-001",
    category: "performance",
    subcategory: "Async patterns",
    pattern: "Promise\\.all.*catch|try.*Promise\\.all",
    description:
      "Use Promise.allSettled when partial failures are acceptable, " +
      "avoiding a single rejection from cancelling all concurrent operations.",
    severity: "medium",
    language: "typescript",
    examples: [
      "const results = await Promise.allSettled(tasks.map(t => run(t)));\nconst succeeded = results.filter(r => r.status === 'fulfilled');",
    ],
    antiPatterns: ["// Fails entirely if any task throws:\nconst results = await Promise.all(tasks.map(t => run(t)));"],
    references: [],
  },

  // ── Code Quality ────────────────────────────────────────────────────────────

  {
    id: "cq-function-length-001",
    category: "code-quality",
    subcategory: "Function length",
    pattern: "function.*\\{[\\s\\S]{2000,}\\}",
    description:
      "Functions longer than ~50 lines are hard to reason about. Extract " +
      "logical blocks into named helper functions.",
    severity: "medium",
    examples: [
      "function processOrder(order: Order): Result {\n  const validated = validateOrder(order);\n  const priced = applyPricing(validated);\n  return fulfillOrder(priced);\n}",
    ],
    antiPatterns: [
      "function processOrder(order: Order): Result {\n  // 80 lines of mixed validation, pricing, and fulfillment logic\n}",
    ],
    references: [],
  },

  {
    id: "cq-line-length-001",
    category: "code-quality",
    subcategory: "Line length",
    pattern: ".{121,}",
    description:
      "Lines over 120 characters reduce readability and cause horizontal " +
      "scrolling. Break long expressions using intermediate variables or multi-line syntax.",
    severity: "low",
    language: "typescript",
    examples: [
      "const result = transform(\n  inputData,\n  { option: true, verbose: false },\n);",
      "const { name, email, role } = user;",
    ],
    antiPatterns: [
      "const result = transform(inputData, { option: true, verbose: false, extraField: 'something long here' });",
    ],
    references: [],
  },

  {
    id: "cq-dead-code-001",
    category: "code-quality",
    subcategory: "Dead code",
    pattern: "// TODO|// FIXME|// HACK|commented.out code",
    description:
      "TODO comments and commented-out code accumulate technical debt. " +
      "Either implement the TODO immediately or delete it with a brief commit message.",
    severity: "low",
    examples: ["// Removed legacy auth path — replaced by OAuth flow in PR #142"],
    antiPatterns: ["// TODO: fix this later", "// const oldImplementation = () => { ... }"],
    references: [],
  },

  {
    id: "cq-duplication-001",
    category: "code-quality",
    subcategory: "Duplication",
    pattern: "copy.paste|repeated pattern",
    description:
      "Repeated logic across files should be extracted into shared utility " +
      "functions. Copy-paste code diverges over time and amplifies bugs.",
    severity: "medium",
    examples: [
      "// Extract shared logic to src/core/utils.ts:\nexport function formatIsoDate(d: Date): string {\n  return d.toISOString().split('T')[0]!;\n}",
    ],
    antiPatterns: [
      "// In file A:\nconst date = d.toISOString().split('T')[0];\n// In file B (identical):\nconst date = d.toISOString().split('T')[0];",
    ],
    references: ["src/core/utils.ts"],
  },

  {
    id: "cq-magic-numbers-001",
    category: "code-quality",
    subcategory: "Dead code",
    pattern: "magic number|unexplained literal",
    description:
      "Unnamed numeric/string literals make intent opaque. Extract into " +
      "named constants at the top of the file or module.",
    severity: "low",
    language: "typescript",
    examples: [
      "const MAX_RETRIES = 3;\nconst TIMEOUT_MS = 5_000;\n\nif (retries >= MAX_RETRIES) throw new Error('retry limit');",
    ],
    antiPatterns: ["if (retries >= 3) throw new Error('retry limit');\nawait sleep(5000);"],
    references: [],
  },

  // ── Security ────────────────────────────────────────────────────────────────

  {
    id: "sec-secrets-env-001",
    category: "security",
    subcategory: "Secrets & env vars",
    pattern: "hardcoded.*secret|apiKey.*=.*['\"][A-Za-z0-9]{16,}['\"]",
    description:
      "Hardcoded secrets and API keys in source code are a critical security " +
      "risk. Always read credentials from environment variables.",
    severity: "high",
    language: "typescript",
    examples: ["const apiKey = process.env['API_KEY'];\nif (!apiKey) throw new Error('API_KEY env var required');"],
    antiPatterns: ["const apiKey = 'sk-1234abcdXYZ'; // hardcoded!", "const DB_PASS = 'super_secret_password';"],
    references: [],
  },

  {
    id: "sec-input-validation-001",
    category: "security",
    subcategory: "Input validation",
    pattern: "req\\.body|req\\.params|req\\.query",
    description:
      "Route handlers that use request data without validation are vulnerable " +
      "to injection and unexpected behavior. Validate with zod or similar schema library.",
    severity: "high",
    language: "typescript",
    framework: "express",
    examples: [
      "import { z } from 'zod';\nconst schema = z.object({ name: z.string().min(1).max(100) });\napp.post('/user', (req, res) => {\n  const { name } = schema.parse(req.body);\n  // safe to use name\n});",
    ],
    antiPatterns: [
      "app.post('/user', (req, res) => {\n  const { name } = req.body; // unvalidated!\n  db.insert({ name });\n});",
    ],
    references: [],
  },

  {
    id: "sec-auth-rate-limiting-001",
    category: "security",
    subcategory: "Auth & rate limiting",
    pattern: "router\\.(get|post|put|delete|patch).*(?!auth|protect)",
    description:
      "Public routes without authentication or rate limiting are vulnerable " +
      "to abuse. Apply auth middleware and rate limiters at the router level.",
    severity: "high",
    language: "typescript",
    framework: "express",
    examples: [
      "import rateLimit from 'express-rate-limit';\nconst limiter = rateLimit({ windowMs: 60_000, max: 100 });\nrouter.use(limiter);\nrouter.post('/login', requireAuth, handler);",
    ],
    antiPatterns: ["router.post('/login', handler); // no auth, no rate limit"],
    references: [],
  },

  {
    id: "sec-path-traversal-001",
    category: "security",
    subcategory: "Input validation",
    pattern: "readFile.*req\\.|path\\.join.*req\\.",
    description:
      "Using user-supplied input directly in file paths enables path traversal " +
      "attacks. Sanitize and restrict paths to a safe base directory.",
    severity: "high",
    language: "typescript",
    examples: [
      "import path from 'node:path';\nconst BASE = '/var/app/uploads';\nconst safePath = path.resolve(BASE, path.basename(userInput));\nif (!safePath.startsWith(BASE)) throw new Error('invalid path');\nfs.readFile(safePath, ...);",
    ],
    antiPatterns: [
      "const filePath = path.join('/uploads', req.params.file); // traversal risk!\nfs.readFile(filePath, ...);",
    ],
    references: [],
  },

  // ── Type Safety ─────────────────────────────────────────────────────────────

  {
    id: "ts-any-type-001",
    category: "type-safety",
    subcategory: "Any type count",
    pattern: ": any|as any|<any>",
    description:
      "The `any` type disables TypeScript's safety guarantees. Use `unknown` " +
      "for truly unknown values and narrow with type guards, or define a proper interface.",
    severity: "medium",
    language: "typescript",
    examples: [
      "function processResponse(data: unknown): string {\n  if (typeof data !== 'object' || data === null) throw new Error('invalid');\n  return (data as { message: string }).message;\n}",
      "// Prefer explicit types:\ninterface ApiResponse { message: string; code: number; }",
    ],
    antiPatterns: [
      "function processResponse(data: any): string {\n  return data.message; // unsafe\n}",
      "const result = fetchData() as any;",
    ],
    references: [],
  },

  {
    id: "ts-strict-config-001",
    category: "type-safety",
    subcategory: "Strict config",
    pattern: '"strict":\\s*false|noImplicitAny.*false',
    description:
      "TypeScript strict mode catches a class of bugs at compile time. " +
      "Never disable strict mode — fix the underlying type errors instead.",
    severity: "high",
    language: "typescript",
    examples: ['// tsconfig.json:\n{\n  "compilerOptions": {\n    "strict": true\n  }\n}'],
    antiPatterns: ['// tsconfig.json:\n{\n  "compilerOptions": {\n    "strict": false // disables all checks\n  }\n}'],
    references: [],
  },

  {
    id: "ts-non-null-assertion-001",
    category: "type-safety",
    subcategory: "Any type count",
    pattern: "[a-zA-Z]!\\.",
    description:
      "Non-null assertions (`!`) bypass null-checks and can cause runtime " +
      "errors. Use optional chaining or explicit guards instead.",
    severity: "medium",
    language: "typescript",
    examples: [
      "const user = users.find(u => u.id === id);\nif (!user) throw new Error(`User ${id} not found`);\nreturn user.name; // safe after guard",
    ],
    antiPatterns: ["const user = users.find(u => u.id === id);\nreturn user!.name; // crashes if not found"],
    references: [],
  },

  {
    id: "ts-unknown-catch-001",
    category: "type-safety",
    subcategory: "Any type count",
    pattern: "catch \\(err: any\\)|catch \\(e: any\\)",
    description:
      "Typing catch variables as `any` re-introduces unsafety. Use `unknown` " +
      "and narrow with instanceof or toErrorMessage().",
    severity: "low",
    language: "typescript",
    examples: [
      "} catch (err: unknown) {\n  const msg = err instanceof Error ? err.message : String(err);\n  logger.error({ msg }, 'failed');\n}",
    ],
    antiPatterns: ["} catch (err: any) {\n  logger.error(err.message); // unsafe\n}"],
    references: ["src/core/utils.ts"],
  },

  // ── Testing ─────────────────────────────────────────────────────────────────

  {
    id: "test-coverage-001",
    category: "testing",
    subcategory: "Coverage ratio",
    pattern: "untested async|no test for",
    description:
      "Async functions and error paths are the most commonly untested. " +
      "Ensure each exported function has at least one happy-path and one error-path test.",
    severity: "high",
    language: "typescript",
    examples: [
      "it('returns user when found', async () => {\n  const user = await fetchUser('123');\n  expect(user.id).toBe('123');\n});\n\nit('throws when user not found', async () => {\n  await expect(fetchUser('missing')).rejects.toThrow();\n});",
    ],
    antiPatterns: [
      "// Only tests the happy path:\nit('returns user', async () => {\n  const user = await fetchUser('123');\n  expect(user).toBeDefined();\n});",
    ],
    references: [],
  },

  {
    id: "test-quality-assertions-001",
    category: "testing",
    subcategory: "Test quality",
    pattern: "expect.*toBeDefined|expect.*toBeTruthy",
    description:
      "Weak assertions like toBeDefined/toBeTruthy pass even for wrong values. " +
      "Assert specific values to catch regressions.",
    severity: "medium",
    language: "typescript",
    examples: [
      "expect(result.count).toBe(3);\nexpect(result.items).toHaveLength(3);\nexpect(result.items[0]?.id).toBe('abc');",
    ],
    antiPatterns: ["expect(result).toBeDefined();\nexpect(result.items).toBeTruthy();"],
    references: [],
  },

  {
    id: "test-edge-cases-001",
    category: "testing",
    subcategory: "Edge case depth",
    pattern: "edge case|boundary|empty input|null input",
    description:
      "Test boundary conditions: empty arrays, zero, null/undefined inputs, " +
      "and max-length strings. These are where bugs most often hide.",
    severity: "medium",
    examples: [
      "it('handles empty list', () => {\n  expect(summarize([])).toEqual({ total: 0, items: [] });\n});\n\nit('handles single item', () => {\n  expect(summarize([{ val: 5 }])).toEqual({ total: 5, items: [5] });\n});",
    ],
    antiPatterns: [
      "// Tests only the typical case:\nit('summarizes items', () => {\n  expect(summarize(fixtures)).toMatchSnapshot();\n});",
    ],
    references: [],
  },

  {
    id: "test-isolation-001",
    category: "testing",
    subcategory: "Test quality",
    pattern: "shared mutable state|global.*test|test.*global",
    description:
      "Tests that share mutable state are order-dependent and flaky. " +
      "Reset state in beforeEach/afterEach and avoid module-level mutation.",
    severity: "high",
    language: "typescript",
    examples: [
      "let store: Store;\nbeforeEach(() => { store = createStore(); });\nafterEach(() => { store.reset(); });",
    ],
    antiPatterns: [
      "const store = createStore(); // shared across all tests!\ndescribe('...', () => { it('modifies store', () => { store.add(x); }); });",
    ],
    references: [],
  },

  {
    id: "test-coverage-branches-001",
    category: "testing",
    subcategory: "Coverage ratio",
    pattern: "branch coverage|if.*else.*untested",
    description:
      "Every branch of conditional logic should have a test. Missing branch " +
      "coverage means logic errors in edge paths go undetected.",
    severity: "medium",
    examples: [
      "it('returns discount for members', () => {\n  expect(price({ member: true, amount: 100 })).toBe(90);\n});\nit('returns full price for non-members', () => {\n  expect(price({ member: false, amount: 100 })).toBe(100);\n});",
    ],
    antiPatterns: [
      "// Only tests one branch:\nit('returns price', () => {\n  expect(price({ member: true, amount: 100 })).toBe(90);\n});",
    ],
    references: [],
  },
];
