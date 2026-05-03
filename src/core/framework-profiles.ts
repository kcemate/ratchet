/**
 * Framework profiles — define which scoring categories each framework handles
 * and the score adjustment weights to apply to avoid false positives.
 *
 * These profiles help prevent penalizing frameworks for features they provide
 * out of the box, such as:
 * - Prisma providing type safety
 * - Passport providing authentication
 * - Next.js providing error handling patterns
 */

import { Framework } from "./framework-detector.js";

/**
 * Scoring category definitions.
 * These correspond to the categories in the ClassicEngine scoring.
 */
export type ScoringCategory =
  | "Testing"
  | "Security"
  | "Type Safety"
  | "Error Handling"
  | "Performance"
  | "Code Quality";

/**
 * A framework profile defines:
 * - category: which scoring category is handled by the framework
 * - weight: the adjustment factor (0.0 to 1.0) applied to the score for that category
 *   - 1.0 = full credit (no adjustment needed)
 *   - 0.5 = half credit (partial handling)
 *   - 0.0 = no credit (framework handles it completely, so original score should be reduced)
 *
 * The adjustment is applied AFTER the initial scoring, reducing the penalty for
 * issues that the framework is expected to handle.
 */
export interface FrameworkProfile {
  name: string;
  category: ScoringCategory;
  weight: number;
}

/**
 * Framework profiles database.
 *
 * Key patterns:
 * - ORMs (Prisma, Drizzle, TypeORM) handle type safety → reduce penalties in Type Safety
 * - Auth libraries (Passport, Clerk, NextAuth) handle authentication → reduce penalties in Security
 * - Full-stack frameworks (Next.js, Remix) handle error handling and routing → reduce penalties in Error Handling and Performance
 * - Web frameworks may handle performance aspects → reduce Performance penalties
 */
const FRAMEWORK_PROFILES: Record<string, FrameworkProfile[]> = {
  express: [
    { name: "express", category: "Error Handling", weight: 0.5 }, // Express has built-in error handling patterns
    { name: "express", category: "Performance", weight: 0.3 }, // Express middleware can optimize performance
  ],
  fastify: [
    { name: "fastify", category: "Error Handling", weight: 0.5 },
    { name: "fastify", category: "Performance", weight: 0.7 }, // Fastify is optimized for performance
  ],
  nestjs: [
    { name: "nestjs", category: "Error Handling", weight: 0.8 }, // NestJS has robust exception filters
    { name: "nestjs", category: "Type Safety", weight: 0.6 }, // NestJS with TypeScript provides good type support
    { name: "nestjs", category: "Security", weight: 0.4 }, // NestJS has security guards/pipes
  ],
  next: [
    { name: "next", category: "Error Handling", weight: 0.9 }, // Next.js has built-in error pages and handling
    { name: "next", category: "Performance", weight: 0.8 }, // Next.js optimizations (static rendering, etc.)
    { name: "next", category: "Testing", weight: 0.3 }, // Next.js testing patterns differ
  ],
  remix: [
    { name: "remix", category: "Error Handling", weight: 0.9 },
    { name: "remix", category: "Performance", weight: 0.7 },
  ],
  hono: [
    { name: "hono", category: "Error Handling", weight: 0.4 },
    { name: "hono", category: "Performance", weight: 0.5 },
  ],
  elysia: [
    { name: "elysia", category: "Error Handling", weight: 0.6 },
    { name: "elysia", category: "Performance", weight: 0.4 },
  ],
  prisma: [
    { name: "prisma", category: "Type Safety", weight: 0.9 }, // Prisma provides strong type safety via Prisma Client
  ],
  "drizzle-orm": [{ name: "drizzle-orm", category: "Type Safety", weight: 0.85 }],
  typeorm: [
    { name: "typeorm", category: "Type Safety", weight: 0.6 }, // TypeORM provides some type safety but less than Prisma
  ],
  sequelize: [
    { name: "sequelize", category: "Type Safety", weight: 0.4 }, // Sequelize has weaker type safety
  ],
  passport: [
    { name: "passport", category: "Security", weight: 0.9 }, // Passport handles authentication
  ],
  clerk: [
    { name: "clerk", category: "Security", weight: 0.95 }, // Clerk provides full auth solution
  ],
  "next-auth": [{ name: "next-auth", category: "Security", weight: 0.9 }],
  authjs: [{ name: "authjs", category: "Security", weight: 0.9 }],
};

/**
 * Gets the framework profile for a given framework and category.
 * Returns undefined if no profile exists.
 */
export function getFrameworkProfile(framework: Framework, category: ScoringCategory): FrameworkProfile | undefined {
  const profiles = FRAMEWORK_PROFILES[framework.name];
  if (!profiles) return undefined;
  return profiles.find(p => p.category === category);
}

/**
 * Calculates the adjusted score for a category based on detected frameworks.
 *
 * @param frameworks - List of detected frameworks
 * @param category - The scoring category to adjust
 * @param originalScore - The original score before adjustment
 * @returns Adjusted score after applying framework weights
 */
export function adjustScoreForFrameworks(
  frameworks: Framework[],
  category: ScoringCategory,
  originalScore: number
): number {
  let adjustmentFactor = 1.0;

  // Collect all applicable weights for this category from detected frameworks
  const applicableWeights: number[] = [];

  for (const framework of frameworks) {
    const profile = getFrameworkProfile(framework, category);
    if (profile) {
      applicableWeights.push(profile.weight);
    }
  }

  if (applicableWeights.length > 0) {
    // Average the weights (or take min? Let's use average for now)
    const avgWeight = applicableWeights.reduce((a, b) => a + b, 0) / applicableWeights.length;
    adjustmentFactor = avgWeight;
  }

  // Apply adjustment: reduce the penalty (i.e., increase the score towards max)
  // But we never increase score beyond the category max
  return Math.min(originalScore / adjustmentFactor, originalScore); // Actually, we want to reduce the negative impact
}

/**
 * Determines if a framework should affect a particular scoring category.
 */
export function isCategoryAffectedByFramework(framework: Framework, category: ScoringCategory): boolean {
  return getFrameworkProfile(framework, category) !== undefined;
}
