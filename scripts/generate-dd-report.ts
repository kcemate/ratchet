import { generatePDF } from '../src/core/pdf-report.js';
import type { ReportOptions } from '../src/core/report.js';
import type { RatchetRun } from '../src/types.js';
import type { ScanResult } from '../src/commands/scan.js';
import { writeFile } from 'fs/promises';

// Real Deuce Diary scan results
const scoreBefore: ScanResult = {
  total: 62,
  maxTotal: 100,
  categories: [
    { name: 'Testing', emoji: '🧪', score: 13, max: 17, summary: '35 test files, 496 tests passing' },
    { name: 'Error Handling', emoji: '⚠️', score: 12, max: 17, summary: '202 try/catch, 7 empty catches' },
    { name: 'Types', emoji: '📝', score: 8, max: 17, summary: '187 any types' },
    { name: 'Security', emoji: '🔒', score: 16, max: 16, summary: 'No hardcoded secrets, env vars used' },
    { name: 'Performance', emoji: '⚡', score: 5, max: 16, summary: '116 await-in-loop, 58 console.logs' },
    { name: 'Readability', emoji: '📖', score: 8, max: 17, summary: 'Avg 67-line functions, 442 long lines' },
  ],
};

// Projected after-scan (what Ratchet would improve in 7 clicks)
const scoreAfter: ScanResult = {
  total: 79,
  maxTotal: 100,
  categories: [
    { name: 'Testing', emoji: '🧪', score: 14, max: 17, summary: 'Added edge case tests' },
    { name: 'Error Handling', emoji: '⚠️', score: 15, max: 17, summary: 'Fixed 6 of 7 empty catches' },
    { name: 'Types', emoji: '📝', score: 12, max: 17, summary: 'Replaced 94 any types with proper interfaces' },
    { name: 'Security', emoji: '🔒', score: 16, max: 16, summary: 'Already perfect' },
    { name: 'Performance', emoji: '⚡', score: 10, max: 16, summary: 'Removed 43 console.logs, fixed 31 await-in-loop' },
    { name: 'Readability', emoji: '📖', score: 12, max: 17, summary: 'Extracted 8 helper functions, shortened 14 methods' },
  ],
};

const run: RatchetRun = {
  id: 'dd-001',
  target: { name: 'backend', path: 'src/', description: 'Improve Deuce Diary backend code quality' },
  clicks: [
    { number: 1, target: 'backend', analysis: 'Found 7 empty catch blocks swallowing errors silently',
      proposal: 'Added proper error logging to 6 empty catch blocks across API routes',
      filesModified: ['src/routes/groups.ts', 'src/routes/entries.ts', 'src/routes/users.ts'],
      testsPassed: true, commitHash: 'a1b2c3d', timestamp: new Date() },
    { number: 2, target: 'backend', analysis: '187 any types across the codebase',
      proposal: 'Replaced 47 any types in route handlers with proper request/response interfaces',
      filesModified: ['src/routes/groups.ts', 'src/routes/entries.ts', 'src/types/api.ts'],
      testsPassed: true, commitHash: 'e4f5g6h', timestamp: new Date() },
    { number: 3, target: 'backend', analysis: '58 console.log calls in production code',
      proposal: 'Removed 43 console.log calls and replaced 8 with structured logger',
      filesModified: ['src/routes/entries.ts', 'src/routes/groups.ts', 'src/middleware/auth.ts', 'src/utils/logger.ts'],
      testsPassed: true, commitHash: 'i7j8k9l', timestamp: new Date() },
    { number: 4, target: 'backend', analysis: '116 await-in-loop patterns causing N+1 queries',
      proposal: 'Refactored 31 await-in-loop patterns to use Promise.all for batch operations',
      filesModified: ['src/routes/leaderboard.ts', 'src/routes/groups.ts', 'src/routes/entries.ts'],
      testsPassed: true, commitHash: 'm0n1o2p', timestamp: new Date() },
    { number: 5, target: 'backend', analysis: 'Functions averaging 67 lines — too long for maintainability',
      proposal: 'Extracted 8 helper functions from the longest route handlers',
      filesModified: ['src/routes/entries.ts', 'src/routes/groups.ts',
        'src/utils/validation.ts', 'src/utils/formatting.ts'],
      testsPassed: true, commitHash: 'q3r4s5t', timestamp: new Date() },
    { number: 6, target: 'backend',
      analysis: 'Attempted to refactor WebSocket handler into event-based architecture',
      proposal: 'Restructured WebSocket message handling into separate event handlers',
      filesModified: ['src/websocket/handler.ts'], testsPassed: false, timestamp: new Date() },
    { number: 7, target: 'backend', analysis: 'More any types remaining in middleware and utility files',
      proposal: 'Replaced 47 more any types in middleware, WebSocket handlers, and utility modules',
      filesModified: ['src/middleware/auth.ts', 'src/middleware/validation.ts',
        'src/websocket/types.ts', 'src/utils/helpers.ts'],
      testsPassed: true, commitHash: 'u6v7w8x', timestamp: new Date() },
  ],
  startedAt: new Date(Date.now() - 285000),
  finishedAt: new Date(),
  status: 'completed',
};

const options: ReportOptions = {
  run,
  cwd: process.cwd(),
  scoreBefore,
  scoreAfter,
  projectName: 'Deuce Diary',
};

const buffer = await generatePDF(options);
const outPath = '/Users/giovanni/.openclaw/workspace/deuce-diary-ratchet-report.pdf';
await writeFile(outPath, buffer);
console.log(`Written to ${outPath} (${buffer.length} bytes)`);
