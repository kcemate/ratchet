/**
 * ratchet graph — GitNexus knowledge graph management commands
 *
 * Subcommands:
 *   graph status           — show if indexed, file count, last indexed time
 *   graph index            — run gitnexus analyze
 *   graph query <cypher>   — run raw Cypher query
 *   graph impact <target>  — detailed blast radius analysis
 *   graph clusters         — show dependency clusters for all files
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { isIndexed, reindex, runCypher, getImpactDetailed, getDependencyClusters } from '../core/gitnexus.js';
import { logger } from '../lib/logger.js';

function getCwd(): string {
  return process.cwd();
}

/**
 * Show GitNexus index status for the current repo.
 */
async function graphStatus(): Promise<void> {
  const cwd = getCwd();
  const indexed = isIndexed(cwd);

  if (!indexed) {
    process.stdout.write(chalk.yellow('  ⚠ GitNexus is NOT indexed for this repo.\n'));
    process.stdout.write(`  Run ${chalk.cyan('ratchet graph index')} to build the knowledge graph.\n`);
    return;
  }

  const gitnexusDir = join(cwd, '.gitnexus');
  let lastIndexed = 'unknown';
  let fileCount = 'unknown';

  try {
    const stat = statSync(gitnexusDir);
    lastIndexed = stat.mtime.toLocaleString();
  } catch {
    // ignore
  }

  process.stdout.write(chalk.green('  ✓ GitNexus is indexed\n'));
  process.stdout.write(`  Last indexed: ${lastIndexed}\n`);
  if (fileCount !== 'unknown') {
    process.stdout.write(`  Files: ${fileCount}\n`);
  }
}

/**
 * Trigger a full re-index via gitnexus analyze.
 */
async function graphIndex(force: boolean): Promise<void> {
  const cwd = getCwd();
  process.stdout.write(chalk.cyan('  Indexing repository with GitNexus...\n'));

  const ok = await reindex(cwd, force);
  if (ok) {
    process.stdout.write(chalk.green('  ✓ Indexing complete\n'));
  } else {
    process.stdout.write(chalk.red('  ✗ Indexing failed or timed out\n'));
    process.stdout.write('  Make sure gitnexus is installed: npm install -g gitnexus\n');
    process.exit(1);
  }
}

/**
 * Run a raw Cypher query against the graph.
 */
