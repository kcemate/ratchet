import { statSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Recursively find the latest mtime among all files in a directory.
 */
function latestMtime(dir: string): number {
  let latest = 0;
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" }) as import("fs").Dirent[];
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, String(entry.name));
    if (entry.isDirectory()) {
      // Skip node_modules and hidden dirs
      if (String(entry.name) === "node_modules" || String(entry.name).startsWith(".")) continue;
      const sub = latestMtime(full);
      if (sub > latest) latest = sub;
    } else if (entry.isFile()) {
      try {
        const stat = statSync(full);
        if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      } catch {
        // skip unreadable files
      }
    }
  }
  return latest;
}

/**
 * Check if any source file is newer than the compiled dist/index.js.
 * Returns a warning message string if stale, or null if up-to-date.
 *
 * Resolves paths relative to the package root (two levels up from dist/index.js).
 */
export function checkStaleBinary(): string | null {
  try {
    // __dirname equivalent for ESM: the directory of this compiled file (dist/)
    const thisFile = fileURLToPath(import.meta.url);
    const distDir = dirname(thisFile);
    const packageRoot = dirname(distDir);
    const distIndex = join(distDir, "index.js");
    const srcDir = join(packageRoot, "src");

    let distMtime: number;
    try {
      distMtime = statSync(distIndex).mtimeMs;
    } catch {
      // dist/index.js doesn't exist — can't check
      return null;
    }

    const srcMtime = latestMtime(srcDir);
    if (srcMtime === 0) {
      // No src directory found (installed from npm, not dev checkout)
      return null;
    }

    if (srcMtime > distMtime) {
      return "⚠ Source files are newer than the compiled binary. Run `npm run build` to update.";
    }

    return null;
  } catch {
    // Non-fatal — don't block the user
    return null;
  }
}
