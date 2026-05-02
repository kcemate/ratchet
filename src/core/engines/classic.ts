/**
 * ClassicEngine — fast, deterministic heuristic scoring.
 *
 * All scoring logic that previously lived in src/commands/scan.ts is extracted
 * here so that scan.ts becomes a thin CLI shell. The public API is:
 *
 *   const engine = new ClassicEngine();
 *   const result = await engine.analyze('/path/to/project', options);
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ScanEngine, ScanEngineOptions } from '../scan-engine.js';
import type { ScanResult, CategoryResult, IssueType } from '../../core/scanner';
import type { Finding } from '../normalize.js';
import { getRuleBySubcategory } from '../finding-rules.js';
import {
  SEVERITY_MAP,
  findSourceFiles,
  readContents,
  isTestFile,
} from '../scan-constants.js';
import { classifyFiles, filterByClass } from '../file-classifier.js';
import { logger } from '../../lib/logger.js';
import { detectProjectLanguage } from '../detect-language.js';
import { detectFrameworks } from '../framework-detector.js';
import type { Framework } from '../framework-detector.js';
import { scoreTests, scoreSecurity, scoreTypes, scoreErrorHandling, scorePerformance, scoreCodeQuality } from './classic-scoring.js';
import { applyFrameworkAdjustments } from './classic-frameworks.js';
import { inferSeverity, parseLocation } from './classic-issues.js';

// ---------------------------------------------------------------------------
// ClassicEngine
// ---------------------------------------------------------------------------

export class ClassicEngine implements ScanEngine {
  readonly name = 'ClassicEngine';
  readonly mode = 'classic' as const;

  async analyze(cwd: string, options: ScanEngineOptions = {}): Promise<ScanResult> {
    let projectName = cwd.split('/').pop() ?? 'unknown';
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
        if (pkg.name) projectName = pkg.name;
      } catch (err) {
        logger.debug({ err }, 'Failed to read package.json for project name');
      }
    }

    const includeNonProduction = options.includeNonProduction ?? false;
    const allFiles = options.files ?? findSourceFiles(cwd, {
      scanProductionOnly: false,
      includeNonProduction,
    });
    const scoringFiles = options.includeTests
      ? allFiles
      : allFiles.filter(f => !isTestFile(f));
    const contents = readContents(allFiles);
    const fileClassifications = classifyFiles(scoringFiles);
    const prodFiles = filterByClass(scoringFiles, fileClassifications, 'production');

    const lang = options.lang ?? detectProjectLanguage(cwd);
    const detectedFrameworks: Framework[] = detectFrameworks(cwd);
    logger.debug(`Detected frameworks: ${detectedFrameworks.map(f => f.name).join(', ') || 'none'}`);

    const categories: CategoryResult[] = [
      scoreTests(allFiles, contents, cwd, lang),
      scoreSecurity(scoringFiles, contents, lang),
      scoreTypes(scoringFiles, cwd, contents, lang),
      scoreErrorHandling(scoringFiles, prodFiles, contents, lang),
      scorePerformance(scoringFiles, prodFiles, contents, lang),
      scoreCodeQuality(scoringFiles, contents),
    ];

    // Apply framework-aware scoring adjustments
    const adjustedCategories = applyFrameworkAdjustments(categories, detectedFrameworks);

    // Derive issuesByType from subcategory data
    const issuesByType: IssueType[] = [];
    for (const cat of adjustedCategories) {
      for (const sub of cat.subcategories) {
        if (sub.issuesFound > 0) {
          issuesByType.push({
            category: cat.name,
            subcategory: sub.name,
            count: sub.issuesFound,
            description: sub.issuesDescription ?? sub.summary,
            severity: inferSeverity(sub),
            locations: sub.locations,
          });
        }
      }
    }

    const totalIssuesFound = issuesByType.reduce((sum, i) => sum + i.count, 0);

    return { projectName, total: adjustedCategories.reduce((sum, c) => sum + c.score, 0), maxTotal: adjustedCategories.reduce((sum, c) => sum + c.max, 0), categories: adjustedCategories, totalIssuesFound, issuesByType };
  }

  /**
   * Run the classic analysis pipeline and ALSO produce a flat Finding[] alongside
   * the ScanResult. The existing analyze() return value is unchanged.
   *
   * Each Finding:
   *   - source: 'classic'
   *   - confidence: 1.0 (deterministic heuristics)
   *   - ruleId: looked up from RULE_REGISTRY via category + subcategory
   *   - file / line: first location from the subcategory's locations array (if any)
   */
  async analyzeWithFindings(
    cwd: string,
    options: ScanEngineOptions = {},
  ): Promise<{ result: ScanResult; findings: Finding[] }> {
    const result = await this.analyze(cwd, options);
    const findings: Finding[] = [];

    for (const cat of result.categories) {
      for (const sub of cat.subcategories) {
        if (sub.issuesFound === 0) continue;

        const rule = getRuleBySubcategory(cat.name, sub.name);
        const severityMap = SEVERITY_MAP[cat.name]?.[sub.name] ?? 'low';
        // Map 3-level severity to Finding severity.
        const severity: Finding['severity'] =
          severityMap === 'high' ? 'high' : severityMap === 'medium' ? 'medium' : 'low';

        const locations = sub.locations ?? [];

        if (locations.length > 0) {
          // One finding per location.
          for (const loc of locations) {
            const { file, line } = parseLocation(loc);
            findings.push({
              category: cat.name,
              subcategory: sub.name,
              severity,
              file,
              line,
              message: sub.issuesDescription ?? sub.summary,
              confidence: 1.0,
              source: 'classic',
              ruleId: rule?.id,
            });
          }
        } else {
          // One aggregate finding (no specific file/line).
          findings.push({
            category: cat.name,
            subcategory: sub.name,
            severity,
            message: sub.issuesDescription ?? sub.summary,
            confidence: 1.0,
            source: 'classic',
            ruleId: rule?.id,
          });
        }
      }
    }

    return { result, findings };
  }
}