async function graphQuery(cypher: string): Promise<void> {
  const cwd = getCwd();

  if (!isIndexed(cwd)) {
    process.stdout.write(chalk.yellow('  ⚠ GitNexus is not indexed. Run: ratchet graph index\n'));
    process.exit(1);
  }

  process.stdout.write(chalk.dim(`  Query: ${cypher}\n\n`));
  const result = await runCypher(cypher, cwd);

  if (result === null) {
    process.stdout.write(chalk.yellow('  No results (or GitNexus not available)\n'));
    return;
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

/**
 * Show detailed blast radius for a target file or symbol.
 */
async function graphImpact(target: string): Promise<void> {
  const cwd = getCwd();

  if (!isIndexed(cwd)) {
    process.stdout.write(chalk.yellow('  ⚠ GitNexus is not indexed. Run: ratchet graph index\n'));
    process.exit(1);
  }

  process.stdout.write(chalk.cyan(`  Analyzing blast radius for: ${target}\n\n`));

  const impact = await getImpactDetailed(target, cwd, {
    direction: 'upstream',
    includeTests: true,
  });

  if (!impact) {
    process.stdout.write(chalk.yellow(`  No impact data found for: ${target}\n`));
    process.stdout.write('  Make sure the file is indexed and the name matches.\n');
    return;
  }

  const dependentCount = impact.directCallers.length + impact.affectedFiles.length;
  const riskColor = impact.riskLevel === 'CRITICAL' ? chalk.red
    : impact.riskLevel === 'HIGH' ? chalk.yellow
    : chalk.green;

  process.stdout.write(`  Risk Level:    ${riskColor(impact.riskLevel)}\n`);
  process.stdout.write(`  Confidence:    ${(impact.confidence * 100).toFixed(0)}%\n`);
  process.stdout.write(`  Dependents:    ${dependentCount}\n`);

  if (impact.directCallers.length > 0) {
    process.stdout.write(`\n  Direct Callers (${impact.directCallers.length}):\n`);
    for (const caller of impact.directCallers.slice(0, 10)) {
      process.stdout.write(`    • ${caller}\n`);
    }
    if (impact.directCallers.length > 10) {
      process.stdout.write(`    ... and ${impact.directCallers.length - 10} more\n`);
    }
  }

  if (impact.affectedFiles.length > 0) {
    process.stdout.write(`\n  Affected Files (${impact.affectedFiles.length}):\n`);
    for (const file of impact.affectedFiles.slice(0, 10)) {
      process.stdout.write(`    • ${file}\n`);
    }
    if (impact.affectedFiles.length > 10) {
      process.stdout.write(`    ... and ${impact.affectedFiles.length - 10} more\n`);
    }
  }
}

/**
 * Show dependency clusters for the current repo.
 */
async function graphClusters(): Promise<void> {
  const cwd = getCwd();

  if (!isIndexed(cwd)) {
    process.stdout.write(chalk.yellow('  ⚠ GitNexus is not indexed. Run: ratchet graph index\n'));
    process.exit(1);
  }

  // Discover TypeScript/JavaScript files in src/
  const { execSync } = await import('child_process');
  let files: string[] = [];
  try {
    const output = execSync('find src -name "*.ts" -not -name "*.d.ts" -not -path "*/node_modules/*"', {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    files = output.trim().split('\n').filter(Boolean);
  } catch {
    process.stdout.write(chalk.yellow('  Could not enumerate source files.\n'));
    return;
  }

  if (files.length === 0) {
    process.stdout.write(chalk.yellow('  No source files found in src/\n'));
    return;
  }

  process.stdout.write(chalk.cyan(`  Computing dependency clusters for ${files.length} files...\n\n`));
  const clusters = getDependencyClusters(files, cwd);

  process.stdout.write(`  Found ${clusters.length} cluster(s):\n\n`);
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]!;
    process.stdout.write(chalk.bold(`  Cluster ${i + 1} (${cluster.length} files):\n`));
    for (const file of cluster.slice(0, 8)) {
      process.stdout.write(`    • ${file}\n`);
    }
    if (cluster.length > 8) {
      process.stdout.write(`    ... and ${cluster.length - 8} more\n`);
    }
    process.stdout.write('\n');
  }
}

/**
 * Register the `graph` command with the CLI.
 */
export function registerGraphCommand(program: Command): void {
  const graph = program
    .command('graph')
    .description('GitNexus knowledge graph management');

  graph
    .command('status')
    .description('Show if the repo is indexed by GitNexus')
    .action(async () => {
      try {
        await graphStatus();
      } catch (err) {
        logger.error({ err }, 'graph status failed');
        process.exit(1);
      }
    });

  graph
    .command('index')
    .description('Run gitnexus analyze to build/refresh the knowledge graph')
    .option('--force', 'Force full re-index even if already indexed', false)
    .action(async (opts: { force: boolean }) => {
      try {
        await graphIndex(opts.force);
      } catch (err) {
        logger.error({ err }, 'graph index failed');
        process.exit(1);
      }
    });

  graph
    .command('query <cypher>')
    .description('Run a raw Cypher query against the knowledge graph')
    .action(async (cypher: string) => {
      try {
        await graphQuery(cypher);
      } catch (err) {
        logger.error({ err }, 'graph query failed');
        process.exit(1);
      }
    });

  graph
    .command('impact <target>')
    .description('Show detailed blast radius for a file or symbol')
    .action(async (target: string) => {
      try {
        await graphImpact(target);
      } catch (err) {
        logger.error({ err }, 'graph impact failed');
        process.exit(1);
      }
    });

  graph
    .command('clusters')
    .description('Show dependency clusters for source files')
    .action(async () => {
      try {
        await graphClusters();
      } catch (err) {
        logger.error({ err }, 'graph clusters failed');
        process.exit(1);
      }
    });
}
