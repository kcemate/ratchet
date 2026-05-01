import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runAutoPr, loadAutoPrConfig, AutoPrConfig } from '../core/auto-pr.js';
import type { ScanResult } from '../core/scanner';
import * as child_process from 'child_process';

const execFileAsync = promisify(execFile);

// Mock logger
const logger = {
  warn: vi.fn(),
  debug: vi.fn(),
};

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock GitHub API token
const mockToken = 'mock-github-token';

// Test fixtures
const testCwd = '/tmp/ratchet-test-auto-pr';
const owner = 'test-owner';
const repo = 'test-repo';

// Sample scan result
const mockScanResult: ScanResult = {
  total: 85,
  maxTotal: 100,
  categories: [
    { name: 'Code Quality', emoji: '🏆', score: 30, max: 40 },
    { name: 'Tests', emoji: '🧪', score: 25, max: 30 },
    { name: 'Documentation', emoji: '📖', score: 30, max: 30 },
  ],
};

// Helper to setup test directory
async function setupTestDir() {
  const { mkdir, rm } = await import('fs/promises');
  await rm(testCwd, { recursive: true, force: true });
  await mkdir(testCwd, { recursive: true });
}

// Helper to write a README
function writeReadme(content: string) {
  writeFileSync(join(testCwd, 'README.md'), content, 'utf-8');
}

// Helper to write a .ratchet.yml
function writeConfig(content: string) {
  writeFileSync(join(testCwd, '.ratchet.yml'), content, 'utf-8');
}

