import { describe, it } from 'vitest';
import { join } from 'path';
import { runScan } from '../src/commands/scan.js';

const CORPUS = join(__dirname, 'fixtures', 'scoring-corpus');

describe('calibrate', () => {
  it('dump scores', async () => {
    for (const f of ['minimal-ts', 'messy-js', 'mixed-quality']) {
      const result = await runScan(join(CORPUS, f));
      console.log(`=== ${f} === Total: ${result.total}/${result.maxTotal} Issues: ${result.totalIssuesFound}`);
      for (const cat of result.categories) {
        console.log(`  ${cat.name}: ${cat.score}/${cat.max}`);
        for (const sub of cat.subcategories) {
          console.log(`    ${sub.name}: ${sub.score}/${sub.max} issues=${sub.issuesFound} ${sub.issuesDescription || ''}`);
        }
      }
    }
  });
});
