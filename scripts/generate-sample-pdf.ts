import { generatePDF } from '../src/core/pdf-report.js';
import type { ReportOptions } from '../src/core/report.js';
import type { RatchetRun } from '../src/types.js';
import type { ScanResult } from '../src/commands/scan.js';
import { writeFile } from 'fs/promises';

const run: RatchetRun = {
  id: 'sample-001',
  target: { name: 'api-errors', path: 'src/api/', description: 'Improve API error handling' },
  clicks: [
    { number: 1, target: 'api-errors', analysis: 'Found unvalidated user input on join endpoint', proposal: 'Added input validation to join and invite endpoints', filesModified: ['src/api/join.ts', 'src/api/invite.ts'], testsPassed: true, commitHash: 'a3f9b21', timestamp: new Date() },
    { number: 2, target: 'api-errors', analysis: 'Found 12 uses of any type across API routes', proposal: 'Replaced 12 any types with proper TypeScript interfaces', filesModified: ['src/api/types.ts', 'src/api/routes.ts'], testsPassed: true, commitHash: '7bc1d44', timestamp: new Date() },
    { number: 3, target: 'api-errors', analysis: 'Database calls missing error handling', proposal: 'Added try/catch to all async database calls with proper error logging', filesModified: ['src/api/db.ts', 'src/api/users.ts', 'src/api/groups.ts'], testsPassed: true, commitHash: '2e8f053', timestamp: new Date() },
    { number: 4, target: 'api-errors', analysis: 'Hardcoded API key found in config.ts', proposal: 'Moved hardcoded API key to environment variable', filesModified: ['src/config.ts', '.env.example'], testsPassed: true, commitHash: '9da3c17', timestamp: new Date() },
    { number: 5, target: 'api-errors', analysis: 'No unit tests exist for API routes', proposal: 'Added 8 unit tests for core API routes covering happy path and error cases', filesModified: ['tests/api/join.test.ts', 'tests/api/invite.test.ts', 'tests/api/users.test.ts'], testsPassed: true, commitHash: 'f81b44a', timestamp: new Date() },
    { number: 6, target: 'api-errors', analysis: 'Auth middleware could be simplified', proposal: 'Attempted to refactor auth middleware into composable functions', filesModified: ['src/middleware/auth.ts'], testsPassed: false, timestamp: new Date() },
    { number: 7, target: 'api-errors', analysis: 'Error formatting is duplicated across routes', proposal: 'Extracted error formatting into shared utility function', filesModified: ['src/api/utils/errors.ts', 'src/api/join.ts', 'src/api/invite.ts'], testsPassed: true, commitHash: 'c4e2a19', timestamp: new Date() },
  ],
  startedAt: new Date(Date.now() - 222000),
  finishedAt: new Date(),
  status: 'completed',
};

const scoreBefore: ScanResult = {
  total: 34,
  maxTotal: 100,
  categories: [
    { name: 'Testing', emoji: '🧪', score: 0, max: 17, summary: 'No tests found' },
    { name: 'Error Handling', emoji: '⚠️', score: 6, max: 17, summary: '5 unhandled exceptions' },
    { name: 'Types', emoji: '📝', score: 8, max: 17, summary: '12 any types found' },
    { name: 'Security', emoji: '🔒', score: 8, max: 16, summary: '2 hardcoded secrets' },
    { name: 'Performance', emoji: '⚡', score: 8, max: 16, summary: '1 N+1 query' },
    { name: 'Readability', emoji: '📖', score: 4, max: 17, summary: 'Long functions, duplicated code' },
  ],
};

const scoreAfter: ScanResult = {
  total: 72,
  maxTotal: 100,
  categories: [
    { name: 'Testing', emoji: '🧪', score: 10, max: 17, summary: '8 tests added' },
    { name: 'Error Handling', emoji: '⚠️', score: 14, max: 17, summary: 'Try/catch on all async calls' },
    { name: 'Types', emoji: '📝', score: 15, max: 17, summary: 'Proper interfaces added' },
    { name: 'Security', emoji: '🔒', score: 14, max: 16, summary: 'Secrets moved to env vars' },
    { name: 'Performance', emoji: '⚡', score: 11, max: 16, summary: 'No critical issues' },
    { name: 'Readability', emoji: '📖', score: 8, max: 17, summary: 'Error utility extracted' },
  ],
};

const options: ReportOptions = { run, cwd: process.cwd(), scoreBefore, scoreAfter };

const buffer = await generatePDF(options);
const outPath = '/Users/giovanni/Projects/ratchet/docs/sample-ratchet-report.pdf';
await writeFile(outPath, buffer);
console.log(`Written to ${outPath}`);
