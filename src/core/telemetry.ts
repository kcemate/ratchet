/**
 * Anonymous telemetry — fires a single POST to api.ratchetcli.com/telemetry
 * with the event name and CLI version. No PII, no project data.
 * Disable with RATCHET_NO_TELEMETRY=1 or --no-telemetry.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";

let version = "unknown";
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  version = JSON.parse(readFileSync(pkgPath, "utf-8")).version;
} catch (err) {
  logger.debug({ err }, 'Failed to read package.json for version');
}

const API = "https://api.ratchetcli.com/telemetry";

export function trackEvent(event: string): void {
  if (process.env.RATCHET_NO_TELEMETRY === "1") return;
  // Fire and forget — never block, never throw
  fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, version }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
