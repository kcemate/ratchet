/**
 * Framework detector — identifies web frameworks and ORMs from package.json dependencies.
 * Used to apply framework-aware scoring heuristics that avoid false positives.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Framework categories and their associated dependency names.
 */
export interface Framework {
  name: string;
  category: string; // e.g., 'web-framework', 'orm', 'auth', 'ui-framework'
}

/**
 * List of supported frameworks and their detection keywords.
 * Categories:
 * - web-framework: traditional server-side MVC frameworks
 * - full-stack-framework: includes both client and server
 * - orm: object-relational mappers
 * - auth: authentication/authorization libraries
 * - ui-framework: UI component libraries or frameworks
 */
const FRAMEWORKS: Array<{ name: string; category: string; deps: string[] }> = [
  // Web frameworks
  { name: 'express', category: 'web-framework', deps: ['express', 'express-validator'] },
  { name: 'fastify', category: 'web-framework', deps: ['fastify'] },
  { name: 'nestjs', category: 'web-framework', deps: ['@nestjs/core', '@nestjs/common', '@nestjs/platform-express'] },
  { name: 'hono', category: 'web-framework', deps: ['hono'] },
  { name: 'elysia', category: 'web-framework', deps: ['elysia'] },
  { name: 'remix', category: 'full-stack-framework', deps: ['remix'] },
  { name: 'next', category: 'full-stack-framework', deps: ['next'] },
  
  // ORMs
  { name: 'prisma', category: 'orm', deps: ['prisma'] },
  { name: 'drizzle-orm', category: 'orm', deps: ['drizzle-orm'] },
  { name: 'typeorm', category: 'orm', deps: ['typeorm'] },
  { name: 'sequelize', category: 'orm', deps: ['sequelize'] },
  
  // Authentication
  { name: 'passport', category: 'auth', deps: ['passport', 'passport-local', 'passport-jwt', 'passport-google-oauth'] },
  { name: 'clerk', category: 'auth', deps: ['clerk'] },
  { name: 'next-auth', category: 'auth', deps: ['next-auth', 'next-auth-prisma'] },
  { name: 'authjs', category: 'auth', deps: ['auth'] }, // NextAuth.js v5 (Auth.js)
  
  // Other
  { name: 'socket.io', category: 'real-time', deps: ['socket.io', 'socket.io-client'] },
];

/**
 * Detects frameworks used in a project by scanning package.json dependencies.
 * 
 * @param cwd - Project root directory
 * @returns List of detected frameworks with their categories
 */
export function detectFrameworks(cwd: string): Framework[] {
  const pkgPath = join(cwd, 'package.json');
  const frameworks: Framework[] = [];

  try {
    if (!existsSync(pkgPath)) {
      return frameworks; // No package.json, no frameworks detected
    }

    const pkgContent = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    
    // Collect all dependency keys (including devDependencies, peerDependencies, etc.)
    const allDeps: Record<string, string> = {};
    if (pkg.dependencies) Object.assign(allDeps, pkg.dependencies);
    if (pkg.devDependencies) Object.assign(allDeps, pkg.devDependencies);
    if (pkg.peerDependencies) Object.assign(allDeps, pkg.peerDependencies);
    if (pkg.optionalDependencies) Object.assign(allDeps, pkg.optionalDependencies);

    // Normalize to lowercase for case-insensitive matching
    const depKeys = Object.keys(allDeps).map(k => k.toLowerCase());

    // Check each framework
    for (const framework of FRAMEWORKS) {
      for (const depName of framework.deps) {
        if (depKeys.includes(depName.toLowerCase())) {
          frameworks.push({ name: framework.name, category: framework.category });
          break; // Found one dependency, count as detected
        }
      }
    }
  } catch (error) {
    console.warn(`Framework detection warning: ${error instanceof Error ? error.message : error}`);
  }

  return frameworks;
}

// Helper for checking file existence
function existsSync(path: string): boolean {
  // Simple polyfill since we're not importing the whole fs module
  try {
    readFileSync(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
