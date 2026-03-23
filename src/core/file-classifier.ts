export type FileClass = 'production' | 'test' | 'documentation' | 'config';

export function classifyFile(filePath: string): FileClass {
  const basename = filePath.split('/').pop() || '';

  // Test files
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(basename) ||
      /^(test|tests|__tests__)\//.test(filePath)) {
    return 'test';
  }

  // Documentation files
  if (/\.(md|txt)$/.test(basename) ||
      /^docs\//.test(filePath) ||
      /examples?\//.test(filePath) ||
      basename === 'explanations.ts' ||
      /\.example\.(ts|js)$/.test(basename)) {
    return 'documentation';
  }

  // Config files
  if (/\.(json|yml|yaml|toml)$/.test(basename) ||
      /\.config\.(ts|js|mjs|cjs)$/.test(basename) ||
      /^\.[a-z]+rc/.test(basename)) {
    return 'config';
  }

  return 'production';
}

export function classifyFiles(files: string[]): Map<string, FileClass> {
  const result = new Map<string, FileClass>();
  for (const f of files) result.set(f, classifyFile(f));
  return result;
}

export function filterByClass(files: string[], classifications: Map<string, FileClass>, ...include: FileClass[]): string[] {
  return files.filter(f => include.includes(classifications.get(f) ?? 'production'));
}
