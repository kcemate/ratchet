// providers.ts — Data providers and utilities
// Public API: File discovery, findSourceFiles, readContents, isTestFile

/**
 * Provides file discovery, content reading, and project metadata.
 */
export interface Providers {
  findSourceFiles(cwd: string): string[];
  readContents(filePath: string): string;
  isTestFile(filePath: string): boolean;
}

// Reserved extension point for file-related utilities extracted from classic.ts.
