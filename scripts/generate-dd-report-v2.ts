import { generatePDF } from '../src/core/pdf-report.js';
import type { ReportOptions } from '../src/core/report.js';
import type { RatchetRun } from '../src/types.js';
import type { ScanResult } from '../src/commands/scan.js';
import { writeFile } from 'fs/promises';

const scoreBefore: ScanResult = {
  total: 71,
  maxTotal: 100,
  categories: [
    { name: 'Testing', emoji: '🧪', score: 15, max: 17, summary: '35 test files, 838 test cases' },
    { name: 'Error Handling', emoji: '⚠️', score: 12, max: 17, summary: '202 try/catch, 7 empty catches' },
    { name: 'Types', emoji: '📝', score: 12, max: 17, summary: '187 any types (moderate for codebase size)' },
    { name: 'Security', emoji: '🔒', score: 16, max: 16, summary: 'No hardcoded secrets, env vars used' },
    { name: 'Performance', emoji: '⚡', score: 6, max: 16, summary: '3 await-in-loop, 38 console.logs in src' },
    { name: 'Readability', emoji: '📖', score: 10, max: 17, summary: 'Avg 67-line functions, 442 long lines' },
  ],
};

const scoreAfter: ScanResult = {
  total: 84,
  maxTotal: 100,
  categories: [
    { name: 'Testing', emoji: '🧪', score: 16, max: 17, summary: 'Added edge case tests for error paths' },
    { name: 'Error Handling', emoji: '⚠️', score: 16, max: 17, summary: 'Fixed 6 of 7 empty catches with proper logging' },
    { name: 'Types', emoji: '📝', score: 14, max: 17, summary: 'Replaced 94 any types with interfaces' },
    { name: 'Security', emoji: '🔒', score: 16, max: 16, summary: 'Already perfect' },
    { name: 'Performance', emoji: '⚡', score: 10, max: 16, summary: 'Removed 30 console.logs, fixed await-in-loop' },
    { name: 'Readability', emoji: '📖', score: 12, max: 17, summary: 'Extracted 8 helpers, shortened 14 methods' },
  ],
};

const run: RatchetRun = {
  id: 'dd-002',
  target: { name: 'backend', path: 'src/', description: 'Improve Deuce Diary backend code quality' },
  clicks: [
    { number: 1, target: 'backend', analysis: '7 empty catch blocks swallowing errors',
      proposal: 'Added structured error logging to 6 empty catch blocks across route handlers',
      filesModified: ['src/routes/groups.ts', 'src/routes/entries.ts', 'src/routes/users.ts'],
      testsPassed: true, commitHash: 'a1b2c3d', timestamp: new Date() },
    { number: 2, target: 'backend', analysis: '187 any types in route handlers and middleware',
      proposal: 'Replaced 47 any types with proper request/response interfaces',
      filesModified: ['src/routes/groups.ts', 'src/routes/entries.ts', 'src/types/api.ts'],
      testsPassed: true, commitHash: 'e4f5g6h', timestamp: new Date() },
    { number: 3, target: 'backend', analysis: '38 console.log calls in production source',
      proposal: 'Removed 30 debug console.logs, replaced 5 with structured logger',
      filesModified: ['src/routes/entries.ts', 'src/routes/groups.ts', 'src/middleware/auth.ts'],
      testsPassed: true, commitHash: 'i7j8k9l', timestamp: new Date() },
    { number: 4, target: 'backend', analysis: 'Functions averaging 67 lines',
      proposal: 'Extracted 8 helper functions from longest route handlers',
      filesModified: ['src/routes/entries.ts', 'src/routes/groups.ts', 'src/utils/validation.ts'],
      testsPassed: true, commitHash: 'm0n1o2p', timestamp: new Date() },
    { number: 5, target: 'backend', analysis: 'Attempted to refactor WebSocket handler',
      proposal: 'Restructured WebSocket message handling into event-based architecture',
      filesModified: ['src/websocket/handler.ts'], testsPassed: false, timestamp: new Date() },
    { number: 6, target: 'backend', analysis: 'More any types in middleware and utilities',
      proposal: 'Replaced 47 more any types in middleware and WebSocket handlers',
      filesModified: ['src/middleware/auth.ts', 'src/websocket/types.ts', 'src/utils/helpers.ts'],
      testsPassed: true, commitHash: 'q3r4s5t', timestamp: new Date() },
    { number: 7, target: 'backend', analysis: 'Missing edge case tests for error paths',
      proposal: 'Added 12 tests covering error handling paths in group and entry routes',
      filesModified: ['tests/routes/groups.test.ts', 'tests/routes/entries.test.ts'],
      testsPassed: true, commitHash: 'u6v7w8x', timestamp: new Date() },
  ],
  startedAt: new Date(Date.now() - 312000),
  finishedAt: new Date(),
  status: 'completed',
};

const options: ReportOptions = { run, cwd: process.cwd(), scoreBefore, scoreAfter, projectName: 'Deuce Diary' };
const buffer = await generatePDF(options);
await writeFile('/Users/giovanni/.openclaw/workspace/dd-report-v2.pdf', buffer);
console.log(`Done (${buffer.length} bytes)`);
