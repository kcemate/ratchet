import type { SubCategory, IssueType } from '../../core/scanner';

const HIGH_SEVERITY_PATTERNS = /empty catch|hardcoded secret|sql injection|command injection|credential/i;
const LOW_SEVERITY_PATTERNS = /documentation|comment|naming/i;

export function inferSeverity(sub: SubCategory): IssueType['severity'] {
  const desc = sub.issuesDescription ?? sub.name;
  if (HIGH_SEVERITY_PATTERNS.test(desc)) return 'high';
  if (LOW_SEVERITY_PATTERNS.test(desc)) return 'low';
  return 'medium';
}

export function parseLocation(loc: string): { file: string; line?: number } {
  // Location can be "path/to/file" or "path/to/file:123".
  const lastColon = loc.lastIndexOf(':');
  if (lastColon > 0) {
    const potentialLine = parseInt(loc.slice(lastColon + 1), 10);
    if (!isNaN(potentialLine) && potentialLine > 0) {
      return { file: loc.slice(0, lastColon), line: potentialLine };
    }
  }
  return { file: loc };
}
