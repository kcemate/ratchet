import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preflightTestCommand } from '../core/engine.js';

// Mock the runner module to avoid actual process spawning
vi.mock('../core/runner.js', () => ({
  runTests: vi.fn(),
}));

import { runTests } from '../core/runner.js';
const mockRunTests = runTests as ReturnType<typeof vi.fn>;

describe('preflightTestCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves without error when tests pass', async () => {
    mockRunTests.mockResolvedValue({ passed: true, output: 'All tests passed', duration: 100 });
    await expect(preflightTestCommand('npm test', '/fake/cwd')).resolves.toBeUndefined();
  });

  it('resolves without error when tests fail (pre-existing failures are OK)', async () => {
    mockRunTests.mockResolvedValue({ passed: false, output: 'Test suite failed', duration: 100 });
    await expect(preflightTestCommand('npm test', '/fake/cwd')).resolves.toBeUndefined();
  });

  it('throws when npm error Missing script is in output', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'npm error Missing script: "test"\nnpm error',
      duration: 50,
    });
    await expect(preflightTestCommand('npm test', '/fake/cwd'))
      .rejects.toThrow('No working test command');
  });

  it('throws when "Missing script:" appears anywhere in output', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'Missing script: test\nError!',
      duration: 50,
    });
    await expect(preflightTestCommand('npm test', '/fake/cwd'))
      .rejects.toThrow('No working test command');
  });

  it('throws when "no test specified" appears in output (default npm stub)', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'Error: no test specified',
      duration: 50,
    });
    await expect(preflightTestCommand('npm test', '/fake/cwd'))
      .rejects.toThrow('No working test command');
  });

  it('includes actionable fix message in the error', async () => {
    mockRunTests.mockResolvedValue({
      passed: false,
      output: 'npm error Missing script: "test"',
      duration: 50,
    });
    await expect(preflightTestCommand('npm test', '/fake/cwd'))
      .rejects.toThrow('add a test script to package.json');
  });
});