describe('auto-pr', () => {
  beforeEach(async () => {
    await setupTestDir();
    process.env['GITHUB_TOKEN'] = mockToken;
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
  });

  describe('loadAutoPrConfig', () => {
    it('should return defaults when no .ratchet.yml exists', () => {
      const config = loadAutoPrConfig(testCwd);
      expect(config).toEqual<AutoPrConfig>({ autoPr: true, categories: true, style: 'flat' });
    });

    it('should parse minimal badge config', () => {
      writeConfig(`badge:\n  auto-pr: false\n  categories: false\n  style: flat-square`);
      const config = loadAutoPrConfig(testCwd);
      expect(config).toEqual<AutoPrConfig>({ autoPr: false, categories: false, style: 'flat-square' });
    });

    it('should default categories and style when only auto-pr is set', () => {
      writeConfig(`badge:\n  auto-pr: true`);
      const config = loadAutoPrConfig(testCwd);
      expect(config).toEqual<AutoPrConfig>({ autoPr: true, categories: true, style: 'flat' });
    });

    it('should handle malformed YAML gracefully', () => {
      writeConfig('this is not valid yaml');
      const config = loadAutoPrConfig(testCwd);
      expect(config).toEqual<AutoPrConfig>({ autoPr: true, categories: true, style: 'flat' });
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('runAutoPr', () => {
    it('should skip when autoPr is disabled in config', async () => {
      writeConfig(`badge:\n  auto-pr: false`);
      writeReadme('# Test Project');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('auto-pr disabled');
    });

    it('should skip when GITHUB_TOKEN is not set', async () => {
      delete process.env['GITHUB_TOKEN'];
      writeReadme('# Test Project');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('GITHUB_TOKEN not set');
    });

    it('should skip when README.md does not exist', async () => {
      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('README.md not found');
    });

    it('should skip when README already has a ratchet badge', async () => {
      writeReadme('[![Ratchet Score](https://ratchetcli.com/badge/test-owner/test-repo.svg)](https://ratchetcli.com/test-owner/test-repo)\n\n# Test Project');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('README already has a ratchet badge');
    });

    it('should skip when branch ratchet/add-badge already exists', async () => {
      // Mock git branch list to show existing branch
      vi.spyOn(execFileAsync, 'execFileAsync').mockImplementation(async (file, args, opts) => {
        if (file === 'git' && args[0] === 'branch' && args[1] === '--list' && args[2] === 'ratchet/add-badge') {
          return { stdout: 'ratchet/add-badge\n', stderr: '' } as any;
        }
        return execFileAsync(file as string, args as string[], opts);
      });

      writeReadme('# Test Project');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('branch ratchet/add-badge already exists');
    });

    it('should create PR with ratchet badges', async () => {
      const gitMock = vi.spyOn(child_process, 'execFile').mockImplementation(async (file, args, opts, callback) => {
        if (file === 'git') {
          if (args[0] === 'branch' && args[1] === '--list') {
            if (callback) callback(null, { stdout: '', stderr: '' });
            return undefined as any;
          }
          if (args[0] === 'rev-parse') {
            if (callback) callback(null, { stdout: 'main\n', stderr: '' });
            return undefined as any;
          }
          if (callback) callback(null, { stdout: '', stderr: '' });
          return undefined as any;
        }
        if (callback) callback(null, { stdout: '', stderr: '' });
        return undefined as any;
      });

      // Mock fetch for GitHub API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/test-owner/test-repo/pull/1' }),
      } as any);

      writeReadme('# Test Project\n\nThis is a test.');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);

      expect(result.skipped).toBe(false);
      expect(result.branch).toBe('ratchet/add-badge');
      expect(result.prUrl).toBe('https://github.com/test-owner/test-repo/pull/1');

      // Verify README was updated
      const updatedReadme = readFileSync(join(testCwd, 'README.md'), 'utf-8');
      expect(updatedReadme).toContain('ratchetcli.com/badge');
      expect(updatedReadme).toContain('Ratchet Score');
      expect(updatedReadme).toContain('Code Quality');
      expect(updatedReadme).toContain('Tests');
      expect(updatedReadme).toContain('Documentation');

      // Verify git commands were called
      expect(gitMock).toHaveBeenCalledWith('git', ['checkout', '-b', 'ratchet/add-badge'], expect.anything(), expect.any(Function));
      expect(gitMock).toHaveBeenCalledWith('git', ['add', 'README.md'], expect.anything(), expect.any(Function));
      expect(gitMock).toHaveBeenCalledWith('git', ['commit', '-m', 'docs: add Ratchet score badges to README'], expect.anything(), expect.any(Function));
      expect(gitMock).toHaveBeenCalledWith('git', ['push', 'origin', 'ratchet/add-badge'], expect.anything(), expect.any(Function));

      // Verify GitHub API was called
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/test-owner/test-repo/pulls',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'token mock-github-token' }),
          body: JSON.stringify(expect.objectContaining({ title: 'docs: add Ratchet score badges to README' })),
        }),
      );
    });

    it('should restore original branch on GitHub API failure', async () => {
      // Mock git commands
      const gitMock = vi.spyOn(execFileAsync, 'execFileAsync').mockImplementation(async (file, args, opts) => {
        if (file === 'git') {
          if (args[0] === 'branch' && args[1] === '--list') return { stdout: '', stderr: '' } as any;
          if (args[0] === 'rev-parse') return { stdout: 'main\n', stderr: '' } as any;
          return { stdout: '', stderr: '' } as any;
        }
        return execFileAsync(file as string, args as string[], opts);
      });

      // Mock fetch to fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
        json: async () => ({ message: 'Repository not found' }),
      } as any);

      writeReadme('# Test Project');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);

      expect(result.skipped).toBe(false);
      expect(result.reason).toContain('PR creation failed');

      // Verify git checkout back to original branch
      expect(gitMock).toHaveBeenCalledWith('git', ['checkout', 'main'], { cwd: testCwd });
    });

    it('should restore original branch on unexpected error', async () => {
      // Mock git commands to throw
      const gitMock = vi.spyOn(execFileAsync, 'execFileAsync').mockImplementation(async (file, args, opts) => {
        if (file === 'git' && args[0] === 'push') {
          throw new Error('git push failed');
        }
        if (file === 'git' && args[0] === 'rev-parse') return { stdout: 'main\n', stderr: '' } as any;
        return { stdout: '', stderr: '' } as any;
      });

      writeReadme('# Test Project');

      const result = await runAutoPr(testCwd, owner, repo, mockScanResult);

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('auto-PR failed');

      // Verify git checkout back to original branch
      expect(gitMock).toHaveBeenCalledWith('git', ['checkout', 'main'], { cwd: testCwd });
    });
  });
});
