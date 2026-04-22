import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'path';
import { runScan } from './scan.js';
import { getExplanation } from '../core/explanations.js';
import { printHeader, scoreColor } from '../lib/cli.js';

// Mock external dependencies
vi.mock('./scan.js');
vi.mock('../core/explanations.js');
vi.mock('../lib/cli.js');

// Helper structure matching the exported QuickFixItem
interface QuickFixItem {
  rank: number;
  subcategoryName: string;
  categoryName: string;
  headroom: number;
  currentScore: number;
  maxScore: number;
  issuesFound: number;
  issuesDescription: string;
  fix: string;
  projectedTotal: number;
}

// Mock implementations for external modules
// We must define the types/mock functions that the source code uses.
vi.mocked(runScan).mockResolvedValue<{
  categories: {
    name: string;
    subcategories: {
      name: string;
      score: number;
      max: number;
      issuesFound: number;
      issuesDescription: string;
    }[]
  }[];
  total: number;
  maxTotal: number;
}>();

vi.mocked(getExplanation).mockImplementation((name: string) => {
  if (name === 'critical-bug') {
    return { fix: 'Check error handling.' };
  }
  if (name === 'minor-style') {
    return { fix: 'Refactor component structure.' };
  }
  return { fix: 'General review needed.' };
});

vi.mocked(printHeader).mockReturnValue(undefined);
vi.mocked(scoreColor).mockImplementation((score: number, max: number) => (str: string) => `${scoreColor.mock.results.length + 1} ${str}`);

