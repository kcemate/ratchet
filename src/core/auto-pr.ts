/**
 * Auto-PR: after the first successful push, detect if the README has a ratchet badge.
 * If not, create a new branch 'ratchet/add-badge', add badge markdown to the top of
 * README.md, and open a GitHub PR via the API.
 *
 * Config (.ratchet.yml):
 *   badge:
 *     auto-pr: true       # default
 *     categories: true    # include per-category badges
 *     style: flat         # badge style
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ScanResult } from "../core/scanner";
import { logger } from "../lib/logger.js";

// Stub badge URL helpers (full implementation in ratchet-pro via credentials)
function hostedBadgeUrl(owner: string, repo: string, style: string): string {
  return `https://ratchetcli.com/badge/${owner}/${repo}.svg?style=${style}`;
}
function hostedCategoryBadgeUrl(owner: string, repo: string, category: string, style: string): string {
  const slug = category.toLowerCase().replace(/\s+/g, "-");
  return `https://ratchetcli.com/badge/${owner}/${repo}/${slug}.svg?style=${style}`;
}

const execFileAsync = promisify(execFile);

export interface AutoPrConfig {
  autoPr: boolean;
  categories: boolean;
  style: string;
}

export function loadAutoPrConfig(cwd: string): AutoPrConfig {
  const defaults: AutoPrConfig = { autoPr: true, categories: true, style: "flat" };
  const configPath = join(cwd, ".ratchet.yml");
  if (!existsSync(configPath)) return defaults;
  try {
    // Parse minimal YAML badge section without a full YAML parser dependency
    const raw = readFileSync(configPath, "utf-8");
    const badgeSection = raw.match(/^badge:\s*\n((?:[ \t]+.+\n?)*)/m);
    if (!badgeSection) {
      logger.warn("No badge section found in .ratchet.yml, using defaults");
      return defaults;
    }

    const section = badgeSection[1]!;
    const autoPr = /auto-pr:\s*(false)/i.test(section) ? false : defaults.autoPr;
    const categories = /categories:\s*(false)/i.test(section) ? false : defaults.categories;
    const styleMatch = section.match(/style:\s*(\S+)/);
    const style = styleMatch ? styleMatch[1]! : defaults.style;

    return { autoPr, categories, style };
  } catch (err) {
    logger.warn({ err }, "Failed to parse .ratchet.yml badge config, using defaults");
    return defaults;
  }
}

/** Returns true if the README already has a ratchetcli badge reference. */
function hasRatchetBadge(readmeContent: string): boolean {
  return /ratchetcli\.com\/badge/i.test(readmeContent);
}

/** Build badge markdown block for the README. */
function buildBadgeBlock(owner: string, repo: string, result: ScanResult, config: AutoPrConfig): string {
  const style = config.style as "flat" | "flat-square" | "for-the-badge";
  const overallUrl = hostedBadgeUrl(owner, repo, style);
  const lines: string[] = [`[![Ratchet Score](${overallUrl})](https://ratchetcli.com/${owner}/${repo})`];

  if (config.categories) {
    for (const cat of result.categories) {
      const url = hostedCategoryBadgeUrl(owner, repo, cat.name, style);
      lines.push(`[![${cat.emoji} ${cat.name}](${url})](https://ratchetcli.com/${owner}/${repo})`);
    }
  }

  return lines.join(" ") + "\n\n";
}

async function gitSafe(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  } catch (err) {
    logger.debug({ args, err }, "git command failed");
    return "";
  }
}

export interface AutoPrResult {
  skipped: boolean;
  reason?: string;
  prUrl?: string;
  branch?: string;
}

/**
 * Attempt to auto-create a PR adding the ratchet badge to README.md.
 *
 * @param cwd - project root directory
 * @param owner - GitHub owner
 * @param repo - GitHub repo name
 * @param result - scan result (used for badge generation)
 * @param githubToken - GitHub API token (optional; reads GITHUB_TOKEN env if not provided)
 */
export async function runAutoPr(
  cwd: string,
  owner: string,
  repo: string,
  result: ScanResult,
  githubToken?: string
): Promise<AutoPrResult> {
  const config = loadAutoPrConfig(cwd);

  if (!config.autoPr) {
    return { skipped: true, reason: "auto-pr disabled in .ratchet.yml" };
  }

  const token = githubToken ?? process.env["GITHUB_TOKEN"];
  if (!token) {
    return { skipped: true, reason: "GITHUB_TOKEN not set — skipping auto-PR" };
  }

  const readmePath = join(cwd, "README.md");
  if (!existsSync(readmePath)) {
    return { skipped: true, reason: "README.md not found" };
  }

  const readmeContent = readFileSync(readmePath, "utf-8");
  if (hasRatchetBadge(readmeContent)) {
    return { skipped: true, reason: "README already has a ratchet badge" };
  }

  // Check if branch already exists
  const existingBranch = await gitSafe(["branch", "--list", "ratchet/add-badge"], cwd);
  if (existingBranch) {
    return { skipped: true, reason: "branch ratchet/add-badge already exists" };
  }

  // Check current branch so we can return to it if needed
  const originalBranch = await gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], cwd);

  try {
    // Create new branch
    await execFileAsync("git", ["checkout", "-b", "ratchet/add-badge"], { cwd });

    // Prepend badge block to README
    const badgeBlock = buildBadgeBlock(owner, repo, result, config);
    writeFileSync(readmePath, badgeBlock + readmeContent, "utf-8");

    // Commit
    await execFileAsync("git", ["add", "README.md"], { cwd });
    await execFileAsync("git", ["commit", "-m", "docs: add Ratchet score badges to README"], { cwd });

    // Push branch
    await execFileAsync("git", ["push", "origin", "ratchet/add-badge"], { cwd });

    // Create PR via GitHub API
    const prBody = [
      `## Add Ratchet Score Badge`,
      "",
      `This PR adds the [Ratchet](https://ratchetcli.com) code quality score badge to the README.`,
      "",
      `**Current score:** ${result.total}/${result.maxTotal}`,
      "",
      result.categories.map(c => `- ${c.emoji} **${c.name}:** ${c.score}/${c.max}`).join("\n"),
      "",
      "> Automatically generated by `ratchet push`",
    ].join("\n");

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "ratchet-run",
      },
      body: JSON.stringify({
        title: "docs: add Ratchet score badges to README",
        body: prBody,
        head: "ratchet/add-badge",
        base: originalBranch || "main",
      }),
    });

    const pr = (await response.json()) as { html_url?: string; message?: string };

    if (!response.ok) {
      return {
        skipped: false,
        branch: "ratchet/add-badge",
        reason: `PR creation failed: ${pr.message ?? response.statusText}`,
      };
    }

    return { skipped: false, branch: "ratchet/add-badge", prUrl: pr.html_url };
  } catch (err) {
    // Restore original branch on error
    await gitSafe(["checkout", originalBranch || "main"], cwd);
    return { skipped: true, reason: `auto-PR failed: ${(err as Error).message}` };
  }
}
