/**
 * Engine Router — factory for selecting the right ScanEngine at runtime.
 *
 * Resolution order:
 *   1. Explicit `mode` argument passed to createEngine()
 *   2. RATCHET_ENGINE environment variable
 *   3. engine field in .ratchet.yml (via config.scan.engine)
 *   4. Default: 'classic'
 */

import type { ScanEngine } from "./scan-engine.js";
import type { RatchetConfig } from "../types.js";
import { ClassicEngine } from "./engines/index.js";
import { DeepEngine } from "./engines/index.js";
import { detectProvider, createProvider } from "./providers/index.js";
import type { ProviderConfig } from "./providers/index.js";

export interface CreateEngineOverrides {
  /** Override the scan model (deep engine only). Takes priority over env vars and config. */
  scanModel?: string;
}

export function createEngine(
  mode: "classic" | "deep" | "auto",
  config?: RatchetConfig,
  overrides?: CreateEngineOverrides
): ScanEngine {
  const envMode = process.env["RATCHET_ENGINE"] as "classic" | "deep" | undefined;
  const cfgMode = config?.scan?.engine as "classic" | "deep" | undefined;

  const resolvedMode: "classic" | "deep" = mode !== "auto" ? mode : (envMode ?? cfgMode ?? "classic");

  if (resolvedMode === "deep") {
    const providerConfig = resolveProviderConfig(config);
    const provider = providerConfig ? createProvider(providerConfig) : detectProvider();

    // Resolve scan model: CLI override > RATCHET_SCAN_MODEL env > config.scan.model
    const scanModel = overrides?.scanModel ?? process.env["RATCHET_SCAN_MODEL"] ?? config?.scan?.model;

    let scanProvider: import("./providers/base.js").Provider | undefined;
    if (scanModel) {
      scanProvider = providerConfig
        ? createProvider({ ...providerConfig, model: scanModel })
        : detectProvider(undefined, scanModel);
    }

    return new DeepEngine(provider, scanProvider);
  }

  return new ClassicEngine();
}

function resolveProviderConfig(config?: RatchetConfig): ProviderConfig | undefined {
  const envProvider = process.env["RATCHET_PROVIDER"] as ProviderConfig["provider"] | undefined;
  if (envProvider) {
    return {
      provider: envProvider,
      model: process.env["RATCHET_MODEL"],
    };
  }
  // Future: read from config.provider when RatchetConfig supports it
  return undefined;
}