describe('quickFixCommand', () => {
  let command: Command;

  // Mocking console.log/write to capture output easily
  let consoleWriteSpy: vi.SpyInstance;

  beforeEach(() => {
    // Setup fresh mocks
    vi.clearAllMocks();

    // Mock process.stdout.write to spy on output
    consoleWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => {});

    // Instantiate the command function
    // We must cast the function result because it returns a Command object
    command = require('../your-module-name').quickFixCommand();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should correctly register the quick-fix command structure', () => {
    // This test just verifies the structure setup
    expect(command.args[0]).toBe('quick-fix');
    expect(command.opts()).toHaveProperty('description');
    expect(command.opts()).toHaveProperty('arguments');
  });

  it('should handle the --apply flag by showing a message and exiting gracefully', async () => {
    // Simulate running with --apply
    await command.parse(process.argv, ['ratchet', 'quick-fix', '--apply']);

    // Check if the specific coming-soon message was printed
    expect(consoleWriteSpy).toHaveBeenCalledWith(
      chalk.cyan('Coming soon — use ratchet torque --focus <category> to fix automatically\n'),
    );
    // Ensure no scan was attempted
    (runScan as any).mock.results[0].value.mockResolvedValue();
    expect(runScan).not.toHaveBeenCalled();
  });

  describe('when running quick-fix without --apply', async () => {
    const mockScanSuccess = {
      categories: [
        {
          name: 'HighImpact',
          subcategories: [
            {
              name: 'critical-bug',
              score: 10,
              max: 30,
              issuesFound: 2,
              issuesDescription: 'Major bugs found.',
            },
            {
              name: 'medium-complexity',
              score: 5,
              max: 25,
              issuesFound: 1,
              issuesDescription: 'Needs refactoring.',
            },
          ],
        },
        {
          name: 'LowImpact',
          subcategories: [
            {
              name: 'minor-style',
              score: 1,
              max: 15,
              issuesFound: 5,
              issuesDescription: 'Formatting issues.',
            },
          ],
        },
      ],
      total: 16,
      maxTotal: 60,
    };

    beforeEach(() => {
      // Mock the scan to return predictable data
      vi.mocked(runScan).mockResolvedValue(mockScanSuccess);
    });

    it('should print initial messages and run the scan for the current directory', async () => {
      await command.parse(process.argv, ['ratchet', 'quick-fix']);

      // Check if the initial header and scanning message were printed
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        '  Current score: 16/60\n\n', // Score color mock output
      );
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        chalk.bold('  Top 3 improvements:\n\n'),
      );
      expect(runScan).toHaveBeenCalledWith('.');
    });

    it('should identify and process multiple improvements, prioritizing the top 3 by headroom', async () => {
      // The mock setup provides three candidates:
      // 1. critical-bug: headroom = 20 (30 - 10)
      // 2. medium-complexity: headroom = 20 (25 - 5)
      // 3. minor-style: headroom = 14 (15 - 1)
      //
      // Since headroom is equal for 1 and 2, order might be unstable, but both should be present.
      // Let's ensure all three are processed and the gains are calculated correctly.

      await command.parse(process.argv, ['ratchet', 'quick-fix']);

      // Check for the total gain message structure
      // The top 3 gains: 20 + 20 + 14 = 54
      // Total score: 16. Max score: 60.
      // Projected total = 16 + 54 = 70. Wait, min(70, 60) = 60.
      // The final reported gain should be (projected total) - (initial total) = 60 - 16 = 44.

      // Check the final cumulative gain message
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        chalk.cyan(
          `  Fix all 3 and gain up to ${chalk.bold(`+44 pts`)} ` +
          `(${'16/60'} → ${'60/60'})\n`,
        ),
      );
    });

    it('should handle the case where no improvements are available (perfect score)', async () => {
      const perfectScoreMock = {
        categories: [
          {
            name: 'Perfect',
            subcategories: [
              {
                name: 'none',
                score: 50,
                max: 50,
                issuesFound: 0,
                issuesDescription: 'None.',
              },
            ],
          },
        ],
        total: 50,
        maxTotal: 50,
      };

      vi.mocked(runScan).mockResolvedValue(perfectScoreMock);
      await command.parse(process.argv, ['ratchet', 'quick-fix']);

      // Check for the success message
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        chalk.green.bold('  🎉 Perfect score! No improvements needed.\n\n'),
      );
      // Ensure no top 3 improvement section was printed
      expect(consoleWriteSpy).toHaveBeenCalledTimes(
        // 1 (Header) + 1 (Scanning) + 1 (Perfect Score Message)
        3,
      );
    });

    it('should handle the case with only one top improvement', async () => {
      const singleImprovementMock = {
        categories: [
          {
            name: 'OnlyGood',
            subcategories: [
              {
                name: 'unique-fix',
                score: 5,
                max: 25,
                issuesFound: 1,
                issuesDescription: 'Only this issue.',
              },
            ],
          },
        ],
        total: 10,
        maxTotal: 50,
      };

      vi.mocked(runScan).mockResolvedValue(singleImprovementMock);
      await command.parse(process.argv, ['ratchet', 'quick-fix']);

      // Check for the rank 1 and the single improvement details
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        // Rank 1 printed
        expect.stringContaining('1. unique-fix'),
      );
      // Check the final cumulative gain calculation (gain = 20, projected = 30)
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        chalk.cyan(
          `  Fix all 3 and gain up to ${chalk.bold(`+20 pts`)} ` +
          `(${'10/50'} → ${'30/50'})\n`,
        ),
      );
    });

    it('should correctly display information for issues found and fixes', async () => {
      // Data structure designed to hit all output paths
      const comprehensiveMock = {
        categories: [
          {
            name: 'TestCat',
            subcategories: [
              {
                name: 'test-issue',
                score: 1,
                max: 10,
                issuesFound: 3,
                issuesDescription: 'Bad formatting.',
              },
            ],
          },
        ],
        total: 1,
        maxTotal: 50,
      };

      vi.mocked(runScan).mockResolvedValue(comprehensiveMock);
      await command.parse(process.argv, ['ratchet', 'quick-fix']);

      // Check for issues found section
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        `     3 Bad formatting.\n`,
      );
      // Check for the fix section
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        `     ${chalk.dim('Fix:')} General review needed.\n`,
      );
      // Check for the projected total section (headroom 9, projected 10)
      expect(consoleWriteSpy).toHaveBeenCalledWith(
        `     ${chalk.dim('→')} Fixing this would bring your score to ~10/50\n`,
      );
    });
  });
});


