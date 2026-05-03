import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "../lib/logger.js";

/** Commands that ALWAYS require human confirmation (never auto-execute) */
export const BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf ~",
  "rm -rf .",
  "rm -rf *",
  "dd if=",
  "mkfs",
  "format",
  "sudo",
  "su ",
  "> /dev/sd",
  "> /dev/null",
  "git push --force",
  "git push -f",
  "git reset --hard",
  "curl | sh",
  "curl | bash",
  "wget | sh",
  "wget | bash",
  "eval ",
  "exec ",
  "chmod 777",
  "chmod -R 777",
  "kill -9 1",
  "killall",
  ":(){:|:&};:", // fork bomb
];

/** Dangerous patterns (regex) */
export const DANGEROUS_PATTERNS = [
  /rm\s+(-[a-z]*f[a-z]*\s+)?\/(?!tmp\b)/, // rm with force outside /tmp
  />\s*\/etc\//, // overwrite system config
  /curl.*\|\s*(ba)?sh/, // pipe-to-shell
  /\$\(.*\)/, // command substitution (flag for review)
  /;\s*rm\s/, // chained rm
  /&&\s*rm\s/, // chained rm
  /npm\s+publish/, // accidental publish
  /docker\s+rm/, // container deletion
  /DROP\s+(TABLE|DATABASE)/i, // SQL destruction
];

/** Protected paths — modifications always blocked in torque */
export const PROTECTED_PATHS = [
  ".git/",
  ".github/workflows/",
  ".env",
  ".env.local",
  ".env.production",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  pattern?: string;
}

export function validateCommand(command: string): SafetyResult {
  const normalized = command.trim().toLowerCase();

  // Check blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (normalized.includes(blocked.toLowerCase())) {
      return { allowed: false, reason: "blocked_command", pattern: blocked };
    }
  }

  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: "dangerous_pattern", pattern: pattern.source };
    }
  }

  return { allowed: true };
}

export function validateFileTarget(filePath: string): SafetyResult {
  const normalized = filePath.replace(/\\/g, "/");
  for (const protectedPath of PROTECTED_PATHS) {
    if (protectedPath.endsWith("/")) {
      // Directory: match prefix (starts with) or nested (contains /dir/)
      if (normalized.startsWith(protectedPath) || normalized.includes("/" + protectedPath)) {
        return { allowed: false, reason: "protected_path", pattern: protectedPath };
      }
    } else {
      // File: exact match or nested (e.g. some/path/.env)
      if (normalized === protectedPath || normalized.endsWith("/" + protectedPath)) {
        return { allowed: false, reason: "protected_path", pattern: protectedPath };
      }
    }
  }
  return { allowed: true };
}

/**
 * Scan a list of file paths for protected path violations.
 * Returns the list of violations found (empty = clean).
 */
export function scanForProtectedPaths(filePaths: string[]): Array<{ file: string; pattern: string }> {
  const violations: Array<{ file: string; pattern: string }> = [];
  for (const file of filePaths) {
    const result = validateFileTarget(file);
    if (!result.allowed && result.pattern) {
      violations.push({ file, pattern: result.pattern });
    }
  }
  return violations;
}

/**
 * Append a safety event to .ratchet/safety-log.json.
 * Non-fatal — errors are logged but don't abort the run.
 */
export async function logSafetyEvent(
  cwd: string,
  event: {
    type: "blocked_command" | "dangerous_pattern" | "protected_path";
    detail: string;
    pattern: string;
    timestamp: string;
  }
): Promise<void> {
  try {
    const ratchetDir = join(cwd, ".ratchet");
    await mkdir(ratchetDir, { recursive: true });
    const logPath = join(ratchetDir, "safety-log.json");

    let existing: unknown[] = [];
    try {
      const { readFile } = await import("fs/promises");
      const raw = await readFile(logPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // File doesn't exist yet — start fresh
    }

    existing.push(event);
    await writeFile(logPath, JSON.stringify(existing, null, 2), "utf-8");
  } catch (err) {
    logger.debug({ err }, "[safety] Failed to write safety log (non-fatal)");
  }
}
